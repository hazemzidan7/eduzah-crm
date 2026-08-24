import { useState } from "react";
import { Modal, Input, Select, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useAuth } from "../../../../context/AuthContext";
import { useFollowUps } from "../../../../context/FollowUpContext";
import { buildDueAt } from "../../../../utils/followUps";

/**
 * CRM-05 — Completing a follow-up always asks for a Result/Note first
 * (required, not optional), then offers an optional "create next follow-up"
 * step that adds a brand-new chained follow-up doc — the just-completed one
 * is never rewritten, per spec.
 */
export default function CompleteFollowUpModal({ followUp, studentName, programLabel, ar, tx, onClose }) {
  const { users } = useAuth();
  const { completeFollowUp } = useFollowUps();
  const admins = users.filter((u) => u.role === "admin");

  const [result, setResult] = useState("");
  const [addNext, setAddNext] = useState(false);
  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("17:00");
  const [nextNote, setNextNote] = useState("");
  const [nextAssignedTo, setNextAssignedTo] = useState(followUp.assignedTo || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const assigneeOptions = [
    { v: "", l: tx("غير معيّن", "Unassigned") },
    ...admins.map((a) => ({ v: a.id, l: a.name || a.email })),
  ];

  const submit = async () => {
    if (!result.trim()) { setError(tx("اكتب نتيجة المتابعة", "Enter a result")); return; }
    let nextFollowUp = null;
    if (addNext) {
      const dueAt = buildDueAt(nextDate, nextTime);
      if (!dueAt) { setError(tx("اختر تاريخًا صحيحًا للمتابعة القادمة", "Pick a valid date for the next follow-up")); return; }
      nextFollowUp = { dueAt, note: nextNote, assignedTo: nextAssignedTo || null };
    }
    setSaving(true);
    setError("");
    try {
      await completeFollowUp(followUp.id, { result: result.trim(), nextFollowUp });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={tx("إكمال المتابعة", "Complete Follow-up")} onClose={onClose}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
        {studentName || tx("—", "—")}{programLabel ? <> · <span dir="ltr">{programLabel}</span></> : ""}
      </div>
      <Input
        label={tx("النتيجة / ملاحظة", "Result / Note")}
        value={result}
        onChange={setResult}
        rows={3}
        placeholder={tx("تم التواصل — الطالب مهتم وطلب الاتصال يوم الخميس.", "Contacted — student is interested and asked to call Thursday.")}
      />

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: C.muted, margin: "4px 0 14px", cursor: "pointer" }}>
        <input type="checkbox" checked={addNext} onChange={(e) => setAddNext(e.target.checked)} />
        {tx("إنشاء متابعة قادمة", "Create next follow-up")}
      </label>

      {addNext && (
        <div style={{ padding: 12, borderRadius: 10, background: "rgba(255,255,255,.04)", marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            <Input label={tx("التاريخ", "Date")} type="date" value={nextDate} onChange={setNextDate} />
            <Input label={tx("الوقت", "Time")} type="time" value={nextTime} onChange={setNextTime} />
          </div>
          <Select label={tx("الموظف المسؤول", "Assigned Sales")} value={nextAssignedTo} onChange={setNextAssignedTo} options={assigneeOptions} />
          <Input label={tx("ملاحظة", "Note")} value={nextNote} onChange={setNextNote} rows={2} />
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: C.danger, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <Btn v="purple" onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
        <Btn v="primary" disabled={saving || !result.trim() || (addNext && !nextDate)} onClick={submit}>{tx("إكمال", "Complete")}</Btn>
      </div>
    </Modal>
  );
}
