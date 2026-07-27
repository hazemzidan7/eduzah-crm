import { useState, useMemo } from "react";
import { Select, Btn, Card } from "../../../../../components/UI";
import { C } from "../../../../../theme";
import { useLang } from "../../../../../context/LangContext";
import { useLeadStatus } from "../../../../../context/LeadStatusContext";
import { useDictionary } from "../../../../../context/DictionaryContext";
import { useImportEngine } from "../../../../../hooks/useImportEngine";

/**
 * Resolves raw "statusRaw" column values to real Lead Statuses. Program is
 * no longer resolved here — it's picked once in the Upload step and applies
 * to every row in the import run (see UploadStep.jsx).
 */
export default function ValueMappingStep({ wiz, patch, onNext, onBack }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { effectiveStatuses } = useLeadStatus();
  const { recordMapping } = useDictionary();
  const { recognizeValue } = useImportEngine();

  const businessUnitId = wiz.profile.businessUnitId;

  const items = useMemo(() => {
    const distinctValues = [...new Set(wiz.cleanedRecords.map((r) => r.statusRaw).filter(Boolean))];
    return distinctValues.map((raw) => ({ raw, ...recognizeValue("status", raw, businessUnitId) }));
  }, [wiz.cleanedRecords]); // eslint-disable-line react-hooks/exhaustive-deps

  const [resolutions, setResolutions] = useState(() => {
    const init = {};
    for (const item of items) init[item.raw] = item.targetId || "";
    return init;
  });
  const [remember, setRemember] = useState({});

  const statusOptions = [
    { v: "", l: tx("— بدون —", "— None —") },
    ...effectiveStatuses(businessUnitId).map((s) => ({ v: s.id, l: ar ? s.name_ar : s.name_en })),
  ];

  const allResolved = items.every((item) => resolutions[item.raw]);

  const continueNext = async () => {
    const valueMap = {};
    for (const item of items) {
      const targetId = resolutions[item.raw];
      valueMap[`status:${item.raw}`] = { targetType: "leadStatusId", targetId };
      if (targetId && remember[item.raw] && item.source !== "dictionary") {
        await recordMapping({ dictionaryType: "status", rawValue: item.raw, targetType: "leadStatusId", targetId, businessUnitId });
      }
    }
    patch({ valueMap });
    onNext();
  };

  if (items.length === 0) {
    return (
      <div>
        <h3 style={{ fontWeight: 800, fontSize: 15, marginTop: 0 }}>{tx("مطابقة القيم", "Value Mapping")}</h3>
        <Card style={{ padding: 20, textAlign: "center", marginBottom: 16 }}>
          <div style={{ color: C.muted, fontSize: 12.5 }}>{tx("لا يوجد عمود حالة لمطابقته", "No status column to map")}</div>
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
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8, textTransform: "uppercase" }}>
          {tx("قيم الحالة", "Status values")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item) => (
            <div key={item.raw} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,.04)", borderRadius: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{item.raw}</div>
              <Select value={resolutions[item.raw] || ""} onChange={(v) => setResolutions((p) => ({ ...p, [item.raw]: v }))} options={statusOptions} />
              {item.source !== "dictionary" && resolutions[item.raw] && (
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: C.muted, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!remember[item.raw]} onChange={(e) => setRemember((p) => ({ ...p, [item.raw]: e.target.checked }))} />
                  {tx("تذكر", "Remember")}
                </label>
              )}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn v="ghost" onClick={onBack}>{tx("رجوع", "Back")}</Btn>
        <Btn v="primary" disabled={!allResolved} onClick={continueNext}>{tx("التالي", "Next")}</Btn>
      </div>
    </div>
  );
}
