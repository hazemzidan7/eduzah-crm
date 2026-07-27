import { useState } from "react";
import { Btn } from "../../../../../components/UI";
import { C } from "../../../../../theme";
import { useLang } from "../../../../../context/LangContext";
import { useImportEngine } from "../../../../../hooks/useImportEngine";

/**
 * The destination Program is already known (the wizard only ever runs from
 * inside that Program's workspace now) — nothing to pick here but the file.
 */
export default function UploadStep({ wiz, patch, onNext }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { analyzeFile } = useImportEngine();

  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const submit = async () => {
    setError("");
    if (!file) { setError(tx("اختر ملف Excel/CSV", "Choose an Excel/CSV file")); return; }
    setAnalyzing(true);
    try {
      const parsed = await analyzeFile(file);
      patch({ parsed, selectedSheetNames: parsed.sheets.map((s) => s.name) });
      onNext();
    } catch (e) {
      setError(e.message || tx("تعذرت قراءة الملف", "Could not read the file"));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: 15, marginTop: 0 }}>{tx("رفع ملف", "Upload a file")}</h3>
      <div style={{ background: "rgba(255,255,255,.04)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12.5, color: C.muted }}>
        {tx("سيتم تعيين كل الطلاب المستوردين إلى ", "Every imported student will be assigned to ")}
        <strong style={{ color: "#fff" }}>{wiz.program.name_en}</strong>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>
          {tx("ملف Excel أو CSV", "Excel or CSV file")}
        </label>
        <input
          type="file" accept=".xlsx,.xls,.csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          style={{ color: "#fff", fontFamily: "'Cairo',sans-serif", fontSize: 12.5 }}
        />
      </div>
      {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <Btn v="primary" disabled={analyzing} onClick={submit}>
        {analyzing ? tx("جاري التحليل…", "Analyzing…") : tx("تحليل الملف", "Analyze File")}
      </Btn>
    </div>
  );
}
