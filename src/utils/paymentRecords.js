/**
 * CRM-02/CRM-03 Payment Records model. Each Engagement gets a
 * `paymentRecords[]` array (same embedded-array pattern as `timeline` — no
 * subcollection). Amount Paid must come ONLY from records with status
 * "confirmed"; Deposit is just a record with paymentType "deposit", not a
 * separate field.
 *
 * CRM-03 status flow: pending -> under_review -> confirmed / rejected.
 * `attachmentRef` is the proof/attachment reference required by CRM-03 —
 * a free-text reference (URL, receipt id, etc.), not a real upload; no
 * Firebase Storage integration exists yet, this just keeps the model/UI
 * ready for one.
 */

export const PAYMENT_METHOD_OPTIONS = [
  { v: "cash", ar: "كاش", en: "Cash" },
  { v: "instapay", ar: "إنستاباي", en: "InstaPay" },
  { v: "vodafone_cash", ar: "فودافون كاش", en: "Vodafone Cash" },
];

export const PAYMENT_TYPE_OPTIONS = [
  { v: "deposit", ar: "عربون", en: "Deposit" },
  { v: "installment", ar: "قسط", en: "Installment" },
  { v: "full", ar: "دفعة كاملة", en: "Full Payment" },
];

export const PAYMENT_RECORD_STATUS_OPTIONS = [
  { v: "pending", ar: "قيد الانتظار", en: "Pending" },
  { v: "under_review", ar: "قيد المراجعة", en: "Under Review" },
  { v: "confirmed", ar: "مؤكد", en: "Confirmed" },
  { v: "rejected", ar: "مرفوض", en: "Rejected" },
];

// Statuses that still "count" for duplicate-conflict purposes — a rejected
// record is a closed matter and shouldn't block a legitimate re-submission.
const ACTIVE_PAYMENT_STATUSES = new Set(["pending", "under_review", "confirmed"]);

export function paymentOptionLabel(options, code, ar) {
  const opt = options.find((o) => o.v === code);
  return opt ? (ar ? opt.ar : opt.en) : code || "—";
}

/**
 * Pre-CRM-02 engagements stored money as flat fields (reservationDeposit +
 * installment1/2/3) with one blob-level `payment.confirmed` flag instead of
 * per-payment records. This never writes anything — it's a read-time shim so
 * old data keeps showing correctly everywhere Payment Records are read. Real
 * records (once `paymentRecords` is non-empty, including after
 * CustomerContext.migrateLegacyPayments runs) always take priority.
 */
export function effectivePaymentRecords(engagement) {
  const real = engagement?.paymentRecords;
  if (Array.isArray(real) && real.length > 0) return real;
  return legacyRecordsFrom(engagement?.payment || {}, engagement);
}

function legacyRecordsFrom(payment, engagement) {
  const legacyStatus = payment.confirmed ? "confirmed" : "pending";
  const entries = [
    { amount: payment.reservationDeposit, paymentType: "deposit" },
    { amount: payment.installment1, paymentType: "installment" },
    { amount: payment.installment2, paymentType: "installment" },
    { amount: payment.installment3, paymentType: "installment" },
  ].filter((e) => typeof e.amount === "number" && e.amount > 0);

  return entries.map((e, i) => ({
    id: `legacy_${i}`,
    engagementId: engagement?.id || null,
    amount: e.amount,
    paymentMethod: null,
    paymentType: e.paymentType,
    status: legacyStatus,
    submittedAt: engagement?.createdAt || null,
    confirmedAt: payment.confirmed ? (payment.confirmedAt || null) : null,
    confirmedBy: null,
    transactionReference: null,
    attachmentRef: null,
    rejectionReason: null,
    legacy: true,
  }));
}

export function confirmedAmountPaid(engagement) {
  return effectivePaymentRecords(engagement)
    .filter((r) => r.status === "confirmed")
    .reduce((sum, r) => sum + (r.amount || 0), 0);
}

export function hasUnmigratedLegacyPayments(engagement) {
  return !(Array.isArray(engagement?.paymentRecords) && engagement.paymentRecords.length > 0)
    && effectivePaymentRecords(engagement).length > 0;
}

const norm = (s) => (s || "").trim().toLowerCase();

/**
 * CRM-03 duplicate protection. Compares one record (a real record already
 * on `engagement`, or a draft not yet submitted) against every payment
 * record across every engagement the app has loaded — safe because
 * CustomerContext already syncs the whole `engagements` collection
 * client-side (same pattern the rest of this app relies on, see the
 * onSnapshot(collection(db, "engagements")) listener).
 *
 * Returns a list of { type, severity, record, engagement } conflicts:
 *  - "reference": another active record shares the same transactionReference
 *  - "proof": another active record shares the same attachmentRef
 *  - "same_engagement": another active record on THIS engagement has the
 *    same amount/method/type (a likely accidental double-submit)
 * severity "blocking" (a CONFIRMED record already owns that reference —
 * see CustomerContext.confirmPaymentRecord, which refuses to confirm over
 * this) vs "warning" (anything else — surfaced in the UI, not blocked).
 */
export function findPaymentConflicts(draftRecord, engagement, allEngagements) {
  if (!draftRecord || !engagement) return [];
  const ref = norm(draftRecord.transactionReference);
  const proof = norm(draftRecord.attachmentRef);
  const conflicts = [];

  for (const other of allEngagements || []) {
    for (const r of effectivePaymentRecords(other)) {
      if (r.id === draftRecord.id && other.id === engagement.id) continue; // never conflicts with itself
      if (!ACTIVE_PAYMENT_STATUSES.has(r.status)) continue;

      if (ref && norm(r.transactionReference) === ref) {
        conflicts.push({ type: "reference", severity: r.status === "confirmed" ? "blocking" : "warning", record: r, engagement: other });
      } else if (proof && norm(r.attachmentRef) === proof) {
        conflicts.push({ type: "proof", severity: r.status === "confirmed" ? "blocking" : "warning", record: r, engagement: other });
      } else if (other.id === engagement.id && r.amount === draftRecord.amount && r.paymentMethod === draftRecord.paymentMethod && r.paymentType === draftRecord.paymentType) {
        conflicts.push({ type: "same_engagement", severity: "warning", record: r, engagement: other });
      }
    }
  }
  return conflicts;
}

export const hasBlockingConflict = (conflicts) => conflicts.some((c) => c.severity === "blocking");

/**
 * CRM-PAYMENT-01 — additive, non-blocking amount check. Deliberately kept
 * separate from findPaymentConflicts above (not touched, not redesigned) —
 * this is a parallel, independently-computed warning for the Payment
 * Verification view. Only meaningful for deposit/full records, where the
 * frozen pricingSnapshot.depositAmount (CRM-PRICING-01) is the one
 * authoritative "amount due now" figure; there's no equivalent single
 * expected amount for an individual installment payment, so those are
 * never flagged — this never blocks Confirm, it's visibility only.
 */
export function expectedAmountNow(engagement) {
  const snap = engagement?.pricingSnapshot;
  return snap && typeof snap.depositAmount === "number" ? snap.depositAmount : null;
}

export function amountMismatch(record, engagement) {
  if (!record || record.paymentType === "installment") return null;
  const expected = expectedAmountNow(engagement);
  if (expected == null || typeof record.amount !== "number" || record.amount === expected) return null;
  return { expected, submitted: record.amount, kind: record.amount < expected ? "partial" : "over" };
}
