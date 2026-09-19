import { useCustomers } from "../context/CustomerContext";
import { useImportBatches } from "../context/ImportBatchContext";
import { useCatalog } from "../context/CatalogContext";
import { buildCustomerDoc } from "../utils/customerDoc";
import { planLeadImport } from "../utils/leadImport";
import { normalizeInterestedProgramIds, validateInterestedProgramIds } from "../utils/interestedPrograms";

/** Firestore allows 500 operations per batch; stay well under it. Each customer create/update is one operation. */
export const LEAD_IMPORT_CHUNK_SIZE = 400;

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * LEAD-IMPORT-01 — writes a bulk lead import plan ("عملاء جدد" Excel upload).
 *
 * The ONLY place this feature touches Firestore, and it is only ever reached
 * from the explicit "استيراد العملاء" button. What it can write is fixed:
 *  - `customers` — new customer docs (via the shared buildCustomerDoc) and, for
 *    customers that already exist, a patch of `interestedProgramIds` (new ids
 *    APPENDED to the ones already stored) and/or an empty `fullName` filled in;
 *  - one `importBatches` tracking doc (kind "customer_leads").
 * No engagement, payment, accounting transaction, catalog node, lead status,
 * or user record is reachable from here.
 *
 * Safe to repeat: the plan is rebuilt against the CURRENT customer list right
 * before writing, so a second run of the same file finds every phone already
 * there and every interest already added — and writes nothing.
 */
export function useLeadImportCommit() {
  const { customers, commitLeadImportChunk } = useCustomers();
  const { nodes, nodeById } = useCatalog();
  const { createBatch, updateBatch } = useImportBatches();

  /** Plan against the live customer list + catalog (used for the preview and again, fresh, at confirm time). */
  const buildPlan = (input, opts = {}) => planLeadImport({ ...input, existingCustomers: customers, programs: nodes, ...opts });

  /**
   * `plan` = the result of buildPlan (re-derive it right before calling this).
   * Returns { batchId, createdCustomers, updatedCustomers, addedInterests, failedChunks, errors, aborted }.
   */
  const commitLeadImport = async ({ plan, fileName, onProgress }) => {
    const now = new Date().toISOString();
    const errors = [];

    // Last line of defence: a NEW interest must be an active catalog Program (the planner only ever matches those,
    // but nothing that isn't one may reach Firestore). Ids already stored on a customer are kept untouched.
    let droppedInvalidInterests = 0;
    const ops = [];
    for (const c of plan.customersToCreate) {
      const { valid, invalid } = validateInterestedProgramIds(c.interestedProgramIds, { nodeById });
      droppedInvalidInterests += invalid.length;
      ops.push({
        type: "create",
        label: c.phone,
        interests: valid.length,
        data: buildCustomerDoc({ fullName: c.fullName, phone: c.phone, secondaryPhones: c.secondaryPhones }, { now, interestedProgramIds: valid }),
      });
    }
    for (const u of plan.customersToUpdate) {
      const patch = { updatedAt: now };
      let interests = 0;
      if (u.patch.interestedProgramIds) {
        const existingIds = normalizeInterestedProgramIds(customers.find((x) => x.id === u.customerId)?.interestedProgramIds);
        const { valid, invalid } = validateInterestedProgramIds(u.patch.interestedProgramIds, { existingIds, nodeById });
        droppedInvalidInterests += invalid.length;
        interests = valid.filter((id) => !existingIds.includes(id)).length;
        if (interests > 0) patch.interestedProgramIds = valid;
      }
      if (u.patch.fullName) patch.fullName = u.patch.fullName;
      if (Object.keys(patch).length === 1) continue; // nothing left to write
      ops.push({ type: "update", id: u.customerId, label: u.phone || u.customerId, interests, patch });
    }

    if (ops.length === 0) {
      return { batchId: null, createdCustomers: 0, updatedCustomers: 0, addedInterests: 0, failedChunks: 0, errors, droppedInvalidInterests, aborted: false, nothingToDo: true };
    }

    // Tracking doc first. If it can't be created we stop BEFORE writing any customer, so nothing is ever imported untracked.
    let batchId;
    try {
      batchId = await createBatch({ kind: "customer_leads", fileName });
    } catch (e) {
      errors.push({ code: "BATCH_CREATE_FAILED", message: e?.message || String(e) });
      return { batchId: null, createdCustomers: 0, updatedCustomers: 0, addedInterests: 0, failedChunks: 0, errors, droppedInvalidInterests, aborted: true };
    }

    const createdCustomerIds = [];
    const updatedCustomerIds = [];
    let createdCustomers = 0, updatedCustomers = 0, addedInterests = 0, failedChunks = 0, errorCount = 0;

    for (let start = 0; start < ops.length; start += LEAD_IMPORT_CHUNK_SIZE) {
      const chunk = ops.slice(start, start + LEAD_IMPORT_CHUNK_SIZE);
      onProgress?.(start, ops.length);
      try {
        // Sequential on purpose: one atomic batch at a time keeps memory flat and lets the UI repaint between chunks.
        const newIds = await commitLeadImportChunk(chunk);
        createdCustomerIds.push(...newIds);
        createdCustomers += newIds.length;
        for (const op of chunk) {
          if (op.type === "update") { updatedCustomers += 1; updatedCustomerIds.push(op.id); }
          addedInterests += op.interests;
        }
      } catch (e) {
        // An atomic chunk either fully commits or not at all; earlier chunks stay committed and the run continues.
        failedChunks += 1;
        errorCount += chunk.length;
        errors.push({ code: "CHUNK_FAILED", from: start + 1, to: start + chunk.length, message: e?.message || String(e) });
      }
      await yieldToUi();
    }
    onProgress?.(ops.length, ops.length);

    try {
      await updateBatch(batchId, {
        status: failedChunks === 0 ? "committed" : "committed_with_errors",
        createdCount: createdCustomers,
        updatedCount: updatedCustomers,
        skippedCount: plan.stats.notImportedRows,
        errorCount,
        interestsAddedCount: addedInterests,
        createdCustomerIds,
        updatedCustomerIds,
      });
    } catch (e) {
      errors.push({ code: "BATCH_FINALIZE_FAILED", message: e?.message || String(e) });
    }

    return { batchId, createdCustomers, updatedCustomers, addedInterests, failedChunks, errors, droppedInvalidInterests, aborted: false };
  };

  return { buildPlan, commitLeadImport };
}
