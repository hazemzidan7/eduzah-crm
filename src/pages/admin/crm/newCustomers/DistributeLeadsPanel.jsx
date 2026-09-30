import { useMemo, useState } from "react";
import { Card, Btn, PBar } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useCustomers } from "../../../../context/CustomerContext";
import { useCatalog } from "../../../../context/CatalogContext";
import { useLeadDistribution } from "../../../../hooks/useLeadDistribution";
import { DISTRIBUTION_METHODS, buildDistributionPreview, selectLeadsByInterestedPrograms } from "../../../../utils/leadDistribution";

const selectSx = { background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "7px 10px", fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", width: 90 };
const th = { textAlign: "start", fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: "#475569", fontWeight: 800, padding: "9px 12px", borderBottom: `1px solid ${C.border}`, background: "#F8FAFC", whiteSpace: "nowrap" };
const td = { padding: "8px 12px", fontSize: 12.5, borderBottom: "1px solid #E2E8F0", verticalAlign: "middle" };

function errorText(code, tx, params = {}) {
  switch (code) {
    case "NO_AVAILABLE_LEADS": return tx("لا يوجد عملاء متاحون للتوزيع", "There are no leads available to distribute");
    case "NO_SALES_SELECTED": return tx("اختر مندوب مبيعات واحد على الأقل", "Select at least one sales representative");
    case "DUPLICATE_SALES_SELECTED": return tx("لا يمكن اختيار نفس المندوب أكثر من مرة", "The same sales representative can't be selected twice");
    case "PERCENT_INVALID": return tx("النسبة يجب أن تكون رقمًا موجبًا", "Percentage must be a valid, non-negative number");
    case "PERCENT_TOTAL_INVALID": return tx(`مجموع النسب لا يجب أن يتجاوز 100% (الحالي: ${params.total}%)`, `Percentages can't exceed 100% (currently: ${params.total}%)`);
    case "MANUAL_COUNT_INVALID": return tx("عدد العملاء يجب أن يكون رقمًا صحيحًا موجبًا", "Customer count must be a whole, non-negative number");
    case "MANUAL_EXCEEDS_AVAILABLE": return tx(`مجموع الأعداد (${params.total}) أكبر من المتاح (${params.available})`, `The total (${params.total}) exceeds what's available (${params.available})`);
    case "EQUAL_COUNT_INVALID": return tx("عدد العملاء المراد توزيعهم غير صحيح", "The number of customers to distribute is invalid");
    case "EQUAL_COUNT_EXCEEDS_AVAILABLE": return tx(`العدد المطلوب توزيعه (${params.total}) أكبر من المتاح (${params.available})`, `The requested amount (${params.total}) exceeds what's available (${params.available})`);
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
 * LEAD-DISTRIBUTION-01 — "توزيع العملاء على السيلز" / "إعادة توزيع". The
 * admin is never forced to allocate the whole pool: percentage/equal/manual
 * all accept LESS than 100% of `customerIds`, and whatever isn't covered
 * stays exactly as it was — still unassigned (mode="distribute") or still
 * with its current owner (mode="reassign"). All arithmetic/ordering lives in
 * utils/leadDistribution.js + hooks/useLeadDistribution.js; this only
 * collects the admin's choices and previews/confirms them.
 *
 * `mode="distribute"` (default): the hook filters out any already-assigned
 * id from `customerIds` before computing anything — a normal distribution
 * can never silently touch an existing Sales owner. `mode="reassign"` skips
 * that filter — the one explicit path allowed to move SALES A -> SALES B.
 */
export default function LeadDistributionPanel({ customerIds, sourceBatchId = null, mode = "distribute", heading, stats, onClose, onDone }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { customerById } = useCustomers();
  const { nodes } = useCatalog();
  const { activeSalesUsers, salesNameById, distributeLeads } = useLeadDistribution();

  const [method, setMethod] = useState(DISTRIBUTION_METHODS.PERCENTAGE);
  const [selectedIds, setSelectedIds] = useState([]);
  const [percentById, setPercentById] = useState({});
  const [countById, setCountById] = useState({});
  const [distributeCount, setDistributeCount] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  // Additive, opt-in course-based filter (see utils/leadDistribution.js's selectLeadsByInterestedPrograms) — "normal"
  // never changes anything below; the percentage/equal/manual engine is completely unaware this exists.
  const [distributionMode, setDistributionMode] = useState("normal"); // "normal" | "course"
  const [selectedProgramIds, setSelectedProgramIds] = useState([]);

  // Same catalog-Program-picker convention as LeadExcelImportPanel.jsx's InterestedProgramsPicker: active Programs
  // only, never a business unit/category, never an invented "Unknown Course".
  const programOptions = useMemo(
    () => (nodes || []).filter((n) => n.type === "program" && n.isActive !== false && !n.archivedAt).sort((a, b) => (a.name_en || "").localeCompare(b.name_en || "")),
    [nodes],
  );
  const toggleProgram = (id) => setSelectedProgramIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // The pool this panel can actually act on — mirrors hooks/useLeadDistribution.js's own filter exactly, so the
  // preview the admin sees before confirming is never optimistic about a customer a normal distribution won't touch.
  const pool = useMemo(
    () => (mode === "reassign" ? customerIds : customerIds.filter((id) => !customerById(id)?.assignedToId)),
    [customerIds, mode, customerById],
  );
  const skippedAlreadyAssigned = customerIds.length - pool.length;
  // Course mode narrows `pool` further by interestedProgramIds (order preserved) before it ever reaches the
  // existing percentage/equal/manual engine; "normal" mode leaves it exactly as `pool` — byte-identical to before.
  const eligiblePool = useMemo(
    () => (distributionMode === "course" ? selectLeadsByInterestedPrograms(pool, selectedProgramIds, customerById) : pool),
    [distributionMode, pool, selectedProgramIds, customerById],
  );
  const availableCount = eligiblePool.length;
  const effectiveDistributeCount = distributeCount == null ? availableCount : distributeCount;

  const toggleSales = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const allocations = useMemo(() => {
    if (method === DISTRIBUTION_METHODS.EQUAL) return selectedIds.map((salesId) => ({ salesId }));
    if (method === DISTRIBUTION_METHODS.PERCENTAGE) return selectedIds.map((salesId) => ({ salesId, percent: percentById[salesId] ?? "" }));
    return selectedIds.map((salesId) => ({ salesId, count: countById[salesId] ?? "" }));
  }, [method, selectedIds, percentById, countById]);

  const preview = useMemo(
    () => buildDistributionPreview({ method, availableCount, allocations, distributeCount: effectiveDistributeCount, salesNameById }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [method, availableCount, allocations, effectiveDistributeCount],
  );

  const percentTotal = method === DISTRIBUTION_METHODS.PERCENTAGE
    ? selectedIds.reduce((sum, id) => sum + (Number(percentById[id]) || 0), 0)
    : null;
  const manualTotal = method === DISTRIBUTION_METHODS.MANUAL
    ? selectedIds.reduce((sum, id) => sum + (Number(countById[id]) || 0), 0)
    : null;

  const canConfirm = !committing && preview.errors.length === 0 && selectedIds.length > 0 && preview.totalAssigned > 0;

  const confirm = async () => {
    if (!canConfirm) return;
    const sentence = tx(
      `سيتم توزيع ${preview.totalAssigned} من أصل ${availableCount} عميل متاح على ${preview.rows.filter((r) => r.count > 0).length} مندوب مبيعات. سيبقى ${preview.remaining} عميل بدون توزيع. هل تريد المتابعة؟`,
      `${preview.totalAssigned} of ${availableCount} available leads will be distributed among ${preview.rows.filter((r) => r.count > 0).length} sales representatives. ${preview.remaining} will remain unassigned. Continue?`,
    );
    if (!window.confirm(sentence)) return;
    setCommitting(true);
    setProgress({ done: 0, total: preview.totalAssigned });
    try {
      // eligiblePool === pool (== the same ids the hook would filter to itself) in "normal" mode — passing it here
      // is behaviorally identical to the pre-existing `customerIds` call; in "course" mode it's the narrowed subset.
      const res = await distributeLeads({ customerIds: eligiblePool, method, allocations, distributeCount: effectiveDistributeCount, sourceBatchId, mode });
      setResult(res);
      onDone?.(res);
    } finally {
      setCommitting(false);
    }
  };

  const defaultHeading = mode === "reassign" ? tx("إعادة توزيع", "Reassign") : tx("توزيع العملاء على السيلز", "Distribute leads to Sales");

  if (activeSalesUsers.length === 0) {
    return (
      <Card style={{ padding: 18, marginBottom: 16, border: `1.5px solid ${C.purple}33` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 15 }}>{heading || defaultHeading}</div>
          <Btn sm v="ghost" onClick={onClose}>{tx("إغلاق", "Close")}</Btn>
        </div>
        <div style={{ color: C.muted, fontSize: 12.5 }}>{tx("لا يوجد مندوبين مبيعات نشطين حاليًا.", "There are no active sales representatives right now.")}</div>
      </Card>
    );
  }

  {/* Baseline emptiness (no unassigned leads at all / no selection to reassign) — a full dead-end is correct here,
      nothing else to configure. A course filter yielding zero matches is handled INLINE further below instead, so
      the admin can still see the mode/program pickers and pick a different course. */}
  if (pool.length === 0) {
    return (
      <Card style={{ padding: 18, marginBottom: 16, border: `1.5px solid ${C.purple}33` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 900, fontSize: 15 }}>{heading || defaultHeading}</div>
          <Btn sm v="ghost" onClick={onClose}>{tx("إغلاق", "Close")}</Btn>
        </div>
        <div style={{ color: C.muted, fontSize: 12.5 }}>
          {mode === "reassign"
            ? tx("لا يوجد عملاء محددون لإعادة توزيعهم.", "There are no selected customers to reassign.")
            : tx("لا يوجد عملاء غير موزعين متاحين حاليًا.", "There are no unassigned leads available right now.")}
        </div>
      </Card>
    );
  }

  return (
    <Card style={{ padding: 18, marginBottom: 16, border: `1.5px solid ${C.purple}33` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>{heading || defaultHeading}</div>
        <Btn sm v="ghost" onClick={onClose} disabled={committing}>{tx("إغلاق", "Close")}</Btn>
      </div>

      {!result && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8, marginBottom: 12 }}>
            {stats && <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff" }}><div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{tx("إجمالي العملاء", "Total customers")}</div><div style={{ fontSize: 20, fontWeight: 900 }}>{stats.total}</div></div>}
            {stats && <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff" }}><div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{tx("الموزعين", "Assigned")}</div><div style={{ fontSize: 20, fontWeight: 900 }}>{stats.assigned}</div></div>}
            {stats && <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff" }}><div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{tx("غير الموزعين", "Unassigned")}</div><div style={{ fontSize: 20, fontWeight: 900, color: C.purple }}>{stats.unassigned}</div></div>}
            {distributionMode === "course" && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff" }}><div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{tx("غير الموزعين قبل تصفية الكورس", "Unassigned before course filter")}</div><div style={{ fontSize: 20, fontWeight: 900 }}>{pool.length}</div></div>
            )}
            {distributionMode === "course" && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff" }}><div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{tx("المهتمين بالكورس المحدد", "Interested in the selected course(s)")}</div><div style={{ fontSize: 20, fontWeight: 900, color: C.purple }}>{eligiblePool.length}</div></div>
            )}
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff" }}><div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{tx("المتاح لهذا التوزيع", "Available for this operation")}</div><div style={{ fontSize: 20, fontWeight: 900, color: C.purple }}>{availableCount}</div></div>
          </div>
          {skippedAlreadyAssigned > 0 && (
            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>
              {tx(`${skippedAlreadyAssigned} من العملاء المحددين موزعون بالفعل ولن يتأثروا بهذا التوزيع العادي.`, `${skippedAlreadyAssigned} of the selected customers are already assigned and won't be touched by this normal distribution.`)}
            </div>
          )}

          {/* Additive: which POOL feeds the (unchanged) method engine below. "التوزيع العادي" is the default and
              behaves exactly as before this feature existed. Not offered during an explicit reassignment — course
              filtering is scoped to the unassigned pool (see utils/leadDistribution.js's selectLeadsByInterestedPrograms). */}
          {mode !== "reassign" && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 8 }}>{tx("طريقة التوزيع", "Distribution scope")}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: distributionMode === "course" ? 10 : 0 }}>
                {[["normal", tx("التوزيع العادي", "Normal distribution")], ["course", tx("التوزيع حسب الكورسات المهتم بيها", "By interested course")]].map(([m, label]) => (
                  <button
                    key={m} disabled={committing}
                    onClick={() => setDistributionMode(m)}
                    style={{
                      padding: "6px 14px", borderRadius: 99, border: "none", cursor: "pointer",
                      fontWeight: 800, fontSize: 12, fontFamily: "'Cairo',sans-serif",
                      background: distributionMode === m ? C.text : `${C.text}0d`, color: distributionMode === m ? "#fff" : C.text,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {distributionMode === "course" && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 6 }}>{tx("اختر الكورسات المهتم بيها", "Select the interested course(s)")}</div>
                  {programOptions.length === 0 ? (
                    <div style={{ fontSize: 12, color: C.muted }}>{tx("لا يوجد كورسات نشطة في الكتالوج.", "There are no active courses in the catalog.")}</div>
                  ) : (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {programOptions.map((p) => (
                        <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
                          <input type="checkbox" checked={selectedProgramIds.includes(p.id)} onChange={() => toggleProgram(p.id)} disabled={committing} />
                          {p.name_en || p.name_ar}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {distributionMode === "course" && selectedProgramIds.length > 0 && eligiblePool.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 12.5, marginBottom: 12 }}>{tx("لا يوجد عملاء غير موزعين مهتمون بهذا الكورس.", "There are no unassigned leads interested in this course.")}</div>
          ) : distributionMode === "course" && selectedProgramIds.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 12.5, marginBottom: 12 }}>{tx("اختر كورس واحد على الأقل لعرض العملاء المهتمين.", "Select at least one course to see interested leads.")}</div>
          ) : (
            <>
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

          {method === DISTRIBUTION_METHODS.EQUAL && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: C.muted, maxWidth: 260 }}>
                {tx("عدد العملاء المراد توزيعهم", "Number of customers to distribute")}
                <input
                  type="number" min="0" max={availableCount} step="1" disabled={committing}
                  value={distributeCount ?? availableCount}
                  onChange={(e) => setDistributeCount(e.target.value === "" ? null : Number(e.target.value))}
                  style={{ ...selectSx, width: 140 }}
                />
              </label>
              <Btn sm v="ghost" style={{ marginTop: 6 }} disabled={committing} onClick={() => setDistributeCount(availableCount)}>{tx("توزيع الكل", "Distribute all")}</Btn>
            </div>
          )}

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
              <div style={{ fontSize: 11.5, color: percentTotal > 100 ? C.danger : C.muted, marginTop: 8, fontWeight: 700 }}>
                {tx(`الإجمالي: ${percentTotal}% (لا يجب أن يتجاوز 100% — أقل من 100% يترك الباقي بدون توزيع)`, `Total: ${percentTotal}% (must not exceed 100% — less than 100% leaves the rest unassigned)`)}
              </div>
            )}
            {method === DISTRIBUTION_METHODS.MANUAL && selectedIds.length > 0 && (
              <div style={{ fontSize: 11.5, color: manualTotal > availableCount ? C.danger : C.muted, marginTop: 8, fontWeight: 700 }}>
                {tx(`الإجمالي: ${manualTotal} من ${availableCount} متاح`, `Total: ${manualTotal} of ${availableCount} available`)}
              </div>
            )}
          </div>

          {selectedIds.length > 0 && preview.errors.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {preview.errors.map((e, i) => <div key={i} style={{ color: C.danger, fontSize: 12 }}>{errorText(e.code, tx, e)}</div>)}
            </div>
          )}

          {preview.rows.length > 0 && preview.errors.length === 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6 }}>{tx("معاينة التوزيع", "Distribution preview")}</div>
              <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
                  <thead>
                    <tr>
                      <th style={th}>{mode === "reassign" ? tx("المسؤول الجديد", "New owner") : tx("المندوب", "Representative")}</th>
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
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>
                {tx(`سيتم توزيع ${preview.totalAssigned} الآن — `, `${preview.totalAssigned} will be distributed now — `)}
                <span style={{ color: preview.remaining > 0 ? C.purple : C.muted }}>
                  {tx(`سيبقى ${preview.remaining} بدون توزيع (غير موزعين، لن يُفقدوا).`, `${preview.remaining} will remain unassigned (not lost).`)}
                </span>
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
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff" }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{tx("بقي غير موزع", "Remained unassigned")}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: C.purple }}>{result.remaining}</div>
            </div>
            {result.failedChunks > 0 && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff" }}>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{tx("دفعات فشلت", "Failed chunks")}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: C.danger }}>{result.failedChunks}</div>
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
            {tx("العملاء غير الموزعين يبقون في «عملاء جدد» ضمن «غير موزع» — لم يُحذف أو يُفقد أي عميل.", "Unassigned customers stay in “عملاء جدد” under “Unassigned” — no customer was deleted or lost.")}
          </div>
          {result.errors?.map((e, i) => <div key={i} style={{ color: C.danger, fontSize: 12 }}>{errorText(e.code, tx, e)}{e.message ? `: ${e.message}` : ""}</div>)}
          <Btn v="ghost" onClick={onClose}>{tx("تم", "Done")}</Btn>
        </div>
      )}
    </Card>
  );
}
