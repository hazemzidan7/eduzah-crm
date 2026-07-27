import { useState } from "react";
import { Card } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useImportProfiles } from "../../../../context/ImportProfileContext";
import UploadStep from "./steps/UploadStep";
import SheetSelectStep from "./steps/SheetSelectStep";
import ColumnMappingStep from "./steps/ColumnMappingStep";
import ValueMappingStep from "./steps/ValueMappingStep";
import DuplicateReviewStep from "./steps/DuplicateReviewStep";
import ValidationSummaryStep from "./steps/ValidationSummaryStep";

const STEP_KEYS = ["upload", "sheets", "columns", "values", "duplicates", "summary"];

/**
 * Always run from inside a Program's workspace now — `program` is required
 * and fully determines the Business Unit and Import Profile, so nothing
 * upstream of "pick a file" needs asking.
 */
export default function ImportWizard({ program }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { activeProfiles, currentVersionOf } = useImportProfiles();

  const businessUnitId = program.path?.[0] || null;
  const profile = activeProfiles.find((p) => p.businessUnitId === businessUnitId);
  const profileVersion = profile ? currentVersionOf(profile.id) : null;

  const [step, setStep] = useState(0);
  const [wiz, setWiz] = useState({
    businessUnitId, program, profile, profileVersion,
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

  if (!profile) {
    return (
      <Card style={{ padding: 24, textAlign: "center" }}>
        <div style={{ color: C.muted, fontSize: 12.5 }}>
          {tx("لا يوجد ملف استيراد مفعّل لوحدة العمل هذه.", "No active Import Profile for this Business Unit.")}
        </div>
      </Card>
    );
  }

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
        {step === 5 && <ValidationSummaryStep wiz={wiz} onBack={() => goTo(4)} />}
      </Card>
    </div>
  );
}
