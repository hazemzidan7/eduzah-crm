/**
 * SAFE-DELETE-01 — safe bulk customer deletion and "Delete Import". Pure
 * module: no React, no Firestore. It decides, per customer, whether a
 * customer may be HARD DELETED, and what a "Delete Import" would do to each
 * customer it touched. The writes live in utils/safeDeleteRun.js (chunked,
 * failure-reporting) and are wired by hooks/useSafeCustomerDeletion.js.
 *
 * THE RULE — a customer is deleted ONLY when nothing operational points at
 * it. Anything that does is "Protected": left exactly as it is, never
 * cascade-deleted. This is deliberately different from (and does not touch)
 * the explicit, typed-"DELETE" admin cascades in utils/deleteCustomer.js /
 * deleteTrack.js, which are per-student/per-track decisions made on
 * registered students; the bulk and import paths here never reach an
 * engagement, payment, accounting record, follow-up or history entry.
 *
 * What makes a customer Protected (every reason is reported, so the UI can say why):
 *  HAS_ENGAGEMENT          any engagement (active OR archived) for this customer
 *  HAS_PAYMENT             payment records inside any of those engagements
 *  HAS_ACCOUNTING          an accountingTransaction linked by customer, engagement or payment id
 *  HAS_FOLLOW_UP           any follow-up for this customer
 *  HAS_ASSIGNMENT_HISTORY  an assignmentHistory entry, or a current Sales owner (assignedToId)
 *  HAS_CONTACT_OUTCOME     Sales already recorded a contact status / planned program on it
 *  HAS_ACCOUNT             linked to a login account (authUid)
 * Links are matched by ID only, never by name/phone/amount similarity.
 */

export const CUSTOMER_DELETION_AUDIT_COLLECTION = "customerDeletionAudit";
export const SAFE_DELETE_CHUNK_SIZE = 400;
/** `in` queries accept at most 30 values. */
export const VERIFY_IN_CHUNK_SIZE = 30;

export const PROTECTED_REASONS = [
  "HAS_ENGAGEMENT", "HAS_PAYMENT", "HAS_ACCOUNTING", "HAS_FOLLOW_UP",
  "HAS_ASSIGNMENT_HISTORY", "HAS_CONTACT_OUTCOME", "HAS_ACCOUNT",
];

// ───────────────────────── protection index ─────────────────────────

/**
 * One pass over the already-loaded engagements / follow-ups / accounting
 * transactions -> the sets a per-customer check needs, so classifying
 * thousands of customers is O(customers + records), not O(customers x records).
 */
export function buildProtectionIndex({ engagements = [], followUps = [], transactions = [] } = {}) {
  const engagementCustomers = new Set();
  const paymentCustomers = new Set();
  const engagementOwner = new Map(); // engagementId -> customerId
  const paymentOwner = new Map(); // paymentId -> customerId
  for (const e of engagements || []) {
    if (!e?.customerId) continue;
    engagementCustomers.add(e.customerId);
    if (e.id) engagementOwner.set(e.id, e.customerId);
    for (const r of e.paymentRecords || []) {
      if (!r) continue;
      paymentCustomers.add(e.customerId);
      if (r.id) paymentOwner.set(r.id, e.customerId);
    }
  }
  const followUpCustomers = new Set((followUps || []).map((f) => f?.customerId).filter(Boolean));
  const accountingCustomers = new Set();
  for (const t of transactions || []) {
    if (t?.relatedCustomerId) accountingCustomers.add(t.relatedCustomerId);
    if (t?.relatedEngagementId && engagementOwner.has(t.relatedEngagementId)) accountingCustomers.add(engagementOwner.get(t.relatedEngagementId));
    if (t?.relatedPaymentId && paymentOwner.has(t.relatedPaymentId)) accountingCustomers.add(paymentOwner.get(t.relatedPaymentId));
  }
  return { engagementCustomers, paymentCustomers, followUpCustomers, accountingCustomers };
}

/** { protected, reasons[] } for ONE customer document. */
export function classifyCustomer(customer, index) {
  const reasons = [];
  const id = customer?.id;
  if (index.engagementCustomers.has(id)) reasons.push("HAS_ENGAGEMENT");
  if (index.paymentCustomers.has(id)) reasons.push("HAS_PAYMENT");
  if (index.accountingCustomers.has(id)) reasons.push("HAS_ACCOUNTING");
  if (index.followUpCustomers.has(id)) reasons.push("HAS_FOLLOW_UP");
  if ((Array.isArray(customer?.assignmentHistory) && customer.assignmentHistory.length > 0) || customer?.assignedToId) reasons.push("HAS_ASSIGNMENT_HISTORY");
  if (customer?.contactStatusId || customer?.plannedProgramId) reasons.push("HAS_CONTACT_OUTCOME");
  if (customer?.authUid) reasons.push("HAS_ACCOUNT");
  return { protected: reasons.length > 0, reasons };
}

// ───────────────────────── bulk deletion plan ─────────────────────────

/**
 * Selected ids -> { requested, deletable[], protectedList[{id, reasons}], missing[] }.
 * Duplicates in the selection count once; an id with no customer document
 * (already deleted — e.g. a retry) is `missing` and simply skipped.
 */
export function planBulkDeletion(customerIds, { customerById, index }) {
  const seen = new Set();
  const deletable = [];
  const protectedList = [];
  const missing = [];
  for (const id of customerIds || []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = customerById(id);
    if (!c) { missing.push(id); continue; }
    const cls = classifyCustomer(c, index);
    if (cls.protected) protectedList.push({ id, reasons: cls.reasons });
    else deletable.push(id);
  }
  return { requested: seen.size, deletable, protectedList, missing };
}

/** reason -> how many protected customers have it (for the "why" summary in the UI). */
export function summarizeProtectedReasons(protectedList) {
  const out = {};
  for (const p of protectedList || []) for (const r of p.reasons) out[r] = (out[r] || 0) + 1;
  return out;
}

// ───────────────────────── delete-import plan ─────────────────────────

const isDeadBatch = (b) => !!b && (!!b.rolledBackAt || b.status === "deleted");

/** customerId -> Set of lead-import batch ids that created/updated it (live batches only). */
export function buildBatchMembership(batches) {
  const map = new Map();
  for (const b of batches || []) {
    if (b?.kind !== "customer_leads" || isDeadBatch(b)) continue;
    for (const id of [...(b.createdCustomerIds || []), ...(b.updatedCustomerIds || [])]) {
      if (!map.has(id)) map.set(id, new Set());
      map.get(id).add(b.id);
    }
  }
  return map;
}

export const buildDeadBatchIds = (batches) => new Set((batches || []).filter(isDeadBatch).map((b) => b.id));

const storedSources = (c) => (Array.isArray(c?.importSources) ? c.importSources : []);

/**
 * What "Delete Import" would do, computed BEFORE any write.
 *
 * A customer is linked to the import if the batch created/updated it or its
 * stored `importSources` names this batch. Per linked customer:
 *  - it has ANOTHER live import source -> stays; only this source is removed;
 *  - else it was NOT created by this import (it existed before, the import
 *    only touched it) -> stays; only this source is removed;
 *  - else it was created by this import and is its only source:
 *      protected (operational data) -> stays; only this source is removed;
 *      safe -> deleted.
 * `sourceEdits` maps each remaining customer that actually stores an entry
 * for this batch to its importSources WITHOUT that entry (other entries kept
 * exactly as they are) — so nothing dangles and nothing else is lost.
 */
export function planImportDeletion(batch, { customers, customerById, index, membership, deadBatchIds }) {
  const created = new Set(batch.createdCustomerIds || []);
  const linkedOrder = [...(batch.createdCustomerIds || []), ...(batch.updatedCustomerIds || [])];
  for (const c of customers || []) if (storedSources(c).some((e) => e?.batchId === batch.id)) linkedOrder.push(c.id);
  const linked = [...new Set(linkedOrder)];
  const dead = deadBatchIds || new Set();

  const deletable = [];
  const removeSourceOnly = [];
  const preExisting = [];
  const protectedKept = [];
  const missing = [];
  const sourceEdits = new Map();
  // Same edit, for a customer planned for deletion: only used if the authoritative check at execution time
  // finds linked records after all (the customer is then kept, and must still lose this source link).
  const fallbackEdits = new Map();

  for (const id of linked) {
    const c = customerById(id);
    if (!c) { missing.push(id); continue; }
    const others = new Set();
    for (const e of storedSources(c)) if (e?.batchId && e.batchId !== batch.id && !dead.has(e.batchId)) others.add(e.batchId);
    for (const bid of membership?.get(id) || []) if (bid !== batch.id && !dead.has(bid)) others.add(bid);

    let bucket;
    if (others.size > 0) bucket = removeSourceOnly;
    else if (!created.has(id)) bucket = preExisting;
    else if (classifyCustomer(c, index).protected) bucket = protectedKept;
    else bucket = deletable;
    bucket.push(id);

    const entries = storedSources(c);
    if (entries.some((e) => e?.batchId === batch.id)) (bucket === deletable ? fallbackEdits : sourceEdits).set(id, entries.filter((e) => e?.batchId !== batch.id));
  }

  return {
    batchId: batch.id,
    linkedTotal: linked.length - missing.length,
    deletable, removeSourceOnly, preExisting, protectedKept, missing, sourceEdits, fallbackEdits,
    counts: {
      linked: linked.length - missing.length,
      delete: deletable.length,
      removeSourceOnly: removeSourceOnly.length,
      preExisting: preExisting.length,
      protected: protectedKept.length,
      missing: missing.length,
      sourceEdits: sourceEdits.size,
    },
  };
}

// ───────────────────────── audit ─────────────────────────

/** An audit entry holds counts and who did it — never names, phones or any customer content. */
export function buildDeletionAuditEntry({ action, currentUser, now = new Date().toISOString(), requestedCount = 0, affectedCustomerCount = 0, protectedCustomerCount = 0, failedCount = 0, batchId, sourceName, sourceRemovedCount }) {
  return {
    action,
    performedById: currentUser?.id || null,
    performedByName: currentUser?.name || currentUser?.email || null,
    performedAt: now,
    requestedCount,
    affectedCustomerCount,
    protectedCustomerCount,
    failedCount,
    ...(batchId ? { batchId } : {}),
    ...(sourceName ? { sourceName } : {}),
    ...(sourceRemovedCount != null ? { sourceRemovedCount } : {}),
  };
}
