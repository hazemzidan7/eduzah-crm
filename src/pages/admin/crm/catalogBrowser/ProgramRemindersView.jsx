import { useMemo, useState } from "react";
import { Card } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useCustomers } from "../../../../context/CustomerContext";
import LeadStatusBadge from "../../../../components/crm/LeadStatusBadge";
import EngagementDetailModal from "../EngagementDetailModal";

const td = { padding: "11px 14px", fontSize: 12.5, textAlign: "center", borderBottom: "1px solid rgba(255,255,255,.09)", verticalAlign: "middle" };
const th = { textAlign: "center", fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: "rgba(255,255,255,.88)", fontWeight: 800, padding: "12px 14px", borderBottom: `1px solid ${C.border}` };

/** Every engagement in this program with a scheduled next-follow-up date,
 * split into overdue (needs attention now) and upcoming. */
export default function ProgramRemindersView({ engagements, ar, tx }) {
  const { customerById } = useCustomers();
  const [openEngagementId, setOpenEngagementId] = useState(null);

  const { overdue, upcoming } = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const withDate = engagements.filter((e) => e.nextFollowUpDate);
    const overdue = withDate.filter((e) => e.nextFollowUpDate < today).sort((a, b) => a.nextFollowUpDate.localeCompare(b.nextFollowUpDate));
    const upcoming = withDate.filter((e) => e.nextFollowUpDate >= today).sort((a, b) => a.nextFollowUpDate.localeCompare(b.nextFollowUpDate));
    return { overdue, upcoming };
  }, [engagements]);

  const fmtDate = (iso) => new Date(iso).toLocaleDateString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short", year: "numeric" });

  const renderTable = (rows, emptyLabel) => rows.length === 0 ? (
    <div style={{ fontSize: 12, color: C.muted, padding: "8px 4px 20px" }}>{emptyLabel}</div>
  ) : (
    <Card style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>{tx("العميل", "Customer")}</th>
            <th style={th}>{tx("تاريخ المتابعة", "Follow-up date")}</th>
            <th style={th}>{tx("الحالة", "Status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const customer = customerById(e.customerId);
            return (
              <tr key={e.id} className="edu-sheet-row" onClick={() => setOpenEngagementId(e.id)} style={{ cursor: "pointer" }}>
                <td style={td}><div style={{ fontWeight: 800 }}>{customer?.fullName || "—"}</div><div style={{ fontSize: 11, color: C.muted }}>{customer?.phone || "—"}</div></td>
                <td style={td}>{fmtDate(e.nextFollowUpDate)}</td>
                <td style={td}><LeadStatusBadge statusId={e.statusId} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );

  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: C.danger, marginBottom: 8, textTransform: "uppercase" }}>
        {tx(`متأخرة (${overdue.length})`, `Overdue (${overdue.length})`)}
      </div>
      {renderTable(overdue, tx("لا توجد متابعات متأخرة", "No overdue follow-ups"))}

      <div style={{ fontSize: 12.5, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase" }}>
        {tx(`القادمة (${upcoming.length})`, `Upcoming (${upcoming.length})`)}
      </div>
      {renderTable(upcoming, tx("لا توجد متابعات قادمة", "No upcoming follow-ups"))}

      {openEngagementId && (
        <EngagementDetailModal
          engagement={engagements.find((e) => e.id === openEngagementId)}
          onClose={() => setOpenEngagementId(null)}
        />
      )}
    </div>
  );
}
