import { useState } from "react";
import { Modal, Input, Select, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useAuth } from "../../../../context/AuthContext";
import { InterestedProgramsPicker } from "../../../../components/crm/InterestedPrograms";
import { customerInterestedProgramIds } from "../../../../utils/interestedPrograms";
import { useNewCustomerWorkflow } from "../../../../hooks/useNewCustomerWorkflow";

/** Turns the workflow's error codes into a message a Sales user can act on. */
export function workflowErrorText(err, tx) {
  const codes = err?.codes || [];
  const first = codes[0];
  const code = first?.code || first;
  switch (code) {
    case "PHONE_REQUIRED": return tx("رقم الهاتف مطلوب ولا يمكن تركه فارغًا", "The phone number is required and can't be empty");
    case "PHONE_INVALID": return tx("رقم الهاتف غير صالح — اكتبه مع رمز الدولة لو مش مصري (مثل +971)", "The phone number is invalid — include the country code if it isn't Egyptian (e.g. +971)");
    case "PHONE_DUPLICATE": return tx("الرقم ده مسجّل لعميل تاني بالفعل", "That phone number already belongs to another customer");
    case "INVALID_INTERESTED_PROGRAMS": return tx("في كورس مش متاح — اختار من القائمة فقط", "A selected program isn't available — pick from the list only");
    case "STATUS_REQUIRED": return tx("اختر الحالة (وقد تكون هذه الحالة لم تُفعَّل بعد — افتح النظام كأدمن مرة واحدة)", "Choose a status (it may not be enabled yet — open the CRM once as an admin)");
    case "PROGRAM_REQUIRED": return tx("اختر الكورس اللي هيحجز فيه", "Select the program the customer will register in");
    case "PROGRAM_INVALID": return tx("الكورس ده مش متاح في الكتالوج", "That program isn't available in the catalog");
    case "USE_REGISTRATION": return tx("«حجز بالفعل» بيتسجّل من زر «تسجيل العميل» بعد اختيار الكورس", "“Already booked” is recorded through “Register customer” after choosing the program");
    case "CUSTOMER_ARCHIVED": return tx("العميل ده مؤرشف", "This customer is archived");
    default: return err?.message || tx("حدث خطأ", "Something went wrong");
  }
}

/**
 * "تعديل" — the customer's own information from inside "عملاء جدد": name
 * (OPTIONAL — Sales often learns it during the call), phone, interested
 * Programs and notes; admin can also set the assigned employee. Saves the
 * customer document only.
 */
export default function EditNewCustomerModal({ customer, onClose }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { currentUser, users } = useAuth();
  const { saveCustomerEdits } = useNewCustomerWorkflow();
  const isAdmin = currentUser?.role === "admin";

  const [fullName, setFullName] = useState(customer.fullName || "");
  const [phone, setPhone] = useState(customer.phone || "");
  const [notes, setNotes] = useState(customer.notes || "");
  const [interestedProgramIds, setInterestedProgramIds] = useState(() => customerInterestedProgramIds(customer));
  const [assignedToId, setAssignedToId] = useState(customer.assignedToId || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const salesUsers = (users || []).filter((u) => u.role === "sales");
  const assignedLabel = customer.assignedToName || salesUsers.find((u) => u.id === customer.assignedToId)?.name || "—";

  const submit = async () => {
    setError("");
    setSaving(true);
    try {
      const assignee = salesUsers.find((u) => u.id === assignedToId);
      await saveCustomerEdits(customer, {
        fullName, phone, notes, interestedProgramIds,
        ...(isAdmin ? { assignedToId, assignedToName: assignee ? (assignee.name || assignee.email) : null } : {}),
      });
      onClose();
    } catch (e) {
      setError(workflowErrorText(e, tx));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={tx("تعديل بيانات العميل", "Edit Customer")} onClose={onClose}>
      <Input label={tx("الاسم (اختياري)", "Name (optional)")} value={fullName} onChange={setFullName} placeholder={tx("سيب الاسم فاضي لو لسه معروفش", "Leave empty if not known yet")} />
      <Input label={tx("رقم الهاتف", "Phone Number")} value={phone} onChange={setPhone} dir="ltr" />
      <InterestedProgramsPicker value={interestedProgramIds} onChange={setInterestedProgramIds} />
      <Input label={tx("ملاحظات", "Notes")} value={notes} onChange={setNotes} rows={4} />
      {isAdmin ? (
        <Select
          label={tx("الموظف المسؤول", "Assigned employee")}
          value={assignedToId}
          onChange={setAssignedToId}
          options={[{ v: "", l: tx("غير معيّن", "Unassigned") }, ...salesUsers.map((u) => ({ v: u.id, l: u.name || u.email }))]}
        />
      ) : (
        <div style={{ marginBottom: 14, fontSize: 12.5 }}>
          <span style={{ color: C.muted, fontWeight: 700 }}>{tx("الموظف المسؤول: ", "Assigned employee: ")}</span>{assignedLabel}
        </div>
      )}
      {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn v="purple" onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
        <Btn v="primary" disabled={saving} onClick={submit}>{saving ? tx("جارٍ الحفظ…", "Saving…") : tx("حفظ", "Save")}</Btn>
      </div>
    </Modal>
  );
}
