import { arrayUnion } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { useCustomers } from "../context/CustomerContext";
import { useImportBatches } from "../context/ImportBatchContext";
import {
  selectActiveSalesUsers, validateDistribution, computeAllocationCounts,
  buildSequentialAssignments, buildAssignmentPatches, chunkDistributionOps,
} from "../utils/leadDistribution";

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Wires utils/leadDistribution.js's pure computation to the real contexts —
 * same pattern as hooks/useLeadImportCommit.js. The write itself reuses
 * CustomerContext.commitLeadImportChunk completely unmodified (this only ever
 * sends it `{type:"update", id, patch}` ops, the exact shape it already
 * handles for the lead import's own customer updates); no new Firestore write
 * path, no new collection.
 */
export function useLeadDistribution() {
  const { users, currentUser } = useAuth();
  const { customers, customerById, commitLeadImportChunk } = useCustomers();
  const { updateBatch } = useImportBatches();

  const activeSalesUsers = selectActiveSalesUsers(users);
  const salesNameById = (id) => activeSalesUsers.find((u) => u.id === id)?.name || (users || []).find((u) => u.id === id)?.name || null;

  /**
   * `customerIds` — an ordered pool of customer ids (the unassigned pool in
   * import order, a fresh import's own accepted ids, or an admin's manual
   * selection). `mode` is the safety switch the spec requires kept separate:
   *  - "distribute" (default): UNASSIGNED -> SALES. Any id in `customerIds`
   *    that is ALREADY assigned is filtered out before anything is computed —
   *    a normal distribution never silently touches or overwrites an existing
   *    Sales owner, no matter what the caller passed in.
   *  - "reassign": SALES A -> SALES B (or UNASSIGNED -> SALES, for a manual
   *    pick that happens to include an unassigned one). No such filter — this
   *    is the one explicit path allowed to change an existing assignment.
   * `sourceBatchId` is nullable — present when this distribution is tied to
   * one fresh import, absent for an ad-hoc pool/selection; either way this is
   * the SAME function, never a parallel system. `distributeCount` only
   * matters for the "equal" method (how many of the pool to split — defaults
   * to the whole filtered pool, i.e. "distribute all").
   *
   * A distribution or reassignment NEVER has to cover the whole pool — only
   * as many as the chosen allocations add up to; the rest is left exactly as
   * it was (see `remaining` on the result).
   *
   * Returns { errors, assignedCount, unchangedCount, remaining, skippedAlreadyAssigned, perSales:[{salesId,salesName,count}], failedChunks }.
   * Only actually-changed customers are written — a retry after a network
   * failure, or a repeated confirm, recomputes the identical deterministic
   * assignment and only touches whatever didn't already get the right value.
   */
  const distributeLeads = async ({ customerIds, method, allocations, distributeCount, sourceBatchId = null, mode = "distribute" }) => {
    const pool = mode === "reassign"
      ? (customerIds || [])
      : (customerIds || []).filter((id) => !customerById(id)?.assignedToId);
    const skippedAlreadyAssigned = (customerIds || []).length - pool.length;

    const availableCount = pool.length;
    const errors = validateDistribution({ method, availableCount, allocations, distributeCount });
    if (errors.length > 0) return { errors, assignedCount: 0, unchangedCount: 0, remaining: availableCount, skippedAlreadyAssigned, perSales: [], failedChunks: 0 };

    const allocationCounts = computeAllocationCounts({ method, availableCount, allocations, distributeCount });
    const assignments = buildSequentialAssignments(pool, allocationCounts, salesNameById);
    const now = new Date().toISOString();
    const { patches, unchangedCount } = buildAssignmentPatches(assignments, {
      customerById, method, sourceBatchId, currentUser, now,
    });

    const perSales = allocationCounts.map((a) => ({ salesId: a.salesId, salesName: salesNameById(a.salesId), count: a.count }));
    const remaining = availableCount - allocationCounts.reduce((s, a) => s + a.count, 0);

    if (patches.length === 0) {
      return { errors: [], assignedCount: 0, unchangedCount, remaining, skippedAlreadyAssigned, perSales, failedChunks: 0 };
    }

    const ops = patches.map(({ customerId, patch, historyEntry }) => ({
      type: "update",
      id: customerId,
      patch: { ...patch, assignmentHistory: arrayUnion(historyEntry) },
    }));

    let failedChunks = 0;
    let assignedCount = 0;
    const commitErrors = [];
    for (const chunk of chunkDistributionOps(ops)) {
      try {
        await commitLeadImportChunk(chunk);
        assignedCount += chunk.length;
      } catch (e) {
        failedChunks += 1;
        commitErrors.push({ code: "DISTRIBUTION_CHUNK_FAILED", message: e?.message || String(e) });
      }
      await yieldToUi();
    }

    // Best-effort summary on the originating import batch, if any — never blocks or fails the distribution itself,
    // and never re-shapes the batch doc's own required fields (see firestore.rules' importBatches update allow-list).
    if (sourceBatchId) {
      try {
        await updateBatch(sourceBatchId, {
          distribution: { method, assignedCount, unchangedCount, remaining, perSales, distributedBy: currentUser?.id || null, distributedAt: now },
        });
      } catch {
        // non-fatal: the customer-level assignment already committed above
      }
    }

    return { errors: commitErrors, assignedCount, unchangedCount, remaining, skippedAlreadyAssigned, perSales, failedChunks };
  };

  return { activeSalesUsers, salesNameById, distributeLeads, customers };
}
