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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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

/** Calendar-month boundaries (inclusive, 'YYYY-MM-DD') for the Dashboard's default "This Month" summary. */
export function currentMonthRange(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth();
  const from = new Date(y, m, 1).toISOString().slice(0, 10);
  const to = new Date(y, m + 1, 0).toISOString().slice(0, 10);
  return { from, to };
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
