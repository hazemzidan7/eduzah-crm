import { useState } from "react";
import { Modal, Input, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import ProgramSelect from "../../../../components/crm/ProgramSelect";
import { useNewCustomerWorkflow } from "../../../../hooks/useNewCustomerWorkflow";
import { FOLLOW_UP_STATUS_KEYS, PROGRAM_REQUIRED_STATUS_KEY, REGISTERED_STATUS_KEY } from "../../../../utils/newCustomerWorkflow";
import { workflowErrorText } from "./EditNewCustomerModal";

const selectSx = { width: "100%", boxSizing: "border-box", background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", fontFamily: "'Cairo',sans-serif", fontSize: 13, outline: "none", cursor: "pointer" };

/**
 * "تسجيل متابعة" — record what happened when Sales contacted the customer.
 * The outcomes are the existing lead statuses (see utils/newCustomerWorkflow.js
 * for the mapping). Recording an outcome NEVER creates an Engagement:
 *  - لم يتم التواصل / لم يرد / هيفكر / مهتم / مش مهتم just update the status;
 *  - هيحجز additionally REQUIRES the actual Program (an existing catalog Program);
 *  - حجز بالفعل is only reachable by registering the customer, so choosing it
 *    hands over to "تسجيل العميل".
 * For لم يرد / هيفكر / مهتم the existing follow-up form can be opened right after saving.
 */
export default function ContactOutcomeModal({ customer, onClose, onRegister, onScheduleFollowUp }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { statusOptions, statusKeyOf, recordContactOutcome } = useNewCustomerWorkflow();

  const currentKey = statusKeyOf(customer);
  const [statusKey, setStatusKey] = useState(currentKey);
  const [plannedProgramId, setPlannedProgramId] = useState(customer.plannedProgramId || "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const labelOf = (o) => (o.status ? (ar ? o.status.name_ar : o.status.name_en) : o.key);
  const needsProgram = statusKey === PROGRAM_REQUIRED_STATUS_KEY;
  const isRegistered = statusKey === REGISTERED_STATUS_KEY;
  const canFollowUp = FOLLOW_UP_STATUS_KEYS.includes(statusKey);

  const save = async (thenFollowUp) => {
    setError("");
    setSaving(true);
    try {
      await recordContactOutcome(customer, { statusKey, plannedProgramId, note });
      onClose();
      if (thenFollowUp) onScheduleFollowUp?.(customer.id);
    } catch (e) {
      setError(workflowErrorText(e, tx));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={tx("تسجيل متابعة", "Record Contact")} onClose={onClose}>
      <div style={{ fontSize: 12.5, marginBottom: 12, color: C.muted }}>
        <b style={{ color: C.text }}>{customer.fullName || tx("بدون اسم", "No name")}</b> · <span dir="ltr">{customer.phone}</span>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 4 }}>{tx("نتيجة التواصل", "Contact result")}</label>
        <select value={statusKey} onChange={(e) => setStatusKey(e.target.value)} style={selectSx}>
          {statusOptions.map((o) => (
            <option key={o.key} value={o.key} disabled={!o.status}>
              {labelOf(o)}{!o.status ? ` — ${tx("غير مفعّلة بعد", "not enabled yet")}` : ""}
            </option>
          ))}
        </select>
        {statusOptions.some((o) => !o.status) && (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
            {tx("الحالات غير المفعّلة بتظهر بعد ما أدمن يفتح النظام مرة واحدة.", "Statuses marked “not enabled yet” appear once an admin has opened the CRM.")}
          </div>
        )}
      </div>

      {needsProgram && (
        <ProgramSelect
          ar={ar}
          label={tx("الكورس اللي هيحجز فيه (مطلوب)", "Program the customer will register in (required)")}
          value={plannedProgramId}
          onChange={setPlannedProgramId}
          invalid={!plannedProgramId}
        />
      )}

      {isRegistered ? (
        <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, marginBottom: 14 }}>
          {tx("«حجز بالفعل» معناها العميل اتسجّل في كورس فعلي. اختار الكورس وأكّد التسجيل من «تسجيل العميل».", "“Already booked” means the customer is registered in a real program. Choose the program and confirm in “Register customer”.")}
        </div>
      ) : (
        <Input label={tx("ملاحظة (اختياري)", "Note (optional)")} value={note} onChange={setNote} rows={3} placeholder={tx("مثال: قال هيرد بكرة الصبح", "e.g. Said he will call back tomorrow morning")} />
      )}

      {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        <Btn v="purple" onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
        {isRegistered ? (
          <Btn v="primary" onClick={() => { onClose(); onRegister?.(customer.id); }}>{tx("متابعة لتسجيل العميل", "Continue to register")}</Btn>
        ) : (
          <>
            {canFollowUp && <Btn v="purple" disabled={saving} onClick={() => save(true)}>{tx("حفظ وجدولة متابعة", "Save & schedule follow-up")}</Btn>}
            <Btn v="primary" disabled={saving} onClick={() => save(false)}>{saving ? tx("جارٍ الحفظ…", "Saving…") : tx("حفظ", "Save")}</Btn>
          </>
        )}
      </div>
    </Modal>
  );
}
