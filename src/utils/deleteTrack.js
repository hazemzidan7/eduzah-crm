/**
 * ADMIN-DELETE-TRACK — pure deletion-set builder for "delete all students of
 * one Track (Program)". Extends utils/deleteCustomer.js rather than
 * duplicating it: every customer whose ONLY engagement(s) are in the
 * selected Track goes through the exact same buildCustomerDeletionSet used
 * by the single-student delete feature (GROUP A — full customer delete).
 * A customer who ALSO has an engagement outside the selected Track is never
 * deleted — only their in-Track engagement(s) and the records that belong
 * specifically to those engagements/payments are removed (GROUP B —
 * engagement-only delete). See DeleteTrackModal.jsx for the confirmation UI
 * and CustomerContext.deleteTrackCascade for the actual batched writes.
 *
 * No Firestore access happens in this file, same split as deleteCustomer.js.
 * Matches by ID only, never by name/amount/date similarity.
 */
import { buildCustomerDeletionSet, CUSTOMERS_COLLECTION, ENGAGEMENTS_COLLECTION } from "./deleteCustomer";
import { FOLLOW_UPS_COLLECTION } from "./followUps";
import { ACCOUNTING_TRANSACTIONS_COLLECTION } from "./accounting";
import { ACCOUNTING_EVENTS_COLLECTION } from "./accountingEvents";

const FIRESTORE_BATCH_LIMIT = 500;

/**
 * Builds the full Track deletion plan. `trackNodeIds` must be the selected
 * Track's own catalogNodeId plus every descendant node id (e.g. future
 * "batch" nodes under a Program) — the same scoping ProgramWorkspace already
 * uses to decide which engagements "belong to this Track" for its own
 * stats, so the preview here can never disagree with what the Track page
 * itself shows as enrolled.
 *
 * For every customer touched by an in-Track engagement, ALL of that
 * customer's engagements (not just the in-Track ones) are checked — a
 * customer with any engagement whose catalogNodeId falls OUTSIDE
 * trackNodeIds keeps their customer record and every other engagement;
 * only their in-Track engagement(s) are removed (GROUP B). A customer whose
 * every engagement is inside trackNodeIds is fully deleted via the existing,
 * unmodified buildCustomerDeletionSet (GROUP A).
 */
export function buildTrackDeletionPlan(trackNodeIds, { engagements, followUps, transactions, customers } = {}) {
  const idsArr = Array.isArray(trackNodeIds) ? trackNodeIds : [trackNodeIds];
  if (idsArr.length === 0 || idsArr.some((id) => !id)) throw new Error("MISSING_TRACK_ID");
  const trackIdSet = new Set(idsArr);

  const allEngagements = engagements || [];
  // Archived engagements are excluded here (same !e.archivedAt rule
  // ProgramWorkspace's own scopedEngagements uses) so "students affected"
  // in the preview always matches this Track page's own "Total Students"
  // stat — an admin bulk-deleting what they just saw on screen. Once a
  // customer IS discovered this way, their full engagement set (archived
  // included) is still what actually gets evaluated/deleted below, same as
  // the single-student delete feature already does.
  const trackEngagements = allEngagements.filter((e) => !e.archivedAt && trackIdSet.has(e.catalogNodeId));

  const customerIds = [...new Set(trackEngagements.map((e) => e.customerId))];
  const customerById = (id) => (customers || []).find((c) => c.id === id) || null;

  const groupA = [];
  const groupB = [];
  const studentList = [];

  for (const customerId of customerIds) {
    const customerAllEngagements = allEngagements.filter((e) => e.customerId === customerId);
    const inTrack = customerAllEngagements.filter((e) => trackIdSet.has(e.catalogNodeId));
    const outsideTrack = customerAllEngagements.filter((e) => !trackIdSet.has(e.catalogNodeId));
    const customer = customerById(customerId);
    const fullyDeleted = outsideTrack.length === 0;

    if (fullyDeleted) {
      const deletionSet = buildCustomerDeletionSet(customerId, { engagements: allEngagements, followUps, transactions });
      groupA.push({ customerId, customer, deletionSet });
    } else {
      const engagementIds = inTrack.map((e) => e.id);
      const engagementIdSet = new Set(engagementIds);

      const paymentIds = [];
      for (const e of inTrack) {
        for (const r of (e.paymentRecords || [])) {
          if (r?.id) paymentIds.push(r.id);
        }
      }
      const paymentIdSet = new Set(paymentIds);

      // followUps: engagementId match only — never customerId, since the
      // customer's other engagement(s) keep their own follow-ups untouched.
      const followUpIds = (followUps || [])
        .filter((f) => engagementIdSet.has(f.engagementId))
        .map((f) => f.id);

      // accountingTransactions: relatedEngagementId/relatedPaymentId match
      // only — deliberately NOT relatedCustomerId, since this customer may
      // still have accounting history tied to their other Track(s).
      const transactionIds = (transactions || [])
        .filter((t) => (
          (t.relatedEngagementId && engagementIdSet.has(t.relatedEngagementId))
          || (t.relatedPaymentId && paymentIdSet.has(t.relatedPaymentId))
        ))
        .map((t) => t.id);

      // accountingEvents: doc id === paymentId, same convention as deleteCustomer.js.
      const eventIds = [...paymentIdSet];

      groupB.push({
        customerId, customer,
        engagementIds, paymentIds, followUpIds, transactionIds, eventIds,
        counts: {
          engagements: engagementIds.length,
          paymentRecords: paymentIds.length,
          followUps: followUpIds.length,
          accountingTransactions: transactionIds.length,
          accountingEvents: eventIds.length,
        },
      });
    }

    // Built from the same (non-archived) engagements trackEngagements/
    // customerIds were discovered from — not from `inTrack` above, which can
    // additionally include an archived in-Track engagement for this
    // customer (still correctly swept up in the actual deletion via
    // engagementIds/deletionSet, just never shown as a visible "student row"
    // the admin didn't already see on the Track page).
    for (const e of trackEngagements.filter((te) => te.customerId === customerId)) {
      studentList.push({
        customerId, engagementId: e.id,
        fullName: customer?.fullName || "",
        phone: customer?.phone || "",
        fullyDeleted,
      });
    }
  }

  const sum = (list, key) => list.reduce((s, x) => s + (x.deletionSet ? x.deletionSet.counts[key] : x.counts[key]), 0);
  const counts = {
    studentsAffected: studentList.length,
    customersFullyDeleted: groupA.length,
    customersPreserved: groupB.length,
    engagementsToDelete: sum(groupA, "engagements") + sum(groupB, "engagements"),
    paymentRecordsAffected: sum(groupA, "paymentRecords") + sum(groupB, "paymentRecords"),
    followUpsAffected: sum(groupA, "followUps") + sum(groupB, "followUps"),
    accountingTransactionsAffected: sum(groupA, "accountingTransactions") + sum(groupB, "accountingTransactions"),
    accountingEventsAffected: sum(groupA, "accountingEvents") + sum(groupB, "accountingEvents"),
  };

  return { trackNodeIds: idsArr, trackEngagements, groupA, groupB, studentList, counts };
}

/**
 * Flattens a Track deletion plan into {collection, id} ops, chunked to stay
 * under Firestore's per-batch limit. Ordering: every non-customer op first
 * (both groups), then every GROUP A customer-doc delete last — the same
 * "customer doc is the last thing removed" invariant chunkDeletionOps uses
 * for a single customer, generalized across the whole Track so a failed/
 * partial run can never leave an orphaned customer with its data already
 * gone while the customer doc (the thing that would mark it as "still needs
 * cleanup") is deleted first.
 */
export function chunkTrackDeletionOps(plan) {
  const nonCustomerOps = (ids) => [
    ...ids.engagementIds.map((id) => ({ collection: ENGAGEMENTS_COLLECTION, id })),
    ...ids.followUpIds.map((id) => ({ collection: FOLLOW_UPS_COLLECTION, id })),
    ...ids.transactionIds.map((id) => ({ collection: ACCOUNTING_TRANSACTIONS_COLLECTION, id })),
    ...ids.eventIds.map((id) => ({ collection: ACCOUNTING_EVENTS_COLLECTION, id })),
  ];

  const ops = [
    ...plan.groupA.flatMap((g) => nonCustomerOps(g.deletionSet)),
    ...plan.groupB.flatMap((g) => nonCustomerOps(g)),
    ...plan.groupA.map((g) => ({ collection: CUSTOMERS_COLLECTION, id: g.customerId })),
  ];

  const chunks = [];
  for (let i = 0; i < ops.length; i += FIRESTORE_BATCH_LIMIT) {
    chunks.push(ops.slice(i, i + FIRESTORE_BATCH_LIMIT));
  }
  return chunks.length ? chunks : [[]];
}
