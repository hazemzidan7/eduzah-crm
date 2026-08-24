import { useState } from "react";
import { Modal, Btn, Input, Select } from "../../../components/UI";
import { C } from "../../../theme";
import { IconTrendUp, IconTrendDown, IconUndo, IconSwap } from "../../../components/Icons";
import { useAccounting } from "../../../context/AccountingContext";
import { useCustomers } from "../../../context/CustomerContext";
import {
  TRANSACTION_TYPES, ACCOUNT_OPTIONS, categoryOptionsForType,
  validateTransaction, normalizeTransactionFields, refundableAmountForPayment,
} from "../../../utils/accounting";
import { effectivePaymentRecords } from "../../../utils/paymentRecords";
import CrmLinkPicker from "./CrmLinkPicker";

// UI-only presentation strings for the codes validateTransaction returns —
// the rule itself lives in utils/accounting.js, this is just localization.
const ERROR_MESSAGES = {
  INVALID_TYPE: ["نوع الحركة غير صالح", "Invalid transaction type"],
  INVALID_AMOUNT: ["المبلغ يجب أن يكون أكبر من صفر", "Amount must be greater than zero"],
  INVALID_ACCOUNT: ["اختر الحساب", "Select an account"],
  INVALID_CATEGORY: ["اختر التصنيف", "Select a category"],
  REFUND_REQUIRES_REASON: ["الاسترداد يتطلب سبب/وصف", "Refund requires a reason/description"],
  INVALID_FROM_ACCOUNT: ["اختر حساب المصدر", "Select the source account"],
  INVALID_TO_ACCOUNT: ["اختر حساب الوجهة", "Select the destination account"],
  SAME_ACCOUNT_TRANSFER: ["لا يمكن التحويل لنفس الحساب", "Cannot transfer to the same account"],
  TRANSFER_MUST_NOT_HAVE_CATEGORY: ["التحويل لا يجب أن يكون له تصنيف", "A transfer must not have a category"],
  // ACCOUNTING-03B
  INVALID_CUSTOMER_REFERENCE: ["العميل المحدد غير موجود", "The selected customer doesn't exist"],
  INVALID_ENGAGEMENT_REFERENCE: ["البرنامج المحدد غير موجود لهذا العميل", "The selected program doesn't exist for this customer"],
  INVALID_PAYMENT_REFERENCE: ["الدفعة المحددة غير موجودة أو غير مؤكدة", "The selected payment doesn't exist or isn't confirmed"],
  REFUND_EXCEEDS_REFUNDABLE_AMOUNT: ["مبلغ الاسترداد أكبر من المتاح استرداده لهذه الدفعة", "Refund amount exceeds what's still refundable for this payment"],
};

// Local id generator matching CustomerContext.jsx's own genId() — used only
// as the refund idempotency key (rule 7), so a retried/double-submitted
// refund attempt reuses the same key instead of minting a new one.
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const TYPE_TABS = [
  { v: TRANSACTION_TYPES.INCOME, ar: "إيراد", en: "Income", Icon: IconTrendUp, color: C.success },
  { v: TRANSACTION_TYPES.EXPENSE, ar: "مصروف", en: "Expense", Icon: IconTrendDown, color: C.danger },
  { v: TRANSACTION_TYPES.REFUND, ar: "استرداد", en: "Refund", Icon: IconUndo, color: C.orange },
  { v: TRANSACTION_TYPES.TRANSFER, ar: "تحويل", en: "Transfer", Icon: IconSwap, color: C.pmid },
];

const todayIso = () => new Date().toISOString().slice(0, 10);
const accountSelectOptions = (ar) => ACCOUNT_OPTIONS.map((o) => ({ v: o.v, l: ar ? o.ar : o.en }));

function draftFromTransaction(t) {
  if (!t) {
    return {
      type: TRANSACTION_TYPES.INCOME, amount: "", account: "", fromAccount: "", toAccount: "",
      category: "", date: todayIso(), note: "", customerId: null, engagementId: null, paymentId: null,
    };
  }
  return {
    type: t.type, amount: String(t.amount ?? ""), account: t.account || "",
    fromAccount: t.fromAccount || "", toAccount: t.toAccount || "", category: t.category || "",
    date: t.date || todayIso(), note: t.note || "",
    customerId: t.relatedCustomerId || null, engagementId: t.relatedEngagementId || null, paymentId: t.relatedPaymentId || null,
  };
}

/**
 * Add/Edit form for one accounting transaction (ACCOUNTING-02 §4/§6). All
 * validation runs through the real utils/accounting.js validateTransaction —
 * this file only localizes the error codes it returns, never re-implements
 * a rule. Create goes through AccountingContext.addTransaction (which itself
 * calls buildTransaction); edit goes through updateTransaction, sending the
 * full normalized field set so editHistory/type-switching stay correct —
 * see normalizeTransactionFields's docstring in utils/accounting.js.
 */
export default function TransactionFormModal({ transaction, ar, tx, onClose }) {
  const { transactions, addTransaction, addRefundTransaction, updateTransaction } = useAccounting();
  const { customerById, engagementsForCustomer } = useCustomers();
  const isEdit = !!transaction;
  const [form, setForm] = useState(() => draftFromTransaction(transaction));
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  // ACCOUNTING-03B — one stable key per "refund attempt" (this modal's
  // lifetime): generated once on mount, reused across retries of the same
  // submit (e.g. a failed write followed by clicking Save again). Closing
  // and reopening the modal for a genuinely new refund gets a fresh key.
  // Only ever used for creating a NEW refund — irrelevant for edits/other types.
  const [refundKey] = useState(() => genId());

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const buildDraft = () => ({
    type: form.type,
    amount: Number(form.amount),
    account: form.account || null,
    fromAccount: form.fromAccount || null,
    toAccount: form.toAccount || null,
    category: form.type === TRANSACTION_TYPES.TRANSFER ? null : (form.category || null),
    date: form.date || todayIso(),
    note: form.note || "",
    relatedCustomerId: form.customerId || null,
    relatedEngagementId: form.engagementId || null,
    relatedPaymentId: form.paymentId || null,
  });

  // ACCOUNTING-03B — defensive check that an optional CRM link actually
  // resolves to real data, plus (only when linked to one specific
  // PaymentRecord) the refundable-amount ceiling from
  // utils/accounting.refundableAmountForPayment. In normal use these ids
  // only ever come from CrmLinkPicker's own dropdowns (always real,
  // already-filtered-to-confirmed-for-refund options — see CrmLinkPicker's
  // `type` prop), so this mainly guards against stale state; the amount
  // check is the one that actually fires in normal use.
  const refundCrmErrors = (draft) => {
    if (draft.type !== TRANSACTION_TYPES.REFUND) return [];
    const errs = [];
    const customer = draft.relatedCustomerId ? customerById(draft.relatedCustomerId) : null;
    if (draft.relatedCustomerId && !customer) errs.push("INVALID_CUSTOMER_REFERENCE");

    const engagements = draft.relatedCustomerId ? engagementsForCustomer(draft.relatedCustomerId) : [];
    const engagement = draft.relatedEngagementId ? engagements.find((e) => e.id === draft.relatedEngagementId) : null;
    if (draft.relatedEngagementId && !engagement) errs.push("INVALID_ENGAGEMENT_REFERENCE");

    const record = engagement && draft.relatedPaymentId
      ? effectivePaymentRecords(engagement).find((r) => r.id === draft.relatedPaymentId)
      : null;
    if (draft.relatedPaymentId && (!record || record.status !== "confirmed")) {
      errs.push("INVALID_PAYMENT_REFERENCE");
    } else if (record) {
      const refundable = refundableAmountForPayment(record, transactions, { excludeTransactionId: isEdit ? transaction.id : undefined });
      if (typeof draft.amount === "number" && draft.amount > refundable) errs.push("REFUND_EXCEEDS_REFUNDABLE_AMOUNT");
    }
    return errs;
  };

  const handleSubmit = async () => {
    const draft = buildDraft();
    const validationErrors = [...validateTransaction(draft), ...refundCrmErrors(draft)];
    if (validationErrors.length > 0) { setErrors(validationErrors); return; }

    setSaving(true);
    setErrors([]);
    try {
      if (isEdit) {
        await updateTransaction(transaction.id, normalizeTransactionFields(draft));
      } else if (draft.type === TRANSACTION_TYPES.REFUND) {
        await addRefundTransaction(draft, refundKey);
      } else {
        await addTransaction(draft);
      }
      onClose();
    } catch (e) {
      setErrors([e.message?.startsWith("INVALID_TRANSACTION") ? e.message.replace("INVALID_TRANSACTION: ", "").split(", ") : "UNKNOWN_ERROR"].flat());
    } finally {
      setSaving(false);
    }
  };

  const isTransfer = form.type === TRANSACTION_TYPES.TRANSFER;
  const isRefund = form.type === TRANSACTION_TYPES.REFUND;
  const showCrmLink = form.type === TRANSACTION_TYPES.INCOME || form.type === TRANSACTION_TYPES.REFUND;
  const categoryOptions = categoryOptionsForType(form.type).map((o) => ({ v: o.v, l: ar ? o.ar : o.en }));

  return (
    <Modal title={isEdit ? tx("تعديل الحركة", "Edit Transaction") : tx("إضافة حركة", "Add Transaction")} onClose={onClose}>
      {/* Type selector — locked while editing, since switching an existing
          entry's type is an unusual, deliberate action better done as
          delete+recreate; editing focuses on correcting amount/account/etc. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {TYPE_TABS.map((t) => {
          const active = form.type === t.v;
          return (
            <button
              key={t.v}
              type="button"
              disabled={isEdit}
              onClick={() => set({ type: t.v, category: "" })}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10,
                border: `1.5px solid ${active ? t.color : C.border}`,
                background: active ? `${t.color}26` : "transparent",
                color: C.text, fontFamily: "'Cairo',sans-serif", fontSize: 12.5, fontWeight: 800,
                cursor: isEdit ? "not-allowed" : "pointer", opacity: isEdit && !active ? 0.4 : 1,
              }}
            >
              <t.Icon size={14} />
              {ar ? t.ar : t.en}
            </button>
          );
        })}
      </div>

      {isTransfer ? (
        <>
          <Select
            label={tx("من حساب", "From Account")}
            value={form.fromAccount}
            onChange={(v) => set({ fromAccount: v })}
            options={[{ v: "", l: tx("اختر…", "Select…") }, ...accountSelectOptions(ar)]}
          />
          <Select
            label={tx("إلى حساب", "To Account")}
            value={form.toAccount}
            onChange={(v) => set({ toAccount: v })}
            options={[{ v: "", l: tx("اختر…", "Select…") }, ...accountSelectOptions(ar)]}
          />
        </>
      ) : (
        <>
          <Select
            label={tx("الحساب", "Account")}
            value={form.account}
            onChange={(v) => set({ account: v })}
            options={[{ v: "", l: tx("اختر…", "Select…") }, ...accountSelectOptions(ar)]}
          />
          <Select
            label={tx("التصنيف", "Category")}
            value={form.category}
            onChange={(v) => set({ category: v })}
            options={[{ v: "", l: tx("اختر…", "Select…") }, ...categoryOptions]}
          />
        </>
      )}

      <Input
        label={tx("المبلغ (ج.م)", "Amount (EGP)")}
        type="number"
        value={form.amount}
        onChange={(v) => set({ amount: v })}
        placeholder="0"
        dir="ltr"
      />
      <Input
        label={tx("التاريخ", "Date")}
        type="date"
        value={form.date}
        onChange={(v) => set({ date: v })}
      />
      <Input
        label={isRefund ? tx("الوصف / سبب الاسترداد", "Description / Reason") : tx("الوصف (اختياري)", "Description (optional)")}
        value={form.note}
        onChange={(v) => set({ note: v })}
        rows={2}
        placeholder={isRefund ? tx("سبب الاسترداد…", "Reason for the refund…") : ""}
      />

      {showCrmLink && (
        <CrmLinkPicker
          tx={tx}
          ar={ar}
          type={form.type}
          customerId={form.customerId}
          engagementId={form.engagementId}
          paymentId={form.paymentId}
          onChange={({ customerId, engagementId, paymentId }) => set({ customerId, engagementId, paymentId })}
        />
      )}

      {errors.length > 0 && (
        <div style={{ marginBottom: 14, padding: "8px 12px", borderRadius: 8, background: `${C.danger}20`, border: `1px solid ${C.danger}66` }}>
          {errors.map((code) => {
            const [arMsg, enMsg] = ERROR_MESSAGES[code] || [code, code];
            return <div key={code} style={{ fontSize: 12, color: C.danger, fontWeight: 700 }}>⚠ {ar ? arMsg : enMsg}</div>;
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Btn v="primary" full disabled={saving} onClick={handleSubmit}>
          {saving ? tx("جارٍ الحفظ…", "Saving…") : isEdit ? tx("حفظ التعديلات", "Save Changes") : tx("إضافة الحركة", "Add Transaction")}
        </Btn>
        <Btn v="ghost" onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
      </div>
    </Modal>
  );
}
