import { useState, useMemo } from "react";
import { Card } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useAuth } from "../../../../context/AuthContext";
import { useLeadStatus } from "../../../../context/LeadStatusContext";
import { useCustomers } from "../../../../context/CustomerContext";
import LeadStatusBadge from "../../../../components/crm/LeadStatusBadge";
import EngagementDetailModal from "../EngagementDetailModal";
import { CONTACT_STATUS_OPTIONS, optionLabel } from "../../../../constants/crmOptions";

const th = { textAlign: "start", fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: C.muted, fontWeight: 700, padding: "12px 14px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
const td = { padding: "11px 14px", fontSize: 12.5, borderBottom: "1px solid rgba(255,255,255,.06)", verticalAlign: "middle", whiteSpace: "nowrap" };

const PRIORITY_COLOR = { low: C.muted, normal: C.muted, high: C.danger };

/** The Students view within one Program's workspace — search + status filter
 * over an already-scoped engagement list. Same table shape works for every
 * Program, since nothing here is course-specific. */
export default function ProgramStudentsList({ engagements, ar, tx }) {
  const { users } = useAuth();
  const { statusById } = useLeadStatus();
  const { customerById } = useCustomers();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openEngagementId, setOpenEngagementId] = useState(null);

  const employeeName = (uid) => {
    if (!uid) return tx("غير معيّن", "Unassigned");
    const u = users.find((x) => x.id === uid);
    return u ? (u.name || u.email) : tx("غير معيّن", "Unassigned");
  };

  const statusOptionsPresent = useMemo(() => {
    const seen = new Map();
    for (const e of engagements) {
      if (e.statusId && !seen.has(e.statusId)) {
        const s = statusById(e.statusId);
        if (s) seen.set(e.statusId, s);
      }
    }
    return [...seen.values()];
  }, [engagements, statusById]);

  const filtered = useMemo(() => {
    let rows = engagements;
    if (statusFilter !== "all") rows = rows.filter((e) => e.statusId === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((e) => {
        const c = customerById(e.customerId);
        return (c?.fullName || "").toLowerCase().includes(q) || (c?.phone || "").includes(q) || (c?.email || "").toLowerCase().includes(q);
      });
    }
    return [...rows].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [engagements, statusFilter, search, customerById]);

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short" }) : "—";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tx("بحث بالاسم أو الهاتف أو البريد…", "Search name, phone, email…")}
          style={{ background: "rgba(255,255,255,.06)", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "9px 13px", color: "#fff", fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", minWidth: 220 }}
        />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={() => setStatusFilter("all")} style={pillStyle(statusFilter === "all", C.purple)}>
          {tx("الكل", "All")} <span style={{ opacity: 0.7 }}>({engagements.length})</span>
        </button>
        {statusOptionsPresent.map((s) => (
          <button key={s.id} onClick={() => setStatusFilter(s.id)} style={pillStyle(statusFilter === s.id, s.color || C.purple)}>
            {ar ? s.name_ar : s.name_en} <span style={{ opacity: 0.7 }}>({engagements.filter((e) => e.statusId === s.id).length})</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card style={{ padding: 32, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("لا يوجد طلاب بعد", "No students yet")}</div></Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={th}>{tx("العميل", "Customer")}</th>
                  <th style={th}>{tx("الهاتف", "Phone")}</th>
                  <th style={th}>{tx("الحالة", "Status")}</th>
                  <th style={th}>{tx("حالة التواصل", "Contact")}</th>
                  <th style={th}>{tx("الأولوية", "Priority")}</th>
                  <th style={th}>{tx("الموظف المسؤول", "Assigned")}</th>
                  <th style={th}>{tx("المتابعة القادمة", "Next Follow-up")}</th>
                  <th style={th}>{tx("تاريخ الإضافة", "Added")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((e) => {
                  const customer = customerById(e.customerId);
                  return (
                    <tr key={e.id} onClick={() => setOpenEngagementId(e.id)} style={{ cursor: "pointer" }}>
                      <td style={td}><div style={{ fontWeight: 800, color: "#fff" }}>{customer?.fullName || "—"}</div></td>
                      <td style={td}>{customer?.phone || "—"}</td>
                      <td style={td}><LeadStatusBadge statusId={e.statusId} /></td>
                      <td style={td}>{optionLabel(CONTACT_STATUS_OPTIONS, e.contactStatus, ar) || tx("لم يتم", "Not Contacted")}</td>
                      <td style={td}><span style={{ color: PRIORITY_COLOR[e.priority] || C.muted, fontWeight: e.priority === "high" ? 800 : 500 }}>{priorityLabel(e.priority, tx)}</span></td>
                      <td style={td}>{employeeName(e.ownerId)}</td>
                      <td style={td}>{fmtDate(e.nextFollowUpDate)}</td>
                      <td style={td}>{fmtDate(e.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 300 && (
            <div style={{ fontSize: 11.5, color: C.muted, padding: "8px 14px" }}>
              {tx(`+ ${filtered.length - 300} طالب إضافي (استخدم البحث)`, `+ ${filtered.length - 300} more (use search to narrow)`)}
            </div>
          )}
        </Card>
      )}

      {openEngagementId && (
        <EngagementDetailModal
          engagement={engagements.find((e) => e.id === openEngagementId)}
          onClose={() => setOpenEngagementId(null)}
        />
      )}
    </div>
  );
}

function priorityLabel(p, tx) {
  if (p === "high") return tx("عالية", "High");
  if (p === "low") return tx("منخفضة", "Low");
  return tx("عادية", "Normal");
}
function pillStyle(active, color) {
  return {
    padding: "6px 13px", borderRadius: 99, border: "none", cursor: "pointer",
    fontWeight: 800, fontSize: 11.5, fontFamily: "'Cairo',sans-serif",
    background: active ? color : "rgba(255,255,255,.06)",
    color: active ? "#fff" : C.muted,
    transition: "all .2s",
  };
}
