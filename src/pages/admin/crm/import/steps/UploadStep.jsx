import { useState } from "react";
import { Select, Btn } from "../../../../../components/UI";
import { C } from "../../../../../theme";
import { useImportProfiles } from "../../../../../context/ImportProfileContext";
import { useCatalog } from "../../../../../context/CatalogContext";
import { useLang } from "../../../../../context/LangContext";
import { useImportEngine } from "../../../../../hooks/useImportEngine";

export default function UploadStep({ wiz, patch, onNext }) {
  const { activeProfiles, currentVersionOf } = useImportProfiles();
  const { nodeById } = useCatalog();
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { analyzeFile } = useImportEngine();

  const [profileId, setProfileId] = useState(wiz.profile?.id || "");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const profileOptions = [
    { v: "", l: tx("اختر ملف استيراد...", "Choose an Import Profile...") },
    ...activeProfiles.map((p) => ({ v: p.id, l: `${p.name} (${ar ? (nodeById(p.businessUnitId)?.name_ar) : (nodeById(p.businessUnitId)?.name_en)})` })),
  ];

  const submit = async () => {
    setError("");
    if (!profileId) { setError(tx("اختر ملف استيراد أولاً", "Choose an Import Profile first")); return; }
    if (!file) { setError(tx("اختر ملف Excel/CSV", "Choose an Excel/CSV file")); return; }
    setAnalyzing(true);
    try {
      const parsed = await analyzeFile(file);
      const profile = activeProfiles.find((p) => p.id === profileId);
      const profileVersion = currentVersionOf(profileId);
      patch({ profile, profileVersion, parsed, selectedSheetNames: parsed.sheets.map((s) => s.name) });
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
      <Select label={tx("ملف الاستيراد (Import Profile)", "Import Profile")} value={profileId} onChange={setProfileId} options={profileOptions} />
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
