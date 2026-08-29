import { useRef, useState } from "react";
import { Modal, Btn } from "../../../components/UI";
import { C, radius, font } from "../../../theme";
import { useAccounting } from "../../../context/AccountingContext";
import { TRANSACTION_TYPE_OPTIONS, ACCOUNT_OPTIONS, optionLabel } from "../../../utils/accounting";

function InfoRow({ label, value, last }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: last ? "none" : `1px solid ${C.border}`, fontSize: 12.5, gap: 10 }}>
      <span style={{ color: C.muted, flexShrink: 0 }}>{label}</span>
      <b style={{ color: C.text, textAlign: "end" }}>{value}</b>
    </div>
  );
}

/**
 * ACCOUNTING-DELETE-01 — Admin-only soft-delete confirmation, same
 * typed-confirmation + double-submit-guard shape as DeleteStudentModal.jsx/
 * DeleteTrackModal.jsx (this codebase's own established pattern for every
 * destructive action, reused here rather than inventing a new one). The
 * actual soft-delete + audit-record write both happen inside
 * AccountingContext.deleteTransaction — this component only collects the
 * confirmation text and the required reason.
 */
export default function DeleteTransactionModal({ transaction, customerById, ar, tx, onClose, onDeleted }) {
  const { deleteTransaction } = useAccounting();
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const submittingRef = useRef(false);

  const canDelete = confirmText.trim() === "DELETE" && reason.trim().length > 0 && !deleting;

  const customer = transaction.relatedCustomerId ? customerById?.(transaction.relatedCustomerId) : null;
  const studentOrDesc = customer?.fullName || transaction.note || tx("—", "—");

  const handleDelete = async () => {
    if (!canDelete || submittingRef.current) return;
    submittingRef.current = true;
    setDeleting(true);
    setError("");
    try {
      await deleteTransaction(transaction.id, { reason: reason.trim() });
      setDone(true);
    } catch (_err) {
      setError(tx("تعذّر حذف الحركة. حاول مرة أخرى.", "Couldn't delete the transaction. Please try again."));
    } finally {
      submittingRef.current = false;
      setDeleting(false);
    }
  };

  if (done) {
    return (
      <Modal title={tx("تم الحذف", "Deleted")} onClose={onDeleted}>
        <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>✅</div>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 20, color: C.text }}>
            {tx("تم حذف الحركة بنجاح", "Transaction deleted successfully")}
          </div>
          <Btn v="primary" onClick={onDeleted}>{tx("إغلاق", "Close")}</Btn>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={tx("حذف الحركة", "Delete Transaction")} onClose={deleting ? undefined : onClose}>
      <div style={{ background: C.faint, borderRadius: radius.md, padding: "4px 14px", marginBottom: 14 }}>
        <InfoRow label={tx("النوع", "Type")} value={optionLabel(TRANSACTION_TYPE_OPTIONS, transaction.type, ar)} />
        <InfoRow label={tx("المبلغ", "Amount")} value={<span dir="ltr">{(transaction.amount || 0).toLocaleString()}</span>} />
        <InfoRow label={tx("التاريخ", "Date")} value={<span dir="ltr">{transaction.date || "—"}</span>} />
        <InfoRow
          label={tx("الحساب", "Account")}
          value={transaction.type === "transfer"
            ? `${optionLabel(ACCOUNT_OPTIONS, transaction.fromAccount, ar)} → ${optionLabel(ACCOUNT_OPTIONS, transaction.toAccount, ar)}`
            : optionLabel(ACCOUNT_OPTIONS, transaction.account, ar)}
        />
        <InfoRow label={tx("الوصف / الطالب", "Description / Student")} value={studentOrDesc} last />
      </div>

      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12, lineHeight: 1.7 }}>
        {tx(
          "لن يتم حذف الحركة نهائيًا — سيتم إخفاؤها من كل الحسابات والتقارير، مع الاحتفاظ بسجل تدقيق كامل يمكن استخدامه لاسترجاعها لاحقًا.",
          "This won't permanently delete the transaction — it will disappear from all balances and reports, with a full audit record kept so it can be restored later.",
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: "block", marginBottom: 6 }}>
          {tx("سبب الحذف (مطلوب)", "Deletion reason (required)")}
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={deleting}
          rows={2}
          placeholder={tx("مثال: تم إدخالها بالخطأ...", "e.g. Entered by mistake...")}
          style={{
            width: "100%", boxSizing: "border-box", background: "#fff", border: `1.5px solid ${C.border}`,
            borderRadius: radius.md, padding: "10px 13px", fontFamily: font, fontSize: 13, outline: "none", resize: "vertical",
          }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: "block", marginBottom: 6 }}>
          {tx('اكتب "DELETE" للتأكيد', 'Type "DELETE" to confirm')}
        </label>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          disabled={deleting}
          dir="ltr"
          placeholder="DELETE"
          style={{
            width: "100%", boxSizing: "border-box", background: "#fff", border: `1.5px solid ${C.border}`,
            borderRadius: radius.md, padding: "10px 13px", fontFamily: font, fontSize: 13, outline: "none",
          }}
        />
      </div>

      {error && <div style={{ fontSize: 12, color: C.danger, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <Btn v="purple" onClick={onClose} disabled={deleting}>{tx("إلغاء", "Cancel")}</Btn>
        <Btn v="danger" onClick={handleDelete} disabled={!canDelete}>
          {deleting ? tx("جارٍ الحذف…", "Deleting…") : tx("حذف الحركة", "Delete Transaction")}
        </Btn>
      </div>
    </Modal>
  );
}
