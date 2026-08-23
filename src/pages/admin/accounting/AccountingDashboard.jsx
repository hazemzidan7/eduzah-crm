import { C } from "../../../theme";
import { IconWallet, IconTrendUp, IconTrendDown, IconUndo, IconSwap, IconPeople } from "../../../components/Icons";
import {
  ACCOUNT_OPTIONS, computeAccountBalances, computeTransactionTotals,
  filterTransactions, currentMonthRange,
} from "../../../utils/accounting";
import { BalanceCard, StatCard } from "./AccountingBadges";

/**
 * ACCOUNTING-02 §1. Balances are computed over EVERY transaction ever
 * recorded (a running balance, never date-filtered) — the period summary
 * below it defaults to the current calendar month, computed via the same
 * shared filterTransactions() the Transactions table uses (§3), so the two
 * never disagree on what counts as "this month". No opening-balance concept
 * exists yet (out of scope, per ACCOUNTING-01's approved spec).
 */
export default function AccountingDashboard({ transactions, ar, tx }) {
  const balances = computeAccountBalances(transactions);
  const { from, to } = currentMonthRange();
  const periodTransactions = filterTransactions(transactions, { dateFrom: from, dateTo: to });
  const totals = computeTransactionTotals(periodTransactions);

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {tx("الأرصدة الحالية", "Current Balances")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 20 }}>
        {ACCOUNT_OPTIONS.map((a) => (
          <BalanceCard key={a.v} label={ar ? a.ar : a.en} value={balances[a.v] || 0} ar={ar} />
        ))}
        <BalanceCard label={tx("إجمالي الرصيد", "Total Balance")} value={balances.total || 0} highlight ar={ar} />
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {tx("ملخص هذا الشهر", "This Month's Summary")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <StatCard Icon={IconTrendUp} color={C.success} label={tx("إجمالي الإيرادات", "Total Income")} value={totals.income} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconTrendDown} color={C.danger} label={tx("إجمالي المصروفات", "Total Expenses")} value={totals.expense} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconUndo} color={C.orange} label={tx("إجمالي المرتجعات", "Total Refunds")} value={totals.refund} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconWallet} color={C.pmid} label={tx("سحوبات شخصية", "Personal Withdrawals")} value={totals.personalWithdrawal} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconSwap} color={C.muted} label={tx("صافي الحركة", "Net Movement")} value={totals.netMovement} suffix={ar ? "ج.م" : "EGP"} />
        <StatCard Icon={IconPeople} color={C.red} label={tx("عدد الطلاب الدافعين", "Paying Students")} value={totals.payingStudentCount} />
      </div>
    </div>
  );
}
