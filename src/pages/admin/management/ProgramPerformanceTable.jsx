import { Card } from "../../../components/UI";
import { C } from "../../../theme";

const th = { padding: "10px 12px", textAlign: "start", fontSize: 11, fontWeight: 800, color: C.muted, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` };
const td = { padding: "10px 12px", fontSize: 12.5, verticalAlign: "middle" };

/**
 * ACCOUNTING-05 §5 — Program | Students | Revenue | Paid | Remaining.
 * Pure presentation; all figures come pre-computed from
 * utils/managementDashboard.computeProgramPerformance (already reuses
 * confirmedAmountPaid/effectiveCoursePrice, no math happens here).
 */
export default function ProgramPerformanceTable({ rows, nodeById, ar, tx }) {
  if (rows.length === 0) {
    return (
      <Card style={{ padding: 40, textAlign: "center", marginBottom: 22 }}>
        <div style={{ color: C.muted }}>{tx("لا توجد بيانات برامج بعد", "No program data yet")}</div>
      </Card>
    );
  }

  return (
    <div className="edu-sheet-scroll" style={{ overflowX: "auto", borderRadius: 12, border: `1px solid ${C.border}`, marginBottom: 22 }}>
      <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#F8FAFC" }}>
            <th style={th}>{tx("البرنامج", "Program")}</th>
            <th style={{ ...th, textAlign: "end" }}>{tx("الطلاب", "Students")}</th>
            <th style={{ ...th, textAlign: "end" }}>{tx("الإيراد (للفترة)", "Revenue (period)")}</th>
            <th style={{ ...th, textAlign: "end" }}>{tx("المدفوع", "Paid")}</th>
            <th style={{ ...th, textAlign: "end" }}>{tx("المتبقي", "Remaining")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const node = nodeById(r.catalogNodeId);
            return (
              <tr key={r.catalogNodeId} style={{ background: i % 2 === 0 ? "transparent" : "#FBFCFE" }}>
                <td style={{ ...td, fontWeight: 700 }} dir="ltr">{node ? node.name_en : r.catalogNodeId}</td>
                <td style={{ ...td, textAlign: "end" }}>{r.students.toLocaleString()}</td>
                <td style={{ ...td, textAlign: "end", color: C.success, fontWeight: 700 }} dir="ltr">{r.revenue.toLocaleString()}</td>
                <td style={{ ...td, textAlign: "end" }} dir="ltr">{r.paid.toLocaleString()}</td>
                <td style={{ ...td, textAlign: "end", color: r.remaining > 0 ? C.orange : C.muted }} dir="ltr">{r.remaining.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
