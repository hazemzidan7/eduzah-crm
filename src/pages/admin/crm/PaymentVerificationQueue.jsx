import { useMemo, useState } from "react";
import { Card } from "../../../components/UI";
import { C } from "../../../theme";
import { useLang } from "../../../context/LangContext";
import { useCatalog } from "../../../context/CatalogContext";
import { useCustomers } from "../../../context/CustomerContext";
import { IconSearch } from "../../../components/Icons";
import {
  effectivePaymentRecords, confirmedAmountPaid, findPaymentConflicts, hasBlockingConflict, amountMismatch,
} from "../../../utils/paymentRecords";
import { effectiveCoursePrice } from "../../../utils/pricingSnapshot";
import PaymentRecordCard from "./PaymentRecordCard";
import EngagementDetailModal from "./EngagementDetailModal";

const FILTERS = [
  { v: "needs_action", ar: "يحتاج إجراء", en: "Needs Action" },
  { v: "pending", ar: "قيد الانتظار", en: "Pending" },
  { v: "under_review", ar: "قيد المراجعة", en: "Under Review" },
  { v: "confirmed", ar: "مؤكد", en: "Confirmed" },
  { v: "rejected", ar: "مرفوض", en: "Rejected" },
  { v: "all", ar: "الكل", en: "All" },
];
const NEEDS_ACTION = new Set(["pending", "under_review"]);

function pillStyle(active) {
  return {
    padding: "6px 13px", borderRadius: 99, border: "none", cursor: "pointer",
    fontWeight: 800, fontSize: 11.5, fontFamily: "'Cairo',sans-serif",
    background: active ? C.red : `${C.purple}26`,
    color: active ? "#fff" : C.muted,
    transition: "all .2s",
  };
}

/**
 * CRM-PAYMENT-01 — the one place an employee triages every Payment Record
 * that needs a decision, across every Program, instead of hunting through
 * each Engagement one at a time. Pure presentation + filtering: every
 * action (Start Review/Confirm/Reject) calls the exact same CustomerContext
 * functions EngagementDetailModal already used — no new payment logic here,
 * conflict detection and Enrollment/Accounting side effects are untouched.
 */
export default function PaymentVerificationQueue() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { nodeById } = useCatalog();
  const { engagements, customerById, startPaymentReview, confirmPaymentRecord, rejectPaymentRecord } = useCustomers();

  const [filter, setFilter] = useState("needs_action");
  const [search, setSearch] = useState("");
  const [openEngagementId, setOpenEngagementId] = useState(null);
  const [confirmError, setConfirmError] = useState("");

  // Flatten every Engagement's Payment Records into one list, each carrying
  // its own Engagement/Customer/Program context — this is the only place in
  // the app that looks across every Engagement's payments at once.
  const rows = useMemo(() => {
    const out = [];
    for (const engagement of engagements) {
      for (const record of effectivePaymentRecords(engagement)) {
        out.push({ engagement, record });
      }
    }
    return out;
  }, [engagements]);

  const counts = useMemo(() => {
    const c = { needs_action: 0, pending: 0, under_review: 0, confirmed: 0, rejected: 0, all: rows.length };
    for (const { record } of rows) {
      if (NEEDS_ACTION.has(record.status)) c.needs_action += 1;
      if (c[record.status] !== undefined) c[record.status] += 1;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (filter === "needs_action") list = list.filter((r) => NEEDS_ACTION.has(r.record.status));
    else if (filter !== "all") list = list.filter((r) => r.record.status === filter);

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(({ engagement }) => {
        const c = customerById(engagement.customerId);
        return (c?.fullName || "").toLowerCase().includes(q) || (c?.phone || "").includes(q);
      });
    }

    // Oldest-first for anything still needing a decision (first in, first
    // reviewed); newest-first once it's just history to browse.
    const chronological = filter === "confirmed" || filter === "rejected" || filter === "all";
    return [...list].sort((a, b) => {
      const cmp = (a.record.submittedAt || "").localeCompare(b.record.submittedAt || "");
      return chronological ? -cmp : cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, search, customerById]);

  const handleConfirm = async (engagementId, paymentId) => {
    try {
      setConfirmError("");
      await confirmPaymentRecord(engagementId, paymentId);
    } catch {
      setConfirmError(tx("تعذّر التأكيد: يوجد تعارض دفع مؤكد بنفس البيانات", "Couldn't confirm: a confirmed duplicate payment conflict exists"));
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{tx("مراجعة المدفوعات", "Payment Verification")}</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
          {tx(
            "كل الدفعات اللي محتاجة قرار، من كل البرامج، في مكان واحد.",
            "Every Payment Record that needs a decision, across every Program, in one place.",
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <button key={f.v} onClick={() => setFilter(f.v)} style={pillStyle(filter === f.v)}>
              {ar ? f.ar : f.en} <span style={{ opacity: 0.7 }}>({counts[f.v] ?? 0})</span>
            </button>
          ))}
        </div>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <span style={{ position: "absolute", insetInlineStart: 12, color: C.muted, display: "flex", pointerEvents: "none" }}><IconSearch size={14} /></span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tx("بحث بالاسم أو الهاتف…", "Search name or phone…")}
            style={{ background: "rgba(255,255,255,.06)", border: `1.5px solid ${C.border}`, borderRadius: 10, paddingBlock: 9, paddingInlineStart: 34, paddingInlineEnd: 14, color: "#fff", fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", minWidth: 220 }}
          />
        </div>
      </div>

      {confirmError && <div style={{ fontSize: 12, color: C.danger, marginBottom: 12 }}>{confirmError}</div>}

      {filtered.length === 0 ? (
        <Card style={{ padding: 40, textAlign: "center" }}>
          <div style={{ color: C.muted }}>
            {filter === "needs_action" ? tx("مفيش دفعات محتاجة مراجعة دلوقتي 🎉", "Nothing needs review right now 🎉") : tx("لا يوجد دفعات", "No payments")}
          </div>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(({ engagement, record }) => {
            const customer = customerById(engagement.customerId);
            const program = engagement.catalogNodeId ? nodeById(engagement.catalogNodeId) : null;
            const snapshot = engagement.pricingSnapshot || null;
            const coursePrice = effectiveCoursePrice(engagement);
            const amountPaid = confirmedAmountPaid(engagement);
            const remaining = (coursePrice || 0) - amountPaid;
            const conflicts = findPaymentConflicts(record, engagement, engagements);
            const mismatch = amountMismatch(record, engagement);
            const blocked = hasBlockingConflict(conflicts);

            const header = (
              <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <button
                      onClick={() => setOpenEngagementId(engagement.id)}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#fff", fontSize: 13.5, fontWeight: 800, fontFamily: "'Cairo',sans-serif", textDecoration: "underline dotted" }}
                    >
                      {customer?.fullName || tx("عميل غير معروف", "Unknown customer")}
                    </button>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
                      <span dir="ltr">{customer?.phone || "—"}</span>
                      {program ? <> · <span dir="ltr">{program.name_en}</span></> : ""}
                    </div>
                  </div>
                  {(NEEDS_ACTION.has(record.status) && (blocked || mismatch)) && (
                    <span style={{ fontSize: 10, fontWeight: 800, color: blocked ? C.danger : C.orange }}>⚠ {tx("يحتاج انتباه", "needs attention")}</span>
                  )}
                </div>
                {/* Engagement-level financial picture — distinct from this one
                    record's own "amount submitted" (shown by PaymentRecordCard
                    itself below): what the Program costs, what's due right
                    now per the frozen pricingSnapshot, what's actually been
                    confirmed so far (any record, not just this one), and
                    what's left. Same confirmedAmountPaid/effectiveCoursePrice
                    used everywhere else — not recomputed here. */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", marginTop: 6, fontSize: 10.5 }} dir="ltr">
                  {typeof coursePrice === "number" && (
                    <span style={{ color: C.muted }}>{tx("سعر الكورس", "Price")}: <b style={{ color: "#fff" }}>{coursePrice.toLocaleString()}</b></span>
                  )}
                  {snapshot && (
                    <span style={{ color: C.muted }}>{tx("متوقع الآن", "Expected now")}: <b style={{ color: "#fff" }}>{(snapshot.depositAmount ?? 0).toLocaleString()} {snapshot.currency || "EGP"}</b></span>
                  )}
                  <span style={{ color: C.muted }}>{tx("المدفوع (مؤكد)", "Confirmed paid")}: <b style={{ color: C.success }}>{amountPaid.toLocaleString()}</b></span>
                  <span style={{ color: C.muted }}>{tx("المتبقي", "Remaining")}: <b style={{ color: remaining > 0 ? C.orange : C.muted }}>{remaining.toLocaleString()}</b></span>
                </div>
              </div>
            );

            return (
              <PaymentRecordCard
                key={`${engagement.id}_${record.id}`}
                record={record}
                engagement={engagement}
                conflicts={conflicts}
                ar={ar}
                tx={tx}
                header={header}
                onStartReview={() => startPaymentReview(engagement.id, record.id)}
                onConfirm={() => handleConfirm(engagement.id, record.id)}
                onReject={(reason) => rejectPaymentRecord(engagement.id, record.id, reason)}
              />
            );
          })}
        </div>
      )}

      {openEngagementId && (
        <EngagementDetailModal
          engagement={engagements.find((e) => e.id === openEngagementId)}
          onClose={() => setOpenEngagementId(null)}
        />
      )}
    </div>
  );
}
