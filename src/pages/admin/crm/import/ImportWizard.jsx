import { useState } from "react";
import { Card } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import UploadStep from "./steps/UploadStep";
import SheetSelectStep from "./steps/SheetSelectStep";
import ColumnMappingStep from "./steps/ColumnMappingStep";
import ValueMappingStep from "./steps/ValueMappingStep";
import DuplicateReviewStep from "./steps/DuplicateReviewStep";
import ValidationSummaryStep from "./steps/ValidationSummaryStep";

const STEP_KEYS = ["upload", "sheets", "columns", "values", "duplicates", "summary"];

export default function ImportWizard() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);

  const [step, setStep] = useState(0);
  const [wiz, setWiz] = useState({
    profile: null, profileVersion: null,
    parsed: null, selectedSheetNames: [],
    rawRows: [], headers: [],
    columnMap: {}, cleanedRecords: [],
    valueMap: {}, duplicateDecisions: {},
  });

  const patch = (p) => setWiz((prev) => ({ ...prev, ...p }));
  const goTo = (i) => setStep(Math.max(0, Math.min(STEP_KEYS.length - 1, i)));

  const STEP_LABELS = [
    tx("الرفع", "Upload"), tx("الأوراق", "Sheets"), tx("الأعمدة", "Columns"),
    tx("القيم", "Values"), tx("التكرارات", "Duplicates"), tx("المراجعة النهائية", "Summary"),
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {STEP_LABELS.map((label, i) => (
          <div key={i} style={{
            padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: i === step ? C.red : i < step ? "rgba(52,211,153,.15)" : "rgba(255,255,255,.06)",
            color: i === step ? "#fff" : i < step ? C.success : C.muted,
          }}>
            {i + 1}. {label}
          </div>
        ))}
      </div>

      <Card style={{ padding: 20 }}>
        {step === 0 && <UploadStep wiz={wiz} patch={patch} onNext={() => goTo(1)} />}
        {step === 1 && <SheetSelectStep wiz={wiz} patch={patch} onNext={() => goTo(2)} onBack={() => goTo(0)} />}
        {step === 2 && <ColumnMappingStep wiz={wiz} patch={patch} onNext={() => goTo(3)} onBack={() => goTo(1)} />}
        {step === 3 && <ValueMappingStep wiz={wiz} patch={patch} onNext={() => goTo(4)} onBack={() => goTo(2)} />}
        {step === 4 && <DuplicateReviewStep wiz={wiz} patch={patch} onNext={() => goTo(5)} onBack={() => goTo(3)} />}
        {step === 5 && <ValidationSummaryStep wiz={wiz} patch={patch} onBack={() => goTo(4)} />}
      </Card>
    </div>
  );
}
