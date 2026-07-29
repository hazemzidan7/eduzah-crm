import { useState, useMemo } from "react";
import { Card, Btn, PBar } from "../../../../../components/UI";
import { C } from "../../../../../theme";
import { useLang } from "../../../../../context/LangContext";
import { useImportCommit } from "../../../../../hooks/useImportCommit";

function classifyRecord(record, index, wiz) {
  const requiredFields = wiz.profileVersion?.requiredFields || [];
  const missing = requiredFields.filter((f) => !record[f]);
  if (missing.length > 0) return { status: "missingRequired", detail: missing.join(", ") };

  const decision = wiz.duplicateDecisions[index];
  if (decision === "skip") return { status: "skipped", detail: null };
  if (decision === "merge") return { status: "duplicateMerge", detail: null };

  if (record.statusRaw) {
    const resolved = wiz.valueMap[`status:${record.statusRaw}`];
    if (!resolved || !resolved.targetId) return { status: "unknownValue", detail: record.statusRaw };
  }
  return { status: "ready", detail: null };
}

const STATUS_META = {
  ready: { ar: "جاهز", en: "Ready", color: C.success },
  duplicateMerge: { ar: "سيتم الدمج", en: "Will merge", color: C.pmid },
  skipped: { ar: "متخطى", en: "Skipped", color: C.muted },
  missingRequired: { ar: "حقل مطلوب ناقص", en: "Missing required field", color: C.danger },
  unknownValue: { ar: "قيمة غير محلولة", en: "Unresolved value", color: C.warning },
};

export default function ValidationSummaryStep({ wiz, onBack }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { commitImport } = useImportCommit();

  const classified = useMemo(
    () => wiz.cleanedRecords.map((r, i) => ({ record: r, index: i, ...classifyRecord(r, i, wiz) })),
    [wiz],
  );
  const counts = classified.reduce((acc, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc; }, {});
  const committable = classified.some((c) => c.status === "ready" || c.status === "duplicateMerge");

  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState(null); // {done, total}
  const [report, setReport] = useState(null); // {createdCount, updatedCount, skippedCount, errorCount}
  const [error, setError] = useState("");

  const runCommit = async () => {
    setCommitting(true);
    setError("");
    try {
      const result = await commitImport(wiz, classified, (done, total) => setProgress({ done, total }));
      setReport(result);
    } catch (e) {
      setError(e.message || tx("حدث خطأ أثناء التنفيذ", "Something went wrong during commit"));
    } finally {
      setCommitting(false);
    }
  };

  if (report) {
    return (
      <div>
        <h3 style={{ fontWeight: 800, fontSize: 15, marginTop: 0 }}>{tx("تم الاستيراد", "Import Complete")}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 16 }}>
          <Card style={{ padding: "12px 14px" }}><div style={{ fontSize: 22, fontWeight: 900, color: C.success }}>{report.createdCount}</div><div style={{ fontSize: 11.5, color: C.muted }}>{tx("منشأ", "Created")}</div></Card>
          <Card style={{ padding: "12px 14px" }}><div style={{ fontSize: 22, fontWeight: 900, color: C.pmid }}>{report.updatedCount}</div><div style={{ fontSize: 11.5, color: C.muted }}>{tx("محدّث (دمج)", "Updated (merged)")}</div></Card>
          <Card style={{ padding: "12px 14px" }}><div style={{ fontSize: 22, fontWeight: 900, color: C.muted }}>{report.skippedCount}</div><div style={{ fontSize: 11.5, color: C.muted }}>{tx("متخطى", "Skipped")}</div></Card>
          <Card style={{ padding: "12px 14px" }}><div style={{ fontSize: 22, fontWeight: 900, color: C.danger }}>{report.errorCount}</div><div style={{ fontSize: 11.5, color: C.muted }}>{tx("أخطاء", "Errors")}</div></Card>
        </div>
        <p style={{ fontSize: 12.5, color: C.muted }}>
          {tx("يمكنك مراجعة هذه العملية أو التراجع عنها لاحقاً من سجل الاستيراد.", "You can review or roll back this import later from Import History.")}
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: 15, marginTop: 0 }}>{tx("المراجعة النهائية والمعاينة", "Final Review & Preview")}</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 18 }}>
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <Card key={key} style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: meta.color }}>{counts[key] || 0}</div>
            <div style={{ fontSize: 11.5, color: C.muted }}>{ar ? meta.ar : meta.en}</div>
          </Card>
        ))}
      </div>

      <div style={{ overflowX: "auto", marginBottom: 18 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr>
              <th style={th}>{tx("الاسم", "Name")}</th>
              <th style={th}>{tx("الهاتف", "Phone")}</th>
              <th style={th}>{tx("الحالة", "Status")}</th>
              <th style={th}>{tx("التفاصيل", "Detail")}</th>
            </tr>
          </thead>
          <tbody>
            {classified.slice(0, 100).map((c) => {
              const meta = STATUS_META[c.status];
              return (
                <tr key={c.index}>
                  <td style={td}>{c.record.fullName || "—"}</td>
                  <td style={td}>{c.record.phone || "—"}</td>
                  <td style={{ ...td, color: meta.color, fontWeight: 700 }}>{ar ? meta.ar : meta.en}</td>
                  <td style={td}>{c.detail || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {classified.length > 100 && (
          <div style={{ fontSize: 11.5, color: C.muted, padding: "8px 4px" }}>
            {tx(`+ ${classified.length - 100} سجل إضافي`, `+ ${classified.length - 100} more records`)}
          </div>
        )}
      </div>

      {committing && progress && (
        <div style={{ marginBottom: 14 }}>
          <PBar value={Math.round((progress.done / progress.total) * 100)} />
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>{progress.done} / {progress.total}</div>
        </div>
      )}
      {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Btn v="purple" disabled={committing} onClick={onBack}>{tx("رجوع", "Back")}</Btn>
        <Btn v="primary" disabled={committing || !committable} onClick={runCommit}>
          {committing ? tx("جاري التنفيذ…", "Committing…") : tx("تنفيذ الاستيراد", "Commit Import")}
        </Btn>
      </div>
    </div>
  );
}

const th = { textAlign: "center", fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: "rgba(255,255,255,.88)", fontWeight: 800, padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,.14)" };
const td = { padding: "9px 12px", fontSize: 12.5, textAlign: "center", borderBottom: "1px solid rgba(255,255,255,.09)" };
