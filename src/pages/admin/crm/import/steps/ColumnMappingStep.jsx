import { useState, useMemo } from "react";
import { Select, Btn } from "../../../../../components/UI";
import { C } from "../../../../../theme";
import { useLang } from "../../../../../context/LangContext";
import { useCustomFields } from "../../../../../context/CustomFieldContext";
import { useDictionary } from "../../../../../context/DictionaryContext";
import { useImportEngine } from "../../../../../hooks/useImportEngine";
import { CANONICAL_FIELDS, canonicalFieldLabel } from "../../../../../constants/importCanonicalFields";

const SOURCE_LABEL = {
  dictionary: { ar: "معروف (من القاموس)", en: "Known (dictionary)", color: "#34d399" },
  fuzzy: { ar: "مقترح", en: "Suggested", color: "#fbbf24" },
  unknown: { ar: "غير معروف", en: "Unknown", color: "#f87171" },
};

export default function ColumnMappingStep({ wiz, patch, onNext, onBack }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { fieldDefsForBusinessUnit } = useCustomFields();
  const { recordMapping } = useDictionary();
  const { recognizeColumn, cleanRecord } = useImportEngine();

  const customFields = fieldDefsForBusinessUnit(wiz.profile.businessUnitId);
  const fieldOptions = [
    { v: "", l: tx("— تجاهل هذا العمود —", "— Ignore this column —") },
    ...CANONICAL_FIELDS.map((f) => ({ v: f.key, l: ar ? f.label_ar : f.label_en })),
    ...customFields.map((f) => ({ v: f.key, l: ar ? f.label_ar : f.label_en })),
  ];

  const initial = useMemo(() => {
    const map = {};
    const meta = {};
    for (const h of wiz.headers) {
      const rec = recognizeColumn(h, wiz.profile.businessUnitId);
      map[h] = rec.field || "";
      meta[h] = rec;
    }
    return { map, meta };
  }, [wiz.headers, wiz.profile.businessUnitId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [columnMap, setColumnMap] = useState(initial.map);
  const [remember, setRemember] = useState({});

  const requiredFields = wiz.profileVersion?.requiredFields || [];
  const mappedFieldKeys = new Set(Object.values(columnMap).filter(Boolean));
  const missingRequired = requiredFields.filter((f) => !mappedFieldKeys.has(f));

  const continueNext = async () => {
    for (const [header, fieldKey] of Object.entries(columnMap)) {
      if (fieldKey && remember[header] && initial.meta[header]?.source !== "dictionary") {
        await recordMapping({ dictionaryType: "column", rawValue: header, targetType: "canonicalField", targetId: fieldKey });
      }
    }
    const cleanedRecords = wiz.rawRows.map((row) => ({ ...cleanRecord(row, columnMap), __sourceSheet: row.__sourceSheet }));
    patch({ columnMap, cleanedRecords });
    onNext();
  };

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: 15, marginTop: 0 }}>{tx("مطابقة الأعمدة", "Column Mapping")}</h3>
      {missingRequired.length > 0 && (
        <div style={{ background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.35)", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, marginBottom: 14, color: "#fecaca" }}>
          {tx("حقول مطلوبة غير مربوطة بعد: ", "Required fields not mapped yet: ")}
          {missingRequired.map((f) => canonicalFieldLabel(f, lang)).join("، ")}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {wiz.headers.map((h) => {
          const meta = initial.meta[h];
          const src = SOURCE_LABEL[meta?.source || "unknown"];
          return (
            <div key={h} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,.04)", borderRadius: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{h}</div>
              <Select value={columnMap[h] || ""} onChange={(v) => setColumnMap((p) => ({ ...p, [h]: v }))} options={fieldOptions} />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: src.color }}>{ar ? src.ar : src.en}</span>
                {meta?.source !== "dictionary" && columnMap[h] && (
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: C.muted, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!remember[h]} onChange={(e) => setRemember((p) => ({ ...p, [h]: e.target.checked }))} />
                    {tx("تذكر", "Remember")}
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn v="purple" onClick={onBack}>{tx("رجوع", "Back")}</Btn>
        <Btn v="primary" disabled={missingRequired.length > 0} onClick={continueNext}>{tx("التالي", "Next")}</Btn>
      </div>
    </div>
  );
}
