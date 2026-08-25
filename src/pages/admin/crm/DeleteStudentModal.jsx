import { useMemo, useState } from "react";
import { Modal, Btn } from "../../../components/UI";
import { C, radius, font } from "../../../theme";
import { useCustomers } from "../../../context/CustomerContext";
import { useFollowUps } from "../../../context/FollowUpContext";
import { useAccounting } from "../../../context/AccountingContext";
import { buildCustomerDeletionSet } from "../../../utils/deleteCustomer";

function CountRow({ label, value, last }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: last ? "none" : `1px solid ${C.border}`, fontSize: 12.5 }}>
      <span style={{ color: C.muted }}>{label}</span>
      <b style={{ color: C.text }}>{value}</b>
    </div>
  );
}

/**
 * ADMIN-DELETE-STUDENT — destructive confirmation modal for the shared
 * Customer/Student detail view (EngagementDetailModal). Preview counts and
 * the actual delete both go through the exact same pure
 * buildCustomerDeletionSet (utils/deleteCustomer.js) / deleteCustomerCascade
 * (CustomerContext) — no separate "preview logic" that could ever disagree
 * with what actually gets deleted.
 */
export default function DeleteStudentModal({ customer, ar, tx, onClose, onDeleted }) {
  const { engagements, deleteCustomerCascade } = useCustomers();
  const { followUps } = useFollowUps();
  const { transactions } = useAccounting();

  // Recomputed on every render from live context data — if anything changes
  // while this modal is open (extremely unlikely in the seconds it's open,
  // but free to guard), the displayed counts and the eventual delete always
  // agree with each other and with reality.
  const deletionSet = useMemo(
    () => buildCustomerDeletionSet(customer.id, { engagements, followUps, transactions }),
    [customer.id, engagements, followUps, transactions],
  );

  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const canDelete = confirmText.trim() === "DELETE" && !deleting;

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setError("");
    try {
      await deleteCustomerCascade(customer.id, { followUps, transactions });
      setDone(true);
    } catch (_err) {
      setError(tx(
        "تعذّر حذف الطالب بالكامل. قد تكون بعض البيانات قد حُذفت جزئيًا — أعد المحاولة، فستحذف فقط ما تبقى.",
        "Couldn't fully delete the student. Some data may have been partially removed — retrying will only delete whatever is left.",
      ));
    } finally {
      setDeleting(false);
    }
  };

  if (done) {
    return (
      <Modal title={tx("تم الحذف", "Deleted")} onClose={onDeleted}>
        <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>✅</div>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 20, color: C.text }}>
            {tx("تم حذف الطالب بنجاح", "Student deleted successfully")}
          </div>
          <Btn v="primary" onClick={onDeleted}>{tx("إغلاق", "Close")}</Btn>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={tx("حذف الطالب", "Delete Student")} onClose={deleting ? undefined : onClose}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{customer.fullName || tx("—", "—")}</div>
        <div style={{ fontSize: 12, color: C.muted }} dir="ltr">{customer.phone || "—"}</div>
      </div>

      <div style={{ fontWeight: 800, fontSize: 13.5, color: C.danger, marginBottom: 8 }}>
        {tx("هل أنت متأكد من حذف الطالب؟", "Are you sure you want to delete this student?")}
      </div>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12, lineHeight: 1.8 }}>
        {tx(
          "سيتم حذف كل البيانات التالية نهائيًا:",
          "The following will be permanently deleted:",
        )}
      </div>

      <div style={{ background: C.faint, borderRadius: radius.md, padding: "4px 14px", marginBottom: 14 }}>
        <CountRow label={tx("العميل نفسه", "The customer record")} value={1} />
        <CountRow label={tx("الالتحاقات (Engagements)", "Engagements")} value={deletionSet.counts.engagements} />
        <CountRow label={tx("سجلات الدفع", "Payment Records")} value={deletionSet.counts.paymentRecords} />
        <CountRow label={tx("المتابعات", "Follow-ups")} value={deletionSet.counts.followUps} />
        <CountRow label={tx("حركات المحاسبة", "Accounting Transactions")} value={deletionSet.counts.accountingTransactions} />
        <CountRow label={tx("أحداث المحاسبة", "Accounting Events")} value={deletionSet.counts.accountingEvents} last />
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 800, color: C.danger, marginBottom: 16 }}>
        {tx("لا يمكن التراجع عن هذه العملية.", "This action cannot be undone.")}
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
          {deleting ? tx("جارٍ الحذف…", "Deleting…") : tx("حذف الطالب نهائيًا", "Permanently Delete Student")}
        </Btn>
      </div>
    </Modal>
  );
}
