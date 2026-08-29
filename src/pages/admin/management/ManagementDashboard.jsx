import { useMemo, useState } from "react";
import { Card, Input } from "../../../components/UI";
import { C } from "../../../theme";
import {
  IconBarChart, IconTrendUp, IconTrendDown, IconUndo, IconSwap, IconWallet, IconPeople,
  IconGrid, IconBox, IconMoney, IconHistory, IconBell, IconCalendarCheck,
} from "../../../components/Icons";
import { useLang } from "../../../context/LangContext";
import { useCustomers } from "../../../context/CustomerContext";
import { useAccounting } from "../../../context/AccountingContext";
import { useFollowUps } from "../../../context/FollowUpContext";
import { useLeadStatus } from "../../../context/LeadStatusContext";
import { useCatalog } from "../../../context/CatalogContext";
import { useCrmNav } from "../../../context/CrmNavContext";
import {
  ACCOUNT_OPTIONS, computeAccountBalances, computeReportMetrics, filterTransactions,
  reportPeriodRange, REPORT_PERIODS, thisWeekRange, currentMonthRange, excludeDeletedTransactions,
} from "../../../utils/accounting";
import { effectivePaymentRecords } from "../../../utils/paymentRecords";
import { computeFollowUpDashboardStats } from "../../../utils/followUps";
import { StatCard, BalanceCard } from "../accounting/AccountingBadges";
import {
  MANAGEMENT_PERIODS, MANAGEMENT_PERIOD_OPTIONS,
  computePaymentStatusCounts, computePaymentAlerts,
  computeLeadFunnel, computeProgramPerformance, computeRecentActivity,
} from "../../../utils/managementDashboard";
import ProgramPerformanceTable from "./ProgramPerformanceTable";
import SalesPerformanceView from "./SalesPerformanceView";

function pillStyle(active) {
  return {
    padding: "6px 13px", borderRadius: 99, border: "none", cursor: "pointer",
    fontWeight: 800, fontSize: 11.5, fontFamily: "'Cairo',sans-serif",
    background: active ? C.red : `${C.purple}26`, color: active ? "#fff" : C.muted,
    transition: "all .2s", whiteSpace: "nowrap",
  };
}

const sectionTitleSx = { fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 };
const grid4 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 22 };

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function AlertRow({ label, count, onClick, severity }) {
  if (!count) return null;
  const color = severity === "danger" ? C.danger : C.orange;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
        background: `${color}18`, border: `1px solid ${color}55`, borderRadius: 10,
        padding: "10px 14px", marginBottom: 8, cursor: onClick ? "pointer" : "default",
        fontFamily: "'Cairo',sans-serif", color: C.text,
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color }}>⚠</span> {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 900, color }}>{count}</span>
    </button>
  );
}

function ActivityRow({ item, ar, tx, customerById }) {
  const customer = item.customerId ? customerById(item.customerId) : null;
  const label = {
    registration: tx("تسجيل طالب جديد", "New student registration"),
    enrollment: tx("تفعيل تسجيل", "Enrollment"),
    payment: tx("دفعة مؤكدة", "Confirmed payment"),
    refund: tx("استرداد", "Refund"),
    expense: tx("مصروف", "Expense"),
  }[item.kind] || item.kind;
  const color = { registration: C.pmid, enrollment: C.success, payment: C.success, refund: C.orange, expense: C.danger }[item.kind] || C.muted;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color }}>{label}</div>
        <div style={{ fontSize: 11, color: C.muted }}>{customer?.fullName || "—"}</div>
      </div>
      <div style={{ textAlign: "end" }}>
        {typeof item.amount === "number" && <div dir="ltr" style={{ fontSize: 12, fontWeight: 700 }}>{item.amount.toLocaleString()}</div>}
        <div style={{ fontSize: 10.5, color: C.muted }}>{new Date(item.at).toLocaleString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
      </div>
    </div>
  );
}

/**
 * ACCOUNTING-05 — Admin-only executive overview. Deliberately separate from
 * the Accounting Dashboard/Reports (unchanged, untouched): this reads the
 * exact same already-loaded CustomerContext/AccountingContext/LeadStatusContext
 * data those pages already subscribe to — no new Firestore listener is
 * created here. Every number either calls an existing pure function
 * (computeReportMetrics, computeAccountBalances, filterTransactions,
 * confirmedAmountPaid/effectiveCoursePrice via managementDashboard.js) or is
 * a plain count over fields that already exist — see managementDashboard.js
 * for what's genuinely new vs. reused.
 */
export default function ManagementDashboard() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { customers, customerById, engagements, engagementById } = useCustomers();
  const { transactions } = useAccounting();
  const { followUps } = useFollowUps();
  const { statuses } = useLeadStatus();
  const { nodeById } = useCatalog();
  const { setSection, goToCatalog } = useCrmNav();

  // SALES-PERF-01 — a second view inside this same Admin-only Management
  // section, same "view" tab pattern AccountingPage already uses for its
  // own Overview/Reports split — not a new Sidebar item, not a new route.
  // Inherits AdminShell's existing strandedOnManagement guard for free.
  const [view, setView] = useState("overview");

  const [periodType, setPeriodType] = useState(MANAGEMENT_PERIODS.TODAY);
  const [customFrom, setCustomFrom] = useState(todayIso());
  const [customTo, setCustomTo] = useState(todayIso());

  const { from, to } = useMemo(() => {
    const now = new Date();
    if (periodType === MANAGEMENT_PERIODS.TODAY) return reportPeriodRange(REPORT_PERIODS.DAILY, now);
    if (periodType === MANAGEMENT_PERIODS.THIS_WEEK) return thisWeekRange(now);
    if (periodType === MANAGEMENT_PERIODS.THIS_MONTH) return currentMonthRange(now);
    return { from: customFrom, to: customTo }; // CUSTOM
  }, [periodType, customFrom, customTo]);

  // ACCOUNTING-DELETE-01 — a soft-deleted transaction must not appear in
  // any Management Dashboard total (Executive Summary, Payment Summary,
  // Money by Method, Program Performance, Recent Activity all derive from
  // periodTransactions/balances below).
  const activeTransactions = useMemo(() => excludeDeletedTransactions(transactions), [transactions]);

  const periodTransactions = useMemo(() => filterTransactions(activeTransactions, { dateFrom: from, dateTo: to }), [activeTransactions, from, to]);
  // BUGFIX (FINALIZATION STEP 3) — computeReportMetrics' deposits/
  // installments/fullPayments split only resolves when a paymentTypeFor
  // hook is supplied (see utils/accounting.js's own docstring); without one
  // every transaction's paymentType reads as null and the Payment Summary
  // split silently stays 0/0/0 forever, even though Total Income is correct.
  // This was missing here. Exact same resolver AccountingReports.jsx already
  // uses for the identical figures — not a new rule, just wiring the
  // existing one in here too.
  const paymentTypeFor = (t) => {
    if (!t.relatedEngagementId || !t.relatedPaymentId) return null;
    const engagement = engagementById(t.relatedEngagementId);
    if (!engagement) return null;
    const record = effectivePaymentRecords(engagement).find((r) => r.id === t.relatedPaymentId);
    return record?.paymentType || null;
  };
  const metrics = useMemo(
    () => computeReportMetrics(periodTransactions, { paymentTypeFor }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [periodTransactions, engagementById],
  );
  const balances = useMemo(() => computeAccountBalances(activeTransactions), [activeTransactions]); // all-time, same as Accounting Dashboard
  const statusCounts = useMemo(() => computePaymentStatusCounts(engagements, { dateFrom: from, dateTo: to }), [engagements, from, to]);
  const alerts = useMemo(() => computePaymentAlerts(engagements), [engagements]);
  const funnel = useMemo(() => computeLeadFunnel(engagements, statuses), [engagements, statuses]);
  const programRows = useMemo(() => computeProgramPerformance(engagements, periodTransactions), [engagements, periodTransactions]);
  const recentActivity = useMemo(() => computeRecentActivity(engagements, periodTransactions, { limit: 10 }), [engagements, periodTransactions]);
  // CRM-05 — small Follow-up summary (section 8 of the spec), always
  // current-state (not period-scoped, same reasoning as the Payment
  // Verification alerts above) — reads FollowUpContext directly, no new
  // Firestore listener, no duplicate of the full Follow-ups page.
  const followUpStats = useMemo(() => computeFollowUpDashboardStats(followUps), [followUps]);

  const totalLeads = useMemo(() => engagements.filter((e) => !e.archivedAt).length, [engagements]);
  const newLeadsInPeriod = useMemo(
    () => engagements.filter((e) => !e.archivedAt && (e.createdAt || "").slice(0, 10) >= from && (e.createdAt || "").slice(0, 10) <= to).length,
    [engagements, from, to],
  );
  const confirmedPaymentsInPeriod = useMemo(() => periodTransactions.filter((t) => t.type === "income").length, [periodTransactions]);
  const conversionRate = totalLeads > 0 ? (funnel.enrolled / totalLeads) * 100 : 0;

  const goPayments = () => setSection("payments");
  const goAccounting = () => setSection("accounting");
  const goFollowUps = () => setSection("followups");

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 800 }}>
          <IconBarChart size={18} />
          {tx("لوحة الإدارة", "Management Dashboard")}
        </div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
          {tx("نظرة عامة تنفيذية — منفصلة عن لوحة المحاسبة التفصيلية.", "Executive overview — separate from the detailed Accounting Dashboard.")}
        </div>
      </div>

      {/* ── SALES-PERF-01: Overview / Sales Performance — same tab pattern
          AccountingPage already uses; Overview is the default, unchanged
          view, Sales Performance is purely additive and never runs unless
          explicitly selected. ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, borderBottom: `1px solid ${C.border}`, paddingBottom: 10 }}>
        {[
          { v: "overview", ar: "نظرة عامة", en: "Overview" },
          { v: "sales_performance", ar: "أداء المبيعات", en: "Sales Performance" },
        ].map((t) => (
          <button key={t.v} onClick={() => setView(t.v)} style={pillStyle(view === t.v)}>{ar ? t.ar : t.en}</button>
        ))}
      </div>

      {view === "sales_performance" ? (
        <SalesPerformanceView />
      ) : (
      <>
      {/* ── Period filter ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 22 }}>
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

      {/* ── Section 1: Executive Summary ── */}
      <div style={sectionTitleSx}>{tx("الملخص التنفيذي", "Executive Summary")}</div>
      <div style={grid4}>
        <StatCard Icon={IconTrendUp} color={C.success} label={tx("إجمالي الإيرادات", "Total Revenue")} value={metrics.income} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconTrendDown} color={C.danger} label={tx("إجمالي المصروفات", "Total Expenses")} value={metrics.expense} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconUndo} color={C.orange} label={tx("إجمالي المرتجعات", "Total Refunds")} value={metrics.refund} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconSwap} color={C.muted} label={tx("صافي الحركة", "Net Movement")} value={metrics.netMovement} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconMoney} color={C.success} label={tx("دفعات مؤكدة", "Confirmed Payments")} value={confirmedPaymentsInPeriod} />
        <StatCard Icon={IconPeople} color={C.red} label={tx("الطلاب الدافعون", "Paying Students")} value={metrics.payingStudentCount} />
        <StatCard Icon={IconPeople} color={C.pmid} label={tx("إجمالي العملاء", "Total Leads")} value={totalLeads} />
        <StatCard Icon={IconPeople} color={C.orange} label={tx("الطلاب المسجَّلون", "Enrolled Students")} value={funnel.enrolled} />
      </div>

      {/* ── Section 2: Payment Summary ── */}
      <div style={sectionTitleSx}>{tx("ملخص الدفعات", "Payment Summary")}</div>
      <div style={grid4}>
        <StatCard Icon={IconTrendUp} color={C.success} label={tx("العرابين", "Deposits")} value={metrics.deposits} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconTrendUp} color={C.pmid} label={tx("الأقساط", "Installments")} value={metrics.installments} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconTrendUp} color={C.orange} label={tx("الدفعات الكاملة", "Full Payments")} value={metrics.fullPayments} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconMoney} color={C.muted} label={tx("قيد الانتظار", "Pending")} value={statusCounts.pending} />
        <StatCard Icon={IconMoney} color={C.orange} label={tx("قيد المراجعة", "Under Review")} value={statusCounts.under_review} />
        <StatCard Icon={IconMoney} color={C.success} label={tx("مؤكدة", "Confirmed")} value={statusCounts.confirmed} />
        <StatCard Icon={IconMoney} color={C.danger} label={tx("مرفوضة", "Rejected")} value={statusCounts.rejected} />
      </div>

      {/* ── Section 3: Money by Method ── */}
      <div style={sectionTitleSx}>{tx("الأموال حسب الطريقة", "Money by Method")}</div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, marginTop: -4 }}>
        {tx("الإيراد المؤكد لهذه الفترة، والرصيد الحالي (كل الأوقات) لكل حساب.", "Confirmed income for this period, and each account's current (all-time) balance.")}
      </div>
      <div style={grid4}>
        {ACCOUNT_OPTIONS.map((a) => (
          <StatCard key={a.v} Icon={IconWallet} color={C.success} label={tx(`إيراد ${a.ar}`, `${a.en} Income`)} value={metrics.incomeByAccount[a.v] || 0} suffix={ar ? "ج.م" : "EGP"} />
        ))}
      </div>
      <div style={grid4}>
        {ACCOUNT_OPTIONS.map((a) => (
          <BalanceCard key={a.v} label={ar ? a.ar : a.en} value={balances[a.v] || 0} ar={ar} />
        ))}
        <BalanceCard label={tx("إجمالي الرصيد", "Total Balance")} value={balances.total || 0} highlight ar={ar} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 22 }}>
        {/* ── Section 4: Sales Funnel ── */}
        <div>
          <div style={sectionTitleSx}>{tx("قمع المبيعات", "Sales Funnel")}</div>
          <Card style={{ padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", fontSize: 12.5, marginBottom: 12 }} dir="ltr">
              <div>{tx("إجمالي العملاء (كل الأوقات)", "Total Leads (all-time)")}: <b>{totalLeads}</b></div>
              <div>{tx("عملاء جدد بالفترة", "New in period")}: <b>{newLeadsInPeriod}</b></div>
              <div>{tx("لم يتم التواصل", "Not Contacted")}: <b>{funnel.notContacted}</b></div>
              <div>{tx("قيد المتابعة", "In Progress")}: <b>{funnel.inProgress}</b></div>
              <div>{tx("حالة نهائية", "Terminal")}: <b>{funnel.terminal}</b></div>
              <div>{tx("مسجَّل (كل الأوقات)", "Enrolled (all-time)")}: <b style={{ color: C.success }}>{funnel.enrolled}</b></div>
            </div>
            <div style={{ padding: "8px 10px", borderRadius: 8, background: "#F8FAFC", marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: C.muted }}>{tx("معدل التحويل (تسجيل / كل العملاء، كل الأوقات)", "Conversion Rate (enrolled / all-time leads)")}</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: C.success }} dir="ltr">{conversionRate.toFixed(1)}%</div>
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>
              {tx("توزيع حسب الحالة الفعلية المُعدّة في الإعدادات:", "Breakdown by the actual statuses configured in Settings:")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
              {funnel.statusBreakdown.length === 0 && <div style={{ fontSize: 11.5, color: C.muted }}>—</div>}
              {funnel.statusBreakdown.map((s) => (
                <div key={s.statusId} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color || C.muted, display: "inline-block" }} />
                    {ar ? s.name_ar : s.name_en}
                  </span>
                  <b>{s.count}</b>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ── Section 7: Alerts ── */}
        <div>
          <div style={sectionTitleSx}>{tx("تنبيهات", "Alerts")}</div>
          <Card style={{ padding: 16 }}>
            <AlertRow label={tx("دفعات قيد الانتظار", "Pending payment verification")} count={alerts.pending} severity="orange" onClick={goPayments} />
            <AlertRow label={tx("دفعات قيد المراجعة", "Under-review payments")} count={alerts.underReview} severity="orange" onClick={goPayments} />
            <AlertRow label={tx("تعارضات دفع محتملة", "Possible payment conflicts")} count={alerts.conflicts} severity="danger" onClick={goPayments} />
            <AlertRow label={tx("دفعات بلا إثبات", "Payments missing proof")} count={alerts.missingProof} severity="orange" onClick={goPayments} />
            {/* FOLLOW-UP-UNIFY-01 — reads followUpStats.overdue (the canonical
                `followUps` collection, computed below), not the legacy
                engagement.nextFollowUpDate field — this card and the
                Follow-ups section's own "Overdue" stat card can no longer
                disagree, since they're now the exact same number. */}
            <AlertRow label={tx("متابعات متأخرة", "Overdue follow-ups")} count={followUpStats.overdue} severity="orange" />
            {alerts.pending + alerts.underReview + alerts.conflicts + alerts.missingProof + followUpStats.overdue === 0 && (
              <div style={{ fontSize: 12.5, color: C.muted, textAlign: "center", padding: "12px 0" }}>{tx("لا توجد تنبيهات حاليًا 🎉", "Nothing needs attention right now 🎉")}</div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Follow-ups — small summary only, the full list lives on its own
          page (Sidebar "المتابعات"); clicking any card jumps there. ── */}
      <div style={{ ...sectionTitleSx, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={goFollowUps}>
        <IconBell size={12} /> {tx("المتابعات", "Follow-ups")}
      </div>
      <div style={grid4}>
        <StatCard Icon={IconBell} color={C.danger} label={tx("متأخرة", "Overdue")} value={followUpStats.overdue} />
        <StatCard Icon={IconCalendarCheck} color={C.orange} label={tx("اليوم", "Due Today")} value={followUpStats.dueToday} />
        <StatCard Icon={IconCalendarCheck} color={C.muted} label={tx("قادمة", "Upcoming")} value={followUpStats.upcoming} />
        <StatCard Icon={IconCalendarCheck} color={C.success} label={tx("مكتملة اليوم", "Completed Today")} value={followUpStats.completedToday} />
      </div>

      {/* ── Section 5: Program Performance ── */}
      <div style={sectionTitleSx}>{tx("أداء البرامج", "Program Performance")}</div>
      <ProgramPerformanceTable rows={programRows} nodeById={nodeById} ar={ar} tx={tx} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 22 }}>
        {/* ── Section 6: Recent Activity ── */}
        <div>
          <div style={sectionTitleSx}><IconHistory size={12} /> {tx("آخر النشاطات", "Recent Activity")}</div>
          <Card style={{ padding: "8px 16px" }}>
            {recentActivity.length === 0
              ? <div style={{ fontSize: 12.5, color: C.muted, textAlign: "center", padding: "12px 0" }}>{tx("لا يوجد نشاط في هذه الفترة", "No activity in this period")}</div>
              : recentActivity.map((item, i) => <ActivityRow key={i} item={item} ar={ar} tx={tx} customerById={customerById} />)}
          </Card>
        </div>

        {/* ── Section 8: Quick Actions ── */}
        <div>
          <div style={sectionTitleSx}><IconBell size={12} /> {tx("إجراءات سريعة", "Quick Actions")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <QuickAction icon={<IconBox size={16} />} label={tx("الكتالوج / خط المبيعات", "Catalog / Sales Sheet")} onClick={goToCatalog} />
            <QuickAction icon={<IconGrid size={16} />} label={tx("العملاء", "Customers")} onClick={goToCatalog} />
            <QuickAction icon={<IconBell size={16} />} label={tx("المتابعات", "Follow-ups")} onClick={goFollowUps} />
            <QuickAction icon={<IconMoney size={16} />} label={tx("مراجعة المدفوعات", "Payment Verification")} onClick={goPayments} />
            <QuickAction icon={<IconWallet size={16} />} label={tx("المحاسبة", "Accounting")} onClick={goAccounting} />
            <QuickAction icon={<IconBarChart size={16} />} label={tx("التقارير", "Reports")} onClick={goAccounting} />
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>
            {tx("«التقارير» تفتح المحاسبة — اختر تبويب التقارير من هناك.", "\"Reports\" opens Accounting — pick the Reports tab from there.")}
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function QuickAction({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderRadius: 10,
        background: "#fff", border: `1px solid ${C.border}`, color: C.text,
        fontFamily: "'Cairo',sans-serif", fontSize: 12.5, fontWeight: 700, cursor: "pointer", textAlign: "start",
      }}
    >
      {icon} {label}
    </button>
  );
}
