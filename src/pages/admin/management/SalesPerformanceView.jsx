import { Fragment, useMemo, useState } from "react";
import { Card, Input } from "../../../components/UI";
import { C, radius } from "../../../theme";
import { useLang } from "../../../context/LangContext";
import { useCustomers } from "../../../context/CustomerContext";
import { useAuth } from "../../../context/AuthContext";
import { useFollowUps } from "../../../context/FollowUpContext";
import { useCatalog } from "../../../context/CatalogContext";
import {
  IconPeople, IconMoney, IconTrendUp, IconCalendarCheck, IconBell, IconSort, IconChevronDown, IconChevronRight,
} from "../../../components/Icons";
import { MANAGEMENT_PERIODS, MANAGEMENT_PERIOD_OPTIONS } from "../../../utils/managementDashboard";
import { reportPeriodRange, REPORT_PERIODS, thisWeekRange, currentMonthRange } from "../../../utils/accounting";
import {
  computeSalesPerformance, summarizeSalesPerformance, isInPeriod, UNASSIGNED_OWNER_KEY,
} from "../../../utils/salesPerformance";
import { effectivePaymentRecords } from "../../../utils/paymentRecords";
import { getDueBucket } from "../../../utils/followUps";
import { StatCard } from "../accounting/AccountingBadges";
import LeadStatusBadge from "../../../components/crm/LeadStatusBadge";
import EngagementDetailModal from "../crm/EngagementDetailModal";

// Same tiny module-local helpers this codebase already duplicates per file
// rather than sharing (see ManagementDashboard.jsx's/AccountingPage.jsx's
// own todayIso/pillStyle) — not extracted into a shared module, consistent
// with that established convention.
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function pillStyle(active) {
  return {
    padding: "6px 13px", borderRadius: 99, border: "none", cursor: "pointer",
    fontWeight: 800, fontSize: 11.5, fontFamily: "'Cairo',sans-serif",
    background: active ? C.red : `${C.purple}26`, color: active ? "#fff" : C.muted,
    transition: "all .2s", whiteSpace: "nowrap",
  };
}

const sectionTitleSx = { fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 };
const grid4 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 18 };
const th = { textAlign: "center", fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase", color: "#475569", fontWeight: 800, padding: "10px 12px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
const td = { padding: "9px 12px", fontSize: 12.5, textAlign: "center", borderBottom: "1px solid #E2E8F0", verticalAlign: "middle" };

function SortableTh({ children, colKey, activeKey, dir, onToggle }) {
  const active = activeKey === colKey;
  return (
    <th style={{ ...th, cursor: "pointer", userSelect: "none" }} onClick={() => onToggle(colKey)}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {children}
        <span style={{ display: "inline-flex", opacity: active ? 1 : 0.35, transform: active && dir === "desc" ? "scaleY(-1)" : "none" }}>
          <IconSort size={11} />
        </span>
      </span>
    </th>
  );
}

/** Same visual language as AccountingBadges' StatCard, but renders "—" for a null rate instead of a misleading 0%. */
function RateStatCard({ Icon, color, label, value }) {
  return (
    <Card style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: `${color}26`, display: "flex", alignItems: "center", justifyContent: "center", color }}>
          <Icon size={14} />
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>{label}</div>
      </div>
      <div style={{ fontSize: 17, fontWeight: 900 }} dir="ltr">
        {value == null ? "—" : `${Math.round(value * 100)}%`}
      </div>
    </Card>
  );
}

function repLabel(row, tx) {
  if (row.isUnassigned) return tx("بدون مسؤول", "Unassigned");
  if (row.isUnknown) return tx("مستخدم غير معروف / محذوف", "Unknown / Deleted User");
  return row.displayLabel || row.ownerId;
}

/**
 * SALES-PERF-01 — Admin-only Sales Performance table + drill-down, a second
 * tab inside the existing Management section (see ManagementDashboard.jsx's
 * own view switch) — same "sub-navigation within one Admin section"
 * convention AccountingPage's Overview/Reports tabs already established;
 * no new Sidebar item, no new route. Inherits ManagementDashboard's own
 * existing admin-only guard (AdminShell's strandedOnManagement) for free —
 * this component is never reachable by a non-admin session in the first
 * place, so no second permission check is duplicated here.
 *
 * Every input is data CustomerContext/FollowUpContext/AuthContext already
 * load for any admin session (AuthContext's `users` is a one-time getDocs
 * fetch on login, not a new listener) — no new Firestore subscription.
 * See utils/salesPerformance.js for the full metric definitions and the
 * documented reasoning behind what was deliberately left out (Conversion
 * Rate, Net Revenue after refunds).
 */
export default function SalesPerformanceView() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { engagements, customerById } = useCustomers();
  const { users } = useAuth();
  const { followUps } = useFollowUps();
  const { nodeById } = useCatalog();

  const [periodType, setPeriodType] = useState(MANAGEMENT_PERIODS.THIS_MONTH);
  const [customFrom, setCustomFrom] = useState(todayIso());
  const [customTo, setCustomTo] = useState(todayIso());
  const [sortKey, setSortKey] = useState("revenue");
  const [sortDir, setSortDir] = useState("desc");
  const [expandedKey, setExpandedKey] = useState(null);
  const [openEngagementId, setOpenEngagementId] = useState(null);

  const { from, to } = useMemo(() => {
    const now = new Date();
    if (periodType === MANAGEMENT_PERIODS.TODAY) return reportPeriodRange(REPORT_PERIODS.DAILY, now);
    if (periodType === MANAGEMENT_PERIODS.THIS_WEEK) return thisWeekRange(now);
    if (periodType === MANAGEMENT_PERIODS.THIS_MONTH) return currentMonthRange(now);
    return { from: customFrom, to: customTo }; // CUSTOM
  }, [periodType, customFrom, customTo]);

  const rows = useMemo(
    () => computeSalesPerformance(engagements, followUps, users, { dateFrom: from, dateTo: to }),
    [engagements, followUps, users, from, to],
  );
  const summary = useMemo(() => summarizeSalesPerformance(rows), [rows]);

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = a[sortKey] ?? -Infinity;
      const vb = b[sortKey] ?? -Infinity;
      const cmp = va - vb;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("desc"); return; }
    setSortDir((d) => (d === "desc" ? "asc" : "desc"));
  };

  // Drill-down — computed only for the one expanded row, not for every row
  // on every render. Ownership-side lists (engagements, confirmed payments)
  // are period-scoped exactly like the table's own numbers; Overdue
  // follow-ups stays current-state, same as its own column.
  const drillDown = useMemo(() => {
    if (!expandedKey) return null;
    const ownedEngagements = engagements.filter((e) => !e.archivedAt && (e.ownerId || UNASSIGNED_OWNER_KEY) === expandedKey);
    const periodOwnedEngagements = ownedEngagements.filter((e) => isInPeriod(e.createdAt, from, to));
    const assignedFollowUps = followUps.filter((f) => (f.assignedTo || UNASSIGNED_OWNER_KEY) === expandedKey && isInPeriod(f.createdAt, from, to));
    const overdueFollowUps = followUps.filter((f) => (f.assignedTo || UNASSIGNED_OWNER_KEY) === expandedKey && f.status === "pending" && getDueBucket(f) === "overdue");
    const confirmedPayments = [];
    for (const e of ownedEngagements) {
      for (const r of effectivePaymentRecords(e)) {
        if (r.status === "confirmed" && isInPeriod(r.confirmedAt, from, to)) confirmedPayments.push({ record: r, engagement: e });
      }
    }
    return { periodOwnedEngagements, assignedFollowUps, overdueFollowUps, confirmedPayments };
  }, [expandedKey, engagements, followUps, from, to]);

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short", year: "numeric" }) : "—";

  return (
    <div>
      {/* ── Period filter — same MANAGEMENT_PERIODS/period helpers Overview
          uses, own independent selection so comparing "this week" here
          doesn't fight Overview's own period choice. ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {MANAGEMENT_PERIOD_OPTIONS.map((o) => (
            <button key={o.v} onClick={() => setPeriodType(o.v)} style={pillStyle(periodType === o.v)}>{ar ? o.ar : o.en}</button>
          ))}
        </div>
        {periodType === MANAGEMENT_PERIODS.CUSTOM && (
          <>
            <div style={{ minWidth: 140 }}><Input type="date" value={customFrom} onChange={setCustomFrom} label={tx("من", "From")} /></div>
            <div style={{ minWidth: 140 }}><Input type="date" value={customTo} onChange={setCustomTo} label={tx("إلى", "To")} /></div>
          </>
        )}
      </div>

      {/* ── Summary cards ── */}
      <div style={sectionTitleSx}>{tx("ملخص", "Summary")}</div>
      <div style={grid4}>
        <StatCard Icon={IconPeople} color={C.pmid} label={tx("عدد المندوبين", "Sales Representatives")} value={summary.totalReps} />
        <StatCard Icon={IconPeople} color={C.purple} label={tx("عملاء مسندة", "Assigned Leads")} value={summary.totalAssignedLeads} />
        <StatCard Icon={IconMoney} color={C.success} label={tx("دفعات مؤكدة", "Confirmed Payments")} value={summary.totalConfirmedPayments} />
        <StatCard Icon={IconTrendUp} color={C.success} label={tx("إجمالي الإيراد", "Total Revenue")} value={summary.totalRevenue} suffix={ar ? "ج.م" : "EGP"} />
        <RateStatCard Icon={IconCalendarCheck} color={C.orange} label={tx("نسبة إتمام المتابعات", "Follow-up Completion Rate")} value={summary.followUpCompletionRate} />
      </div>

      {/* ── Attribution note — required so "who owns the lead" is never
          silently conflated with "who executed the follow-up". ── */}
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 12, lineHeight: 1.8, padding: "8px 12px", background: "#F8FAFC", borderRadius: radius.md }}>
        ℹ️ {tx(
          "«العملاء المسندة» و«الدفعات المؤكدة» و«الإيراد» محسوبة حسب مسؤول العميل (Owner). «المتابعات» محسوبة حسب المكلَّف بالمتابعة (Assignee) — قد يكونان شخصين مختلفين لنفس العميل.",
          "Assigned Leads, Confirmed Payments, and Revenue are attributed to the engagement's OWNER. Follow-ups are attributed to the follow-up's ASSIGNEE — these can be two different people for the same lead.",
        )}
      </div>

      {/* ── Main table ── */}
      <div style={sectionTitleSx}>{tx("أداء المندوبين", "Representative Performance")}</div>
      {sortedRows.length === 0 ? (
        <Card style={{ padding: 32, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("لا توجد بيانات بعد", "No data yet")}</div></Card>
      ) : (
        <div className="edu-sheet-scroll" style={{ overflowX: "auto", borderRadius: 12, border: `1px solid ${C.border}` }}>
          <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "start" }}>{tx("المندوب", "Sales Representative")}</th>
                <SortableTh colKey="assignedLeads" activeKey={sortKey} dir={sortDir} onToggle={toggleSort}>{tx("عملاء مسندة", "Assigned Leads")}</SortableTh>
                <SortableTh colKey="followUpsAssigned" activeKey={sortKey} dir={sortDir} onToggle={toggleSort}>{tx("متابعات", "Follow-ups")}</SortableTh>
                <th style={th}>{tx("مكتملة", "Completed")}</th>
                <SortableTh colKey="followUpsOverdue" activeKey={sortKey} dir={sortDir} onToggle={toggleSort}>{tx("متأخرة", "Overdue")}</SortableTh>
                <SortableTh colKey="completionRate" activeKey={sortKey} dir={sortDir} onToggle={toggleSort}>{tx("نسبة الإتمام", "Completion")}</SortableTh>
                <SortableTh colKey="confirmedPayments" activeKey={sortKey} dir={sortDir} onToggle={toggleSort}>{tx("دفعات مؤكدة", "Confirmed Payments")}</SortableTh>
                <SortableTh colKey="revenue" activeKey={sortKey} dir={sortDir} onToggle={toggleSort}>{tx("الإيراد", "Revenue")}</SortableTh>
                <SortableTh colKey="payingStudents" activeKey={sortKey} dir={sortDir} onToggle={toggleSort}>{tx("طلاب دافعون", "Paying Students")}</SortableTh>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const isOpen = expandedKey === row.key;
                return (
                  <Fragment key={row.key}>
                    <tr className="edu-sheet-row" style={{ cursor: "pointer" }} onClick={() => setExpandedKey(isOpen ? null : row.key)}>
                      <td style={{ ...td, textAlign: "start", fontWeight: 800 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span style={{ display: "inline-flex", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", color: C.muted }}>
                            <IconChevronRight size={12} />
                          </span>
                          {(row.isUnassigned || row.isUnknown) ? <span style={{ fontStyle: "italic", color: C.muted, fontWeight: 700 }}>{repLabel(row, tx)}</span> : repLabel(row, tx)}
                        </span>
                      </td>
                      <td style={td}>{row.assignedLeads}</td>
                      <td style={td}>{row.followUpsAssigned}</td>
                      <td style={td}>{row.followUpsCompleted}</td>
                      <td style={{ ...td, color: row.followUpsOverdue > 0 ? C.danger : C.text, fontWeight: row.followUpsOverdue > 0 ? 800 : 400 }}>{row.followUpsOverdue}</td>
                      <td style={td}>{row.completionRate == null ? "—" : `${Math.round(row.completionRate * 100)}%`}</td>
                      <td style={td}>{row.confirmedPayments}</td>
                      <td style={{ ...td, fontWeight: 800, color: C.success }} dir="ltr">{row.revenue.toLocaleString()}</td>
                      <td style={td}>{row.payingStudents}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} style={{ padding: 0, borderBottom: `1px solid ${C.border}` }}>
                          <div style={{ padding: "14px 20px", background: "#F8FAFC" }}>
                            {!drillDown ? null : (
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                                <div>
                                  <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>
                                    {tx(`العملاء المسندة (${drillDown.periodOwnedEngagements.length})`, `Assigned Leads (${drillDown.periodOwnedEngagements.length})`)}
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
                                    {drillDown.periodOwnedEngagements.length === 0 && <div style={{ fontSize: 11.5, color: C.muted }}>—</div>}
                                    {drillDown.periodOwnedEngagements.map((e) => {
                                      const customer = customerById(e.customerId);
                                      const program = e.catalogNodeId ? nodeById(e.catalogNodeId) : null;
                                      return (
                                        <button key={e.id} onClick={(ev) => { ev.stopPropagation(); setOpenEngagementId(e.id); }} className="edu-row-menu-item" style={{ textAlign: "start", padding: "5px 8px" }}>
                                          <div style={{ fontSize: 11.5, fontWeight: 700 }}>{customer?.fullName || "—"}</div>
                                          <div style={{ fontSize: 10, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
                                            <span dir="ltr">{program?.name_en || "—"}</span>
                                            <LeadStatusBadge statusId={e.statusId} />
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>
                                    {tx(`المتابعات (${drillDown.assignedFollowUps.length}) — متأخرة (${drillDown.overdueFollowUps.length})`, `Follow-ups (${drillDown.assignedFollowUps.length}) — Overdue (${drillDown.overdueFollowUps.length})`)}
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
                                    {drillDown.assignedFollowUps.length === 0 && <div style={{ fontSize: 11.5, color: C.muted }}>—</div>}
                                    {drillDown.assignedFollowUps.map((f) => {
                                      const bucket = getDueBucket(f);
                                      const color = bucket === "overdue" ? C.danger : bucket === "completed" ? C.success : C.muted;
                                      return (
                                        <div key={f.id} style={{ fontSize: 11.5, display: "flex", justifyContent: "space-between", padding: "3px 8px" }}>
                                          <span>{f.customerName || customerById(f.customerId)?.fullName || "—"}</span>
                                          <span style={{ color, fontWeight: 700 }} dir="ltr">{fmtDate(f.dueAt)}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>
                                    {tx(`الدفعات المؤكدة (${drillDown.confirmedPayments.length})`, `Confirmed Payments (${drillDown.confirmedPayments.length})`)}
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
                                    {drillDown.confirmedPayments.length === 0 && <div style={{ fontSize: 11.5, color: C.muted }}>—</div>}
                                    {drillDown.confirmedPayments.map(({ record, engagement }) => {
                                      const customer = customerById(engagement.customerId);
                                      return (
                                        <button key={record.id} onClick={(ev) => { ev.stopPropagation(); setOpenEngagementId(engagement.id); }} className="edu-row-menu-item" style={{ textAlign: "start", padding: "5px 8px", display: "flex", justifyContent: "space-between" }}>
                                          <span style={{ fontSize: 11.5 }}>{customer?.fullName || "—"}</span>
                                          <span style={{ fontSize: 11.5, fontWeight: 800, color: C.success }} dir="ltr">{(record.amount || 0).toLocaleString()}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
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
