import { useState, useMemo } from "react";
import { Select, Btn, Card } from "../../../../../components/UI";
import { C } from "../../../../../theme";
import { useLang } from "../../../../../context/LangContext";
import { useLeadStatus } from "../../../../../context/LeadStatusContext";
import { useCatalog } from "../../../../../context/CatalogContext";
import { useDictionary } from "../../../../../context/DictionaryContext";
import { useImportEngine } from "../../../../../hooks/useImportEngine";

// Only fields with a real Firestore target (status/program) get reviewed here —
// descriptive fields (university/city/...) are cleaned text, not ID-mapped, in this sub-phase.
const DICTIONARY_FIELDS = [
  { field: "statusRaw", dictionaryType: "status" },
  { field: "programRaw", dictionaryType: "program" },
];

export default function ValueMappingStep({ wiz, patch, onNext, onBack }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { effectiveStatuses } = useLeadStatus();
  const { descendantsOf } = useCatalog();
  const { recordMapping } = useDictionary();
  const { recognizeValue } = useImportEngine();

  const businessUnitId = wiz.profile.businessUnitId;

  const groups = useMemo(() => {
    return DICTIONARY_FIELDS
      .filter(({ field }) => wiz.cleanedRecords.some((r) => r[field]))
      .map(({ field, dictionaryType }) => {
        const distinctValues = [...new Set(wiz.cleanedRecords.map((r) => r[field]).filter(Boolean))];
        const items = distinctValues.map((raw) => ({ raw, ...recognizeValue(dictionaryType, raw, businessUnitId) }));
        return { field, dictionaryType, items };
      });
  }, [wiz.cleanedRecords]); // eslint-disable-line react-hooks/exhaustive-deps

  const [resolutions, setResolutions] = useState(() => {
    const init = {};
    for (const g of groups) for (const item of g.items) {
      init[`${g.dictionaryType}:${item.raw}`] = item.targetId || "";
    }
    return init;
  });
  const [remember, setRemember] = useState({});

  const optionsFor = (dictionaryType) => {
    if (dictionaryType === "status") {
      return [
        { v: "", l: tx("— بدون —", "— None —") },
        ...effectiveStatuses(businessUnitId).map((s) => ({ v: s.id, l: ar ? s.name_ar : s.name_en })),
      ];
    }
    return [
      { v: "", l: tx("— بدون —", "— None —") },
      ...descendantsOf(businessUnitId).map((n) => ({ v: n.id, l: ar ? n.name_ar : n.name_en })),
    ];
  };

  const allResolved = groups.every((g) => g.items.every((item) => resolutions[`${g.dictionaryType}:${item.raw}`]));

  const continueNext = async () => {
    const valueMap = {};
    for (const g of groups) {
      for (const item of g.items) {
        const key = `${g.dictionaryType}:${item.raw}`;
        const targetId = resolutions[key];
        valueMap[key] = { targetType: g.dictionaryType === "status" ? "leadStatusId" : "catalogNodeId", targetId };
        if (targetId && remember[key] && item.source !== "dictionary") {
          await recordMapping({ dictionaryType: g.dictionaryType, rawValue: item.raw, targetType: valueMap[key].targetType, targetId, businessUnitId: g.dictionaryType === "status" ? businessUnitId : null });
        }
      }
    }
    patch({ valueMap });
    onNext();
  };

  if (groups.length === 0) {
    return (
      <div>
        <h3 style={{ fontWeight: 800, fontSize: 15, marginTop: 0 }}>{tx("مطابقة القيم", "Value Mapping")}</h3>
        <Card style={{ padding: 20, textAlign: "center", marginBottom: 16 }}>
          <div style={{ color: C.muted, fontSize: 12.5 }}>{tx("لا يوجد أعمدة حالة أو برنامج لمطابقتها", "No status/program columns to map")}</div>
        </Card>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn v="ghost" onClick={onBack}>{tx("رجوع", "Back")}</Btn>
          <Btn v="primary" onClick={() => { patch({ valueMap: {} }); onNext(); }}>{tx("التالي", "Next")}</Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: 15, marginTop: 0 }}>{tx("مطابقة القيم", "Value Mapping")}</h3>
      {groups.map((g) => (
        <div key={g.field} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8, textTransform: "uppercase" }}>
            {g.dictionaryType === "status" ? tx("قيم الحالة", "Status values") : tx("قيم البرنامج", "Program values")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {g.items.map((item) => {
              const key = `${g.dictionaryType}:${item.raw}`;
              return (
                <div key={key} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,.04)", borderRadius: 10 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{item.raw}</div>
                  <Select value={resolutions[key] || ""} onChange={(v) => setResolutions((p) => ({ ...p, [key]: v }))} options={optionsFor(g.dictionaryType)} />
                  {item.source !== "dictionary" && resolutions[key] && (
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: C.muted, cursor: "pointer" }}>
                      <input type="checkbox" checked={!!remember[key]} onChange={(e) => setRemember((p) => ({ ...p, [key]: e.target.checked }))} />
                      {tx("تذكر", "Remember")}
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <Btn v="ghost" onClick={onBack}>{tx("رجوع", "Back")}</Btn>
        <Btn v="primary" disabled={!allResolved} onClick={continueNext}>{tx("التالي", "Next")}</Btn>
      </div>
    </div>
  );
}
