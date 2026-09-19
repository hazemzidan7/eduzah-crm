import { useCustomers } from "../context/CustomerContext";
import { useImportBatches } from "../context/ImportBatchContext";
import { useCatalog } from "../context/CatalogContext";
import { planLeadImport } from "../utils/leadImport";
import { runLeadImportCommit } from "../utils/leadImportCommit";

export { LEAD_IMPORT_CHUNK_SIZE } from "../utils/leadImportCommit";

/**
 * LEAD-IMPORT-01 — wires the bulk lead import ("عملاء جدد" Excel upload) to the
 * real contexts. The planning and write logic live in utils/leadImport.js and
 * utils/leadImportCommit.js (pure, unit-tested); this hook only supplies the
 * live customers/catalog and the Firestore touch points. Reached for writing
 * only from the explicit "استيراد العملاء" button.
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

  /** `plan` = the result of buildPlan (re-derive it right before calling this). */
  const commitLeadImport = ({ plan, fileName, onProgress }) =>
    runLeadImportCommit({ plan, fileName, onProgress, customers, nodeById, createBatch, updateBatch, commitLeadImportChunk });

  return { buildPlan, commitLeadImport };
}
