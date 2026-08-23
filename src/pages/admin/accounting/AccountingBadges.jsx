import { C } from "../../../theme";
import { IconTrendUp, IconTrendDown, IconUndo, IconSwap } from "../../../components/Icons";
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
