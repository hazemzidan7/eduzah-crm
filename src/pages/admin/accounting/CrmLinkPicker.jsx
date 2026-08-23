import { useMemo, useState } from "react";
import { C } from "../../../theme";
import { Select } from "../../../components/UI";
import { IconX } from "../../../components/Icons";
import { useCustomers } from "../../../context/CustomerContext";
import { useCatalog } from "../../../context/CatalogContext";
import { effectivePaymentRecords, paymentOptionLabel, PAYMENT_TYPE_OPTIONS, PAYMENT_RECORD_STATUS_OPTIONS } from "../../../utils/paymentRecords";
import { TRANSACTION_TYPES } from "../../../utils/accounting";

/**
 * Optional Customer/Engagement/PaymentRecord link for an Income or Refund
 * transaction (ACCOUNTING-02 §4). Read-only lookup against CRM data already
 * loaded by CustomerContext — reuses effectivePaymentRecords/paymentOptionLabel
 * as-is, never writes to CRM, never auto-fills amount/account. Picking a link
 * here is a manual, deliberate action by whoever is entering the transaction —
 * NOT the automatic CRM->Accounting integration explicitly out of scope.
 *
 * `type` (ACCOUNTING-03B): for a Refund, only confirmed PaymentRecords are
 * offered — refunding money back requires it to have actually been
 * received. Income keeps the full list (unchanged from ACCOUNTING-02).
 */
export default function CrmLinkPicker({ tx, ar, type, customerId, engagementId, paymentId, onChange }) {
  const { customers, engagementsForCustomer, customerById } = useCustomers();
  const { nodeById } = useCatalog();
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((c) => (c.fullName || "").toLowerCase().includes(q) || (c.phone || "").includes(q))
      .slice(0, 8);
  }, [customers, query]);

  const selectedCustomer = customerId ? customerById(customerId) : null;
  const engagements = customerId ? engagementsForCustomer(customerId) : [];
  const selectedEngagement = engagementId ? engagements.find((e) => e.id === engagementId) : null;
  const allRecords = selectedEngagement ? effectivePaymentRecords(selectedEngagement) : [];
  const records = type === TRANSACTION_TYPES.REFUND ? allRecords.filter((r) => r.status === "confirmed") : allRecords;

  return (
    <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, border: `1px dashed ${C.border}`, background: "rgba(255,255,255,.03)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8 }}>
        {tx("ربط بعميل من الـ CRM (اختياري)", "Link to a CRM customer (optional)")}
      </div>

      {!selectedCustomer ? (
        <div style={{ position: "relative" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tx("ابحث بالاسم أو الهاتف…", "Search name or phone…")}
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.055)", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", color: "#fff", fontFamily: "'Cairo',sans-serif", fontSize: 13, outline: "none" }}
          />
          {matches.length > 0 && (
            <div style={{ marginTop: 6, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
              {matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onChange({ customerId: c.id, engagementId: null, paymentId: null }); setQuery(""); }}
                  style={{ display: "block", width: "100%", textAlign: "start", padding: "8px 12px", background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, color: "#fff", cursor: "pointer", fontFamily: "'Cairo',sans-serif", fontSize: 12.5 }}
                >
                  {c.fullName || tx("بدون اسم", "Unnamed")} <span style={{ color: C.muted }} dir="ltr">· {c.phone || "—"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{selectedCustomer.fullName || tx("بدون اسم", "Unnamed")}</div>
            <button
              type="button"
              onClick={() => onChange({ customerId: null, engagementId: null, paymentId: null })}
              style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", display: "flex" }}
              title={tx("إزالة الربط", "Remove link")}
            >
              <IconX size={14} />
            </button>
          </div>

          {engagements.length > 0 && (
            <Select
              label={tx("البرنامج (اختياري)", "Program (optional)")}
              value={engagementId || ""}
              onChange={(v) => onChange({ customerId, engagementId: v || null, paymentId: null })}
              options={[
                { v: "", l: tx("بدون تحديد", "Not specified") },
                ...engagements.map((e) => {
                  const node = e.catalogNodeId ? nodeById(e.catalogNodeId) : null;
                  return { v: e.id, l: node ? node.name_en : e.id };
                }),
              ]}
            />
          )}

          {selectedEngagement && records.length > 0 && (
            <Select
              label={tx("دفعة مرتبطة (اختياري)", "Related payment record (optional)")}
              value={paymentId || ""}
              onChange={(v) => onChange({ customerId, engagementId, paymentId: v || null })}
              options={[
                { v: "", l: tx("بدون تحديد", "Not specified") },
                ...records.map((r) => ({
                  v: r.id,
                  l: `${(r.amount || 0).toLocaleString()} · ${paymentOptionLabel(PAYMENT_TYPE_OPTIONS, r.paymentType, ar)} · ${paymentOptionLabel(PAYMENT_RECORD_STATUS_OPTIONS, r.status, ar)}`,
                })),
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
}
