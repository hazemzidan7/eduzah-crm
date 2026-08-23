import { Card } from "../../../components/UI";
import { C } from "../../../theme";
import { IconWallet, IconTrendUp, IconTrendDown, IconUndo, IconSwap, IconPeople } from "../../../components/Icons";
import {
  ACCOUNT_OPTIONS, computeAccountBalances, computeTransactionTotals,
  filterTransactions, currentMonthRange, optionLabel,
} from "../../../utils/accounting";

function BalanceCard({ label, value, highlight, ar }) {
  return (
    <Card style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: highlight ? `${C.red}33` : "rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", color: highlight ? C.red : C.muted }}>
          <IconWallet size={15} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{label}</div>
      </div>
      <div style={{ fontSize: 20, fontWeight: 900, color: value < 0 ? C.danger : "#fff" }} dir="ltr">
        {value.toLocaleString()} <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{ar ? "ج.م" : "EGP"}</span>
      </div>
    </Card>
  );
}

function StatCard({ Icon, color, label, value, suffix }) {
  return (
    <Card style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: `${color}26`, display: "flex", alignItems: "center", justifyContent: "center", color }}>
          <Icon size={14} />
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>{label}</div>
      </div>
      <div style={{ fontSize: 17, fontWeight: 900 }} dir="ltr">
        {value.toLocaleString()}{suffix ? <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}> {suffix}</span> : ""}
      </div>
    </Card>
  );
}

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
