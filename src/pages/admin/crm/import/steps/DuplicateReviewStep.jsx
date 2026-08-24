import { useState, useMemo } from "react";
import { Btn, Card } from "../../../../../components/UI";
import { C } from "../../../../../theme";
import { useLang } from "../../../../../context/LangContext";
import { useImportEngine } from "../../../../../hooks/useImportEngine";

const DECISION_OPTIONS = [
  { v: "merge", ar: "دمج مع الموجود", en: "Merge with existing" },
  { v: "createNew", ar: "إنشاء سجل جديد", en: "Create new anyway" },
  { v: "skip", ar: "تخطي", en: "Skip" },
];

export default function DuplicateReviewStep({ wiz, patch, onNext, onBack }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { findDuplicatesWithinBatch, findDuplicateAgainstCrm } = useImportEngine();

  const programId = wiz.program.id;

  const withinBatch = useMemo(() => findDuplicatesWithinBatch(wiz.cleanedRecords), [wiz.cleanedRecords]); // eslint-disable-line react-hooks/exhaustive-deps
  const withinBatchDupeIndexes = new Set(withinBatch.flatMap((g) => g.recordIndexes.slice(1)));

  const crmMatches = useMemo(() => wiz.cleanedRecords.map((r, i) => {
    if (withinBatchDupeIndexes.has(i)) return null; // already flagged as an in-file duplicate
    const { customerMatch, engagementMatch } = findDuplicateAgainstCrm(r, programId);
    return customerMatch ? { index: i, record: r, customerMatch, engagementMatch } : null;
  }).filter(Boolean), [wiz.cleanedRecords]); // eslint-disable-line react-hooks/exhaustive-deps

  const [decisions, setDecisions] = useState(() => {
    const init = {};
    withinBatch.forEach((g) => g.recordIndexes.slice(1).forEach((i) => { init[i] = "skip"; }));
    crmMatches.forEach((m) => { init[m.index] = m.engagementMatch ? "merge" : "createNew"; });
    return init;
  });

  const setDecision = (idx, v) => setDecisions((p) => ({ ...p, [idx]: v }));

  const continueNext = () => {
    patch({ duplicateDecisions: decisions });
    onNext();
  };

  const hasNone = withinBatch.length === 0 && crmMatches.length === 0;

  return (
    <div>
      <h3 style={{ fontWeight: 800, fontSize: 15, marginTop: 0 }}>{tx("مراجعة التكرارات", "Duplicate Review")}</h3>

      {hasNone && (
        <Card style={{ padding: 20, textAlign: "center", marginBottom: 16 }}>
          <div style={{ color: C.muted, fontSize: 12.5 }}>{tx("لم يتم العثور على تكرارات", "No duplicates found")}</div>
        </Card>
      )}

      {withinBatch.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8, textTransform: "uppercase" }}>
            {tx("تكرارات داخل نفس الملف", "Duplicates within this file")}
          </div>
          {withinBatch.map((g) => (
            <Card key={g.phone} style={{ padding: "10px 14px", marginBottom: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{g.phone}</div>
              {g.recordIndexes.map((i, gi) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 12 }}>
                  <span>{wiz.cleanedRecords[i].fullName || "—"} {gi === 0 && <span style={{ color: C.success }}>({tx("الأساسي", "primary")})</span>}</span>
                  {gi > 0 && (
                    <select value={decisions[i] || "skip"} onChange={(e) => setDecision(i, e.target.value)}
                      style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 11, padding: "2px 6px" }}>
                      {DECISION_OPTIONS.map((o) => <option key={o.v} value={o.v}>{ar ? o.ar : o.en}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}

      {crmMatches.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8, textTransform: "uppercase" }}>
            {tx("مطابقات مع عملاء موجودين", "Matches against existing customers")}
          </div>
          {crmMatches.map((m) => (
            <Card key={m.index} style={{ padding: "10px 14px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 12.5 }}>
                  <b>{m.record.fullName || "—"}</b> (<bdi dir="ltr">{m.record.phone}</bdi>) → {tx("يطابق", "matches")} <b>{m.customerMatch.fullName}</b>
                  {m.engagementMatch && <span style={{ color: C.orange }}> · {tx("لديه تعامل بالفعل مع هذا البرنامج", "already has an engagement with this Program")}</span>}
                </div>
                <select value={decisions[m.index] || "merge"} onChange={(e) => setDecision(m.index, e.target.value)}
                  style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 11, padding: "2px 6px" }}>
                  {DECISION_OPTIONS.map((o) => <option key={o.v} value={o.v}>{ar ? o.ar : o.en}</option>)}
                </select>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Btn v="purple" onClick={onBack}>{tx("رجوع", "Back")}</Btn>
        <Btn v="primary" onClick={continueNext}>{tx("التالي", "Next")}</Btn>
      </div>
    </div>
  );
}
