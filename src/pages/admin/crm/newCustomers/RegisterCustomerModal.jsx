import { useRef, useState } from "react";
import { Modal, Input, Select, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useCatalog } from "../../../../context/CatalogContext";
import ProgramSelect from "../../../../components/crm/ProgramSelect";
import { InterestedProgramChips } from "../../../../components/crm/InterestedPrograms";
import { customerInterestedProgramIds } from "../../../../utils/interestedPrograms";
import { isActiveProgramNode } from "../../../../utils/newCustomerWorkflow";
import { ATTENDANCE_TYPE_OPTIONS } from "../../../../constants/crmOptions";
import { useNewCustomerWorkflow } from "../../../../hooks/useNewCustomerWorkflow";
import { workflowErrorText } from "./EditNewCustomerModal";

/**
 * "تسجيل العميل" — turns a new customer into a real registration:
 *   1. select the ACTUAL Program (an existing active catalog Program — no free text),
 *   2. review the customer's information,
 *   3. confirm,
 *   4. the normal Engagement is created for that Program (same builder as Add Student),
 *   5. the customer leaves "عملاء جدد" on its own, because they now have an Engagement.
 * Reuses the existing customer (never a second one), leaves the interest list untouched, creates no
 * payment or accounting record, and is safe against double-click/retry (the create is transactional
 * and keyed on customer + Program). Price and payment plan are set afterwards in the Program's
 * Sales Sheet, exactly as for every other registration.
 */
export default function RegisterCustomerModal({ customer, onClose }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { nodeById } = useCatalog();
  const { registerCustomer } = useNewCustomerWorkflow();

  const interestIds = customerInterestedProgramIds(customer).filter((id) => isActiveProgramNode(nodeById(id)));
  const planned = customer.plannedProgramId && isActiveProgramNode(nodeById(customer.plannedProgramId)) ? customer.plannedProgramId : "";

  const [programId, setProgramId] = useState(planned);
  const [name, setName] = useState(customer.fullName || "");
  const [attendanceType, setAttendanceType] = useState("");
  const [registrationDate, setRegistrationDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null); // { status, programName, archivedExisting }
  const inFlight = useRef(false); // a second click while the first is still running must do nothing

  const attendanceOptions = [{ v: "", l: tx("— بدون —", "— None —") }, ...ATTENDANCE_TYPE_OPTIONS.map((o) => ({ v: o.v, l: ar ? o.ar : o.en }))];
  const program = programId ? nodeById(programId) : null;

  const confirm = async () => {
    if (inFlight.current) return;
    setError("");
    if (!programId) { setError(workflowErrorText({ codes: ["PROGRAM_REQUIRED"] }, tx)); return; }
    inFlight.current = true;
    setSaving(true);
    try {
      const res = await registerCustomer(customer, { programId, name, attendanceType, registrationDate });
      setDone({ ...res, programName: program?.name_en || "" });
    } catch (e) {
      setError(workflowErrorText(e, tx));
      inFlight.current = false;
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    const already = done.status === "already_registered";
    return (
      <Modal title={tx("تسجيل العميل", "Register Customer")} onClose={onClose}>
        <div style={{ background: already ? "#FEF3C7" : "#F0FDF4", border: `1px solid ${already ? "#FDE68A" : "#BBF7D0"}`, borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 12 }}>
          {already
            ? (done.archivedExisting
              ? tx("العميل عنده سجل مؤرشف في الكورس ده — استرجعه من صفحة الكورس. لم يُنشأ تسجيل جديد.", "The customer has an archived record in this program — restore it from the program page. No new registration was created.")
              : tx(`العميل مسجّل بالفعل في ${done.programName} — لم يُنشأ تسجيل مكرر.`, `The customer is already registered in ${done.programName} — no duplicate was created.`))
            : tx(`تم تسجيل العميل في ${done.programName}. هيظهر دلوقتي في شيت الكورس، وحدّد السعر وخطة الدفع من هناك.`, `The customer is now registered in ${done.programName}. Set the price and payment plan from that program's Sales Sheet.`)}
        </div>
        {done.customerPatchError && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10 }}>{tx("تم التسجيل لكن تعذّر تحديث حالة العميل: ", "Registered, but the customer's status couldn't be updated: ")}{done.customerPatchError}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end" }}><Btn v="primary" onClick={onClose}>{tx("إغلاق", "Close")}</Btn></div>
      </Modal>
    );
  }

  return (
    <Modal title={tx("تسجيل العميل", "Register Customer")} onClose={onClose}>
      <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6 }}>{tx("١) الكورس الفعلي", "1) The actual program")}</div>
      <ProgramSelect ar={ar} label={tx("الكورس اللي هيحجز فيه (مطلوب)", "Program the customer registers in (required)")} value={programId} onChange={setProgramId} invalid={!programId && !!error} />
      {interestIds.length > 0 && (
        <div style={{ marginTop: -6, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{tx("الكورسات المهتم بيها (اضغط لاختيار):", "Interested programs (click to pick):")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {interestIds.map((id) => (
              <button key={id} type="button" dir="ltr" onClick={() => setProgramId(id)} style={{ cursor: "pointer", border: `1px solid ${programId === id ? C.purple : C.border}`, background: programId === id ? `${C.purple}22` : "#fff", borderRadius: 99, padding: "4px 11px", fontSize: 11.5, fontWeight: 700, fontFamily: "'Cairo',sans-serif" }}>
                {nodeById(id)?.name_en}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6 }}>{tx("٢) مراجعة بيانات العميل", "2) Review the customer")}</div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 12, background: "#FAFBFC", fontSize: 12.5 }}>
        <div style={{ marginBottom: 6 }}><span style={{ color: C.muted, fontWeight: 700 }}>{tx("الهاتف: ", "Phone: ")}</span><span dir="ltr">{customer.phone}</span></div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ color: C.muted, fontWeight: 700, marginBottom: 4 }}>{tx("الكورسات المهتم بيها (تفضل زي ما هي):", "Interested programs (kept as they are):")}</div>
          <InterestedProgramChips ids={customerInterestedProgramIds(customer)} tx={tx} emptyLabel="—" />
        </div>
        {customer.notes && <div><span style={{ color: C.muted, fontWeight: 700 }}>{tx("ملاحظات: ", "Notes: ")}</span><span style={{ whiteSpace: "pre-wrap" }}>{customer.notes}</span></div>}
      </div>
      <Input label={tx("الاسم (اختياري — كمّله لو عرفته)", "Name (optional — fill it in if you learned it)")} value={name} onChange={setName} />
      <Select label={tx("نوع الحضور", "Attendance Type")} value={attendanceType} onChange={setAttendanceType} options={attendanceOptions} />
      <Input label={tx("تاريخ التسجيل", "Registration Date")} type="date" value={registrationDate} onChange={setRegistrationDate} />

      <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6 }}>{tx("٣) تأكيد التسجيل", "3) Confirm")}</div>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>
        {tx("هيتم إنشاء تسجيل عادي في الكورس المختار لنفس العميل (بدون مدفوعات أو معاملات محاسبية)، وهيخرج العميل من «عملاء جدد» تلقائيًا.", "A normal registration is created in the chosen program for this same customer (no payments or accounting transactions), and the customer leaves “New Customers” automatically.")}
      </div>
      {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn v="purple" onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
        <Btn v="primary" disabled={saving || !programId} onClick={confirm}>{saving ? tx("جارٍ التسجيل…", "Registering…") : tx("تأكيد التسجيل", "Confirm registration")}</Btn>
      </div>
    </Modal>
  );
}
