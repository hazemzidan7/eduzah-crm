import { useMemo, useState } from "react";
import { Btn, Input, Select } from "../../../components/UI";
import { C } from "../../../theme";
import { IconSearch, IconWallet } from "../../../components/Icons";
import { useLang } from "../../../context/LangContext";
import { useAuth } from "../../../context/AuthContext";
import { useAccounting } from "../../../context/AccountingContext";
import { useCustomers } from "../../../context/CustomerContext";
import {
  TRANSACTION_TYPE_OPTIONS, ACCOUNT_OPTIONS,
  INCOME_CATEGORY_OPTIONS, EXPENSE_CATEGORY_OPTIONS, REFUND_CATEGORY_OPTIONS,
  filterTransactions, excludeDeletedTransactions,
} from "../../../utils/accounting";
import AccountingDashboard from "./AccountingDashboard";
import AccountingReports from "./AccountingReports";
import TransactionsTable from "./TransactionsTable";
import TransactionFormModal from "./TransactionFormModal";
import TransactionHistoryModal from "./TransactionHistoryModal";
import DeleteTransactionModal from "./DeleteTransactionModal";
import AccountingHistoryView from "./AccountingHistoryView";

const ALL_CATEGORY_OPTIONS = [...INCOME_CATEGORY_OPTIONS, ...EXPENSE_CATEGORY_OPTIONS, ...REFUND_CATEGORY_OPTIONS];

function pillStyle(active) {
  return {
    padding: "6px 13px", borderRadius: 99, border: "none", cursor: "pointer",
    fontWeight: 800, fontSize: 11.5, fontFamily: "'Cairo',sans-serif",
    background: active ? C.red : `${C.purple}26`,
    color: active ? "#fff" : C.muted,
    transition: "all .2s", whiteSpace: "nowrap",
  };
}

const EMPTY_FILTERS = { search: "", type: "all", account: "all", category: "all", dateFrom: "", dateTo: "" };

/**
 * ACCOUNTING-02 — Accounting section root: Dashboard + Transactions table +
 * search/filters + Add/Edit. Reachable by Admin (full access) and
 * "accounting"-role staff (view/add/edit) — see AccountingContext.
 * canAccessAccounting and firestore.rules' isAccountingStaff().
 */
export default function AccountingPage() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const { transactions, loading } = useAccounting();
  const { customerById } = useCustomers();
  // ACCOUNTING-DELETE-01 — every calculation/display below reads
  // activeTransactions, never the raw `transactions` — a soft-deleted
  // transaction must disappear from the Transactions list, the Dashboard,
  // and every total. The raw `transactions` (still including deleted ones)
  // is only ever needed by AccountingHistoryView, which reads
  // useAccounting() itself for that.
  const activeTransactions = useMemo(() => excludeDeletedTransactions(transactions), [transactions]);

  const [view, setView] = useState("overview"); // ACCOUNTING-04: "overview" (default, unchanged) | "reports" | "history" (Admin-only, ACCOUNTING-DELETE-01)
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [historyTransaction, setHistoryTransaction] = useState(null);
  const [deletingTransaction, setDeletingTransaction] = useState(null);

  const setFilter = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const hasActiveFilters = Object.keys(EMPTY_FILTERS).some((k) => filters[k] !== EMPTY_FILTERS[k]);

  const filtered = useMemo(() => filterTransactions(activeTransactions, filters, {
    searchTextFor: (t) => (t.relatedCustomerId ? customerById?.(t.relatedCustomerId)?.fullName || "" : ""),
  }), [activeTransactions, filters, customerById]);

  // Newest first — a ledger is read chronologically-descending by default,
  // same convention as Payment Verification's "history" views.
  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || "")),
    [filtered],
  );

  const openAdd = () => { setEditingTransaction(null); setFormOpen(true); };
  const openEdit = (t) => { setEditingTransaction(t); setFormOpen(true); };
  const closeForm = () => { setFormOpen(false); setEditingTransaction(null); };

  // Resolved live from `transactions` by id (not the row object captured at
  // click-time) so the modal always reflects the current editHistory[].
  const openHistory = (t) => setHistoryTransaction(t.id);
  const historyRecord = historyTransaction ? transactions.find((t) => t.id === historyTransaction) : null;

  const openDelete = (t) => setDeletingTransaction(t);
  const closeDelete = () => setDeletingTransaction(null);

  if (loading) {
    return <div style={{ color: C.muted, padding: 40, textAlign: "center" }}>{tx("جارٍ التحميل…", "Loading…")}</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 800 }}>
            <IconWallet size={18} />
            {tx("المحاسبة", "Accounting")}
          </div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
            {tx("الأرصدة والحركات المالية — مستقلة عن سجلات الدفع في الـ CRM.", "Balances and financial transactions — independent of CRM payment records.")}
          </div>
        </div>
        <Btn v="primary" onClick={openAdd}>{tx("+ إضافة حركة", "+ Add Transaction")}</Btn>
      </div>

      {/* ACCOUNTING-04: Overview is the default, unchanged view — Reports is
          purely additive and never runs unless explicitly selected. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, borderBottom: `1px solid ${C.border}`, paddingBottom: 10 }}>
        {[
          { v: "overview", ar: "نظرة عامة", en: "Overview" },
          { v: "reports", ar: "التقارير", en: "Reports" },
          // ACCOUNTING-DELETE-01 — Admin-only tab, same client-side gate
          // shape as every other role-restricted item in this app; the real
          // boundary is firestore.rules' accountingTransactionAudit rule
          // (admin-only read), not this button being hidden.
          ...(isAdmin ? [{ v: "history", ar: "سجل الحذف", en: "Deletion History" }] : []),
        ].map((t) => (
          <button key={t.v} onClick={() => setView(t.v)} style={pillStyle(view === t.v)}>{ar ? t.ar : t.en}</button>
        ))}
      </div>

      {view === "reports" ? (
        <AccountingReports ar={ar} tx={tx} />
      ) : view === "history" ? (
        isAdmin ? <AccountingHistoryView ar={ar} tx={tx} /> : null
      ) : (
        <>
          <AccountingDashboard transactions={activeTransactions} ar={ar} tx={tx} />

          <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {tx("الحركات", "Transactions")}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 14 }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <span style={{ position: "absolute", insetInlineStart: 12, color: C.muted, display: "flex", pointerEvents: "none" }}><IconSearch size={14} /></span>
              <input
                value={filters.search}
                onChange={(e) => setFilter({ search: e.target.value })}
                placeholder={tx("بحث بالوصف أو اسم العميل…", "Search description or customer name…")}
                style={{ background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 10, paddingBlock: 9, paddingInlineStart: 34, paddingInlineEnd: 14, color: C.text, fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", minWidth: 220 }}
              />
            </div>

            <div style={{ minWidth: 150 }}>
              <Select
                value={filters.account}
                onChange={(v) => setFilter({ account: v })}
                options={[{ v: "all", l: tx("كل الحسابات", "All Accounts") }, ...ACCOUNT_OPTIONS.map((a) => ({ v: a.v, l: ar ? a.ar : a.en }))]}
              />
            </div>
            <div style={{ minWidth: 150 }}>
              <Select
                value={filters.category}
                onChange={(v) => setFilter({ category: v })}
                options={[{ v: "all", l: tx("كل التصنيفات", "All Categories") }, ...ALL_CATEGORY_OPTIONS.map((c) => ({ v: c.v, l: ar ? c.ar : c.en }))]}
              />
            </div>
            <div style={{ minWidth: 140 }}>
              <Input type="date" value={filters.dateFrom} onChange={(v) => setFilter({ dateFrom: v })} placeholder={tx("من تاريخ", "From date")} />
            </div>
            <div style={{ minWidth: 140 }}>
              <Input type="date" value={filters.dateTo} onChange={(v) => setFilter({ dateTo: v })} placeholder={tx("إلى تاريخ", "To date")} />
            </div>
            {hasActiveFilters && (
              <Btn v="ghost" sm onClick={() => setFilters(EMPTY_FILTERS)}>{tx("مسح الفلاتر", "Clear filters")}</Btn>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            <button onClick={() => setFilter({ type: "all" })} style={pillStyle(filters.type === "all")}>{tx("الكل", "All")}</button>
            {TRANSACTION_TYPE_OPTIONS.map((o) => (
              <button key={o.v} onClick={() => setFilter({ type: o.v })} style={pillStyle(filters.type === o.v)}>{ar ? o.ar : o.en}</button>
            ))}
          </div>

          <TransactionsTable
            transactions={sorted} ar={ar} tx={tx} customerById={customerById}
            onEdit={openEdit} onViewHistory={openHistory}
            onDelete={isAdmin ? openDelete : undefined}
          />
        </>
      )}

      {formOpen && (
        <TransactionFormModal transaction={editingTransaction} ar={ar} tx={tx} onClose={closeForm} />
      )}

      {historyRecord && (
        <TransactionHistoryModal transaction={historyRecord} ar={ar} tx={tx} onClose={() => setHistoryTransaction(null)} />
      )}

      {deletingTransaction && (
        <DeleteTransactionModal
          transaction={deletingTransaction}
          customerById={customerById}
          ar={ar} tx={tx}
          onClose={closeDelete}
          onDeleted={closeDelete}
        />
      )}
    </div>
  );
}
