import { useMemo, useState } from "react";
import { Card } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useCustomers } from "../../../../context/CustomerContext";
import { useFollowUps } from "../../../../context/FollowUpContext";
import { getDueBucket } from "../../../../utils/followUps";
import LeadStatusBadge from "../../../../components/crm/LeadStatusBadge";
import EngagementDetailModal from "../EngagementDetailModal";

const td = { padding: "11px 14px", fontSize: 12.5, textAlign: "center", borderBottom: "1px solid #E2E8F0", verticalAlign: "middle" };
const th = { textAlign: "center", fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: "#475569", fontWeight: 800, padding: "12px 14px", borderBottom: `1px solid ${C.border}` };

/**
 * FOLLOW-UP-UNIFY-02 — every PENDING canonical follow-up whose engagement
 * belongs to this Program, split into overdue (needs attention now) and
 * upcoming — same two-section shape this page always had, now sourced from
 * the real `followUps` collection (FollowUpContext) instead of the legacy
 * engagement.nextFollowUpDate field, so it can never disagree with the
 * Follow-ups page or Management Dashboard again. "Today" folds into
 * Upcoming here, same as the original binary overdue/upcoming split — this
 * page never had a third bucket.
 *
 * A follow-up carries its own dueAt (a real instant, with a time), unlike
 * the legacy date-only field — shown accordingly. Customer info prefers the
 * live customerById() join (same fallback-to-snapshot pattern FollowUpsPage
 * already uses) over the follow-up's own denormalized customerName/Phone.
 * Two pending follow-ups on the same engagement both show as two rows —
 * both are real, independent reminders; this page's job is to surface every
 * one that needs attention, not to collapse them (that collapsing-to-one is
 * specifically the Sales Sheet's own constraint, not this page's).
 */
export default function ProgramRemindersView({ engagements, ar, tx }) {
  const { customerById } = useCustomers();
  const { followUps } = useFollowUps();
  const [openEngagementId, setOpenEngagementId] = useState(null);

  const { overdue, upcoming } = useMemo(() => {
    const engagementById = new Map(engagements.map((e) => [e.id, e]));
    const pending = followUps.filter((f) => f.status === "pending" && engagementById.has(f.engagementId));
    const overdue = pending.filter((f) => getDueBucket(f) === "overdue").sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""));
    const upcoming = pending.filter((f) => getDueBucket(f) !== "overdue").sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""));
    return { overdue, upcoming };
  }, [engagements, followUps]);

  const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  const renderTable = (rows, emptyLabel) => rows.length === 0 ? (
    <div style={{ fontSize: 12, color: C.muted, padding: "8px 4px 20px" }}>{emptyLabel}</div>
  ) : (
    <Card style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>{tx("العميل", "Customer")}</th>
            <th style={th}>{tx("موعد المتابعة", "Follow-up due")}</th>
            <th style={th}>{tx("الحالة", "Status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const engagement = engagements.find((e) => e.id === f.engagementId);
            const customer = customerById(f.customerId);
            const displayName = customer?.fullName || f.customerName || "—";
            const displayPhone = customer?.phone || f.customerPhone || "—";
            return (
              <tr key={f.id} className="edu-sheet-row" onClick={() => setOpenEngagementId(f.engagementId)} style={{ cursor: "pointer" }}>
                <td style={td}><div style={{ fontWeight: 800 }}>{displayName}</div><div dir="ltr" style={{ fontSize: 11, color: C.muted }}>{displayPhone}</div></td>
                <td style={td} dir="ltr">{fmtDateTime(f.dueAt)}</td>
                <td style={td}><LeadStatusBadge statusId={engagement?.statusId} /></td>
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
