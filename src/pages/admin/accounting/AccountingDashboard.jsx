import { C } from "../../../theme";
import { IconWallet, IconTrendUp, IconTrendDown, IconUndo, IconSwap, IconPeople } from "../../../components/Icons";
import {
  ACCOUNT_OPTIONS, ACCOUNTS, computeAccountBalances, computeTransactionTotals,
  filterTransactions, currentMonthRange,
} from "../../../utils/accounting";
import { BalanceCard, UnassignedCard, KpiCard, ACCOUNT_COLOR } from "./AccountingBadges";

const KNOWN_ACCOUNTS = ACCOUNT_OPTIONS.filter((a) => a.v !== ACCOUNTS.UNASSIGNED);

/**
 * ACCOUNTING-02 §1 / UX-01 — Balances are computed over EVERY transaction
 * ever recorded (a running balance, never date-filtered) via the unchanged
 * computeAccountBalances/computeTransactionTotals — this component only
 * restructures how those same numbers are PRESENTED, it derives nothing new.
 *
 * UX-01's core fix: computeAccountBalances.total sums known accounts AND the
 * unassigned bucket together, which used to be shown as one "Total Balance"
 * card — reading as "cash the company has available" when in reality it's
 * mostly income/expense whose physical wallet was never recorded. This view
 * splits that same total into "Known Account Balance" (cash+instapay+
 * vodafone+bank only) and "Unassigned / Unverified Money" as two visually
 * distinct figures, and never re-labels Net Result as spendable cash either.
 */
export default function AccountingDashboard({ transactions, ar, tx }) {
  const balances = computeAccountBalances(transactions);
  const { from, to } = currentMonthRange();
  const periodTransactions = filterTransactions(transactions, { dateFrom: from, dateTo: to });
  const totals = computeTransactionTotals(periodTransactions);
  const allTimeTotals = computeTransactionTotals(transactions);

  const knownBalance = KNOWN_ACCOUNTS.reduce((sum, a) => sum + (balances[a.v] || 0), 0);
  const unassigned = balances[ACCOUNTS.UNASSIGNED] || 0;
  const netResult = allTimeTotals.income - allTimeTotals.expense;

  return (
    <div style={{ marginBottom: 22 }}>
      <SectionLabel>{tx("الملخص المالي (كل الفترة)", "Financial Overview (all-time)")}</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 22 }}>
        <KpiCard
          Icon={IconTrendUp} color={C.success}
          label={tx("إجمالي الإيرادات", "Total Revenue")}
          value={allTimeTotals.income} suffix={ar ? "ج.م" : "EGP"}
        />
        <KpiCard
          Icon={IconTrendDown} color={C.danger}
          label={tx("إجمالي المصروفات", "Total Expenses")}
          value={allTimeTotals.expense} suffix={ar ? "ج.م" : "EGP"}
        />
        <KpiCard
          Icon={IconSwap} color={C.pmid}
          label={tx("صافي النتيجة", "Net Result")}
          value={netResult} suffix={ar ? "ج.م" : "EGP"}
          caption={tx("الإيراد ناقص المصروف — ليس رصيدًا نقديًا متاحًا", "Revenue minus expenses — not a spendable cash balance")}
        />
      </div>

      <SectionLabel>{tx("أرصدة الحسابات المعروفة", "Known Account Balances")}</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 22 }}>
        {KNOWN_ACCOUNTS.map((a) => (
          <BalanceCard key={a.v} label={ar ? a.ar : a.en} value={balances[a.v] || 0} accent={ACCOUNT_COLOR[a.v]} ar={ar} />
        ))}
        <BalanceCard label={tx("إجمالي الأرصدة المعروفة", "Known Balance Total")} value={knownBalance} highlight ar={ar} />
      </div>

      <SectionLabel>{tx("أموال غير محددة الحساب", "Unassigned / Unverified Money")}</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginBottom: 22 }}>
        <UnassignedCard
          label={tx("غير محدد", "Unassigned")}
          value={unassigned}
          ar={ar}
          caption={tx(
            "حركات مالية حقيقية لكن لم يُسجَّل فيها الحساب الفعلي (كاش/إنستاباي/فودافون/بنك) — ليست جزءًا من رصيد أي حساب معروف.",
            "Real recorded money whose actual wallet (cash/InstaPay/Vodafone/bank) was never logged — not part of any known account's balance.",
          )}
        />
      </div>

      <SectionLabel>{tx("ملخص هذا الشهر", "This Month's Summary")}</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <StatCardCompact Icon={IconTrendUp} color={C.success} label={tx("إيراد الشهر", "Income")} value={totals.income} suffix={ar ? "ج.م" : "EGP"} />
        <StatCardCompact Icon={IconTrendDown} color={C.danger} label={tx("مصروف الشهر", "Expenses")} value={totals.expense} suffix={ar ? "ج.م" : "EGP"} />
        <StatCardCompact Icon={IconUndo} color={C.orange} label={tx("مرتجعات", "Refunds")} value={totals.refund} suffix={ar ? "ج.م" : "EGP"} />
        <StatCardCompact Icon={IconWallet} color={C.pmid} label={tx("سحوبات شخصية", "Personal Withdrawals")} value={totals.personalWithdrawal} suffix={ar ? "ج.م" : "EGP"} />
        <StatCardCompact Icon={IconSwap} color={C.muted} label={tx("صافي حركة الشهر", "Net Movement")} value={totals.netMovement} suffix={ar ? "ج.م" : "EGP"} />
        <StatCardCompact Icon={IconPeople} color={C.red} label={tx("طلاب دافعون", "Paying Students")} value={totals.payingStudentCount} />
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
      {children}
    </div>
  );
}

// A slightly denser StatCard variant, scoped to this file only — the period
// summary sits below three other card rows now, so it reads as a secondary,
// glanceable strip rather than repeating the same visual weight as the
// hero KPI cards above it.
function StatCardCompact({ Icon, color, label, value, suffix }) {
  return (
    <div style={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: `${color}1a`, display: "flex", alignItems: "center", justifyContent: "center", color }}>
          <Icon size={12} />
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{label}</div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 900 }} dir="ltr">
        {value.toLocaleString()}{suffix ? <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted }}> {suffix}</span> : ""}
      </div>
    </div>
  );
}
