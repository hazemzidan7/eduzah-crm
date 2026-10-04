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
 * Returns { batchId, createdCustomers, updatedCustomers, addedInterests, failedChunks, errors, droppedInvalidInterests, aborted, acceptedCustomerIds, nothingToDo? }.
 */
export async function runLeadImportCommit({
  plan, fileName, customers, nodeById,
  createBatch, updateBatch, commitLeadImportChunk,
  onProgress, chunkSize = LEAD_IMPORT_CHUNK_SIZE, now = new Date().toISOString(),
  sourceName,
}) {
  const errors = [];

  // IMPORT-SOURCE-01 (opt-in: only when the caller names the source). Every accepted lead — new, updated, or already
  // existing — gets this import's source recorded in `customers/{id}.importSources[]`. It is APPENDED, never rewritten:
  // a customer keeps every source it ever came from, and a source it already has (same name, any case) is not added
  // twice. Phone/username deduplication is untouched — a different source never makes a second customer.
  const cleanSourceName = String(sourceName ?? "").replace(/\s+/g, " ").trim();
  const sourceKey = cleanSourceName.toLowerCase();
  const storedSources = (customerId) => {
    const list = customers.find((x) => x.id === customerId)?.importSources;
    return Array.isArray(list) ? list : [];
  };
  const needsSource = (customerId) => !!sourceKey && !storedSources(customerId).some((e) => String(e?.sourceName ?? "").replace(/\s+/g, " ").trim().toLowerCase() === sourceKey);

  // Every ACCEPTED lead's REAL Firestore id, in the plan's original order (see leadImport.js's acceptedCustomers) —
  // an existing/updated customer's id was already known at plan time; a newly-created one only exists once its
  // chunk actually commits, so a create whose chunk failed is correctly left out (it was never written). Feeds
  // Sales distribution's sequential range assignment; nothing here writes anything by itself.
  const buildAcceptedCustomerIds = (createdKeyToId) =>
    (plan.acceptedCustomers || [])
      .map((entry) => (entry.kind === "create" ? createdKeyToId.get(entry.key) : entry.customerId))
      .filter(Boolean);

  // Position (1-based) of every accepted lead within THIS import's own accepted-lead order — rejected/skipped rows
  // never consume a position, so a 1200-row file that accepts 1000 leads numbers them 1..1000, never 1..1200. This
  // becomes `customers/{id}.importSequence` the FIRST time a customer is ever imported (see `needsSequence` below) —
  // it is the "#" column "عملاء جدد" displays, and it is never reassigned or renumbered on a later re-import.
  const positionByKey = new Map();
  const positionByCustomerId = new Map();
  (plan.acceptedCustomers || []).forEach((entry, i) => {
    const position = i + 1;
    if (entry.kind === "create") positionByKey.set(entry.key, position);
    else positionByCustomerId.set(entry.customerId, position);
  });
  const needsSequence = (customerId) => !customers.find((x) => x.id === customerId)?.importSequence;

  // Last line of defence: a NEW interest must be an active catalog Program (the planner only ever matches those,
  // but nothing that isn't one may reach Firestore). Ids already stored on a customer are kept untouched.
  let droppedInvalidInterests = 0;
  const ops = [];
  for (const c of plan.customersToCreate) {
    const { valid, invalid } = validateInterestedProgramIds(c.interestedProgramIds, { nodeById });
    droppedInvalidInterests += invalid.length;
    ops.push({
      type: "create",
      key: c.key,
      label: c.phone || c.whatsappUsername,
      interests: valid.length,
      pendingSequence: positionByKey.get(c.key),
      pendingSource: !!sourceKey,
      // whatsappUsername rides along as its own field (undefined — and so absent from the doc — for a phone-only lead).
      data: buildCustomerDoc({ fullName: c.fullName, phone: c.phone, secondaryPhones: c.secondaryPhones, notes: c.notes, whatsappUsername: c.whatsappUsername }, { now, interestedProgramIds: valid }),
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
    // Contact identifiers the planner decided to FILL IN on an existing customer (it never plans an overwrite).
    if (u.patch.whatsappUsername) patch.whatsappUsername = u.patch.whatsappUsername;
    if (u.patch.phone) { patch.phone = u.patch.phone; patch.normalizedPhone = u.patch.normalizedPhone; }
    if (u.patch.notes) patch.notes = u.patch.notes; // the old note + the appended import note (built by the planner)
    const pendingSequence = needsSequence(u.customerId) ? positionByCustomerId.get(u.customerId) : undefined;
    const pendingSource = needsSource(u.customerId);
    if (Object.keys(patch).length === 1 && pendingSequence === undefined && !pendingSource) continue; // nothing left to write
    ops.push({ type: "update", id: u.customerId, label: u.phone || u.customerId, interests, pendingSequence, pendingSource, patch });
  }
  // An existing customer this import matched with nothing else to change, but who has never been sequenced before
  // (their first appearance in any import) or doesn't have this source yet — still gets exactly one write.
  for (const entry of plan.acceptedCustomers || []) {
    if (entry.kind !== "unchanged") continue;
    const pendingSource = needsSource(entry.customerId);
    if (!needsSequence(entry.customerId) && !pendingSource) continue;
    ops.push({ type: "update", id: entry.customerId, label: entry.customerId, interests: 0, pendingSequence: needsSequence(entry.customerId) ? positionByCustomerId.get(entry.customerId) : undefined, pendingSource, patch: { updatedAt: now } });
  }

  if (ops.length === 0) {
    return { batchId: null, createdCustomers: 0, updatedCustomers: 0, addedInterests: 0, failedChunks: 0, errors, droppedInvalidInterests, aborted: false, acceptedCustomerIds: buildAcceptedCustomerIds(new Map()), nothingToDo: true };
  }

  // Tracking doc first. If it can't be created we stop BEFORE writing any customer, so nothing is ever imported untracked.
  let batchId;
  try {
    batchId = await createBatch({ kind: "customer_leads", fileName, ...(sourceKey ? { sourceName: cleanSourceName } : {}) });
  } catch (e) {
    errors.push({ code: "BATCH_CREATE_FAILED", message: e?.message || String(e) });
    return { batchId: null, createdCustomers: 0, updatedCustomers: 0, addedInterests: 0, failedChunks: 0, errors, droppedInvalidInterests, aborted: true, acceptedCustomerIds: buildAcceptedCustomerIds(new Map()) };
  }

  // Only now that batchId exists can a pending sequence number be finalized with the batch it belongs to.
  const sourceEntry = sourceKey ? { batchId, sourceName: cleanSourceName, fileName: fileName || "", importedAt: now } : null;
  for (const op of ops) {
    if (op.pendingSequence != null) {
      const seq = { importSequence: op.pendingSequence, importBatchId: batchId };
      if (op.type === "create") Object.assign(op.data, seq);
      else Object.assign(op.patch, seq);
    }
    if (op.pendingSource && sourceEntry) {
      if (op.type === "create") op.data.importSources = [sourceEntry];
      else op.patch.importSources = [...storedSources(op.id), sourceEntry]; // existing sources kept, this one appended
    }
  }

  const createdCustomerIds = [];
  const updatedCustomerIds = [];
  const createdKeyToId = new Map();
  let createdCustomers = 0, updatedCustomers = 0, addedInterests = 0, failedChunks = 0, errorCount = 0;

  for (let start = 0; start < ops.length; start += chunkSize) {
    const chunk = ops.slice(start, start + chunkSize);
    onProgress?.(start, ops.length);
    try {
      // Sequential on purpose: one atomic batch at a time keeps memory flat and lets the UI repaint between chunks.
      const newIds = await commitLeadImportChunk(chunk);
      createdCustomerIds.push(...newIds);
      createdCustomers += newIds.length;
      // `newIds` is in the same order as this chunk's create-type ops (see CustomerContext.commitLeadImportChunk) —
      // pair each one back to its plan `key` so acceptedCustomerIds can resolve a "create" entry to its real id.
      const createOpsInChunk = chunk.filter((op) => op.type === "create");
      createOpsInChunk.forEach((op, i) => createdKeyToId.set(op.key, newIds[i]));
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

  return { batchId, createdCustomers, updatedCustomers, addedInterests, failedChunks, errors, droppedInvalidInterests, aborted: false, acceptedCustomerIds: buildAcceptedCustomerIds(createdKeyToId) };
}
