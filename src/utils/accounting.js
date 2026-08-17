/**
 * ACCOUNTING-01 — Data model + transaction rules for the (still separate)
 * Eduzah Accounting system. Pure module, no Firestore calls — same split as
 * paymentRecords.js/pricingSnapshot.js: this file defines shape/vocabulary/
 * validation, src/context/AccountingContext.jsx does the actual I/O.
 *
 * Deliberately NOT imported by anything CRM-side yet (no link to
 * paymentRecords.js, accountingEvents.js, or CustomerContext). The future
 * hookup (Confirmed CRM Payment -> Accounting Event -> Accounting
 * Transaction) is out of scope for this task.
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
  const isTransfer = draft.type === TRANSACTION_TYPES.TRANSFER;
  return {
    type: draft.type,
    amount: draft.amount,
    currency: draft.currency || ACCOUNTING_CURRENCY,
    account: isTransfer ? null : draft.account,
    fromAccount: isTransfer ? draft.fromAccount : null,
    toAccount: isTransfer ? draft.toAccount : null,
    category: isTransfer ? null : draft.category,
    note: draft.note || "",
    relatedCustomerId: draft.relatedCustomerId || null,
    relatedEngagementId: draft.relatedEngagementId || null,
    relatedPaymentId: draft.relatedPaymentId || null,
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
