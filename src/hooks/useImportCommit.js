import { useCustomers } from "../context/CustomerContext";
import { useImportBatches } from "../context/ImportBatchContext";
import { useCustomFields } from "../context/CustomFieldContext";
import { normalizePhone, normalizeEmail } from "../utils/leadDedupe";
import { STUDENT_PROFILE_FIELD_KEYS } from "../constants/importCanonicalFields";

/**
 * Actually writes to Firestore — everything before this sub-phase was
 * preview-only. Commits sequentially (not in parallel) because the dedup
 * check needs an in-memory phone->customerId map that's updated as we go:
 * onSnapshot-backed React state lags a write by a round-trip, so two
 * same-phone rows processed back-to-back in one batch could otherwise both
 * pass the "no existing customer" check and create two customers.
 */
export function useImportCommit() {
  const {
    customers, findCustomerByPhone, findCustomerByEmail, addCustomer,
    findEngagement, addEngagement, mergeStudentProfile, logEngagementActivity,
    archiveCustomer, archiveEngagement,
  } = useCustomers();
  const { createBatch, updateBatch, markRolledBack } = useImportBatches();
  const { fieldDefById } = useCustomFields();

  const resolveTargetId = (wiz, record, field, dictionaryType) => {
    const raw = record[field];
    if (!raw) return null;
    return wiz.valueMap[`${dictionaryType}:${raw}`]?.targetId || null;
  };

  const extractCustomFields = (wiz, record) => {
    const out = {};
    for (const defId of wiz.profileVersion.customFieldDefIds || []) {
      const def = fieldDefById(defId);
      if (def && record[def.key] !== undefined && record[def.key] !== "") out[def.key] = record[def.key];
    }
    return out;
  };

  // Section 1 (Student Profile) only — whatever the column mapping actually
  // populated on this row. Never touches Section 2 (CRM Internal Data).
  const extractStudentProfile = (record) => {
    const out = {};
    for (const key of STUDENT_PROFILE_FIELD_KEYS) {
      if (record[key] !== undefined && record[key] !== "") out[key] = record[key];
    }
    return out;
  };

  /** `classified` = the array built by ValidationSummaryStep (record/index/status). */
  const commitImport = async (wiz, classified, onProgress) => {
    const batchId = await createBatch({
      fileName: wiz.parsed.fileName,
      importProfileId: wiz.profile.id,
      importProfileVersion: wiz.profileVersion.version,
    });

    const phoneMap = new Map(customers.filter((c) => c.normalizedPhone).map((c) => [c.normalizedPhone, c.id]));
    const createdCustomerIds = [];
    const createdEngagementIds = [];
    let createdCount = 0, updatedCount = 0, skippedCount = 0, errorCount = 0;

    for (let i = 0; i < classified.length; i++) {
      const c = classified[i];
      onProgress?.(i + 1, classified.length);

      if (c.status === "skipped" || c.status === "missingRequired" || c.status === "unknownValue") {
        skippedCount += 1;
        continue;
      }

      try {
        const record = c.record;
        const np = normalizePhone(record.phone);
        let customerId = phoneMap.get(np);
        let isNewCustomer = false;

        if (!customerId) {
          const existing = findCustomerByPhone(record.phone) || (record.email ? findCustomerByEmail(record.email) : null);
          if (existing) {
            customerId = existing.id;
          } else {
            customerId = await addCustomer(record);
            isNewCustomer = true;
          }
          phoneMap.set(np, customerId);
        }
        if (isNewCustomer) createdCustomerIds.push(customerId);

        const existingEngagement = findEngagement(customerId, wiz.profile.businessUnitId);
        if (c.status === "duplicateMerge" && existingEngagement) {
          // Section 1 only, and only fills gaps — never overwrites a value
          // sales already has, never touches Section 2 (CRM Internal Data).
          await mergeStudentProfile(existingEngagement.id, extractStudentProfile(record));
          await logEngagementActivity(existingEngagement.id, {
            type: "system",
            text: `Merged additional data from import: ${wiz.parsed.fileName}`,
          });
          updatedCount += 1;
        } else {
          const engagementId = await addEngagement(customerId, {
            businessUnitId: wiz.profile.businessUnitId,
            catalogNodeId: resolveTargetId(wiz, record, "programRaw", "program"),
            statusId: resolveTargetId(wiz, record, "statusRaw", "status") || wiz.profileVersion.defaultLeadStatusId,
            tagIds: wiz.profileVersion.defaultTagIds || [],
            studentProfile: extractStudentProfile(record),
            customFields: extractCustomFields(wiz, record),
            sourceImportBatchIds: [batchId],
            creationNote: `Imported from ${wiz.parsed.fileName}`,
          });
          createdEngagementIds.push(engagementId);
          createdCount += 1;
        }
      } catch (e) {
        errorCount += 1;
      }
    }

    await updateBatch(batchId, {
      status: "committed",
      createdCount, updatedCount, skippedCount, errorCount,
      createdCustomerIds, createdEngagementIds,
    });

    return { batchId, createdCount, updatedCount, skippedCount, errorCount };
  };

  /** Only ever archives what THIS batch created — merged/pre-existing records are never in these lists. */
  const rollbackBatch = async (batch) => {
    for (const id of batch.createdEngagementIds || []) await archiveEngagement(id);
    for (const id of batch.createdCustomerIds || []) await archiveCustomer(id);
    await markRolledBack(batch.id);
  };

  return { commitImport, rollbackBatch };
}
