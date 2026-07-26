import { useCatalog } from "../context/CatalogContext";
import { useLeadStatus } from "../context/LeadStatusContext";
import { useCustomFields } from "../context/CustomFieldContext";
import { useDictionary } from "../context/DictionaryContext";
import { useCustomers } from "../context/CustomerContext";
import { parseWorkbookFile } from "../utils/importEngine/fileParser";
import { bestFuzzyMatch } from "../utils/importEngine/similarity";
import { cleanPhone, cleanEmail, cleanWhitespace, splitMultiValue } from "../utils/importEngine/dataCleaning";
import { CANONICAL_FIELDS } from "../constants/importCanonicalFields";

const FUZZY_THRESHOLD = 0.72;

/**
 * Orchestrates the recognition/cleaning/dedup logic on top of the already-
 * encapsulated Firestore contexts — this hook itself never touches Firestore
 * directly, it only composes useX() hooks that already do. No commit logic
 * lives here yet (sub-phase 5); this is read-only analysis.
 */
export function useImportEngine() {
  const { businessUnits, descendantsOf } = useCatalog();
  const { effectiveStatuses } = useLeadStatus();
  const { fieldDefsForBusinessUnit } = useCustomFields();
  const { findMapping } = useDictionary();
  const { findCustomerByPhone, findCustomerByEmail, findEngagement } = useCustomers();

  // ── Stage 1-2: Upload + Worksheet/Header detection ──────────────────
  const analyzeFile = (file) => parseWorkbookFile(file);

  // ── Stage 3: Column Recognition ──────────────────────────────────────
  // Dictionary exact match first; falls back to fuzzy matching against the
  // core Customer/Engagement fields plus this Business Unit's own custom
  // fields. Never returns a silent guess — `source` always says how it decided.
  const recognizeColumn = (header, businessUnitId) => {
    const dictHit = findMapping("column", header);
    if (dictHit) {
      return { field: dictHit.targetId, source: "dictionary", confidence: 1, dictionaryEntryId: dictHit.id };
    }

    const candidates = [
      ...CANONICAL_FIELDS.flatMap((f) => [
        { field: f.key, text: f.label_ar },
        { field: f.key, text: f.label_en },
      ]),
      ...fieldDefsForBusinessUnit(businessUnitId).flatMap((f) => [
        { field: f.key, text: f.label_ar },
        { field: f.key, text: f.label_en },
      ]),
    ];
    const match = bestFuzzyMatch(header, candidates, FUZZY_THRESHOLD);
    if (match && match.matched) {
      return { field: match.field, source: "fuzzy", confidence: match.score };
    }
    return { field: null, source: "unknown", confidence: 0 };
  };

  // ── Stage 4: Value Recognition ────────────────────────────────────────
  // Same dictionary-first, fuzzy-fallback shape, but the fuzzy candidate list
  // depends on dictionaryType: real leadStatuses/catalogNodes for structural
  // types, nothing to fuzzy-match against yet for purely descriptive ones
  // (university/faculty/city/...) beyond what's already in the dictionary.
  const recognizeValue = (dictionaryType, rawValue, businessUnitId = null) => {
    const dictHit = findMapping(dictionaryType, rawValue, businessUnitId);
    if (dictHit) {
      return {
        targetType: dictHit.targetType, targetId: dictHit.targetId, canonicalText: dictHit.canonicalText,
        source: "dictionary", confidence: 1, dictionaryEntryId: dictHit.id,
      };
    }

    if (dictionaryType === "status") {
      const candidates = effectiveStatuses(businessUnitId).flatMap((s) => [
        { targetId: s.id, text: s.name_ar }, { targetId: s.id, text: s.name_en },
      ]);
      const match = bestFuzzyMatch(rawValue, candidates, FUZZY_THRESHOLD);
      if (match && match.matched) {
        return { targetType: "leadStatusId", targetId: match.targetId, source: "fuzzy", confidence: match.score };
      }
    }

    if (dictionaryType === "businessUnit") {
      const candidates = businessUnits.flatMap((n) => [
        { targetId: n.id, text: n.name_ar }, { targetId: n.id, text: n.name_en },
      ]);
      const match = bestFuzzyMatch(rawValue, candidates, FUZZY_THRESHOLD);
      if (match && match.matched) {
        return { targetType: "catalogNodeId", targetId: match.targetId, source: "fuzzy", confidence: match.score };
      }
    }

    if (dictionaryType === "program") {
      // Every node under this Business Unit (category/program/batch, whatever
      // depth it actually sits at — the catalog's depth is intentionally
      // flexible, see Milestone 1) is a fair candidate for "which program".
      const pool = businessUnitId ? descendantsOf(businessUnitId) : [];
      const candidates = pool.flatMap((n) => [
        { targetId: n.id, text: n.name_ar }, { targetId: n.id, text: n.name_en },
      ]);
      const match = bestFuzzyMatch(rawValue, candidates, FUZZY_THRESHOLD);
      if (match && match.matched) {
        return { targetType: "catalogNodeId", targetId: match.targetId, source: "fuzzy", confidence: match.score };
      }
    }

    return { targetType: null, targetId: null, canonicalText: null, source: "unknown", confidence: 0 };
  };

  // ── Stage 5: Data Cleaning ────────────────────────────────────────────
  const cleanValueForField = (fieldKey, rawValue) => {
    if (fieldKey === "phone" || fieldKey === "secondaryPhone" || fieldKey === "whatsapp") return cleanPhone(rawValue);
    if (fieldKey === "email") return cleanEmail(rawValue);
    return cleanWhitespace(rawValue);
  };

  /** Applies a column map ({header: fieldKey}) to one raw row, cleaning each value. */
  const cleanRecord = (rawRow, columnMap) => {
    const record = {};
    for (const [header, value] of Object.entries(rawRow)) {
      const fieldKey = columnMap[header];
      if (!fieldKey) continue;
      record[fieldKey] = cleanValueForField(fieldKey, value);
    }
    // A phone cell can legitimately hold more than one number ("01xxxxxxxxx - 01xxxxxxxxx").
    const rawPhoneCell = Object.entries(rawRow).find(([h]) => columnMap[h] === "phone")?.[1];
    const splitPhones = splitMultiValue(rawPhoneCell).map(cleanPhone).filter(Boolean);
    if (splitPhones.length > 1) {
      record.phone = splitPhones[0];
      record.secondaryPhones = splitPhones.slice(1);
    }
    return record;
  };

  // ── Stage 6: Duplicate Detection ──────────────────────────────────────
  // Within the uploaded file itself — grouped by cleaned phone.
  const findDuplicatesWithinBatch = (records) => {
    const groups = new Map();
    records.forEach((r, i) => {
      const key = r.phone;
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    });
    return [...groups.entries()].filter(([, idxs]) => idxs.length > 1).map(([phone, idxs]) => ({ phone, recordIndexes: idxs }));
  };

  // Against the existing CRM — two levels, per the approved architecture:
  // person-level (does this phone/email already belong to a customer?) and,
  // if so, engagement-level (does that customer already have a relationship
  // with this Business Unit?).
  const findDuplicateAgainstCrm = (record, businessUnitId) => {
    const customer = findCustomerByPhone(record.phone) || (record.email ? findCustomerByEmail(record.email) : null);
    if (!customer) return { customerMatch: null, engagementMatch: null };
    const engagement = businessUnitId ? findEngagement(customer.id, businessUnitId) : null;
    return { customerMatch: customer, engagementMatch: engagement };
  };

  return {
    analyzeFile,
    recognizeColumn,
    recognizeValue,
    cleanRecord,
    findDuplicatesWithinBatch,
    findDuplicateAgainstCrm,
  };
}
