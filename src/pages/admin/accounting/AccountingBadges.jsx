import { Card } from "../../../components/UI";
import { C } from "../../../theme";
import { IconTrendUp, IconTrendDown, IconUndo, IconSwap, IconWallet } from "../../../components/Icons";
import { TRANSACTION_TYPES, TRANSACTION_TYPE_OPTIONS, ACCOUNT_OPTIONS, optionLabel } from "../../../utils/accounting";

const TYPE_STYLE = {
  [TRANSACTION_TYPES.INCOME]: { color: C.success, Icon: IconTrendUp },
  [TRANSACTION_TYPES.EXPENSE]: { color: C.danger, Icon: IconTrendDown },
  [TRANSACTION_TYPES.REFUND]: { color: C.orange, Icon: IconUndo },
  [TRANSACTION_TYPES.TRANSFER]: { color: C.pmid, Icon: IconSwap },
};

// "Do not rely on color alone" (ACCOUNTING-02 §2) — every badge always
// pairs its color with a distinct icon AND the full text label, never icon-only.
export function TransactionTypeBadge({ type, ar }) {
  const { color, Icon } = TYPE_STYLE[type] || { color: C.muted, Icon: null };
  const label = optionLabel(TRANSACTION_TYPE_OPTIONS, type, ar);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: `${color}26`, color: "#fff", border: `1px solid ${color}88`,
      borderRadius: 999, padding: "4.5px 11px 4.5px 9px", fontSize: 11, fontWeight: 800,
      whiteSpace: "nowrap", letterSpacing: 0.2,
    }}>
      {Icon && <Icon size={12} />}
      {label}
    </span>
  );
}

/** Account column content — a single account normally, or "From → To" for a transfer (§2's explicit requirement). */
export function AccountCell({ tx, ar }) {
  if (tx.type === TRANSACTION_TYPES.TRANSFER) {
    const from = optionLabel(ACCOUNT_OPTIONS, tx.fromAccount, ar);
    const to = optionLabel(ACCOUNT_OPTIONS, tx.toAccount, ar);
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }} dir="ltr">
        <span>{from}</span>
        <IconSwap size={12} />
        <span>{to}</span>
      </span>
    );
  }
  return <span style={{ fontSize: 12 }}>{optionLabel(ACCOUNT_OPTIONS, tx.account, ar)}</span>;
}

export const typeAmountColor = (type) => (TYPE_STYLE[type] || {}).color || "#fff";

// ACCOUNTING-04: moved here (unchanged) from AccountingDashboard.jsx so
// AccountingReports.jsx can reuse the exact same card look — pure move, no
// behavior change to the Dashboard.
export function BalanceCard({ label, value, highlight, ar }) {
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

export function StatCard({ Icon, color, label, value, suffix }) {
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
