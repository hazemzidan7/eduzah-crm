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
   * `customerIds` — the ordered accepted-lead list (LeadExcelImportPanel's
   * fresh `acceptedCustomerIds`, or an admin's manual row selection from
   * NewCustomersPage for a later reassignment). `sourceBatchId` is nullable —
   * present for a fresh-import distribution, absent for ad-hoc reassignment;
   * either way this is the SAME function, never a parallel system.
   *
   * Returns { errors, assignedCount, unchangedCount, perSales:[{salesId,salesName,count}], failedChunks }.
   * Only actually-changed customers are written — a retry after a network
   * failure, or a repeated confirm, recomputes the identical deterministic
   * assignment and only touches whatever didn't already get the right value.
   */
  const distributeLeads = async ({ customerIds, method, allocations, sourceBatchId = null }) => {
    const totalCount = (customerIds || []).length;
    const errors = validateDistribution({ method, totalCount, allocations });
    if (errors.length > 0) return { errors, assignedCount: 0, unchangedCount: 0, perSales: [], failedChunks: 0 };

    const allocationCounts = computeAllocationCounts({ method, totalCount, allocations });
    const assignments = buildSequentialAssignments(customerIds, allocationCounts, salesNameById);
    const now = new Date().toISOString();
    const { patches, unchangedCount } = buildAssignmentPatches(assignments, {
      customerById, method, sourceBatchId, currentUser, now,
    });

    const perSales = allocationCounts.map((a) => ({ salesId: a.salesId, salesName: salesNameById(a.salesId), count: a.count }));

    if (patches.length === 0) {
      return { errors: [], assignedCount: 0, unchangedCount, perSales, failedChunks: 0 };
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
          distribution: { method, assignedCount, unchangedCount, perSales, distributedBy: currentUser?.id || null, distributedAt: now },
        });
      } catch {
        // non-fatal: the customer-level assignment already committed above
      }
    }

    return { errors: commitErrors, assignedCount, unchangedCount, perSales, failedChunks };
  };

  return { activeSalesUsers, salesNameById, distributeLeads, customers };
}
