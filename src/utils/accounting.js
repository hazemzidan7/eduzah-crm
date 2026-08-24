/**
 * ACCOUNTING-01 — Data model + transaction rules for the (still separate)
 * Eduzah Accounting system. Pure module, no Firestore calls — same split as
 * paymentRecords.js/pricingSnapshot.js: this file defines shape/vocabulary/
 * validation, src/context/AccountingContext.jsx does the actual I/O for
 * UI-created transactions.
 *
 * ACCOUNTING-03A: buildIncomeDraftFromConfirmedPayment (near the bottom of
 * this file) is the one CRM-side import — CustomerContext.jsx's
 * createAccountingIncomeFromPayment uses it to build the draft, same
 * pure-DTO/I/O-wrapper split as utils/accountingEvents.js's
 * buildConfirmedPaymentEvent vs. CustomerContext's emitAccountingEvent. This
 * file still never imports anything CRM-side itself (no dependency on
 * paymentRecords.js/CustomerContext) — the integration reads FROM the CRM
 * INTO Accounting, never the reverse.
 */

export const ACCOUNTING_TRANSACTIONS_COLLECTION = "accountingTransactions";
export const ACCOUNTING_CURRENCY = "EGP";

export const TRANSACTION_TYPES = {
  INCOME: "income",
  EXPENSE: "expense",
  REFUND: "refund",
  TRANSFER: "transfer",
};

export const TRANSACTION_TYPE_OPTIONS = [
  { v: TRANSACTION_TYPES.INCOME, ar: "إيراد", en: "Income" },
  { v: TRANSACTION_TYPES.EXPENSE, ar: "مصروف", en: "Expense" },
  { v: TRANSACTION_TYPES.REFUND, ar: "استرداد", en: "Refund" },
  { v: TRANSACTION_TYPES.TRANSFER, ar: "تحويل", en: "Transfer" },
];

// Where money currently exists. Same set doubles as "payment method" for
// income transactions (cash/instapay/vodafone_cash mirror
// utils/paymentRecords.js's PAYMENT_METHOD_OPTIONS; "bank" is Accounting-only
// since no CRM payment is ever received directly into it).
export const ACCOUNTS = {
  CASH: "cash",
  INSTAPAY: "instapay",
  VODAFONE_CASH: "vodafone_cash",
  BANK: "bank",
};

export const ACCOUNT_OPTIONS = [
  { v: ACCOUNTS.CASH, ar: "خزينة الشركة", en: "Company Cash" },
  { v: ACCOUNTS.INSTAPAY, ar: "إنستاباي", en: "InstaPay" },
  { v: ACCOUNTS.VODAFONE_CASH, ar: "فودافون كاش", en: "Vodafone Cash" },
  { v: ACCOUNTS.BANK, ar: "البنك", en: "Bank" },
];

export const INCOME_CATEGORIES = {
  STUDENT_PAYMENT: "student_payment",
  OTHER_INCOME: "other_income",
};

export const INCOME_CATEGORY_OPTIONS = [
  { v: INCOME_CATEGORIES.STUDENT_PAYMENT, ar: "دفعة طالب", en: "Student Payment" },
  { v: INCOME_CATEGORIES.OTHER_INCOME, ar: "إيراد آخر", en: "Other Income" },
];

export const EXPENSE_CATEGORIES = {
  RENT: "rent",
  ELECTRICITY: "electricity",
  SALARIES: "salaries",
  ADVERTISING: "advertising",
  PURCHASES: "purchases",
  OPERATING_EXPENSES: "operating_expenses",
  PERSONAL_WITHDRAWAL: "personal_withdrawal",
  OTHER: "other",
};

export const EXPENSE_CATEGORY_OPTIONS = [
  { v: EXPENSE_CATEGORIES.RENT, ar: "إيجار", en: "Rent" },
  { v: EXPENSE_CATEGORIES.ELECTRICITY, ar: "كهرباء", en: "Electricity" },
  { v: EXPENSE_CATEGORIES.SALARIES, ar: "رواتب", en: "Salaries" },
  { v: EXPENSE_CATEGORIES.ADVERTISING, ar: "إعلانات", en: "Advertising" },
  { v: EXPENSE_CATEGORIES.PURCHASES, ar: "مشتريات", en: "Purchases" },
  { v: EXPENSE_CATEGORIES.OPERATING_EXPENSES, ar: "مصروفات تشغيلية", en: "Operating Expenses" },
  { v: EXPENSE_CATEGORIES.PERSONAL_WITHDRAWAL, ar: "سحب شخصي", en: "Personal Withdrawal" },
  { v: EXPENSE_CATEGORIES.OTHER, ar: "أخرى", en: "Other" },
];

export const REFUND_CATEGORIES = {
  STUDENT_REFUND: "student_refund",
  OTHER_REFUND: "other_refund",
};

export const REFUND_CATEGORY_OPTIONS = [
  { v: REFUND_CATEGORIES.STUDENT_REFUND, ar: "استرداد طالب", en: "Student Refund" },
  { v: REFUND_CATEGORIES.OTHER_REFUND, ar: "استرداد آخر", en: "Other Refund" },
];

// category options for a given transaction type; null for transfer (transfers
// are never categorized as income/expense/refund).
export function categoryOptionsForType(type) {
  if (type === TRANSACTION_TYPES.INCOME) return INCOME_CATEGORY_OPTIONS;
  if (type === TRANSACTION_TYPES.EXPENSE) return EXPENSE_CATEGORY_OPTIONS;
  if (type === TRANSACTION_TYPES.REFUND) return REFUND_CATEGORY_OPTIONS;
  return [];
}

export function optionLabel(options, code, ar) {
  const opt = options.find((o) => o.v === code);
  return opt ? (ar ? opt.ar : opt.en) : code || "—";
}

const VALID_ACCOUNTS = new Set(Object.values(ACCOUNTS));
const VALID_TYPES = new Set(Object.values(TRANSACTION_TYPES));
const CATEGORY_SETS = {
  [TRANSACTION_TYPES.INCOME]: new Set(Object.values(INCOME_CATEGORIES)),
  [TRANSACTION_TYPES.EXPENSE]: new Set(Object.values(EXPENSE_CATEGORIES)),
  [TRANSACTION_TYPES.REFUND]: new Set(Object.values(REFUND_CATEGORIES)),
};

/**
 * Validates a draft transaction (plain form data, not yet a Firestore doc).
 * Returns an array of error codes — empty array means valid. Deliberately
 * returns codes, not user-facing strings, since no UI exists yet to localize
 * them into (bilingual ar/en, per every other option list in this codebase).
 *
 * Rules enforced (per the approved ACCOUNTING-01 spec):
 *  - amount must be a positive number
 *  - income/expense/refund require a category valid for that type, and an
 *    account (where the money now sits)
 *  - refund additionally requires a non-empty reason/note
 *  - transfer requires fromAccount + toAccount, must differ, no category
 *    (a transfer is neither income nor expense — see buildTransaction)
 */
export function validateTransaction(draft) {
  const errors = [];
  if (!draft || !VALID_TYPES.has(draft.type)) {
    errors.push("INVALID_TYPE");
    return errors;
  }
  if (typeof draft.amount !== "number" || !(draft.amount > 0)) {
    errors.push("INVALID_AMOUNT");
  }

  if (draft.type === TRANSACTION_TYPES.TRANSFER) {
    if (!VALID_ACCOUNTS.has(draft.fromAccount)) errors.push("INVALID_FROM_ACCOUNT");
    if (!VALID_ACCOUNTS.has(draft.toAccount)) errors.push("INVALID_TO_ACCOUNT");
    if (draft.fromAccount && draft.toAccount && draft.fromAccount === draft.toAccount) {
      errors.push("SAME_ACCOUNT_TRANSFER");
    }
    if (draft.category) errors.push("TRANSFER_MUST_NOT_HAVE_CATEGORY");
    return errors;
  }

  if (!VALID_ACCOUNTS.has(draft.account)) errors.push("INVALID_ACCOUNT");
  if (!CATEGORY_SETS[draft.type]?.has(draft.category)) errors.push("INVALID_CATEGORY");
  if (draft.type === TRANSACTION_TYPES.REFUND && !String(draft.note || "").trim()) {
    errors.push("REFUND_REQUIRES_REASON");
  }
  return errors;
}

export const isValidTransaction = (draft) => validateTransaction(draft).length === 0;

// Local calendar date as 'YYYY-MM-DD' (matching <input type="date">'s own
// format) — NOT toISOString(), which converts to UTC first. In any timezone
// ahead of UTC (e.g. Cairo, UTC+2/+3, where this app runs) local midnight on
// day D is still UTC's day D-1, so toISOString().slice(0,10) silently lands
// one day early. Bug found and fixed here (ACCOUNTING-04) while building
// more period-boundary logic on top of this exact pattern — todayIso() and
// currentMonthRange() below both had it; every stored `date` going forward
// is now the correct local calendar day, not the UTC one.
function localIsoDate(year, monthIndex0, day) {
  const mm = String(monthIndex0 + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function todayIso() {
  const d = new Date();
  return localIsoDate(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Normalizes a draft's business fields into the shape every transaction doc
 * stores — single source of truth shared by buildTransaction (create) and
 * the edit form (ACCOUNTING-02), so switching a transaction's type on edit
 * can never leave stale fromAccount/toAccount/category fields behind: a
 * transfer always has account=null/category=null, everything else always
 * has fromAccount=null/toAccount=null.
 *
 * `date` (ACCOUNTING-02) is the real-world transaction date the accounting
 * form asks for on every type — distinct from `createdAt`, which is when the
 * record was entered into the system (e.g. backfilling yesterday's cash
 * sale). Defaults to today when omitted.
 */
export function normalizeTransactionFields(draft) {
  const isTransfer = draft.type === TRANSACTION_TYPES.TRANSFER;
  return {
    type: draft.type,
    amount: draft.amount,
    currency: draft.currency || ACCOUNTING_CURRENCY,
    date: draft.date || todayIso(),
    account: isTransfer ? null : draft.account,
    fromAccount: isTransfer ? draft.fromAccount : null,
    toAccount: isTransfer ? draft.toAccount : null,
    category: isTransfer ? null : draft.category,
    note: draft.note || "",
    relatedCustomerId: draft.relatedCustomerId || null,
    relatedEngagementId: draft.relatedEngagementId || null,
    relatedPaymentId: draft.relatedPaymentId || null,
  };
}

/**
 * Builds the Firestore-ready transaction doc from a validated draft. Throws
 * if the draft doesn't pass validateTransaction — callers (Context layer)
 * are expected to validate first and surface errors to the user themselves;
 * this is the last-line guard against writing a malformed doc.
 *
 * `relatedCustomerId`/`relatedEngagementId`/`relatedPaymentId` are optional
 * and nullable by design — "some accounting transactions are independent and
 * must work without student links" (approved spec). None of these are ever
 * populated automatically by this module; a caller passes them explicitly
 * when the transaction genuinely originates from a CRM payment.
 */
export function buildTransaction(draft, { currentUser } = {}) {
  const errors = validateTransaction(draft);
  if (errors.length > 0) throw new Error(`INVALID_TRANSACTION: ${errors.join(", ")}`);

  const now = new Date().toISOString();
  return {
    ...normalizeTransactionFields(draft),
    createdBy: currentUser?.id || null,
    createdByName: currentUser?.name || null,
    createdAt: now,
    updatedAt: now,
    editHistory: [],
  };
}

/**
 * Builds one edit-history entry for updateTransaction. `oldValue`/`newValue`
 * are objects containing only the fields that actually changed (not the
 * whole document) — keeps history entries small and each one legible on its
 * own ("what changed in this edit"), same append-only-array shape as
 * engagements' `timeline[]`.
 */
export function buildEditHistoryEntry({ editedBy, editedByName, oldValue, newValue }) {
  return {
    editedBy: editedBy || null,
    editedByName: editedByName || null,
    editedAt: new Date().toISOString(),
    oldValue,
    newValue,
  };
}

/** Diffs `updates` against the current doc; returns null if nothing actually changed. */
export function diffForEditHistory(current, updates) {
  const oldValue = {};
  const newValue = {};
  for (const key of Object.keys(updates)) {
    if (updates[key] !== current?.[key]) {
      oldValue[key] = current?.[key] ?? null;
      newValue[key] = updates[key];
    }
  }
  return Object.keys(newValue).length > 0 ? { oldValue, newValue } : null;
}

// ─── ACCOUNTING-02: pure derived calculations ────────────────────────────
// Same philosophy as the rest of this codebase (Amount Paid/Remaining in
// paymentRecords.js, Course Price in pricingSnapshot.js): balances/totals
// are never stored, always derived from the transaction list at read time —
// so they can never drift out of sync with the ledger. All three functions
// below take a plain array of transaction docs (already fetched by
// AccountingContext) and are UI-agnostic.

/**
 * Running balance per account, computed from every transaction ever
 * recorded (never date-filtered — a balance is a running total "as of now",
 * not a period figure). Exactly the rules approved for ACCOUNTING-01/02:
 * income +account, expense/refund -account, transfer -fromAccount
 * +toAccount. Transfers never touch anything but the two accounts they
 * name, so they can't inflate or deflate `total` either.
 */
export function computeAccountBalances(transactions) {
  const balances = {
    [ACCOUNTS.CASH]: 0,
    [ACCOUNTS.INSTAPAY]: 0,
    [ACCOUNTS.VODAFONE_CASH]: 0,
    [ACCOUNTS.BANK]: 0,
  };
  for (const t of transactions || []) {
    if (t.type === TRANSACTION_TYPES.INCOME && t.account) {
      balances[t.account] = (balances[t.account] || 0) + t.amount;
    } else if ((t.type === TRANSACTION_TYPES.EXPENSE || t.type === TRANSACTION_TYPES.REFUND) && t.account) {
      balances[t.account] = (balances[t.account] || 0) - t.amount;
    } else if (t.type === TRANSACTION_TYPES.TRANSFER) {
      if (t.fromAccount) balances[t.fromAccount] = (balances[t.fromAccount] || 0) - t.amount;
      if (t.toAccount) balances[t.toAccount] = (balances[t.toAccount] || 0) + t.amount;
    }
  }
  const total = Object.values(balances).reduce((sum, v) => sum + v, 0);
  return { ...balances, total };
}

/**
 * Ledger totals over whatever transaction list is passed in — caller
 * decides the period by pre-filtering (see filterTransactions/
 * currentMonthRange below). Transfers are summed separately and never
 * folded into income/expense/refund, per the approved rule that a transfer
 * must never inflate revenue or expenses. `payingStudentCount` counts
 * distinct `relatedCustomerId`s across income transactions in the list —
 * derived straight from the optional link already on the doc, no CRM read.
 */
export function computeTransactionTotals(transactions) {
  let income = 0, expense = 0, refund = 0, transfer = 0, personalWithdrawal = 0;
  const payingCustomerIds = new Set();
  for (const t of transactions || []) {
    if (t.type === TRANSACTION_TYPES.INCOME) {
      income += t.amount;
      if (t.relatedCustomerId) payingCustomerIds.add(t.relatedCustomerId);
    } else if (t.type === TRANSACTION_TYPES.EXPENSE) {
      expense += t.amount;
      if (t.category === EXPENSE_CATEGORIES.PERSONAL_WITHDRAWAL) personalWithdrawal += t.amount;
    } else if (t.type === TRANSACTION_TYPES.REFUND) {
      refund += t.amount;
    } else if (t.type === TRANSACTION_TYPES.TRANSFER) {
      transfer += t.amount;
    }
  }
  return {
    income, expense, refund, transfer, personalWithdrawal,
    netMovement: income - expense - refund,
    payingStudentCount: payingCustomerIds.size,
  };
}

/**
 * ACCOUNTING-04 — one full Reports metrics bundle for a period. Extends
 * computeTransactionTotals (reused as-is, not duplicated) with the
 * account-level income breakdown and the Deposit/Installment/Full-Payment
 * split the Reports view needs.
 *
 * `paymentTypeFor(tx)` is an optional caller-supplied hook — same pattern as
 * filterTransactions' searchTextFor above — that resolves an income
 * transaction's CRM payment type ("deposit"/"installment"/"full", straight
 * from utils/paymentRecords.js's own PAYMENT_TYPE_OPTIONS values, not a new
 * classification invented here) via its relatedPaymentId, when available.
 * Keeps this file CRM-agnostic: no import of paymentRecords.js/
 * CustomerContext here — the caller (Reports UI, which already has both
 * contexts) resolves the actual PaymentRecord and hands back its type.
 * "full" payments count toward Total Income only, never Deposits/
 * Installments, per the approved spec.
 */
export function computeReportMetrics(transactions, { paymentTypeFor } = {}) {
  const totals = computeTransactionTotals(transactions);
  const incomeByAccount = {
    [ACCOUNTS.CASH]: 0,
    [ACCOUNTS.INSTAPAY]: 0,
    [ACCOUNTS.VODAFONE_CASH]: 0,
    [ACCOUNTS.BANK]: 0,
  };
  let deposits = 0, installments = 0, fullPayments = 0;
  for (const t of transactions || []) {
    if (t.type !== TRANSACTION_TYPES.INCOME) continue;
    if (t.account) incomeByAccount[t.account] = (incomeByAccount[t.account] || 0) + t.amount;
    const paymentType = paymentTypeFor ? paymentTypeFor(t) : null;
    if (paymentType === "deposit") deposits += t.amount;
    else if (paymentType === "installment") installments += t.amount;
    else if (paymentType === "full") fullPayments += t.amount;
  }
  return { ...totals, incomeByAccount, deposits, installments, fullPayments };
}

/** Calendar-month boundaries (inclusive, 'YYYY-MM-DD') for the Dashboard's default "This Month" summary. */
export function currentMonthRange(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth();
  const from = localIsoDate(y, m, 1);
  const lastDayOfMonth = new Date(y, m + 1, 0).getDate();
  const to = localIsoDate(y, m, lastDayOfMonth);
  return { from, to };
}

/**
 * ACCOUNTING-05 — the current calendar week's boundaries, Saturday through
 * Friday (Egypt's weekend is Friday-Saturday, so this treats Saturday as day
 * one of the week — a documented, single convention, not Sunday/Monday). A
 * real calendar week, never a rolling 7-day window. Uses the same
 * localIsoDate helper as currentMonthRange/todayIso above, for the same
 * reason (local calendar components, not a UTC-converted timestamp).
 */
export function thisWeekRange(now = new Date()) {
  const daysSinceSaturday = (now.getDay() + 1) % 7; // JS getDay(): Sun=0..Sat=6 -> Sat=0..Fri=6
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceSaturday);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return {
    from: localIsoDate(start.getFullYear(), start.getMonth(), start.getDate()),
    to: localIsoDate(end.getFullYear(), end.getMonth(), end.getDate()),
  };
}

// ─── ACCOUNTING-04: Report periods ───────────────────────────────────────
// Real calendar boundaries only — never a rolling N-day window, per the
// approved spec. All four period types share the same localIsoDate helper
// currentMonthRange/todayIso already use, so every boundary is computed
// from local calendar components, not a UTC-converted timestamp.

export const REPORT_PERIODS = {
  DAILY: "daily",
  MONTHLY: "monthly",
  HALF_YEARLY: "half_yearly",
  YEARLY: "yearly",
};

export const REPORT_PERIOD_OPTIONS = [
  { v: REPORT_PERIODS.DAILY, ar: "يومي", en: "Daily" },
  { v: REPORT_PERIODS.MONTHLY, ar: "شهري", en: "Monthly" },
  { v: REPORT_PERIODS.HALF_YEARLY, ar: "نصف سنوي", en: "Half-Yearly" },
  { v: REPORT_PERIODS.YEARLY, ar: "سنوي", en: "Yearly" },
];

/**
 * The 'YYYY-MM-DD' from/to boundaries of the report period of `periodType`
 * that contains `anchor` — Daily is the one calendar day; Monthly reuses
 * currentMonthRange's own boundary math for an arbitrary anchor (not just
 * "now"); Half-Yearly is Jan-Jun or Jul-Dec of anchor's year; Yearly is
 * Jan 1-Dec 31 of anchor's year. Unrecognized periodType falls back to
 * Monthly (same default as the Dashboard's own summary).
 */
export function reportPeriodRange(periodType, anchor = new Date()) {
  const y = anchor.getFullYear();
  const m = anchor.getMonth(); // 0-based
  if (periodType === REPORT_PERIODS.DAILY) {
    const d = localIsoDate(y, m, anchor.getDate());
    return { from: d, to: d };
  }
  if (periodType === REPORT_PERIODS.HALF_YEARLY) {
    const firstHalf = m < 6;
    const from = localIsoDate(y, firstHalf ? 0 : 6, 1);
    const lastMonthOfHalf = firstHalf ? 5 : 11; // 0-based: May(5) or Nov(11)
    const lastDay = new Date(y, lastMonthOfHalf + 1, 0).getDate();
    const to = localIsoDate(y, lastMonthOfHalf, lastDay);
    return { from, to };
  }
  if (periodType === REPORT_PERIODS.YEARLY) {
    return { from: localIsoDate(y, 0, 1), to: localIsoDate(y, 11, 31) };
  }
  return currentMonthRange(anchor); // MONTHLY, and the fallback
}

/**
 * Moves `anchor` one period forward/backward — a real calendar step (next
 * month, next half, next year), not a fixed number of days.
 */
export function shiftReportPeriod(periodType, anchor, direction) {
  const step = direction === "next" ? 1 : -1;
  if (periodType === REPORT_PERIODS.DAILY) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    d.setDate(d.getDate() + step);
    return d;
  }
  // MONTHLY/HALF_YEARLY/YEARLY only ever read the anchor's year/month
  // (reportPeriodRange above ignores the day-of-month for these) — pinning
  // the day to 1 before shifting avoids a real Date.setMonth() footgun:
  // stepping from e.g. Jan 31 would otherwise try to land on "Feb 31",
  // which doesn't exist, and JS silently overflows into March instead.
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  if (periodType === REPORT_PERIODS.HALF_YEARLY) d.setMonth(d.getMonth() + step * 6);
  else if (periodType === REPORT_PERIODS.YEARLY) d.setFullYear(d.getFullYear() + step);
  else d.setMonth(d.getMonth() + step); // MONTHLY, and the fallback
  return d;
}

function isWithinDateRange(dateStr, { from, to } = {}) {
  if (!dateStr) return false;
  if (from && dateStr < from) return false;
  if (to && dateStr > to) return false;
  return true;
}

/**
 * Shared filter used by both the Transactions table (section 3) and, via
 * currentMonthRange, the Dashboard summary — one implementation so the two
 * can never disagree on what "matches this search/filter" means.
 * `searchTextFor(tx)` is an optional caller-supplied hook for search terms
 * this module can't know about itself (e.g. a resolved customer name) —
 * keeps this file CRM-agnostic while still letting the UI layer search by
 * student name.
 */
export function filterTransactions(transactions, {
  search = "", type = "all", account = "all", category = "all", dateFrom = null, dateTo = null,
} = {}, { searchTextFor } = {}) {
  const q = search.trim().toLowerCase();
  return (transactions || []).filter((t) => {
    if (type !== "all" && t.type !== type) return false;
    if (account !== "all") {
      const matches = t.type === TRANSACTION_TYPES.TRANSFER
        ? (t.fromAccount === account || t.toAccount === account)
        : t.account === account;
      if (!matches) return false;
    }
    if (category !== "all" && t.category !== category) return false;
    if ((dateFrom || dateTo) && !isWithinDateRange(t.date, { from: dateFrom, to: dateTo })) return false;
    if (q) {
      const extra = searchTextFor ? searchTextFor(t) : "";
      const haystack = [
        t.note, t.relatedCustomerId, t.relatedEngagementId, t.relatedPaymentId,
        t.createdByName, t.account, t.fromAccount, t.toAccount, t.category, t.type, extra,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

// ─── ACCOUNTING-03A: Confirmed CRM Payment -> Accounting Income ──────────
// Pure DTO builder — CustomerContext.createAccountingIncomeFromPayment does
// the actual idempotent Firestore write (doc id = paymentId, same pattern
// as accountingEvents), passing this draft straight into buildTransaction
// above. Kept here (not in CustomerContext) so it's testable against real
// engagement/record fixtures without needing Firestore, and so the mapping
// rule lives next to the ACCOUNTS it maps into.

// CRM payment methods and Accounting accounts already share the same string
// codes by design, but this maps explicitly rather than relying on that
// coincidence ("do not guess a different account" — approved rule 5). A
// paymentMethod with no entry here (null, or anything unrecognized — e.g. an
// un-migrated legacy record, which stores paymentMethod: null) maps to
// undefined, and buildTransaction's validateTransaction then rejects the
// draft with INVALID_ACCOUNT rather than fabricating one.
export const PAYMENT_METHOD_TO_ACCOUNT = {
  cash: ACCOUNTS.CASH,
  instapay: ACCOUNTS.INSTAPAY,
  vodafone_cash: ACCOUNTS.VODAFONE_CASH,
  bank: ACCOUNTS.BANK,
};

/**
 * Builds the income draft for one confirmed PaymentRecord — amount is
 * always `record.amount` (the actual amount confirmed on this one record,
 * never Remaining or course price; approved rule 3), so every confirmed
 * record produces its own separate transaction (rule 4) even when several
 * records exist on the same Engagement. No catalogNodeId/program field is
 * added to the Accounting schema (rule 14) — it's already reachable via
 * relatedEngagementId -> engagement.catalogNodeId, so storing it again here
 * would just be a derivable duplicate.
 */
export function buildIncomeDraftFromConfirmedPayment(engagement, record) {
  return {
    type: TRANSACTION_TYPES.INCOME,
    amount: record.amount,
    account: PAYMENT_METHOD_TO_ACCOUNT[record.paymentMethod] || null,
    category: INCOME_CATEGORIES.STUDENT_PAYMENT,
    date: (record.confirmedAt || new Date().toISOString()).slice(0, 10),
    note: `CRM ${record.paymentType || "payment"} payment confirmed`,
    relatedCustomerId: engagement?.customerId || null,
    relatedEngagementId: engagement?.id || null,
    relatedPaymentId: record.id,
  };
}

// ─── ACCOUNTING-03B: Refund -> Accounting ────────────────────────────────
// No existing CRM refund/remaining-amount concept exists anywhere to reuse
// (paymentRecords.js has no refund status or refund-tracking field at all —
// confirmed by inspecting it before writing this). The only defensible,
// non-invented ceiling for "amount available to refund" on a specific
// PaymentRecord is that record's own confirmed amount, minus whatever has
// already been refunded against it via other Accounting refund transactions
// — nothing more elaborate is assumed. A refund with no linked PaymentRecord
// has no ceiling to check against (rule 15 only requires this when a
// specific payment is "supplied").

/**
 * Sum of existing refund transactions already linked to one PaymentRecord.
 * `excludeTransactionId` lets an edit of an existing refund exclude its own
 * prior amount from the sum (otherwise editing a refund's own amount would
 * see itself as "already refunded" and incorrectly shrink its own ceiling).
 */
export function alreadyRefundedForPayment(transactions, paymentRecordId, { excludeTransactionId } = {}) {
  return (transactions || [])
    .filter((t) => t.type === TRANSACTION_TYPES.REFUND && t.relatedPaymentId === paymentRecordId && t.id !== excludeTransactionId)
    .reduce((sum, t) => sum + (t.amount || 0), 0);
}

/**
 * How much of `paymentRecord` is still available to refund. Returns null
 * when there's no record to bound against (an independent refund, per the
 * approved spec, is allowed at any amount — same "some transactions have no
 * student link" rule ACCOUNTING-01 already established).
 */
export function refundableAmountForPayment(paymentRecord, transactions, { excludeTransactionId } = {}) {
  if (!paymentRecord || typeof paymentRecord.amount !== "number") return null;
  const already = alreadyRefundedForPayment(transactions, paymentRecord.id, { excludeTransactionId });
  return Math.max(0, paymentRecord.amount - already);
}
