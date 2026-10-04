import { SAFE_DELETE_CHUNK_SIZE, buildDeletionAuditEntry } from "./safeDelete";

/**
 * SAFE-DELETE-01 — the write phase of bulk customer deletion and "Delete
 * Import", kept free of React and Firestore (everything touching Firestore is
 * injected) so it can be exercised end to end in tests; hooks/
 * useSafeCustomerDeletion.js wires the real touch points.
 *
 * Reaching Firestore it can only ever do three things, all on `customers`:
 * delete a customer, rewrite a customer's `importSources`, and (for imports)
 * update the one importBatches doc + append one audit entry. It has no way to
 * address an engagement, payment record, accounting record, follow-up or
 * assignment history — they are not reachable from here.
 *
 * SAFETY, in this order, for every deletion chunk:
 *  1. `verifyLinked(ids)` asks Firestore AUTHORITATIVELY (not the possibly
 *     stale/partial live context) whether any engagement / follow-up /
 *     accounting record points at those ids; any hit is kept and reported as
 *     protected. If the check itself fails, the chunk is NOT deleted (an
 *     unverifiable customer is never assumed safe) and is reported as failed.
 *  2. only then are the verified-safe ids deleted, one atomic chunk at a time.
 * Chunks are independent: an earlier chunk that committed stays committed, a
 * failed one is reported with its exact size — the result never claims more
 * than what actually happened. Deleting an already-deleted customer is a
 * Firestore no-op and a retry re-plans from live data, so a double click or a
 * retry can never delete anything twice or reach anything new.
 */

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));
const toChunks = (arr, size) => { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; };
const msg = (e) => e?.message || String(e);

/** Verifies + deletes `ids` chunk by chunk. Mutates `acc` ({deleted, failed, failedIds, protectedList, errors}) and returns the ids found protected on the spot. */
async function deleteVerified(ids, { commitChunk, verifyLinked, chunkSize, onProgress, progress }, acc) {
  const newlyProtected = [];
  for (const chunk of toChunks(ids, chunkSize)) {
    onProgress?.(progress.done, progress.total);
    let safeIds = chunk;
    try {
      const found = await verifyLinked(chunk);
      safeIds = chunk.filter((id) => !found.has(id));
      for (const [id, reasons] of found) { acc.protectedList.push({ id, reasons, found: "verified" }); newlyProtected.push(id); }
    } catch (e) {
      acc.failed += chunk.length;
      acc.failedIds.push(...chunk);
      acc.errors.push({ code: "VERIFY_FAILED", count: chunk.length, message: msg(e) });
      progress.done += chunk.length;
      continue;
    }
    if (safeIds.length > 0) {
      try {
        await commitChunk(safeIds.map((id) => ({ type: "delete", id })));
        acc.deleted += safeIds.length;
      } catch (e) {
        acc.failed += safeIds.length;
        acc.failedIds.push(...safeIds);
        acc.errors.push({ code: "CHUNK_FAILED", count: safeIds.length, message: msg(e) });
      }
    }
    progress.done += chunk.length;
    await yieldToUi();
  }
  return newlyProtected;
}

/** Rewrites importSources on customers that STAY (never deletes). Returns how many were rewritten. */
async function applySourceEdits(edits, { commitChunk, chunkSize, now }, acc) {
  let applied = 0;
  const entries = [...edits.entries()];
  for (const chunk of toChunks(entries, chunkSize)) {
    try {
      await commitChunk(chunk.map(([id, importSources]) => ({ type: "update", id, patch: { importSources, updatedAt: now } })));
      applied += chunk.length;
    } catch (e) {
      acc.failed += chunk.length;
      acc.failedIds.push(...chunk.map(([id]) => id));
      acc.errors.push({ code: "SOURCE_EDIT_FAILED", count: chunk.length, message: msg(e) });
    }
    await yieldToUi();
  }
  return applied;
}

/**
 * Bulk delete of a selection. `plan` = planBulkDeletion(...). Returns
 * { requested, deleted, protected, protectedList, failed, failedIds, missing, errors, auditWritten }.
 */
export async function runBulkDeletion({
  plan, currentUser, commitChunk, verifyLinked, writeAudit, onProgress,
  chunkSize = SAFE_DELETE_CHUNK_SIZE, now = new Date().toISOString(),
}) {
  const acc = { deleted: 0, failed: 0, failedIds: [], protectedList: [...plan.protectedList], errors: [] };
  const progress = { done: 0, total: plan.deletable.length };
  await deleteVerified(plan.deletable, { commitChunk, verifyLinked, chunkSize, onProgress, progress }, acc);
  onProgress?.(progress.total, progress.total);

  let auditWritten = false;
  if (acc.deleted > 0 || acc.failed > 0) {
    try {
      await writeAudit(buildDeletionAuditEntry({
        action: "bulk_customer_delete", currentUser, now,
        requestedCount: plan.requested, affectedCustomerCount: acc.deleted,
        protectedCustomerCount: acc.protectedList.length, failedCount: acc.failed,
      }));
      auditWritten = true;
    } catch (e) {
      acc.errors.push({ code: "AUDIT_FAILED", message: msg(e) });
    }
  }
  return { requested: plan.requested, deleted: acc.deleted, protected: acc.protectedList.length, protectedList: acc.protectedList, failed: acc.failed, failedIds: acc.failedIds, missing: plan.missing.length, errors: acc.errors, auditWritten };
}

/**
 * Delete Import. `plan` = planImportDeletion(...). The batch is marked
 * "deleting" BEFORE any customer is touched (if that can't be written,
 * nothing is). On completion the batch doc is UPDATED, never removed — its
 * sourceName / fileName / createdAt / importedBy and its customer-id lists stay
 * as the audit trail: status "deleted" (+ rolledBackAt, deletedAt,
 * deletedById/Name, deletionSummary) when everything worked, otherwise
 * "deleted_partial" so the import stays listed and can simply be run again.
 */
export async function runImportDeletion({
  batch, plan, currentUser, commitChunk, verifyLinked, updateBatch, writeAudit, onProgress,
  chunkSize = SAFE_DELETE_CHUNK_SIZE, now = new Date().toISOString(),
}) {
  const empty = { deleted: 0, sourceRemoved: 0, protected: 0, preExisting: 0, failed: 0, failedIds: [], errors: [], auditWritten: false };
  if (batch.status === "deleted" || batch.rolledBackAt) return { ...empty, alreadyDeleted: true };

  try {
    await updateBatch(batch.id, { status: "deleting", deleteStartedAt: now, deleteStartedById: currentUser?.id || null });
  } catch (e) {
    return { ...empty, aborted: true, errors: [{ code: "BATCH_MARK_FAILED", message: msg(e) }] };
  }

  const acc = { deleted: 0, failed: 0, failedIds: [], protectedList: [], errors: [] };
  // 1. customers that stay: drop ONLY this import's entry from their importSources.
  let sourceRemoved = await applySourceEdits(plan.sourceEdits, { commitChunk, chunkSize, now }, acc);
  // 2. customers created only by this import and verified safe: delete.
  const progress = { done: 0, total: plan.deletable.length };
  const newlyProtected = await deleteVerified(plan.deletable, { commitChunk, verifyLinked, chunkSize, onProgress, progress }, acc);
  onProgress?.(progress.total, progress.total);
  // 3. anyone the authoritative check turned out to protect stays too — and also loses just this source link.
  const lateEdits = new Map(newlyProtected.filter((id) => plan.fallbackEdits?.has(id)).map((id) => [id, plan.fallbackEdits.get(id)]));
  if (lateEdits.size > 0) sourceRemoved += await applySourceEdits(lateEdits, { commitChunk, chunkSize, now }, acc);

  const protectedCount = plan.protectedKept.length + newlyProtected.length;
  const summary = { deleted: acc.deleted, sourceRemoved, removeSourceOnly: plan.removeSourceOnly.length, preExisting: plan.preExisting.length, protected: protectedCount, failed: acc.failed, missing: plan.missing.length };
  const ok = acc.failed === 0;
  try {
    await updateBatch(batch.id, ok
      ? { status: "deleted", rolledBackAt: now, deletedAt: now, deletedById: currentUser?.id || null, deletedByName: currentUser?.name || currentUser?.email || null, deletionSummary: summary }
      : { status: "deleted_partial", lastDeleteAttemptAt: now, deletionSummary: summary });
  } catch (e) {
    acc.errors.push({ code: "BATCH_FINALIZE_FAILED", message: msg(e) });
  }

  let auditWritten = false;
  try {
    await writeAudit(buildDeletionAuditEntry({
      action: "import_delete", currentUser, now, batchId: batch.id, sourceName: batch.sourceName || batch.fileName,
      requestedCount: plan.counts.linked, affectedCustomerCount: acc.deleted, protectedCustomerCount: protectedCount,
      failedCount: acc.failed, sourceRemovedCount: sourceRemoved,
    }));
    auditWritten = true;
  } catch (e) {
    acc.errors.push({ code: "AUDIT_FAILED", message: msg(e) });
  }

  return { ...summary, sourceRemoved, failedIds: acc.failedIds, errors: acc.errors, auditWritten, ok, status: ok ? "deleted" : "deleted_partial" };
}
