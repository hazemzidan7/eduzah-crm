import { useMemo, useRef, useState } from "react";
import { Modal, Btn, Badge } from "../../../components/UI";
import { C, radius, font } from "../../../theme";
import { useCustomers } from "../../../context/CustomerContext";
import { useFollowUps } from "../../../context/FollowUpContext";
import { useAccounting } from "../../../context/AccountingContext";
import { buildTrackDeletionPlan } from "../../../utils/deleteTrack";

const CONFIRM_PHRASE = "DELETE TRACK";

function CountRow({ label, value, last }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: last ? "none" : `1px solid ${C.border}`, fontSize: 12.5 }}>
      <span style={{ color: C.muted }}>{label}</span>
      <b style={{ color: C.text }}>{value}</b>
    </div>
  );
}

/**
 * ADMIN-DELETE-TRACK — destructive confirmation modal for bulk-deleting
 * every student of ONE selected Track (Program), rendered from
 * ProgramWorkspace. Preview counts and the actual delete both go through the
 * exact same pure buildTrackDeletionPlan (utils/deleteTrack.js) /
 * deleteTrackCascade (CustomerContext) — no separate "preview logic" that
 * could ever disagree with what actually gets deleted.
 *
 * `trackNodeIds` = the selected Track's own catalogNodeId + every descendant
 * node id, matching exactly how ProgramWorkspace itself scopes "students of
 * this Track" for its own stats.
 */
export default function DeleteTrackModal({ track, trackNodeIds, ar, tx, onClose, onDeleted }) {
  const { engagements, customers, deleteTrackCascade } = useCustomers();
  const { followUps } = useFollowUps();
  const { transactions } = useAccounting();

  const plan = useMemo(
    () => buildTrackDeletionPlan(trackNodeIds, { engagements, followUps, transactions, customers }),
    [trackNodeIds, engagements, followUps, transactions, customers],
  );

  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const submittingRef = useRef(false);
  const canDelete = confirmText.trim() === CONFIRM_PHRASE && !deleting && plan.counts.studentsAffected > 0;

  const handleDelete = async () => {
    if (!canDelete || submittingRef.current) return;
    submittingRef.current = true;
    setDeleting(true);
    setError("");
    try {
      const finalPlan = await deleteTrackCascade(trackNodeIds, { customers, followUps, transactions });
      setResult(finalPlan.counts);
    } catch (_err) {
      setError(tx(
        "تعذّر حذف طلاب التراك بالكامل. قد تكون بعض البيانات قد حُذفت جزئيًا — أعد المحاولة، فستحذف فقط ما تبقى.",
        "Couldn't fully delete the Track's students. Some data may have been partially removed — retrying will only delete whatever is left.",
      ));
    } finally {
      submittingRef.current = false;
      setDeleting(false);
    }
  };

  if (result) {
    return (
      <Modal title={tx("تم الحذف", "Deleted")} onClose={onDeleted}>
        <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>✅</div>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 16, color: C.text }}>
            {tx("تم حذف طلاب التراك بنجاح", "Track students deleted successfully")}
          </div>
          <div style={{ background: C.faint, borderRadius: radius.md, padding: "4px 14px", marginBottom: 18, textAlign: ar ? "right" : "left" }}>
            <CountRow label={tx("طلاب تم حذفهم بالكامل", "Students completely deleted")} value={result.customersFullyDeleted} />
            <CountRow label={tx("التحاقات تم إزالتها", "Engagements removed")} value={result.engagementsToDelete} />
            <CountRow label={tx("عملاء تم الاحتفاظ بهم (لديهم تراكات أخرى)", "Customers preserved (other Tracks)")} value={result.customersPreserved} last />
          </div>
          <Btn v="primary" onClick={onDeleted}>{tx("إغلاق", "Close")}</Btn>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={tx("حذف طلاب التراك", "Delete Track Students")} onClose={deleting ? undefined : onClose}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{tx("التراك", "Track")}</div>
        <div style={{ fontWeight: 800, fontSize: 14, color: C.text }} dir="ltr">{track?.name_en || track?.name_ar || "—"}</div>
      </div>

      {plan.counts.studentsAffected === 0 ? (
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 14 }}>
          {tx("لا يوجد طلاب مسجَّلون في هذا التراك حاليًا.", "No students are currently enrolled in this Track.")}
        </div>
      ) : (
        <>
          <div style={{ fontWeight: 800, fontSize: 13.5, color: C.danger, marginBottom: 8 }}>
            {tx("هل أنت متأكد من حذف طلاب هذا التراك؟", "Are you sure you want to delete this Track's students?")}
          </div>

          <div style={{ background: C.faint, borderRadius: radius.md, padding: "4px 14px", marginBottom: 14 }}>
            <CountRow label={tx("الطلاب المتأثرون", "Students affected")} value={plan.counts.studentsAffected} />
            <CountRow label={tx("عملاء سيُحذَفون بالكامل", "Customers fully deleted")} value={plan.counts.customersFullyDeleted} />
            <CountRow label={tx("عملاء سيبقون (لديهم تراكات أخرى)", "Customers preserved (other Tracks)")} value={plan.counts.customersPreserved} />
            <CountRow label={tx("الالتحاقات (Engagements)", "Engagements")} value={plan.counts.engagementsToDelete} />
            <CountRow label={tx("سجلات الدفع", "Payment records")} value={plan.counts.paymentRecordsAffected} />
            <CountRow label={tx("المتابعات", "Follow-ups")} value={plan.counts.followUpsAffected} />
            <CountRow label={tx("حركات المحاسبة", "Accounting transactions")} value={plan.counts.accountingTransactionsAffected} />
            <CountRow label={tx("أحداث المحاسبة", "Accounting events")} value={plan.counts.accountingEventsAffected} last />
          </div>

          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, marginBottom: 6 }}>
            {tx("قائمة الطلاب", "Student list")}
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: radius.md, maxHeight: 200, overflow: "auto", marginBottom: 14 }}>
            {plan.studentList.map((s, i) => (
              <div key={`${s.customerId}_${s.engagementId}`} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                padding: "8px 12px", borderBottom: i === plan.studentList.length - 1 ? "none" : `1px solid ${C.border}`, fontSize: 12,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.fullName || "—"}</div>
                  <div style={{ color: C.muted, fontSize: 11 }} dir="ltr">{s.phone || "—"}</div>
                </div>
                <Badge color={s.fullyDeleted ? C.danger : C.purple}>
                  {s.fullyDeleted ? tx("حذف كامل", "Full delete") : tx("الالتحاق فقط", "Engagement only")}
                </Badge>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ fontSize: 12.5, fontWeight: 800, color: C.danger, marginBottom: 16 }}>
        {tx("هذه العملية لا يمكن التراجع عنها.", "This action cannot be undone.")}
      </div>

      {plan.counts.studentsAffected > 0 && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: "block", marginBottom: 6 }}>
            {tx(`اكتب "${CONFIRM_PHRASE}" للتأكيد`, `Type "${CONFIRM_PHRASE}" to confirm`)}
          </label>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={deleting}
            dir="ltr"
            placeholder={CONFIRM_PHRASE}
            style={{
              width: "100%", boxSizing: "border-box", background: "#fff", border: `1.5px solid ${C.border}`,
              borderRadius: radius.md, padding: "10px 13px", fontFamily: font, fontSize: 13, outline: "none",
            }}
          />
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: C.danger, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <Btn v="purple" onClick={onClose} disabled={deleting}>{tx("إلغاء", "Cancel")}</Btn>
        {plan.counts.studentsAffected > 0 && (
          <Btn v="danger" onClick={handleDelete} disabled={!canDelete}>
            {deleting ? tx("جارٍ الحذف…", "Deleting…") : tx("حذف طلاب التراك نهائيًا", "Permanently Delete Track Students")}
          </Btn>
        )}
      </div>
    </Modal>
  );
}
