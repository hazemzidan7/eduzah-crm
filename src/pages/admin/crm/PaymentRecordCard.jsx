import { useState } from "react";
import { Btn, Card } from "../../../components/UI";
import { C } from "../../../theme";
import {
  PAYMENT_METHOD_OPTIONS, PAYMENT_TYPE_OPTIONS, PAYMENT_RECORD_STATUS_OPTIONS, paymentOptionLabel,
  amountMismatch,
} from "../../../utils/paymentRecords";

export const PAYMENT_STATUS_COLOR = { pending: C.muted, under_review: C.orange, confirmed: C.success, rejected: C.danger };
export const PAYMENT_STATUS_LABEL = {
  pending: ["قيد الانتظار", "Pending"],
  under_review: ["قيد المراجعة", "Under Review"],
  confirmed: ["مؤكد", "Confirmed"],
  rejected: ["مرفوض", "Rejected"],
};

/**
 * One Payment Record. Flow: pending -> under_review -> confirmed/rejected —
 * Confirm/Reject only appear once review has actually started; Confirm is
 * disabled outright when a blocking duplicate exists elsewhere (see
 * CustomerContext.confirmPaymentRecord, which re-checks this server-side
 * too). Shared between EngagementDetailModal (a single Engagement's own
 * records) and PaymentVerificationQueue (CRM-PAYMENT-01 — every Engagement's
 * pending/under_review records in one place) so the two never drift apart;
 * `header` is the only thing the queue adds (student/program identity —
 * redundant once you're already inside one Engagement's own modal).
 */
export default function PaymentRecordCard({ record, engagement, conflicts, ar, tx, header, onStartReview, onConfirm, onReject }) {
  const color = PAYMENT_STATUS_COLOR[record.status] || C.muted;
  const [statusAr, statusEn] = PAYMENT_STATUS_LABEL[record.status] || [record.status, record.status];
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const blocked = conflicts.some((c) => c.severity === "blocking");
  const mismatch = amountMismatch(record, engagement);
  const needsProofButHasNone = !record.legacy && !record.attachmentRef
    && (record.paymentMethod === "instapay" || record.paymentMethod === "vodafone_cash")
    && (record.status === "pending" || record.status === "under_review");

  return (
    <Card style={{ padding: "10px 14px" }}>
      {header}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div>
          <span dir="ltr" style={{ fontSize: 14, fontWeight: 800 }}>{(record.amount || 0).toLocaleString()}</span>
          <span style={{ fontSize: 11.5, color: C.muted, marginInlineStart: 8 }}>
            {paymentOptionLabel(PAYMENT_TYPE_OPTIONS, record.paymentType, ar)}
            {record.paymentMethod ? ` · ${paymentOptionLabel(PAYMENT_METHOD_OPTIONS, record.paymentMethod, ar)}` : ""}
            {record.legacy ? ` · ${tx("قديم", "legacy")}` : ""}
          </span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color }}>{ar ? statusAr : statusEn}</span>
      </div>
      {(record.transactionReference || record.attachmentRef || record.submittedAt) && (
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>
          {record.transactionReference ? `${tx("رقم العملية", "Ref")}: ${record.transactionReference} · ` : ""}
          {record.attachmentRef ? `${tx("إثبات", "Proof")}: ${record.attachmentRef} · ` : ""}
          {record.submittedAt ? new Date(record.submittedAt).toLocaleDateString(ar ? "ar-EG" : "en-US") : ""}
        </div>
      )}
      {needsProofButHasNone && (
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, fontStyle: "italic" }}>
          {tx("لا يوجد إثبات دفع مرفق — لم يُرفع بعد", "No proof attached yet")}
        </div>
      )}
      {record.status === "rejected" && record.rejectionReason && (
        <div style={{ fontSize: 11.5, color: C.danger, marginTop: 4 }}>{tx("سبب الرفض", "Rejection reason")}: {record.rejectionReason}</div>
      )}

      {mismatch && (record.status === "pending" || record.status === "under_review") && (
        <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8, background: `${C.orange}22`, border: `1px solid ${C.orange}66` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.orange }}>
            ⚠ {tx(
              mismatch.kind === "partial"
                ? `مبلغ جزئي: المُرسَل ${mismatch.submitted.toLocaleString()} أقل من المطلوب الآن ${mismatch.expected.toLocaleString()}`
                : `مبلغ أكبر من المطلوب: المُرسَل ${mismatch.submitted.toLocaleString()} أكثر من المطلوب الآن ${mismatch.expected.toLocaleString()}`,
              mismatch.kind === "partial"
                ? `Partial amount: ${mismatch.submitted.toLocaleString()} submitted is less than the ${mismatch.expected.toLocaleString()} expected now`
                : `Amount higher than expected: ${mismatch.submitted.toLocaleString()} submitted vs. ${mismatch.expected.toLocaleString()} expected now`,
            )}
          </div>
        </div>
      )}

      {conflicts.length > 0 && (record.status === "pending" || record.status === "under_review") && (
        <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8, background: `${blocked ? C.danger : C.orange}22`, border: `1px solid ${blocked ? C.danger : C.orange}66` }}>
          {conflicts.map((c, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 700, color: blocked ? C.danger : C.orange }}>
              ⚠ {tx(
                c.type === "reference" ? "نفس رقم العملية مستخدم في دفعة أخرى" : c.type === "proof" ? "نفس إثبات الدفع مستخدم في دفعة أخرى" : "دفعة مشابهة (نفس المبلغ والطريقة والنوع) لنفس العميل",
                c.type === "reference" ? "Same transaction reference used by another payment" : c.type === "proof" ? "Same proof reference used by another payment" : "Similar payment (same amount/method/type) for this customer",
              )} — {paymentOptionLabel(PAYMENT_RECORD_STATUS_OPTIONS, c.record.status, ar)}
            </div>
          ))}
        </div>
      )}

      {record.status === "pending" && !record.legacy && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <Btn sm v="purple" onClick={onStartReview}>{tx("بدء المراجعة", "Start Review")}</Btn>
        </div>
      )}
      {record.status === "under_review" && !record.legacy && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <Btn sm v="primary" disabled={blocked} title={blocked ? tx("محظور بسبب تعارض مؤكد", "Blocked by a confirmed duplicate") : undefined} onClick={onConfirm}>{tx("تأكيد", "Confirm")}</Btn>
            <Btn sm v="ghost" onClick={() => setRejecting((v) => !v)}>{tx("رفض", "Reject")}</Btn>
          </div>
          {rejecting && (
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={tx("سبب الرفض...", "Rejection reason...")}
                style={{ flex: 1, background: "rgba(255,255,255,.06)", border: `1.5px solid ${C.border}`, borderRadius: 8, color: "#fff", fontFamily: "'Cairo',sans-serif", fontSize: 12, padding: "6px 10px" }}
              />
              <Btn sm v="primary" disabled={!reason.trim()} onClick={() => { onReject(reason.trim()); setRejecting(false); setReason(""); }}>{tx("تأكيد الرفض", "Confirm Reject")}</Btn>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
