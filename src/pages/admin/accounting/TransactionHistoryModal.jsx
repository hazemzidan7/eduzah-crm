import { Modal } from "../../../components/UI";
import { C } from "../../../theme";
import {
  ACCOUNT_OPTIONS, TRANSACTION_TYPE_OPTIONS,
  INCOME_CATEGORY_OPTIONS, EXPENSE_CATEGORY_OPTIONS, REFUND_CATEGORY_OPTIONS,
  optionLabel,
} from "../../../utils/accounting";

// Category codes are unique across income/expense/refund (no collisions),
// so one combined lookup is safe here — same option lists AccountingPage/
// TransactionFormModal already use, not a second source of truth.
const ALL_CATEGORY_OPTIONS = [...INCOME_CATEGORY_OPTIONS, ...EXPENSE_CATEGORY_OPTIONS, ...REFUND_CATEGORY_OPTIONS];

const FIELD_LABELS = {
  type: ["النوع", "Type"],
  amount: ["المبلغ", "Amount"],
  currency: ["العملة", "Currency"],
  date: ["التاريخ", "Date"],
  account: ["الحساب", "Account"],
  fromAccount: ["من حساب", "From Account"],
  toAccount: ["إلى حساب", "To Account"],
  category: ["التصنيف", "Category"],
  note: ["الوصف", "Description"],
  relatedCustomerId: ["معرّف العميل", "Customer ID"],
  relatedEngagementId: ["معرّف البرنامج", "Engagement ID"],
  relatedPaymentId: ["معرّف الدفعة", "Payment ID"],
};

function fieldLabel(key, ar) {
  const pair = FIELD_LABELS[key];
  return pair ? (ar ? pair[0] : pair[1]) : key;
}

function formatValue(key, value, ar) {
  if (value === null || value === undefined || value === "") return "—";
  if (key === "type") return optionLabel(TRANSACTION_TYPE_OPTIONS, value, ar);
  if (key === "account" || key === "fromAccount" || key === "toAccount") return optionLabel(ACCOUNT_OPTIONS, value, ar);
  if (key === "category") return optionLabel(ALL_CATEGORY_OPTIONS, value, ar);
  if (key === "amount") return typeof value === "number" ? value.toLocaleString() : value;
  return String(value);
}

/**
 * Read-only viewer for one transaction's editHistory[] — exactly what
 * AccountingContext.updateTransaction() already writes (editedBy/editedAt/
 * oldValue/newValue). No new audit mechanism: this never writes to the
 * array, only renders it. Visible to both Admin and Accounting staff —
 * same visibility as the transaction itself; no CRM data is read here.
 */
export default function TransactionHistoryModal({ transaction, ar, tx, onClose }) {
  const history = [...(transaction?.editHistory || [])].sort(
    (a, b) => (b.editedAt || "").localeCompare(a.editedAt || ""),
  );

  return (
    <Modal title={tx("سجل التعديلات", "Edit History")} onClose={onClose}>
      {history.length === 0 ? (
        <div style={{ padding: "24px 8px", textAlign: "center", color: C.muted, fontSize: 13 }}>
          {tx("لا توجد تعديلات", "No edits")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {history.map((entry, i) => {
            const changedKeys = Object.keys(entry.newValue || {});
            return (
              <div key={i} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: "rgba(255,255,255,.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 4 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800 }}>
                    {entry.editedByName || tx("مستخدم غير معروف", "Unknown user")}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }} dir="ltr">
                    {entry.editedAt ? new Date(entry.editedAt).toLocaleString(ar ? "ar-EG" : "en-US") : "—"}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {changedKeys.length === 0 ? (
                    <div style={{ fontSize: 11.5, color: C.muted }}>{tx("لا توجد تفاصيل", "No details")}</div>
                  ) : changedKeys.map((key) => (
                    <div key={key} style={{ fontSize: 12, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline" }}>
                      <span style={{ color: C.muted, fontWeight: 700, minWidth: 90 }}>{fieldLabel(key, ar)}:</span>
                      <span style={{ color: C.danger, textDecoration: "line-through" }} dir="ltr">{formatValue(key, entry.oldValue?.[key], ar)}</span>
                      <span style={{ color: C.muted }}>→</span>
                      <span style={{ color: C.success, fontWeight: 700 }} dir="ltr">{formatValue(key, entry.newValue?.[key], ar)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
