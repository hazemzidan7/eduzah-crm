import { Card } from "../../../components/UI";
import { C } from "../../../theme";
import { IconEdit, IconHistory } from "../../../components/Icons";
import { TRANSACTION_TYPES, categoryOptionsForType, optionLabel } from "../../../utils/accounting";
import { TransactionTypeBadge, AccountCell, typeAmountColor } from "./AccountingBadges";

function amountSign(type) {
  if (type === TRANSACTION_TYPES.INCOME) return "+";
  if (type === TRANSACTION_TYPES.EXPENSE || type === TRANSACTION_TYPES.REFUND) return "−";
  return "";
}

function categoryLabel(t, ar) {
  if (t.type === TRANSACTION_TYPES.TRANSFER || !t.category) return "—";
  return optionLabel(categoryOptionsForType(t.type), t.category, ar);
}

const th = { padding: "10px 12px", textAlign: "start", fontSize: 11, fontWeight: 800, color: C.muted, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` };
const td = { padding: "10px 12px", fontSize: 12.5, verticalAlign: "middle" };

/**
 * ACCOUNTING-02 §2/§3 — the Transactions table. Rows are whatever the caller
 * already filtered (AccountingPage owns search/type/account/category/date
 * via utils/accounting.filterTransactions) — this component only renders.
 */
export default function TransactionsTable({ transactions, ar, tx, customerById, onEdit, onViewHistory }) {
  if (transactions.length === 0) {
    return (
      <Card style={{ padding: 40, textAlign: "center" }}>
        <div style={{ color: C.muted }}>{tx("لا توجد حركات مطابقة", "No matching transactions")}</div>
      </Card>
    );
  }

  return (
    <div className="edu-sheet-scroll" style={{ overflowX: "auto", borderRadius: 12, border: `1px solid ${C.border}` }}>
      <table style={{ width: "100%", minWidth: 860, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#F8FAFC" }}>
            <th style={th}>{tx("التاريخ", "Date")}</th>
            <th style={th}>{tx("النوع", "Type")}</th>
            <th style={th}>{tx("الطالب / الوصف", "Student / Description")}</th>
            <th style={th}>{tx("التصنيف", "Category")}</th>
            <th style={th}>{tx("الحساب", "Account")}</th>
            <th style={{ ...th, textAlign: "end" }}>{tx("المبلغ", "Amount")}</th>
            <th style={th}>{tx("بواسطة", "Created By")}</th>
            <th style={{ ...th, width: 76 }} />
          </tr>
        </thead>
        <tbody>
          {transactions.map((t, i) => {
            const customer = t.relatedCustomerId ? customerById?.(t.relatedCustomerId) : null;
            const studentOrDesc = customer?.fullName || t.note || "—";
            return (
              <tr key={t.id} style={{ background: i % 2 === 0 ? "transparent" : "#FBFCFE" }}>
                <td style={{ ...td, whiteSpace: "nowrap" }} dir="ltr">{t.date || "—"}</td>
                <td style={td}><TransactionTypeBadge type={t.type} ar={ar} /></td>
                <td style={{ ...td, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={studentOrDesc}>
                  {customer ? <span style={{ fontWeight: 700 }}>{studentOrDesc}</span> : studentOrDesc}
                </td>
                <td style={td}>{categoryLabel(t, ar)}</td>
                <td style={td}><AccountCell tx={t} ar={ar} /></td>
                <td style={{ ...td, textAlign: "end", fontWeight: 800, color: typeAmountColor(t.type) }} dir="ltr">
                  {amountSign(t.type)}{(t.amount || 0).toLocaleString()}
                </td>
                <td style={{ ...td, color: C.muted }}>{t.createdByName || "—"}</td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => onEdit(t)}
                      title={tx("تعديل", "Edit")}
                      style={{ background: "#fff", border: "none", borderRadius: 8, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, cursor: "pointer" }}
                    >
                      <IconEdit size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onViewHistory(t)}
                      title={tx("سجل التعديلات", "Edit History")}
                      style={{
                        position: "relative", background: "#fff", border: "none", borderRadius: 8,
                        width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
                        color: (t.editHistory || []).length > 0 ? C.red : C.muted, cursor: "pointer",
                      }}
                    >
                      <IconHistory size={13} />
                      {(t.editHistory || []).length > 0 && (
                        <span style={{
                          position: "absolute", top: -4, insetInlineEnd: -4, background: C.red, color: "#fff",
                          borderRadius: 999, fontSize: 9, fontWeight: 800, minWidth: 14, height: 14,
                          display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
                        }}>
                          {t.editHistory.length}
                        </span>
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
