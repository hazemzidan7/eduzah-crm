import { useMemo, useState } from "react";
import { Card, Btn, PBar } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useLeadDistribution } from "../../../../hooks/useLeadDistribution";
import { DISTRIBUTION_METHODS, buildDistributionPreview } from "../../../../utils/leadDistribution";

const selectSx = { background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "7px 10px", fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", width: 90 };
const th = { textAlign: "start", fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: "#475569", fontWeight: 800, padding: "9px 12px", borderBottom: `1px solid ${C.border}`, background: "#F8FAFC", whiteSpace: "nowrap" };
const td = { padding: "8px 12px", fontSize: 12.5, borderBottom: "1px solid #E2E8F0", verticalAlign: "middle" };

function errorText(code, tx) {
  switch (code) {
    case "NO_ACCEPTED_LEADS": return tx("لا يوجد عملاء لتوزيعهم", "There are no leads to distribute");
    case "NO_SALES_SELECTED": return tx("اختر مندوب مبيعات واحد على الأقل", "Select at least one sales representative");
    case "DUPLICATE_SALES_SELECTED": return tx("لا يمكن اختيار نفس المندوب أكثر من مرة", "The same sales representative can't be selected twice");
    case "PERCENT_INVALID": return tx("النسبة يجب أن تكون رقمًا موجبًا", "Percentage must be a valid, non-negative number");
    case "PERCENT_TOTAL_INVALID": return tx("مجموع النسب يجب أن يساوي 100% بالضبط", "Percentages must sum to exactly 100%");
    case "MANUAL_COUNT_INVALID": return tx("عدد العملاء يجب أن يكون رقمًا صحيحًا موجبًا", "Customer count must be a whole, non-negative number");
    case "MANUAL_TOTAL_MISMATCH": return tx("مجموع الأعداد يجب أن يساوي إجمالي العملاء المقبولين بالضبط", "The counts must sum to exactly the accepted lead count");
    case "METHOD_INVALID": return tx("طريقة توزيع غير معروفة", "Unknown distribution method");
    case "DISTRIBUTION_CHUNK_FAILED": return tx("فشل جزء من عملية التوزيع", "Part of the distribution failed");
    default: return code;
  }
}

const METHOD_LABEL = (tx) => ({
  [DISTRIBUTION_METHODS.PERCENTAGE]: tx("توزيع بالنسب", "Distribute by percentage"),
  [DISTRIBUTION_METHODS.EQUAL]: tx("توزيع بالتساوي", "Distribute equally"),
  [DISTRIBUTION_METHODS.MANUAL]: tx("توزيع يدوي", "Manual distribution"),
});

/**
 * LEAD-DISTRIBUTION-01 — "توزيع العملاء على السيلز". Reused for both entry
 * points: right after a lead import (sourceBatchId set — the summary is
 * recorded on that same importBatches doc) and admin-triggered reassignment
 * from "عملاء جدد" (sourceBatchId null). All arithmetic/ordering lives in
 * utils/leadDistribution.js + hooks/useLeadDistribution.js; this only
 * collects the admin's choices and previews/confirms them. Re-running the
 * exact same distribution is always safe — hooks/useLeadDistribution.js's
 * patch diffing only ever touches a customer whose assignment isn't already
 * correct, so a double click or a retry writes nothing twice.
 */
export default function DistributeLeadsPanel({ customerIds, sourceBatchId = null, heading, showReassignmentDetail = false, currentOwnerById, onClose, onDone }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { activeSalesUsers, salesNameById, distributeLeads } = useLeadDistribution();

  const [method, setMethod] = useState(DISTRIBUTION_METHODS.PERCENTAGE);
  const [selectedIds, setSelectedIds] = useState([]);
  const [percentById, setPercentById] = useState({});
  const [countById, setCountById] = useState({});
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);

  const totalCount = customerIds.length;

  const toggleSales = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const allocations = useMemo(() => {
    if (method === DISTRIBUTION_METHODS.EQUAL) return selectedIds.map((salesId) => ({ salesId }));
    if (method === DISTRIBUTION_METHODS.PERCENTAGE) return selectedIds.map((salesId) => ({ salesId, percent: percentById[salesId] ?? "" }));
    return selectedIds.map((salesId) => ({ salesId, count: countById[salesId] ?? "" }));
  }, [method, selectedIds, percentById, countById]);

  const preview = useMemo(
    () => buildDistributionPreview({ method, totalCount, allocations, salesNameById }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [method, totalCount, allocations],
  );

  const percentTotal = method === DISTRIBUTION_METHODS.PERCENTAGE
    ? selectedIds.reduce((sum, id) => sum + (Number(percentById[id]) || 0), 0)
    : null;
  const manualTotal = method === DISTRIBUTION_METHODS.MANUAL
    ? selectedIds.reduce((sum, id) => sum + (Number(countById[id]) || 0), 0)
    : null;

  const canConfirm = !committing && preview.errors.length === 0 && selectedIds.length > 0;

  const confirm = async () => {
    if (!canConfirm) return;
    const sentence = tx(
      `سيتم توزيع ${totalCount} عميل على ${preview.rows.length} مندوب مبيعات. هل تريد المتابعة؟`,
      `${totalCount} leads will be distributed among ${preview.rows.length} sales representatives. Continue?`,
    );
    if (!window.confirm(sentence)) return;
    setCommitting(true);
    setProgress({ done: 0, total: totalCount });
    try {
      const res = await distributeLeads({ customerIds, method, allocations, sourceBatchId });
      setResult(res);
      onDone?.(res);
    } finally {
      setCommitting(false);
    }
  };

  if (activeSalesUsers.length === 0) {
    return (
      <Card style={{ padding: 18, marginBottom: 16, border: `1.5px solid ${C.purple}33` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 15 }}>{heading || tx("توزيع العملاء على السيلز", "Distribute leads to Sales")}</div>
          <Btn sm v="ghost" onClick={onClose}>{tx("إغلاق", "Close")}</Btn>
        </div>
        <div style={{ color: C.muted, fontSize: 12.5 }}>{tx("لا يوجد مندوبين مبيعات نشطين حاليًا.", "There are no active sales representatives right now.")}</div>
      </Card>
    );
  }

  if (totalCount === 0) {
    return (
      <Card style={{ padding: 18, marginBottom: 16, border: `1.5px solid ${C.purple}33` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 15 }}>{heading || tx("توزيع العملاء على السيلز", "Distribute leads to Sales")}</div>
          <Btn sm v="ghost" onClick={onClose}>{tx("إغلاق", "Close")}</Btn>
        </div>
        <div style={{ color: C.muted, fontSize: 12.5 }}>{tx("لا يوجد عملاء لتوزيعهم.", "There are no leads to distribute.")}</div>
      </Card>
    );
  }

  return (
    <Card style={{ padding: 18, marginBottom: 16, border: `1.5px solid ${C.purple}33` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>{heading || tx("توزيع العملاء على السيلز", "Distribute leads to Sales")}</div>
        <Btn sm v="ghost" onClick={onClose} disabled={committing}>{tx("إغلاق", "Close")}</Btn>
      </div>

      {!result && (
        <>
          <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12 }}>{tx(`إجمالي العملاء المقبولين: ${totalCount}`, `Total accepted leads: ${totalCount}`)}</div>

          {showReassignmentDetail && currentOwnerById && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6 }}>{tx("المسؤول الحالي", "Current owner")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: C.muted }}>
                {Object.entries(
                  customerIds.reduce((acc, id) => {
                    const name = currentOwnerById(id) || tx("غير معيّن", "Unassigned");
                    acc[name] = (acc[name] || 0) + 1;
                    return acc;
                  }, {}),
                ).map(([name, count]) => <div key={name}>{name} — {count}</div>)}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {Object.values(DISTRIBUTION_METHODS).map((m) => (
              <button
                key={m} disabled={committing}
                onClick={() => setMethod(m)}
                style={{
                  padding: "6px 14px", borderRadius: 99, border: "none", cursor: "pointer",
                  fontWeight: 800, fontSize: 12, fontFamily: "'Cairo',sans-serif",
                  background: method === m ? C.purple : `${C.purple}1a`, color: method === m ? "#fff" : C.purple,
                }}
              >
                {METHOD_LABEL(tx)[m]}
              </button>
            ))}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 8 }}>{tx("مندوبو المبيعات", "Sales representatives")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {activeSalesUsers.map((u) => (
                <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 12.5, cursor: "pointer", minWidth: 160 }}>
                    <input type="checkbox" checked={selectedIds.includes(u.id)} onChange={() => toggleSales(u.id)} disabled={committing} />
                    {u.name || u.email}
                  </label>
                  {selectedIds.includes(u.id) && method === DISTRIBUTION_METHODS.PERCENTAGE && (
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.muted }}>
                      {tx("النسبة", "Percentage")}
                      <input
                        type="number" min="0" max="100" step="0.01" style={selectSx} disabled={committing}
                        value={percentById[u.id] ?? ""}
                        onChange={(e) => setPercentById((p) => ({ ...p, [u.id]: e.target.value }))}
                      /> %
                    </label>
                  )}
                  {selectedIds.includes(u.id) && method === DISTRIBUTION_METHODS.MANUAL && (
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.muted }}>
                      {tx("عدد العملاء", "Customer count")}
                      <input
                        type="number" min="0" step="1" style={selectSx} disabled={committing}
                        value={countById[u.id] ?? ""}
                        onChange={(e) => setCountById((p) => ({ ...p, [u.id]: e.target.value }))}
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
            {method === DISTRIBUTION_METHODS.PERCENTAGE && selectedIds.length > 0 && (
              <div style={{ fontSize: 11.5, color: percentTotal === 100 ? C.success : C.muted, marginTop: 8, fontWeight: 700 }}>
                {tx(`الإجمالي: ${percentTotal}% (يجب أن يساوي 100%)`, `Total: ${percentTotal}% (must equal 100%)`)}
              </div>
            )}
            {method === DISTRIBUTION_METHODS.MANUAL && selectedIds.length > 0 && (
              <div style={{ fontSize: 11.5, color: manualTotal === totalCount ? C.success : C.muted, marginTop: 8, fontWeight: 700 }}>
                {tx(`الإجمالي: ${manualTotal} من ${totalCount}`, `Total: ${manualTotal} of ${totalCount}`)}
              </div>
            )}
          </div>

          {selectedIds.length > 0 && preview.errors.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {preview.errors.map((e, i) => <div key={i} style={{ color: C.danger, fontSize: 12 }}>{errorText(e.code, tx)}</div>)}
            </div>
          )}

          {preview.rows.length > 0 && preview.errors.length === 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6 }}>{tx("معاينة التوزيع", "Distribution preview")}</div>
              <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
                  <thead>
                    <tr>
                      <th style={th}>{showReassignmentDetail ? tx("المسؤول الجديد", "New owner") : tx("المندوب", "Representative")}</th>
                      {method === DISTRIBUTION_METHODS.PERCENTAGE && <th style={th}>{tx("النسبة", "Percentage")}</th>}
                      <th style={th}>{tx("عدد العملاء", "Customer count")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.salesId}>
                        <td style={td}>{r.salesName}</td>
                        {method === DISTRIBUTION_METHODS.PERCENTAGE && <td style={td} dir="ltr">{r.percent}%</td>}
                        <td style={td}>{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {committing ? (
            <div style={{ maxWidth: 420 }}>
              <PBar value={progress.total ? Math.round((progress.done / progress.total) * 100) : 0} color={C.purple} />
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{tx("جاري التوزيع…", "Distributing…")}</div>
            </div>
          ) : (
            <Btn v="primary" disabled={!canConfirm} onClick={confirm}>{tx("تأكيد التوزيع", "Confirm distribution")}</Btn>
          )}
        </>
      )}

      {result && (
        <div>
          {result.errors?.length > 0 && result.assignedCount === 0 && result.unchangedCount === 0 ? (
            <div style={{ color: C.danger, fontWeight: 800, marginBottom: 8 }}>{tx("تعذّر إتمام التوزيع", "Distribution could not complete")}</div>
          ) : (
            <div style={{ fontWeight: 800, marginBottom: 8, color: result.failedChunks ? "#92400E" : C.success }}>
              {result.failedChunks ? tx("اكتمل التوزيع مع بعض الأخطاء", "Distribution finished with errors") : tx("تم التوزيع بنجاح", "Distribution completed")}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 10 }}>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff" }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{tx("عملاء تم توزيعهم", "Customers assigned")}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: C.success }}>{result.assignedCount}</div>
            </div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff" }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{tx("بدون تغيير", "Unchanged")}</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{result.unchangedCount}</div>
            </div>
            {result.failedChunks > 0 && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff" }}>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{tx("دفعات فشلت", "Failed chunks")}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: C.danger }}>{result.failedChunks}</div>
              </div>
            )}
          </div>
          {result.errors?.map((e, i) => <div key={i} style={{ color: C.danger, fontSize: 12 }}>{errorText(e.code, tx)}{e.message ? `: ${e.message}` : ""}</div>)}

          {showReassignmentDetail && result.perSales?.length > 0 && (
            <div style={{ marginTop: 12, marginBottom: 12 }}>
              <div style={{ overflowX: "auto", maxHeight: 240, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
                  <thead><tr><th style={th}>{tx("المسؤول الجديد", "New owner")}</th><th style={th}>{tx("عدد العملاء", "Customer count")}</th></tr></thead>
                  <tbody>
                    {result.perSales.map((r) => (
                      <tr key={r.salesId}><td style={td}>{r.salesName}</td><td style={td}>{r.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {currentOwnerById && (
                <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
                  {tx("«المسؤول الحالي» قبل هذا التوزيع كان موضّحًا في القائمة قبل التأكيد.", "The “current owner” before this distribution was shown in the list before confirming.")}
                </div>
              )}
            </div>
          )}

          <Btn v="ghost" onClick={onClose}>{tx("تم", "Done")}</Btn>
        </div>
      )}
    </Card>
  );
}
