import { useState, useMemo } from "react";
import { Select, Btn } from "../../../../../components/UI";
import { C } from "../../../../../theme";
import { useImportProfiles } from "../../../../../context/ImportProfileContext";
import { useCatalog } from "../../../../../context/CatalogContext";
import { useLang } from "../../../../../context/LangContext";
import { useImportEngine } from "../../../../../hooks/useImportEngine";

/**
 * Business Unit -> Program -> file, in that order. The selected Program
 * becomes the destination for every row in this import run — no per-row
 * Program column needed in the spreadsheet. To import a file that covers
 * several courses, run the import once per course, picking the matching
 * Program each time.
 */
export default function UploadStep({ wiz, patch, onNext }) {
  const { activeProfiles, currentVersionOf } = useImportProfiles();
  const { businessUnits, programsUnder } = useCatalog();
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { analyzeFile } = useImportEngine();

  const [businessUnitId, setBusinessUnitId] = useState(wiz.businessUnitId || "");
  const [programId, setProgramId] = useState(wiz.program?.id || "");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const businessUnitOptions = [
    { v: "", l: tx("اختر وحدة العمل...", "Choose a Business Unit...") },
    ...businessUnits.map((bu) => ({ v: bu.id, l: ar ? bu.name_ar : bu.name_en })),
  ];

  const programs = useMemo(() => (businessUnitId ? programsUnder(businessUnitId) : []), [businessUnitId, programsUnder]);
  const programOptions = [
    { v: "", l: tx("اختر البرنامج...", "Choose a Program...") },
    ...programs.map((p) => ({ v: p.id, l: p.name_en })),
  ];

  const selectBusinessUnit = (v) => {
    setBusinessUnitId(v);
    setProgramId(""); // the previous Program likely belongs to a different Business Unit
  };

  const submit = async () => {
    setError("");
    if (!businessUnitId) { setError(tx("اختر وحدة العمل أولاً", "Choose a Business Unit first")); return; }
    if (!programId) { setError(tx("اختر البرنامج أولاً", "Choose a Program first")); return; }
    const profile = activeProfiles.find((p) => p.businessUnitId === businessUnitId);
    if (!profile) { setError(tx("لا يوجد ملف استيراد مفعّل لهذه الوحدة", "No active Import Profile for this Business Unit")); return; }
    if (!file) { setError(tx("اختر ملف Excel/CSV", "Choose an Excel/CSV file")); return; }
    setAnalyzing(true);
    try {
      const parsed = await analyzeFile(file);
      const profileVersion = currentVersionOf(profile.id);
      const program = programs.find((p) => p.id === programId);
      patch({
        businessUnitId, program, profile, profileVersion,
        parsed, selectedSheetNames: parsed.sheets.map((s) => s.name),
      });
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
      <Select label={tx("وحدة العمل", "Business Unit")} value={businessUnitId} onChange={selectBusinessUnit} options={businessUnitOptions} />
      <Select
        label={tx("البرنامج (سيتم تعيين كل الطلاب المستوردين إليه)", "Program (every imported student will be assigned here)")}
        value={programId}
        onChange={setProgramId}
        options={programOptions}
      />
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
