import { buildCustomerDoc } from "./customerDoc";
import { normalizeInterestedProgramIds, validateInterestedProgramIds } from "./interestedPrograms";

/** Firestore allows 500 operations per batch; stay well under it. Each customer create/update is one operation. */
export const LEAD_IMPORT_CHUNK_SIZE = 400;

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * LEAD-IMPORT-01 — the write phase of a bulk lead import, kept free of React
 * and Firestore so it can be exercised end to end in tests: the Firestore
 * touch points are injected (`createBatch`, `updateBatch`,
 * `commitLeadImportChunk`) and hooks/useLeadImportCommit.js wires them to the
 * real contexts.
 *
 * What it can write is fixed:
 *  - `customers` — new customer docs (via the shared buildCustomerDoc) and, for
 *    customers that already exist, a patch of `interestedProgramIds` (new ids
 *    APPENDED to the ones already stored) and/or an empty `fullName` filled in;
 *  - one `importBatches` tracking doc (kind "customer_leads"; NO import
 *    profile — lead imports don't use one).
 * No engagement, payment, accounting transaction, catalog node, lead status,
 * or user record is reachable from here.
 *
 * Returns { batchId, createdCustomers, updatedCustomers, addedInterests, failedChunks, errors, droppedInvalidInterests, aborted, nothingToDo? }.
 */
export async function runLeadImportCommit({
  plan, fileName, customers, nodeById,
  createBatch, updateBatch, commitLeadImportChunk,
  onProgress, chunkSize = LEAD_IMPORT_CHUNK_SIZE, now = new Date().toISOString(),
}) {
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
      data: buildCustomerDoc({ fullName: c.fullName, phone: c.phone, secondaryPhones: c.secondaryPhones, notes: c.notes }, { now, interestedProgramIds: valid }),
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
    if (u.patch.notes) patch.notes = u.patch.notes; // the old note + the appended import note (built by the planner)
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

  for (let start = 0; start < ops.length; start += chunkSize) {
    const chunk = ops.slice(start, start + chunkSize);
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
}
