/**
 * CRM-02 Payment Records model. Each Engagement gets a `paymentRecords[]`
 * array (same embedded-array pattern as `timeline` — no subcollection).
 * Amount Paid must come ONLY from records with status "confirmed"; Deposit
 * is just a record with paymentType "deposit", not a separate field.
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
  { v: "pending", ar: "قيد المراجعة", en: "Pending" },
  { v: "confirmed", ar: "مؤكد", en: "Confirmed" },
  { v: "rejected", ar: "مرفوض", en: "Rejected" },
];

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
  return legacyRecordsFrom(engagement?.payment || {}, engagement?.createdAt || null);
}

function legacyRecordsFrom(payment, createdAt) {
  const legacyStatus = payment.confirmed ? "confirmed" : "pending";
  const entries = [
    { amount: payment.reservationDeposit, paymentType: "deposit" },
    { amount: payment.installment1, paymentType: "installment" },
    { amount: payment.installment2, paymentType: "installment" },
    { amount: payment.installment3, paymentType: "installment" },
  ].filter((e) => typeof e.amount === "number" && e.amount > 0);

  return entries.map((e, i) => ({
    id: `legacy_${i}`,
    amount: e.amount,
    paymentMethod: null,
    paymentType: e.paymentType,
    status: legacyStatus,
    submittedAt: createdAt,
    confirmedAt: payment.confirmed ? (payment.confirmedAt || null) : null,
    confirmedBy: null,
    transactionReference: null,
    attachmentRef: null,
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
