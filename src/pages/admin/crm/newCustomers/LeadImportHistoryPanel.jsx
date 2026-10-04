import { useState } from "react";
import { Card, Btn, Badge } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useImportBatches } from "../../../../context/ImportBatchContext";
import { DeleteImportModal } from "./SafeDeleteModals";

const th = { textAlign: "start", fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: "#475569", fontWeight: 800, padding: "10px 12px", borderBottom: `1px solid ${C.border}`, background: "#F8FAFC", whiteSpace: "nowrap" };
const td = { padding: "9px 12px", fontSize: 12.5, borderBottom: "1px solid #E2E8F0", verticalAlign: "middle" };

/**
 * SAFE-DELETE-01 — import history for LEAD imports ("عملاء جدد" files) with the
 * admin-only "حذف الاستيراد" action. (Program imports keep their own list in
 * the Program workspace — import/ImportHistoryList.jsx — and are not shown here.)
 * A deleted import is NOT removed from this list: the batch record is kept as
 * the audit trail and just shows its final status.
 */
export default function LeadImportHistoryPanel({ onClose }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { batches } = useImportBatches();
  const [deletingId, setDeletingId] = useState(null);

  const leadBatches = (batches || []).filter((b) => b.kind === "customer_leads");
  const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const deleting = deletingId ? leadBatches.find((b) => b.id === deletingId) : null;

  const statusBadge = (b) => {
    if (b.status === "deleted") return <Badge color={C.muted}>{tx("محذوف", "Deleted")}</Badge>;
    if (b.status === "deleted_partial") return <Badge color={C.warning}>{tx("حذف جزئي", "Partially deleted")}</Badge>;
    if (b.status === "deleting") return <Badge color={C.warning}>{tx("حذف غير مكتمل", "Deletion interrupted")}</Badge>;
    if (b.status === "committed_with_errors") return <Badge color={C.warning}>{tx("بأخطاء", "With errors")}</Badge>;
    return <Badge color={C.success}>{tx("مكتمل", "Committed")}</Badge>;
  };

  return (
    <Card style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, fontSize: 14 }}>{tx("سجل الاستيراد", "Import history")}</div>
        <Btn sm v="ghost" onClick={onClose}>{tx("إغلاق", "Close")}</Btn>
      </div>
      {leadBatches.length === 0 ? (
        <div style={{ padding: "0 14px 16px", color: C.muted, fontSize: 12.5 }}>{tx("لا توجد عمليات استيراد بعد.", "No imports yet.")}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={th}>{tx("المصدر", "Source")}</th>
                <th style={th}>{tx("الملف", "File")}</th>
                <th style={th}>{tx("التاريخ", "Date")}</th>
                <th style={th}>{tx("بواسطة", "By")}</th>
                <th style={th}>{tx("العملاء", "Customers")}</th>
                <th style={th}>{tx("الحالة", "Status")}</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {leadBatches.map((b) => (
                <tr key={b.id} className="edu-sheet-row">
                  <td style={{ ...td, fontWeight: 800 }}>{b.sourceName || "—"}</td>
                  <td style={td} dir="auto">{b.fileName || "—"}</td>
                  <td style={{ ...td, color: C.muted }}>{fmt(b.createdAt)}</td>
                  <td style={td}>{b.importedByName || "—"}</td>
                  <td style={td}>{(b.createdCount ?? 0) + (b.updatedCount ?? 0)} <span style={{ color: C.muted, fontSize: 11 }}>({b.createdCount ?? 0} {tx("جديد", "new")})</span></td>
                  <td style={td}>{statusBadge(b)}</td>
                  <td style={td}>
                    {b.status !== "deleted" && <Btn sm v="danger" onClick={() => setDeletingId(b.id)}>{tx("حذف الاستيراد", "Delete Import")}</Btn>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deleting && <DeleteImportModal batch={deleting} onClose={() => setDeletingId(null)} />}
    </Card>
  );
}
