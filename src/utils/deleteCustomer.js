/**
 * ADMIN-DELETE-STUDENT — pure deletion-set builder. Given a customerId and
 * the already-loaded engagements/followUps/transactions arrays (the exact
 * same live data every admin session already holds via CustomerContext/
 * FollowUpContext/AccountingContext — no extra Firestore reads), computes
 * EXACTLY which documents belong to this one customer. No Firestore access
 * happens in this file; CustomerContext.deleteCustomerCascade does the
 * actual batched writes using this result.
 *
 * Every inclusion rule matches the approved spec precisely, and matches by
 * ID only — never by name/amount/date similarity:
 *  - engagements: engagement.customerId === target
 *  - payment records: the embedded paymentRecords[] on those engagements —
 *    deleted for free when the engagement doc is deleted; their real ids are
 *    still collected here so linked accountingTransactions/accountingEvents
 *    can be found
 *  - followUps: followUp.customerId === target
 *  - accountingTransactions: relatedCustomerId === target, OR
 *    relatedEngagementId is one of this customer's engagement ids, OR
 *    relatedPaymentId is one of this customer's payment ids
 *  - accountingEvents: doc id === one of this customer's payment ids (same
 *    "doc id = paymentId" convention CustomerContext.emitAccountingEvent
 *    already uses when creating them — see utils/accountingEvents.js)
 */
import { FOLLOW_UPS_COLLECTION } from "./followUps";
import { ACCOUNTING_TRANSACTIONS_COLLECTION } from "./accounting";
import { ACCOUNTING_EVENTS_COLLECTION } from "./accountingEvents";

export const CUSTOMERS_COLLECTION = "customers";
export const ENGAGEMENTS_COLLECTION = "engagements";

// Firestore's own writeBatch() hard limit is 500 operations per batch.
const FIRESTORE_BATCH_LIMIT = 500;

export function buildCustomerDeletionSet(customerId, { engagements, followUps, transactions } = {}) {
  if (!customerId) throw new Error("MISSING_CUSTOMER_ID");

  const customerEngagements = (engagements || []).filter((e) => e.customerId === customerId);
  const engagementIds = customerEngagements.map((e) => e.id);
  const engagementIdSet = new Set(engagementIds);

  const paymentIds = [];
  for (const e of customerEngagements) {
    for (const r of (e.paymentRecords || [])) {
      if (r?.id) paymentIds.push(r.id);
    }
  }
  const paymentIdSet = new Set(paymentIds);

  const followUpIds = (followUps || [])
    .filter((f) => f.customerId === customerId)
    .map((f) => f.id);

  const transactionIds = (transactions || [])
    .filter((t) => (
      t.relatedCustomerId === customerId
      || (t.relatedEngagementId && engagementIdSet.has(t.relatedEngagementId))
      || (t.relatedPaymentId && paymentIdSet.has(t.relatedPaymentId))
    ))
    .map((t) => t.id);

  // Attempting to delete a non-existent doc is a safe Firestore no-op, so
  // every real payment id is a valid candidate here without a pre-check.
  const eventIds = [...paymentIdSet];

  return {
    customerId,
    engagementIds,
    paymentIds,
    followUpIds,
    transactionIds,
    eventIds,
    counts: {
      engagements: engagementIds.length,
      paymentRecords: paymentIds.length,
      followUps: followUpIds.length,
      accountingTransactions: transactionIds.length,
      accountingEvents: eventIds.length,
    },
  };
}

/**
 * Flattens a deletion set into {collection, id} operations and chunks them
 * to stay under Firestore's per-batch limit. The customer doc is always the
 * very last operation across all chunks — if anything earlier fails, the
 * customer record itself is the last thing removed, so a failed/partial run
 * never leaves an orphaned customer with its related data already gone.
 */
export function chunkDeletionOps(deletionSet) {
  const ops = [
    ...deletionSet.engagementIds.map((id) => ({ collection: ENGAGEMENTS_COLLECTION, id })),
    ...deletionSet.followUpIds.map((id) => ({ collection: FOLLOW_UPS_COLLECTION, id })),
    ...deletionSet.transactionIds.map((id) => ({ collection: ACCOUNTING_TRANSACTIONS_COLLECTION, id })),
    ...deletionSet.eventIds.map((id) => ({ collection: ACCOUNTING_EVENTS_COLLECTION, id })),
    { collection: CUSTOMERS_COLLECTION, id: deletionSet.customerId },
  ];
  const chunks = [];
  for (let i = 0; i < ops.length; i += FIRESTORE_BATCH_LIMIT) {
    chunks.push(ops.slice(i, i + FIRESTORE_BATCH_LIMIT));
  }
  return chunks.length ? chunks : [[]];
}
