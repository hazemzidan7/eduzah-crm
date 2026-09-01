import { Card } from "../../../components/UI";
import { C, radius } from "../../../theme";
import { IconTrendUp, IconTrendDown, IconUndo, IconSwap, IconWallet, IconAlertTriangle } from "../../../components/Icons";
import { TRANSACTION_TYPES, TRANSACTION_TYPE_OPTIONS, ACCOUNT_OPTIONS, ACCOUNTS, optionLabel } from "../../../utils/accounting";

// One shared color per real-world account, reused by the Dashboard's balance
// cards, Reports' "Income by Account" cards, and the Transactions table's
// account cell dot — so the same wallet always reads as the same color
// everywhere in Accounting. Unassigned deliberately has no entry here (it's
// not a wallet) and is rendered with its own warning treatment instead, see
// UnassignedCard below.
export const ACCOUNT_COLOR = {
  [ACCOUNTS.CASH]: C.success,
  [ACCOUNTS.INSTAPAY]: C.pmid,
  [ACCOUNTS.VODAFONE_CASH]: C.orange,
  [ACCOUNTS.BANK]: C.red,
};

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
      background: `${color}26`, color: C.text, border: `1px solid ${color}88`,
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
  const isUnassigned = tx.account === ACCOUNTS.UNASSIGNED;
  const dotColor = ACCOUNT_COLOR[tx.account] || C.warning;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: isUnassigned ? "transparent" : dotColor,
        border: isUnassigned ? `1.5px dashed ${C.warning}` : "none",
      }} />
      {optionLabel(ACCOUNT_OPTIONS, tx.account, ar)}
    </span>
  );
}

export const typeAmountColor = (type) => (TYPE_STYLE[type] || {}).color || C.text;

// ACCOUNTING-04: moved here (unchanged) from AccountingDashboard.jsx so
// AccountingReports.jsx can reuse the exact same card look — pure move, no
// behavior change to the Dashboard. `accent` tints the icon chip with a
// specific account's color (see ACCOUNT_COLOR above) instead of the generic
// highlight/muted look, so Cash/InstaPay/Vodafone/Bank read as visually
// distinct wallets at a glance, never just "four identical gray boxes".
export function BalanceCard({ label, value, highlight, accent, ar }) {
  const chipColor = accent || (highlight ? C.red : C.muted);
  return (
    <Card style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: (accent || highlight) ? `${chipColor}1a` : C.faint, display: "flex", alignItems: "center", justifyContent: "center", color: chipColor }}>
          <IconWallet size={15} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{label}</div>
      </div>
      <div style={{ fontSize: 20, fontWeight: 900, color: value < 0 ? C.danger : C.text }} dir="ltr">
        {value.toLocaleString()} <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{ar ? "ج.م" : "EGP"}</span>
      </div>
    </Card>
  );
}

// The unassigned bucket is real recorded money, but its physical wallet is
// unknown — it must never look like a fifth interchangeable account card.
// Dashed border + warning-orange tint + a triangle icon + an explicit
// one-line caption make that unmistakable at a glance, not just implied by
// a label. Never colored/iconed the same as a real account (see
// ACCOUNT_COLOR above, which deliberately has no entry for "unassigned").
export function UnassignedCard({ label, value, caption, ar }) {
  return (
    <Card style={{ padding: "16px 18px", background: "#FFFBEB", border: `1.5px dashed ${C.warning}88` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: `${C.warning}26`, display: "flex", alignItems: "center", justifyContent: "center", color: C.odark }}>
          <IconAlertTriangle size={15} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.odark }}>{label}</div>
      </div>
      <div style={{ fontSize: 20, fontWeight: 900, color: C.text }} dir="ltr">
        {value.toLocaleString()} <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{ar ? "ج.م" : "EGP"}</span>
      </div>
      {caption && <div style={{ fontSize: 10.5, color: C.odark, fontWeight: 700, marginTop: 6, lineHeight: 1.4 }}>{caption}</div>}
    </Card>
  );
}

// A hero-level KPI card for Total Revenue / Total Expenses / Net Result —
// bigger type than StatCard, an optional caption for figures that are easy
// to misread at a glance (Net Result is income-minus-expenses, never a cash
// balance — the caption says so explicitly rather than relying on the label
// alone, same "don't rely on color/label alone" rule as the type badges).
export function KpiCard({ Icon, color, label, value, suffix, caption }) {
  return (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: radius.md, background: `${color}1a`, display: "flex", alignItems: "center", justifyContent: "center", color }}>
          <Icon size={17} />
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.muted }}>{label}</div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color: value < 0 ? C.danger : C.text }} dir="ltr">
        {value.toLocaleString()}{suffix ? <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}> {suffix}</span> : ""}
      </div>
      {caption && <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 6, lineHeight: 1.4 }}>{caption}</div>}
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
