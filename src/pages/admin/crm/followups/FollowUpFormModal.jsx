import { useState } from "react";
import { Modal, Input, Select, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useAuth } from "../../../../context/AuthContext";
import { useFollowUps } from "../../../../context/FollowUpContext";
import { buildDueAt, splitDueAt } from "../../../../utils/followUps";

/**
 * CRM-05 — Create (from an Engagement's own detail view) or Edit (from the
 * Follow-ups list) one follow-up. customerId/engagementId are always fixed
 * by context and never re-picked here: create mode requires `engagement`,
 * edit mode requires `followUp`. Student/program are shown read-only either
 * way — the form only asks for Date / Time / Note / Assigned Sales, per spec.
 */
export default function FollowUpFormModal({ engagement, followUp, studentName, studentPhone, programLabel, ar, tx, onClose }) {
  const { users, currentUser } = useAuth();
  const { addFollowUp, updateFollowUp } = useFollowUps();
  const admins = users.filter((u) => u.role === "admin");
  const isEdit = !!followUp;

  const initialSplit = isEdit ? splitDueAt(followUp.dueAt) : { date: "", time: "17:00" };
  const [date, setDate] = useState(initialSplit.date);
  const [time, setTime] = useState(initialSplit.time || "17:00");
  const [note, setNote] = useState(isEdit ? (followUp.note || "") : "");
  const [assignedTo, setAssignedTo] = useState(isEdit ? (followUp.assignedTo || "") : (engagement?.ownerId || currentUser?.id || ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const assigneeOptions = [
    { v: "", l: tx("غير معيّن", "Unassigned") },
    ...admins.map((a) => ({ v: a.id, l: a.name || a.email })),
  ];

  const submit = async () => {
    const dueAt = buildDueAt(date, time);
    if (!dueAt) { setError(tx("اختر تاريخًا صحيحًا", "Pick a valid date")); return; }
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await updateFollowUp(followUp.id, { dueAt, note, assignedTo: assignedTo || null });
      } else {
        // CRM-05 FINALIZATION — this create path only runs from
        // EngagementDetailModal (admin-only), which always has the live
        // customer/engagement in hand; snapshot it onto the doc so a
        // Sales-role viewer (no customers/engagements read access) can still
        // see who this is for. See utils/followUps.buildFollowUp.
        await addFollowUp({
          customerId: engagement.customerId, engagementId: engagement.id, dueAt, note, assignedTo: assignedTo || null,
          customerName: studentName || null, customerPhone: studentPhone || null, programLabel: programLabel || null,
        });
      }
      onClose();
    } catch (_err) {
      setError(tx("تعذّر الحفظ", "Couldn't save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? tx("تعديل المتابعة", "Edit Follow-up") : tx("إضافة متابعة", "Add Follow-up")} onClose={onClose}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
        {studentName || tx("—", "—")}{programLabel ? <> · <span dir="ltr">{programLabel}</span></> : ""}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <Input label={tx("التاريخ", "Date")} type="date" value={date} onChange={setDate} />
        <Input label={tx("الوقت", "Time")} type="time" value={time} onChange={setTime} />
      </div>
      <Select label={tx("الموظف المسؤول", "Assigned Sales")} value={assignedTo} onChange={setAssignedTo} options={assigneeOptions} />
      <Input
        label={tx("ملاحظة", "Note")}
        value={note}
        onChange={setNote}
        rows={3}
        placeholder={tx("مثال: الطالب قال هيفكر ويرد بكرة", "e.g. Student said he will think and respond tomorrow")}
      />
      {error && <div style={{ fontSize: 12, color: C.danger, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <Btn v="purple" onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
        <Btn v="primary" disabled={saving || !date} onClick={submit}>{tx("حفظ", "Save")}</Btn>
      </div>
    </Modal>
  );
}
