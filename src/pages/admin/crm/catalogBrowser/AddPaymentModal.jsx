import { useState } from "react";
import { Modal, Input, Select, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useCustomers } from "../../../../context/CustomerContext";
import { useCatalog } from "../../../../context/CatalogContext";
import {
  PAYMENT_METHOD_OPTIONS, PAYMENT_TYPE_OPTIONS,
  effectivePaymentRecords, confirmedAmountPaid, findPaymentConflicts, amountMismatch,
} from "../../../../utils/paymentRecords";
import { effectiveCoursePrice } from "../../../../utils/pricingSnapshot";

// Local calendar date ('YYYY-MM-DD') — NOT toISOString(), which converts to
// UTC first and can land a day early in a timezone ahead of UTC (this app
// runs in Africa/Cairo). Same fix already applied in utils/accounting.js.
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Sales Sheet -> Payment integration. Creates a PaymentRecord through the
 * exact existing CustomerContext.addPaymentRecord path — same function
 * EngagementDetailModal's own payment form already uses, so there is only
 * ever one payment-creation code path. The record always starts "pending";
 * nothing here confirms it, touches Accounting, or bypasses Payment
 * Verification's conflict/mismatch checks — those remain exactly as they
 * are, just surfaced here (read-only, informational) so Sales sees the same
 * warnings before submitting that the verification queue would show later.
 */
export default function AddPaymentModal({ engagement, onClose }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { customerById, engagements: allEngagements, addPaymentRecord } = useCustomers();
  const { nodeById } = useCatalog();

  const customer = customerById(engagement.customerId);
  const program = engagement.catalogNodeId ? nodeById(engagement.catalogNodeId) : null;
  const coursePrice = effectiveCoursePrice(engagement);
  const amountPaid = confirmedAmountPaid(engagement);
  const remaining = (coursePrice || 0) - amountPaid;
  const snapshot = engagement.pricingSnapshot || null;
  const hasExistingRecords = effectivePaymentRecords(engagement).length > 0;

  // Smart default per payment type, read straight from the existing frozen
  // pricingSnapshot / effectiveCoursePrice — no new pricing formula. Only
  // applied while the amount field hasn't been touched by Sales yet, so a
  // manually-entered amount is never silently overwritten.
  const defaultAmountFor = (type) => {
    if (type === "deposit") return snapshot?.depositAmount ?? null;
    if (type === "full") return snapshot?.fullPaymentPrice ?? coursePrice ?? null;
    return remaining > 0 ? remaining : null; // installment
  };

  const [paymentType, setPaymentType] = useState(hasExistingRecords ? "installment" : "deposit");
  const [amount, setAmount] = useState(() => defaultAmountFor(hasExistingRecords ? "installment" : "deposit") ?? "");
  const [amountTouched, setAmountTouched] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [date, setDate] = useState(todayIso());
  const [transactionReference, setTransactionReference] = useState("");
  const [attachmentRef, setAttachmentRef] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const changePaymentType = (v) => {
    setPaymentType(v);
    if (!amountTouched) {
      const def = defaultAmountFor(v);
      setAmount(def != null ? String(def) : "");
    }
  };
  const changeAmount = (v) => { setAmountTouched(true); setAmount(v); };

  const numericAmount = Number(amount) || 0;
  const draft = { id: "__draft__", amount: numericAmount, paymentMethod, paymentType, transactionReference, attachmentRef };
  // Same conflict detector + mismatch warning Payment Verification already
  // uses — read-only here, never blocks creation (creation was never
  // blocked even in the existing EngagementDetailModal flow; only
  // confirmation is, via the unmodified confirmPaymentRecord check).
  const conflicts = (transactionReference || attachmentRef) ? findPaymentConflicts(draft, engagement, allEngagements) : [];
  const mismatch = numericAmount > 0 ? amountMismatch(draft, engagement) : null;

  const projectedPaid = amountPaid + numericAmount;
  const projectedRemaining = (coursePrice || 0) - projectedPaid;

  const paymentTypeOptions = PAYMENT_TYPE_OPTIONS.map((o) => ({ v: o.v, l: ar ? o.ar : o.en }));
  const paymentMethodOptions = PAYMENT_METHOD_OPTIONS.map((o) => ({ v: o.v, l: ar ? o.ar : o.en }));

  const submit = async () => {
    setError("");
    if (!numericAmount || numericAmount <= 0) {
      setError(tx("أدخل مبلغًا صحيحًا أكبر من صفر", "Enter a valid amount greater than zero"));
      return;
    }
    setSaving(true);
    try {
      // The one existing payment-creation path — always creates status:
      // "pending". No confirmation, no Accounting write, no enrollment
      // change happens here; those only ever happen through Payment
      // Verification's own unmodified confirmPaymentRecord flow.
      await addPaymentRecord(engagement.id, {
        amount: numericAmount,
        paymentMethod,
        paymentType,
        transactionReference: transactionReference.trim() || undefined,
        attachmentRef: attachmentRef.trim() || undefined,
        submittedAt: date ? new Date(`${date}T00:00:00`).toISOString() : undefined,
      });
      setSubmitted(true);
    } catch (e) {
      setError(e.message || tx("حدث خطأ", "Something went wrong"));
    } finally {
      setSaving(false);
    }
  };

  if (submitted) {
    return (
      <Modal title={tx("تسجيل دفعة", "Add Payment")} onClose={onClose}>
        <div style={{ textAlign: "center", padding: "12px 4px" }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{tx("تم تسجيل الدفعة بنجاح ✅", "Payment recorded successfully ✅")}</div>
          <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 20 }}>
            {tx("في انتظار مراجعة وتأكيد الدفع.", "Waiting for review and confirmation.")}
          </div>
          <Btn v="primary" onClick={onClose}>{tx("إغلاق", "Close")}</Btn>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={tx("تسجيل دفعة", "Add Payment")} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px", marginBottom: 4 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{tx("الطالب", "Student")}</div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{customer?.fullName || "—"}</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{tx("البرنامج", "Program")}</div>
          <div dir="ltr" style={{ fontSize: 13, textAlign: ar ? "end" : "start" }}>{program?.name_en || "—"}</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{tx("سعر الكورس", "Course Price")}</div>
          <div dir="ltr" style={{ fontSize: 13, textAlign: ar ? "end" : "start" }}>{(coursePrice ?? 0).toLocaleString()}</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{tx("المدفوع (مؤكد)", "Confirmed Paid")}</div>
          <div dir="ltr" style={{ fontSize: 13, fontWeight: 700, color: C.success, textAlign: ar ? "end" : "start" }}>{amountPaid.toLocaleString()}</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{tx("المتبقي حاليًا", "Current Remaining")}</div>
          <div dir="ltr" style={{ fontSize: 13, fontWeight: 700, color: remaining > 0 ? C.orange : C.muted, textAlign: ar ? "end" : "start" }}>{remaining.toLocaleString()}</div>
        </div>
      </div>

      <div style={{ height: 1, background: C.border, margin: "4px 0 14px" }} />

      <Select label={tx("نوع الدفعة", "Payment Type")} value={paymentType} onChange={changePaymentType} options={paymentTypeOptions} />
      <Input label={tx("المبلغ", "Amount")} type="number" value={String(amount)} onChange={changeAmount} dir="ltr" />
      <Select label={tx("طريقة الدفع", "Payment Method")} value={paymentMethod} onChange={setPaymentMethod} options={paymentMethodOptions} />
      <Input label={tx("تاريخ الدفعة", "Payment Date")} type="date" value={date} onChange={setDate} />
      <Input label={tx("رقم العملية (اختياري)", "Transaction Reference (optional)")} value={transactionReference} onChange={setTransactionReference} dir="ltr" />
      <Input
        label={tx("مرجع إثبات الدفع (اختياري)", "Proof reference (optional)")}
        value={attachmentRef}
        onChange={setAttachmentRef}
        dir="ltr"
        placeholder={tx("رابط/رقم إيصال...", "URL / receipt id...")}
      />

      {mismatch && (
        <div style={{ marginTop: -8, marginBottom: 14, padding: "8px 12px", borderRadius: 8, background: `${C.orange}22`, border: `1px solid ${C.orange}66` }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.orange }}>
            ⚠ {tx(
              mismatch.kind === "partial"
                ? `مبلغ جزئي: أقل من المطلوب الآن (${mismatch.expected.toLocaleString()})`
                : `المبلغ أكبر من المطلوب الآن (${mismatch.expected.toLocaleString()})`,
              mismatch.kind === "partial"
                ? `Partial amount: less than the ${mismatch.expected.toLocaleString()} expected now`
                : `Amount higher than the ${mismatch.expected.toLocaleString()} expected now`,
            )}
          </div>
        </div>
      )}
      {conflicts.length > 0 && (
        <div style={{ marginTop: -8, marginBottom: 14, fontSize: 11.5, fontWeight: 700, color: C.orange }}>
          ⚠ {tx("تحذير: نفس رقم العملية أو الإثبات مستخدم بالفعل في دفعة أخرى", "Warning: this reference/proof is already used by another payment")}
        </div>
      )}

      <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,.04)", border: `1px solid ${C.border}`, marginBottom: 16 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>
          {tx("المتوقع بعد التأكيد", "Projected after confirmation")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: 12.5 }} dir="ltr">
          <div>{tx("المدفوع حاليًا", "Current paid")}: <b>{amountPaid.toLocaleString()}</b></div>
          <div>{tx("هذه الدفعة", "This payment")}: <b>{numericAmount.toLocaleString()}</b></div>
          <div>{tx("الإجمالي الجديد", "New total paid")}: <b style={{ color: C.success }}>{projectedPaid.toLocaleString()}</b></div>
          <div>{tx("المتبقي الجديد", "New remaining")}: <b style={{ color: projectedRemaining > 0 ? C.orange : C.muted }}>{projectedRemaining.toLocaleString()}</b></div>
        </div>
      </div>

      {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn v="purple" onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
        <Btn v="primary" disabled={saving || !numericAmount} onClick={submit}>
          {saving ? tx("جارٍ التسجيل…", "Recording…") : tx("تسجيل الدفعة", "Record Payment")}
        </Btn>
      </div>
    </Modal>
  );
}
