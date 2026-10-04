import { useMemo, useRef } from "react";
import { addDoc, collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useCustomers } from "../context/CustomerContext";
import { useFollowUps } from "../context/FollowUpContext";
import { useAccounting } from "../context/AccountingContext";
import { useImportBatches } from "../context/ImportBatchContext";
import {
  CUSTOMER_DELETION_AUDIT_COLLECTION, VERIFY_IN_CHUNK_SIZE,
  buildProtectionIndex, planBulkDeletion, buildBatchMembership, buildDeadBatchIds, planImportDeletion,
} from "../utils/safeDelete";
import { runBulkDeletion, runImportDeletion } from "../utils/safeDeleteRun";
import { ENGAGEMENTS_COLLECTION } from "../utils/deleteCustomer";
import { FOLLOW_UPS_COLLECTION } from "../utils/followUps";
import { ACCOUNTING_TRANSACTIONS_COLLECTION } from "../utils/accounting";

/**
 * SAFE-DELETE-01 — wires the pure planning (utils/safeDelete.js) and the
 * chunked, failure-reporting runner (utils/safeDeleteRun.js) to the real
 * contexts. Admin-only: the hook refuses for any other role, and Firestore
 * enforces the same (customers/importBatches/customerDeletionAudit writes are
 * isAdmin()-only). Previews are computed from the data the admin session
 * already holds (no extra reads, nothing downloaded just to delete a few
 * rows); the DELETE itself re-asks Firestore authoritatively (verifyLinked)
 * so a stale or still-loading live context can never make a customer with
 * linked records look safe. A single in-flight lock makes a double click or a
 * second tab-click on the same page a no-op.
 */
export function useSafeCustomerDeletion() {
  const { currentUser } = useAuth();
  const { customers, customerById, engagements, commitCustomerDeletionChunk } = useCustomers();
  const { followUps } = useFollowUps();
  const { transactions } = useAccounting();
  const { batches, updateBatch } = useImportBatches();
  const isAdmin = currentUser?.role === "admin";
  const lockRef = useRef(false);

  const index = useMemo(() => buildProtectionIndex({ engagements, followUps, transactions }), [engagements, followUps, transactions]);
  const membership = useMemo(() => buildBatchMembership(batches), [batches]);
  const deadBatchIds = useMemo(() => buildDeadBatchIds(batches), [batches]);

  const previewBulk = (customerIds) => planBulkDeletion(customerIds, { customerById, index });
  const previewImport = (batch) => planImportDeletion(batch, { customers, customerById, index, membership, deadBatchIds });

  /** Authoritative per-chunk check against Firestore: Map(customerId -> reasons[]) for every id that still has linked records. */
  const verifyLinked = async (ids) => {
    const found = new Map();
    const add = (id, reason) => { if (!found.has(id)) found.set(id, []); if (!found.get(id).includes(reason)) found.get(id).push(reason); };
    for (let i = 0; i < ids.length; i += VERIFY_IN_CHUNK_SIZE) {
      const part = ids.slice(i, i + VERIFY_IN_CHUNK_SIZE);
      const [eng, fu, tr] = await Promise.all([
        getDocs(query(collection(db, ENGAGEMENTS_COLLECTION), where("customerId", "in", part))),
        getDocs(query(collection(db, FOLLOW_UPS_COLLECTION), where("customerId", "in", part))),
        getDocs(query(collection(db, ACCOUNTING_TRANSACTIONS_COLLECTION), where("relatedCustomerId", "in", part))),
      ]);
      eng.forEach((d) => { const data = d.data(); add(data.customerId, "HAS_ENGAGEMENT"); if ((data.paymentRecords || []).length > 0) add(data.customerId, "HAS_PAYMENT"); });
      fu.forEach((d) => add(d.data().customerId, "HAS_FOLLOW_UP"));
      tr.forEach((d) => add(d.data().relatedCustomerId, "HAS_ACCOUNTING"));
    }
    return found;
  };

  const writeAudit = (entry) => addDoc(collection(db, CUSTOMER_DELETION_AUDIT_COLLECTION), entry);

  const guarded = async (fn) => {
    if (!isAdmin) return { forbidden: true };
    if (lockRef.current) return { busy: true };
    lockRef.current = true;
    try { return await fn(); } finally { lockRef.current = false; }
  };

  /** Re-plans from the live data at the moment of the click (never trusts an older preview), then deletes only what is safe. */
  const runBulk = (customerIds, { onProgress } = {}) => guarded(() => runBulkDeletion({
    plan: previewBulk(customerIds), currentUser, commitChunk: commitCustomerDeletionChunk, verifyLinked, writeAudit, onProgress,
  }));

  const runImport = (batchId, { onProgress } = {}) => guarded(() => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return { aborted: true, errors: [{ code: "BATCH_NOT_FOUND" }] };
    return runImportDeletion({
      batch, plan: previewImport(batch), currentUser, commitChunk: commitCustomerDeletionChunk, verifyLinked, updateBatch, writeAudit, onProgress,
    });
  });

  return { isAdmin, previewBulk, previewImport, runBulk, runImport };
}
