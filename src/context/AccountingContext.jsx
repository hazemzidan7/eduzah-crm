import { createContext, useContext, useState, useEffect } from "react";
import { collection, doc, addDoc, updateDoc, getDoc, setDoc, onSnapshot, arrayUnion } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";
import {
  ACCOUNTING_TRANSACTIONS_COLLECTION,
  TRANSACTION_TYPES,
  validateTransaction,
  buildTransaction,
  buildEditHistoryEntry,
  diffForEditHistory,
} from "../utils/accounting";

const AccountingCtx = createContext(null);

// ACCOUNTING-02 — Admin gets full access everywhere; "accounting" is the one
// other role allowed into this module (view/add/edit transactions), per the
// approved permissions. No new RBAC system — same shape as isAdmin() below,
// just a second allowed role, mirrored in firestore.rules' isAccountingStaff().
export const canAccessAccounting = (currentUser) =>
  currentUser?.role === "admin" || currentUser?.role === "accounting";

/**
 * ACCOUNTING-01 — data layer only. Deliberately independent of
 * CustomerContext/paymentRecords/accountingEvents: no import from those
 * modules, no read of CRM collections. The future Confirmed Payment ->
 * Accounting Event -> Accounting Transaction hookup is a later task.
 */
export function AccountingProvider({ children }) {
  const { currentUser } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canAccessAccounting(currentUser)) { setTransactions([]); setLoading(false); return; }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, ACCOUNTING_TRANSACTIONS_COLLECTION),
      (snap) => { setTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [currentUser?.id, currentUser?.role]);

  const transactionById = (id) => transactions.find((t) => t.id === id) || null;

  const addTransaction = async (draft) => {
    const errors = validateTransaction(draft);
    if (errors.length > 0) throw new Error(`INVALID_TRANSACTION: ${errors.join(", ")}`);
    const doc_ = buildTransaction(draft, { currentUser });
    const ref = await addDoc(collection(db, ACCOUNTING_TRANSACTIONS_COLLECTION), doc_);
    return ref.id;
  };

  // Convenience wrapper — a transfer is just a transaction with type "transfer";
  // this only exists so call sites don't have to remember the type string.
  const addTransfer = (draft) => addTransaction({ ...draft, type: TRANSACTION_TYPES.TRANSFER, category: null });

  // ACCOUNTING-03B — refund creation needs a caller-supplied idempotency key
  // (rule 7: "the same refund operation must never create duplicate
  // transactions... do not rely only on timestamps"), unlike addTransaction
  // above (which always mints a fresh auto-id — fine for Income/Expense/
  // Transfer, where there's no "retry" concept to dedupe). Kept as its own
  // function rather than changing addTransaction's signature, so Income/
  // Expense/Transfer creation is completely unaffected. Same doc-id-
  // existence-check pattern already used for accountingEvents and the
  // confirmed-payment income integration (CustomerContext.
  // createAccountingIncomeFromPayment) — if `idempotencyKey` already names a
  // document, that existing transaction is returned as-is, never duplicated.
  const addRefundTransaction = async (draft, idempotencyKey) => {
    const errors = validateTransaction(draft);
    if (errors.length > 0) throw new Error(`INVALID_TRANSACTION: ${errors.join(", ")}`);
    const ref = doc(db, ACCOUNTING_TRANSACTIONS_COLLECTION, idempotencyKey);
    const existing = await getDoc(ref);
    if (existing.exists()) return { id: existing.id, ...existing.data() };
    const built = buildTransaction(draft, { currentUser });
    await setDoc(ref, built);
    return { id: idempotencyKey, ...built };
  };

  // Records never overwritten silently — every field change appends one
  // editHistory entry (editedBy/editedAt/oldValue/newValue), same
  // append-only-array pattern as engagements' timeline[].
  const updateTransaction = async (id, updates) => {
    const current = transactionById(id);
    if (!current) return;
    const merged = { ...current, ...updates };
    const errors = validateTransaction(merged);
    if (errors.length > 0) throw new Error(`INVALID_TRANSACTION: ${errors.join(", ")}`);

    const diff = diffForEditHistory(current, updates);
    const now = new Date().toISOString();
    const patch = { ...updates, updatedAt: now };
    if (diff) {
      patch.editHistory = arrayUnion(buildEditHistoryEntry({
        editedBy: currentUser?.id || null,
        editedByName: currentUser?.name || null,
        oldValue: diff.oldValue,
        newValue: diff.newValue,
      }));
    }
    await updateDoc(doc(db, ACCOUNTING_TRANSACTIONS_COLLECTION, id), patch);
  };

  return (
    <AccountingCtx.Provider value={{
      transactions, loading, transactionById,
      addTransaction, addTransfer, addRefundTransaction, updateTransaction,
    }}>
      {children}
    </AccountingCtx.Provider>
  );
}

export const useAccounting = () => useContext(AccountingCtx);
