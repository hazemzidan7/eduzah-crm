import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../../../firebase";
import { Card, Btn, Badge } from "../../../components/UI";
import { C } from "../../../theme";
import { useAuth } from "../../../context/AuthContext";
import { useAccounting } from "../../../context/AccountingContext";
import { useCustomers } from "../../../context/CustomerContext";
import { IconUndo } from "../../../components/Icons";
import { ACCOUNTING_TRANSACTION_AUDIT_COLLECTION, TRANSACTION_TYPE_OPTIONS, optionLabel } from "../../../utils/accounting";

/**
 * ACCOUNTING-DELETE-01 — the minimal History/Audit view: every delete/
 * restore action ever taken on an Accounting Transaction, read directly
 * from the dedicated accountingTransactionAudit collection (never from a
 * transaction's own editHistory[] — see that collection's own doc comment
 * in utils/accounting.js for why). Deliberately its own small, local,
 * admin-gated subscription — not folded into the shared AccountingContext
 * (which both Admin and Accounting subscribe to) — so an Accounting-role
 * session never even fetches audit data to begin with, matching every
 * other admin-only collection in this app (see e.g. CatalogContext/
 * LeadStatusContext's own "only subscribe if role qualifies" gate). The
 * real boundary is still firestore.rules (admin-only read on that
 * collection) — this client-side gate is the second, not the only, line
 * of defense.
 */
export default function AccountingHistoryView({ ar, tx }) {
  const { currentUser } = useAuth();
  const { transactionById, restoreTransaction } = useAccounting();
  const { customerById } = useCustomers();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState(null);
  const [restoreError, setRestoreError] = useState("");

  useEffect(() => {
    if (currentUser?.role !== "admin") { setEntries([]); setLoading(false); return; }
    setLoading(true);
    const q = query(collection(db, ACCOUNTING_TRANSACTION_AUDIT_COLLECTION), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => { setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [currentUser?.id, currentUser?.role]);

  if (currentUser?.role !== "admin") return null; // defensive — AccountingPage already only renders this view for admins

  const handleRestore = async (entry) => {
    setRestoringId(entry.transactionId);
    setRestoreError("");
    try {
      await restoreTransaction(entry.transactionId);
    } catch (e) {
      setRestoreError(
        e.message === "DUPLICATE_INCOME_FOR_PAYMENT"
          ? tx("تعذّر الاسترجاع: يوجد بالفعل حركة دخل مسجّلة لهذه الدفعة", "Couldn't restore: an Income transaction already exists for this payment")
          : tx("تعذّر الاسترجاع. حاول مرة أخرى.", "Couldn't restore. Please try again."),
      );
    } finally {
      setRestoringId(null);
    }
  };

  const fmt = (iso) => iso ? new Date(iso).toLocaleString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  if (loading) {
    return <Card style={{ padding: 32, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("جاري التحميل…", "Loading…")}</div></Card>;
  }

  if (entries.length === 0) {
    return (
      <Card style={{ padding: 32, textAlign: "center" }}>
        <div style={{ color: C.muted }}>{tx("لا يوجد سجل حذف أو استرجاع بعد", "No deletions or restores yet")}</div>
      </Card>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {tx("سجل حذف حركات المحاسبة", "Accounting Transaction Deletion History")}
      </div>
      {restoreError && <div style={{ fontSize: 12, color: C.danger, marginBottom: 10 }}>{restoreError}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map((entry) => {
          const isDeleteAction = entry.action === "delete";
          const currentTxn = transactionById(entry.transactionId);
          const isCurrentlyDeleted = currentTxn?.isDeleted === true;
          const customer = entry.relatedCustomerId ? customerById(entry.relatedCustomerId) : null;
          const actorName = isDeleteAction ? entry.deletedByName : entry.restoredByName;
          const actorAt = isDeleteAction ? entry.deletedAt : entry.restoredAt;

          return (
            <Card key={entry.id} style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <Badge color={isDeleteAction ? C.danger : C.success}>
                      {isDeleteAction ? tx("محذوفة", "Deleted") : tx("مُسترجَعة", "Restored")}
                    </Badge>
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>{optionLabel(TRANSACTION_TYPE_OPTIONS, entry.transactionType, ar)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>
                    {customer?.fullName || tx("بدون طالب مرتبط", "No linked student")}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "end" }}>
                  <div dir="ltr" style={{ fontSize: 13, fontWeight: 800 }}>{(entry.amount || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 10.5, color: C.muted }} dir="ltr">{entry.date || "—"}</div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}`, flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontSize: 11, color: C.muted }}>
                  {tx("بواسطة", "By")} <b style={{ color: C.text }}>{actorName || tx("مستخدم غير معروف", "Unknown user")}</b>
                  {" · "}<span dir="ltr">{fmt(actorAt)}</span>
                </div>
                {isDeleteAction && isCurrentlyDeleted && (
                  <Btn sm v="primary" disabled={restoringId === entry.transactionId} onClick={() => handleRestore(entry)}>
                    <IconUndo size={13} /> {tx("استرجاع", "Restore")}
                  </Btn>
                )}
              </div>

              {isDeleteAction && entry.deletionReason && (
                <div style={{ fontSize: 12, color: C.text, marginTop: 8, background: "#F8FAFC", borderRadius: 8, padding: "6px 10px" }}>
                  {tx("السبب", "Reason")}: {entry.deletionReason}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
