import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Btn, Badge, PBar } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useCatalog } from "../../../../context/CatalogContext";
import { parseWorkbookFileWithRowNumbers } from "../../../../utils/importEngine/fileParser";
import { detectColumns, MAX_IMPORT_ROWS } from "../../../../utils/leadImport";
import { useLeadImportCommit } from "../../../../hooks/useLeadImportCommit";
import { InterestedProgramsPicker } from "../../../../components/crm/InterestedPrograms";

const th = { textAlign: "start", fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: "#475569", fontWeight: 800, padding: "9px 12px", borderBottom: `1px solid ${C.border}`, background: "#F8FAFC", whiteSpace: "nowrap" };
const td = { padding: "8px 12px", fontSize: 12, borderBottom: "1px solid #E2E8F0", verticalAlign: "top" };
const selectSx = { background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 8, padding: "7px 10px", fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", maxWidth: "100%" };
const ROW_PAGE = 100;

/** Human-readable reason for one row outcome (a rejection, a skip, or a review warning). */
function reasonText(r, tx) {
  const p = r.params || {};
  switch (r.code) {
    case "NO_PHONE": return tx("رقم التليفون مطلوب", "phone number is required");
    case "INVALID_PHONE": {
      const why = {
        too_short: tx("الرقم أقصر من اللازم", "number is too short"),
        too_long: tx("الرقم أطول من اللازم", "number is too long"),
        not_egyptian_mobile: tx("مش رقم موبايل مصري (010/011/012/015)", "not an Egyptian mobile number (010/011/012/015)"),
        no_digits: tx("مفيش أرقام", "no digits"),
      }[p.why] || "";
      return `${tx("رقم التليفون غير صالح", "phone number is invalid")}${why ? ` — ${why}` : ""}`;
    }
    case "AMBIGUOUS_EXISTING": return tx(`الرقم مطابق لـ ${p.count} عملاء موجودين — مراجعة يدوية (لن يُعدَّل أي منهم)`, `phone matches ${p.count} existing customers — manual review (none will be changed)`);
    case "ARCHIVED_CUSTOMER": return tx("العميل موجود لكنه مؤرشف — لن يُنشأ عميل مكرر ولن يُعاد تفعيله", "customer exists but is archived — no duplicate is created and it is not reactivated");
    case "UNMATCHED_PROGRAM": return tx(`كورس غير موجود في الكتالوج: «${p.token}» — لن يُضاف الاهتمام`, `program not in the catalog: "${p.token}" — interest not added`);
    case "AMBIGUOUS_PROGRAM": return tx(`«${p.token}» يطابق أكثر من كورس (${(p.names || []).join("، ")}) — اختر يدويًا`, `"${p.token}" matches several programs (${(p.names || []).join(", ")}) — choose manually`);
    case "NAME_CONFLICT": return tx(`اسم مختلف لنفس الرقم — تم الإبقاء على «${p.keptName}» (صف ${p.keptRow})`, `different name for the same phone — kept "${p.keptName}" (row ${p.keptRow})`);
    case "MULTI_PHONE": return tx(`أكثر من رقم في الخلية — الرقم الأول أساسي والباقي أرقام إضافية: ${(p.secondary || []).join("، ")}`, `several numbers in the cell — first is primary, the rest are secondary: ${(p.secondary || []).join(", ")}`);
    case "DUPLICATE_IN_FILE": return tx(`نفس الرقم مكرر في الملف (أول ظهور صف ${p.firstRow}) — دُمج في نفس العميل`, `same phone repeated in the file (first seen row ${p.firstRow}) — merged into the same customer`);
    default: return r.code;
  }
}

function Stat({ label, value, tone }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff" }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: tone || C.text }}>{value}</div>
    </div>
  );
}

/**
 * LEAD-IMPORT-01 — "رفع ملف Excel" inside عملاء جدد. Two strictly separate
 * phases: (1) choosing a file only PARSES it in the browser and builds a
 * preview/dry-run (nothing is written to Firestore, ever, at this stage);
 * (2) only the explicit "استيراد العملاء" button — after the confirmation
 * sentence — calls the commit hook.
 */
export default function LeadExcelImportPanel({ onClose }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { nodes } = useCatalog();
  const { buildPlan, commitLeadImport } = useLeadImportCommit();
  const buildPlanRef = useRef(buildPlan);
  buildPlanRef.current = buildPlan;

  const [parsed, setParsed] = useState(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState({ phone: null, name: null, programs: [] });
  const [detection, setDetection] = useState(null);
  const [tokenOverrides, setTokenOverrides] = useState({});
  // Programs chosen ONCE for the whole import (not read from the file) — applied as interests to every customer the file brings in.
  const [batchProgramIds, setBatchProgramIds] = useState([]);
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [parseError, setParseError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const planRun = useRef(0);
  const fileInput = useRef(null);

  const sheet = parsed?.sheets[sheetIdx] || null;
  const programOptions = useMemo(
    () => nodes.filter((n) => n.type === "program" && n.isActive !== false && !n.archivedAt).sort((a, b) => (a.name_en || "").localeCompare(b.name_en || "")),
    [nodes],
  );

  const pickSheet = (data, idx) => {
    const s = data.sheets[idx];
    setSheetIdx(idx);
    setTokenOverrides({});
    setPlan(null);
    setNotice("");
    if (!s) return;
    const det = detectColumns(s.headers, s.rows, { hasHeader: s.hasHeader });
    setDetection(det);
    setMapping(det.mapping);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParseError(""); setResult(null); setParsed(null); setPlan(null); setNotice(""); setBatchProgramIds([]);
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setParseError(tx("نوع الملف غير مدعوم — استخدم .xlsx أو .xls أو .csv", "Unsupported file type — use .xlsx, .xls or .csv")); return; }
    try {
      const data = await parseWorkbookFileWithRowNumbers(file);
      const firstWithRows = Math.max(0, data.sheets.findIndex((s) => s.rows.length > 0));
      if (data.sheets.every((s) => s.rows.length === 0)) { setParseError(tx("الملف فارغ", "The file has no data rows")); return; }
      const big = data.sheets.find((s) => s.rows.length > MAX_IMPORT_ROWS);
      if (big) { setParseError(tx(`الملف كبير جدًا (أكثر من ${MAX_IMPORT_ROWS} صف) — قسّمه على أكثر من ملف`, `File too large (over ${MAX_IMPORT_ROWS} rows) — split it into several files`)); return; }
      setParsed(data);
      pickSheet(data, firstWithRows);
    } catch (err) {
      setParseError(tx("تعذّرت قراءة الملف", "Could not read the file") + (err?.message ? `: ${err.message}` : ""));
    }
  };

  // Preview = a pure computation over the parsed file. Re-runs when the sheet, the column choices or a manual program choice change.
  useEffect(() => {
    if (!sheet || !mapping.phone) { setPlan(null); return undefined; }
    const run = ++planRun.current;
    setPlanning(true);
    buildPlanRef.current({ rows: sheet.rows, rowNumbers: sheet.rowNumbers, mapping, tokenOverrides, batchProgramIds })
      .then((p) => { if (run === planRun.current) setPlan(p); })
      .catch((err) => { if (run === planRun.current) setParseError(err?.message || String(err)); })
      .finally(() => { if (run === planRun.current) setPlanning(false); });
    return () => { planRun.current += 1; };
  }, [sheet, mapping, tokenOverrides, batchProgramIds]);

  const setField = (field, value) => setMapping((m) => ({ ...m, [field]: value || null }));
  const toggleProgramColumn = (h) => setMapping((m) => ({ ...m, programs: m.programs.includes(h) ? m.programs.filter((x) => x !== h) : [...m.programs, h] }));

  const s = plan?.stats;
  const willChange = !!s && (s.newCustomers > 0 || s.updatedCustomers > 0);
  const confirmSentence = s
    ? tx(
      `سيتم إضافة ${s.newCustomers} عميل جديد، وتحديث ${s.updatedCustomers} عميل موجود، وإضافة ${s.newInterests} اهتمام.`,
      `${s.newCustomers} new customers will be added, ${s.updatedCustomers} existing customers updated, and ${s.newInterests} interests added.`,
    )
    : "";

  const shownRows = useMemo(() => {
    if (!plan) return [];
    const flagged = plan.rows.filter((r) => r.status !== "accepted" || r.warnings.some((w) => w.severity === "review"));
    return flagged;
  }, [plan]);

  const doImport = async () => {
    if (!plan || importing) return;
    setNotice("");
    // Re-plan against the customers as they are RIGHT NOW: the preview may be minutes old and someone may have added a customer meanwhile.
    const fresh = await buildPlanRef.current({ rows: sheet.rows, rowNumbers: sheet.rowNumbers, mapping, tokenOverrides, batchProgramIds });
    const key = (p) => `${p.stats.newCustomers}/${p.stats.updatedCustomers}/${p.stats.newInterests}`;
    if (key(fresh) !== key(plan)) {
      setPlan(fresh);
      setNotice(tx("تغيّرت بيانات العملاء منذ المعاينة — تم تحديث الملخص. راجعه ثم اضغط «استيراد العملاء» مرة أخرى. (لم يُكتب شيء)", "Customer data changed since the preview — the summary was refreshed. Review it and press “Import customers” again. (Nothing was written)"));
      return;
    }
    const f = fresh.stats;
    const chosen = batchProgramIds.map((id) => programOptions.find((p) => p.id === id)?.name_en).filter(Boolean);
    const chosenLine = chosen.length > 0 ? tx(`الكورسات المختارة كاهتمامات: ${chosen.join("، ")}\n\n`, `Selected interests: ${chosen.join(", ")}\n\n`) : "";
    const sentence = tx(
      `سيتم إضافة ${f.newCustomers} عميل جديد، وتحديث ${f.updatedCustomers} عميل موجود، وإضافة ${f.newInterests} اهتمام.\n\n${chosenLine}لن يتم إنشاء أي تسجيلات أو مدفوعات أو معاملات محاسبية.\n\nهل تريد المتابعة؟`,
      `${f.newCustomers} new customers will be added, ${f.updatedCustomers} existing customers updated, and ${f.newInterests} interests added.\n\n${chosenLine}No registrations, payments or accounting transactions will be created.\n\nContinue?`,
    );
    if (!window.confirm(sentence)) return;
    setImporting(true);
    setProgress({ done: 0, total: f.newCustomers + f.updatedCustomers });
    try {
      const res = await commitLeadImport({ plan: fresh, fileName: parsed.fileName, onProgress: (done, total) => setProgress({ done, total }) });
      setResult(res);
    } catch (err) {
      setResult({ aborted: true, errors: [{ code: "UNEXPECTED", message: err?.message || String(err) }], createdCustomers: 0, updatedCustomers: 0, addedInterests: 0, failedChunks: 0 });
    } finally {
      setImporting(false);
    }
  };

  const reset = () => { setParsed(null); setPlan(null); setResult(null); setParseError(""); setNotice(""); setTokenOverrides({}); setBatchProgramIds([]); };

  return (
    <Card style={{ padding: 18, marginBottom: 16, border: `1.5px solid ${C.red}33` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontWeight: 900, fontSize: 15 }}>{tx("رفع ملف Excel", "Upload Excel file")}</div>
        <Btn sm v="ghost" onClick={onClose} disabled={importing}>{tx("إغلاق", "Close")}</Btn>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, maxWidth: 760 }}>
        {tx(
          "رقم التليفون هو الحقل الوحيد المطلوب — الاسم اختياري. اختيار الملف يعرض معاينة فقط ولا يكتب أي بيانات؛ الاستيراد لا يبدأ إلا بزر «استيراد العملاء». الاستيراد ينشئ عملاء واهتمامات فقط — لا تسجيلات ولا مدفوعات ولا معاملات محاسبية.",
          "Phone is the only required field — the name is optional. Choosing a file only shows a preview and writes nothing; the import starts only with the “Import customers” button. It creates customers and interests only — no registrations, payments or accounting transactions.",
        )}
      </div>

      {!result && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} disabled={importing} style={{ display: "none" }} />
          <Btn v="primary" disabled={importing} onClick={() => fileInput.current?.click()}>{parsed ? tx("اختيار ملف آخر", "Choose another file") : tx("اختيار ملف (.xlsx / .xls / .csv)", "Choose file (.xlsx / .xls / .csv)")}</Btn>
          {parsed && <span dir="auto" style={{ fontSize: 12.5, fontWeight: 700 }}>{parsed.fileName}</span>}
          {parsed && parsed.sheets.length > 1 && (
            <select value={sheetIdx} onChange={(e) => pickSheet(parsed, Number(e.target.value))} style={selectSx} disabled={importing}>
              {parsed.sheets.map((sh, i) => <option key={sh.name} value={i}>{sh.name} ({sh.rows.length})</option>)}
            </select>
          )}
        </div>
      )}

      {parseError && <div style={{ color: C.danger, fontSize: 12.5, marginBottom: 10 }}>{parseError}</div>}
      {notice && <div style={{ color: "#92400E", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10 }}>{notice}</div>}

      {sheet && !result && (
        <>
          {/* ── column mapping ── */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: "flex", flexDirection: "column", gap: 4 }}>
              {tx("عمود رقم التليفون (مطلوب)", "Phone column (required)")}
              <select value={mapping.phone || ""} onChange={(e) => setField("phone", e.target.value)} style={selectSx} disabled={importing}>
                <option value="">{tx("— اختر —", "— choose —")}</option>
                {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: "flex", flexDirection: "column", gap: 4 }}>
              {tx("عمود الاسم (اختياري)", "Name column (optional)")}
              <select value={mapping.name || ""} onChange={(e) => setField("name", e.target.value)} style={selectSx} disabled={importing}>
                <option value="">{tx("— بدون —", "— none —")}</option>
                {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
          </div>
          {detection && (detection.recognizedButNotStored.notes.length + detection.recognizedButNotStored.source.length + detection.recognizedButNotStored.assignedTo.length > 0) && (
            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>
              {tx("أعمدة معروفة لكن غير مخزّنة (لا يوجد لها حقل على العميل): ", "Recognized but not stored (the customer record has no field for them): ")}
              {[...detection.recognizedButNotStored.notes, ...detection.recognizedButNotStored.source, ...detection.recognizedButNotStored.assignedTo].join("، ")}
            </div>
          )}
          {sheet.headers.length > 0 && (
            <details style={{ marginBottom: 12, fontSize: 12 }} open={mapping.programs.length > 0}>
              <summary style={{ cursor: "pointer", fontWeight: 700, color: C.muted }}>
                {tx("اختياري: استخدام عمود من الملف كاهتمامات لكل صف", "Optional: use a column from the file as per-row interests")}
                {mapping.programs.length > 0 ? ` (${mapping.programs.length})` : ""}
              </summary>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                {sheet.headers.filter((h) => h !== mapping.phone && h !== mapping.name).map((h) => (
                  <label key={h} style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 600, color: C.text, cursor: "pointer" }}>
                    <input type="checkbox" checked={mapping.programs.includes(h)} onChange={() => toggleProgramColumn(h)} disabled={importing} />{h}
                  </label>
                ))}
              </div>
            </details>
          )}
          {plan && s && (
            <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 10 }} data-testid="lead-import-phone-count">
              {tx(`عدد الأرقام: ${s.validPhoneRows}`, `Phone numbers: ${s.validPhoneRows}`)}
              {s.uniquePhones !== s.validPhoneRows && <span style={{ fontWeight: 600, fontSize: 12, color: C.muted }}> {tx(`(${s.uniquePhones} رقم مختلف)`, `(${s.uniquePhones} distinct)`)}</span>}
            </div>
          )}
          <div style={{ opacity: importing ? 0.6 : 1, pointerEvents: importing ? "none" : "auto" }}>
            <InterestedProgramsPicker value={batchProgramIds} onChange={setBatchProgramIds} />
          </div>
          {batchProgramIds.length > 0 && (
            <div style={{ fontSize: 11.5, color: C.muted, margin: "-6px 0 12px" }}>
              {tx("سيتم إضافة الكورسات المختارة كاهتمامات لكل العملاء في هذا الملف (الجدد والموجودين) مع الحفاظ على اهتماماتهم الحالية.", "The selected programs are added as interests to every customer in this file (new and existing), keeping their current interests.")}
            </div>
          )}
          {!mapping.phone && (
            <div style={{ color: C.danger, fontSize: 12.5, marginBottom: 10 }}>{tx("اختر عمود رقم التليفون لعرض المعاينة — بدونه لا يمكن استيراد أي صف.", "Choose the phone column to see the preview — without it no row can be imported.")}</div>
          )}

          {/* ── preview / dry-run ── */}
          {planning && <div style={{ color: C.muted, fontSize: 12.5, marginBottom: 10 }}>{tx("جاري تحليل الملف…", "Analysing the file…")}</div>}
          {plan && s && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Badge color={C.warning}>{tx("معاينة فقط — لم يُكتب شيء", "PREVIEW ONLY — nothing written")}</Badge>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 14 }}>
                <Stat label={tx("إجمالي الصفوف", "Total rows")} value={s.totalRows} />
                <Stat label={tx("صفوف صالحة", "Valid rows")} value={s.validPhoneRows} tone={C.success} />
                <Stat label={tx("رقم تليفون ناقص", "Missing phone")} value={s.missingPhoneRows} tone={s.missingPhoneRows ? C.danger : undefined} />
                <Stat label={tx("رقم تليفون غير صالح", "Invalid phone")} value={s.invalidPhoneRows} tone={s.invalidPhoneRows ? C.danger : undefined} />
                <Stat label={tx("صفوف مكررة", "Duplicate rows")} value={s.duplicateRows} />
                <Stat label={tx("عملاء موجودون", "Existing customers")} value={s.existingCustomers} />
                <Stat label={tx("عملاء جدد", "New customers")} value={s.newCustomers} tone={C.red} />
                <Stat label={tx("عملاء بدون اسم", "Missing names")} value={s.missingNameCustomers} />
                <Stat label={tx("كورسات مطابقة", "Matched programs")} value={s.matchedProgramsDistinct} />
                <Stat label={tx("كورسات غير مطابقة", "Unmatched programs")} value={s.unmatchedProgramsDistinct} tone={s.unmatchedProgramsDistinct ? C.warning : undefined} />
                <Stat label={tx("اهتمامات جديدة", "New interests to add")} value={s.newInterests} tone={C.red} />
                <Stat label={tx("تحتاج مراجعة يدوية", "Manual review")} value={s.manualReviewRows} tone={s.manualReviewRows ? C.warning : undefined} />
              </div>

              {(() => {
                const sample = plan.rows.filter((r) => r.status === "accepted").slice(0, 8);
                if (sample.length === 0) return null;
                const outcomeLabel = { create: tx("جديد", "New"), update: tx("تحديث", "Update"), existing_unchanged: tx("موجود", "Existing"), duplicate: tx("مكرر في الملف", "Repeated in file") };
                return (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6 }}>{tx("معاينة أول الصفوف المقبولة", "Sample of the first accepted rows")}</div>
                    <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
                        <thead><tr><th style={th}>{tx("الصف", "Row")}</th><th style={th}>{tx("الاسم", "Name")}</th><th style={th}>{tx("الهاتف", "Phone")}</th><th style={th}>{tx("النتيجة", "Result")}</th></tr></thead>
                        <tbody>
                          {sample.map((r) => (
                            <tr key={r.rowNumber}>
                              <td style={td}>{r.rowNumber}</td>
                              <td style={td} dir="auto">{r.name || <span style={{ color: C.muted }}>{tx("بدون اسم", "no name")}</span>}</td>
                              <td style={td} dir="ltr">{r.phoneNormalized}</td>
                              <td style={td}>{outcomeLabel[r.outcome] || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {plan.unmatchedPrograms.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6 }}>{tx("كورسات غير موجودة في الكتالوج", "Programs not found in the catalog")}</div>
                  <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 6 }}>{tx("لن يتم إنشاء أي كورس جديد. يمكنك ربط كل اسم بكورس موجود، أو تركه ليُتخطى (يُستورد العميل بدون هذا الاهتمام).", "No program is ever created. Map each name to an existing program, or leave it to be skipped (the customer is still imported without that interest).")}</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {plan.unmatchedPrograms.map((u) => (
                      <div key={u.key} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span dir="auto" style={{ fontWeight: 700, fontSize: 12.5, minWidth: 160 }}>«{u.token}» <span style={{ color: C.muted, fontWeight: 500 }}>×{u.count}</span></span>
                        <select
                          value={tokenOverrides[u.key] || ""}
                          onChange={(e) => setTokenOverrides((o) => { const n = { ...o }; if (e.target.value) n[u.key] = e.target.value; else delete n[u.key]; return n; })}
                          style={{ ...selectSx, minWidth: 220 }} disabled={importing}
                        >
                          <option value="">{tx("— تخطّي هذا الاهتمام —", "— skip this interest —")}</option>
                          {programOptions.map((p) => <option key={p.id} value={p.id}>{p.name_en || p.name_ar}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {shownRows.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6 }}>
                    {tx(`صفوف مرفوضة أو تحتاج مراجعة (${shownRows.length})`, `Rejected / needs-review rows (${shownRows.length})`)}
                  </div>
                  <div style={{ overflowX: "auto", maxHeight: 340, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                      <thead>
                        <tr>
                          <th style={th}>{tx("الصف", "Row")}</th>
                          <th style={th}>{tx("الاسم", "Name")}</th>
                          <th style={th}>{tx("الهاتف", "Phone")}</th>
                          <th style={th}>{tx("الحالة", "Status")}</th>
                          <th style={th}>{tx("السبب", "Reason")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(showAll ? shownRows : shownRows.slice(0, ROW_PAGE)).map((r) => (
                          <tr key={r.rowNumber}>
                            <td style={td}>{r.rowNumber}</td>
                            <td style={td} dir="auto">{r.name || "—"}</td>
                            <td style={td} dir="ltr">{r.phoneRaw || tx("فارغ", "empty")}</td>
                            <td style={td}>
                              {r.status === "rejected"
                                ? <Badge color={C.danger}>{tx("مرفوض", "REJECTED")}</Badge>
                                : r.status === "skipped"
                                  ? <Badge color={C.warning}>{tx("متخطى", "SKIPPED")}</Badge>
                                  : <Badge color={C.warning}>{tx("مراجعة", "REVIEW")}</Badge>}
                            </td>
                            <td style={td}>{[...r.reasons, ...r.warnings.filter((w) => w.severity === "review")].map((x, i) => <div key={i}>{reasonText(x, tx)}</div>)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {shownRows.length > ROW_PAGE && !showAll && (
                    <Btn sm v="ghost" style={{ marginTop: 6 }} onClick={() => setShowAll(true)}>{tx(`عرض كل الصفوف (${shownRows.length})`, `Show all ${shownRows.length} rows`)}</Btn>
                  )}
                </div>
              )}

              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8 }} data-testid="lead-import-confirm-sentence">{confirmSentence}</div>
                {importing ? (
                  <div style={{ maxWidth: 420 }}>
                    <PBar value={progress.total ? Math.round((progress.done / progress.total) * 100) : 0} />
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{tx(`جاري الاستيراد… ${progress.done} / ${progress.total}`, `Importing… ${progress.done} / ${progress.total}`)}</div>
                  </div>
                ) : (
                  <Btn v="primary" disabled={!willChange || planning} onClick={doImport}>{tx("استيراد العملاء", "Import customers")}</Btn>
                )}
                {!willChange && !planning && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{tx("لا يوجد ما يمكن استيراده من هذا الملف.", "There is nothing to import from this file.")}</div>}
              </div>
            </>
          )}
        </>
      )}

      {result && (
        <div>
          {result.aborted ? (
            <div style={{ color: C.danger, fontWeight: 800, marginBottom: 8 }}>{tx("توقف الاستيراد قبل كتابة أي بيانات", "The import stopped before writing any data")}</div>
          ) : result.nothingToDo ? (
            <div style={{ fontWeight: 800, marginBottom: 8 }}>{tx("لا يوجد ما يمكن استيراده — كل العملاء والاهتمامات موجودة بالفعل.", "Nothing to import — every customer and interest already exists.")}</div>
          ) : (
            <div style={{ fontWeight: 800, marginBottom: 8, color: result.failedChunks ? "#92400E" : C.success }}>
              {result.failedChunks ? tx("اكتمل الاستيراد مع بعض الأخطاء", "Import finished with errors") : tx("تم الاستيراد بنجاح", "Import completed")}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 10 }}>
            <Stat label={tx("عملاء جدد أُضيفوا", "Customers created")} value={result.createdCustomers} tone={C.success} />
            <Stat label={tx("عملاء تم تحديثهم", "Customers updated")} value={result.updatedCustomers} />
            <Stat label={tx("اهتمامات أُضيفت", "Interests added")} value={result.addedInterests} />
            <Stat label={tx("دفعات فشلت", "Failed chunks")} value={result.failedChunks} tone={result.failedChunks ? C.danger : undefined} />
          </div>
          {result.errors?.map((e, i) => (
            <div key={i} style={{ color: C.danger, fontSize: 12 }}>{e.code}{e.from ? ` (${e.from}–${e.to})` : ""}: {e.message}</div>
          ))}
          <div style={{ marginTop: 10 }}><Btn v="ghost" onClick={reset}>{tx("استيراد ملف آخر", "Import another file")}</Btn></div>
        </div>
      )}
    </Card>
  );
}
