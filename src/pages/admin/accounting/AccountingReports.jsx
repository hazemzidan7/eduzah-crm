import { useMemo, useState } from "react";
import { Card } from "../../../components/UI";
import { C } from "../../../theme";
import {
  IconTrendUp, IconTrendDown, IconUndo, IconSwap, IconWallet, IconPeople, IconChevronRight,
} from "../../../components/Icons";
import { useAccounting } from "../../../context/AccountingContext";
import { useCustomers } from "../../../context/CustomerContext";
import {
  ACCOUNT_OPTIONS, REPORT_PERIODS, REPORT_PERIOD_OPTIONS,
  reportPeriodRange, shiftReportPeriod, filterTransactions, computeReportMetrics,
} from "../../../utils/accounting";
import { effectivePaymentRecords } from "../../../utils/paymentRecords";
import { StatCard } from "./AccountingBadges";

function pillStyle(active) {
  return {
    padding: "6px 13px", borderRadius: 99, border: "none", cursor: "pointer",
    fontWeight: 800, fontSize: 11.5, fontFamily: "'Cairo',sans-serif",
    background: active ? C.red : `${C.purple}26`,
    color: active ? "#fff" : C.muted,
    transition: "all .2s", whiteSpace: "nowrap",
  };
}

function NavButton({ onClick, pointLeft, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`,
        background: "#fff", color: C.text, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <span style={{ display: "flex", transform: pointLeft ? "rotate(180deg)" : "none" }}>
        <IconChevronRight size={14} />
      </span>
    </button>
  );
}

function periodLabel(periodType, anchor, ar, tx) {
  const locale = ar ? "ar-EG" : "en-US";
  if (periodType === REPORT_PERIODS.DAILY) {
    return anchor.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  }
  if (periodType === REPORT_PERIODS.HALF_YEARLY) {
    const half = anchor.getMonth() < 6 ? 1 : 2;
    return tx(`النصف ${half === 1 ? "الأول" : "الثاني"} ${anchor.getFullYear()}`, `H${half} ${anchor.getFullYear()}`);
  }
  if (periodType === REPORT_PERIODS.YEARLY) {
    return String(anchor.getFullYear());
  }
  return anchor.toLocaleDateString(locale, { year: "numeric", month: "long" }); // MONTHLY
}

const ACCOUNT_ICON_COLOR = { cash: C.success, instapay: C.pmid, vodafone_cash: C.orange, bank: C.red };

/**
 * ACCOUNTING-04 — period-based Reports, separate from the Dashboard's
 * all-time balances (which stay exactly as ACCOUNTING-02 built them,
 * unaffected by anything here). Reuses filterTransactions (§3's utility,
 * unchanged) for the date-range filter and computeReportMetrics (which
 * itself reuses computeTransactionTotals, not a duplicate calculation) for
 * every number shown. Deposit/Installment/Full-Payment classification comes
 * from the real PaymentRecord.paymentType on the CRM side (via
 * relatedPaymentId -> engagement -> effectivePaymentRecords), not a new
 * classification invented here.
 */
export default function AccountingReports({ ar, tx }) {
  const { transactions } = useAccounting();
  const { engagementById } = useCustomers();

  const [periodType, setPeriodType] = useState(REPORT_PERIODS.MONTHLY); // default: current month
  const [anchor, setAnchor] = useState(() => new Date());

  const { from, to } = useMemo(() => reportPeriodRange(periodType, anchor), [periodType, anchor]);
  const periodTransactions = useMemo(
    () => filterTransactions(transactions, { dateFrom: from, dateTo: to }),
    [transactions, from, to],
  );

  // Resolves an income transaction's real CRM PaymentRecord.paymentType via
  // its optional relatedEngagementId/relatedPaymentId link — read-only, same
  // pattern already used elsewhere in Accounting (e.g. TransactionsTable's
  // customer-name lookup). Transactions with no CRM link simply stay
  // unclassified (they still count toward Total Income only).
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

  const goPrev = () => setAnchor(shiftReportPeriod(periodType, anchor, "prev"));
  const goNext = () => setAnchor(shiftReportPeriod(periodType, anchor, "next"));

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {REPORT_PERIOD_OPTIONS.map((o) => (
          <button
            key={o.v}
            onClick={() => setPeriodType(o.v)}
            style={pillStyle(periodType === o.v)}
          >
            {ar ? o.ar : o.en}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 20 }}>
        <NavButton onClick={goPrev} pointLeft title={tx("الفترة السابقة", "Previous period")} />
        <div style={{ fontSize: 15, fontWeight: 800, minWidth: 160, textAlign: "center" }}>
          {periodLabel(periodType, anchor, ar, tx)}
        </div>
        <NavButton onClick={goNext} title={tx("الفترة التالية", "Next period")} />
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {tx("الملخص", "Summary")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 20 }}>
        <StatCard Icon={IconTrendUp} color={C.success} label={tx("إجمالي الإيرادات", "Total Income")} value={metrics.income} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconTrendDown} color={C.danger} label={tx("إجمالي المصروفات", "Total Expenses")} value={metrics.expense} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconWallet} color={C.pmid} label={tx("سحوبات شخصية", "Personal Withdrawals")} value={metrics.personalWithdrawal} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconUndo} color={C.orange} label={tx("إجمالي المرتجعات", "Total Refunds")} value={metrics.refund} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconSwap} color={C.muted} label={tx("صافي الحركة", "Net Movement")} value={metrics.netMovement} suffix={ar ? "ج.م" : "EGP"} />
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {tx("الإيراد حسب الحساب", "Income by Account")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 20 }}>
        {ACCOUNT_OPTIONS.map((a) => (
          <StatCard
            key={a.v}
            Icon={IconWallet}
            color={ACCOUNT_ICON_COLOR[a.v] || C.muted}
            label={ar ? a.ar : a.en}
            value={metrics.incomeByAccount[a.v] || 0}
            suffix={ar ? "ج.م" : "EGP"}
          />
        ))}
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {tx("الطلاب والدفعات", "Students & Payments")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 20 }}>
        <StatCard Icon={IconPeople} color={C.red} label={tx("الطلاب الدافعون", "Paying Students")} value={metrics.payingStudentCount} />
        <StatCard Icon={IconTrendUp} color={C.success} label={tx("العرابين", "Deposits")} value={metrics.deposits} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconTrendUp} color={C.pmid} label={tx("الأقساط", "Installments")} value={metrics.installments} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconTrendUp} color={C.orange} label={tx("الدفعات الكاملة", "Full Payments")} value={metrics.fullPayments} suffix={ar ? "ج.م" : "EGP"} />
      </div>

      {/* Transfers shown separately, de-emphasized — never part of Income/
          Expense/Refund/Net Movement above (approved rule). */}
      <Card style={{ padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", opacity: 0.8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted }}>
          <IconSwap size={14} />
          {tx("التحويلات (لا تُحتسب ضمن الإيراد/المصروف/صافي الحركة)", "Transfers (not counted in Income/Expenses/Net Movement)")}
        </div>
        <div style={{ fontSize: 13, fontWeight: 800 }} dir="ltr">
          {(metrics.transfer || 0).toLocaleString()} <span style={{ fontSize: 11, color: C.muted }}>{ar ? "ج.م" : "EGP"}</span>
        </div>
      </Card>
    </div>
  );
}
