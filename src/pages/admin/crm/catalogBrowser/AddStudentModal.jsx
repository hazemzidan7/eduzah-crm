import { useState } from "react";
import { Modal, Input, Select, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useCustomers } from "../../../../context/CustomerContext";
import { useLeadStatus } from "../../../../context/LeadStatusContext";
import { ATTENDANCE_TYPE_OPTIONS } from "../../../../constants/crmOptions";

/**
 * The manual counterpart to importing a spreadsheet — same destination
 * Program, same defaulted CRM Internal Data, just one student at a time.
 * Deliberately minimal: only what's needed to create the record: everything
 * else (status, owner, payment...) is filled in from the Sheet afterward.
 */
export default function AddStudentModal({ program, businessUnitId, onClose }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { resolveOrCreateCustomer, findEngagement, addEngagement } = useCustomers();
  const { globalStatuses } = useLeadStatus();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [attendanceType, setAttendanceType] = useState("");
  const [registrationDate, setRegistrationDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const attendanceOptions = [
    { v: "", l: tx("— بدون —", "— None —") },
    ...ATTENDANCE_TYPE_OPTIONS.map((o) => ({ v: o.v, l: ar ? o.ar : o.en })),
  ];

  const submit = async () => {
    setError("");
    if (!fullName.trim()) { setError(tx("أدخل الاسم الكامل", "Enter a full name")); return; }
    if (!phone.trim()) { setError(tx("أدخل رقم الهاتف", "Enter a phone number")); return; }
    setSaving(true);
    try {
      const customerId = await resolveOrCreateCustomer({ fullName, phone, email });
      if (findEngagement(customerId, program.id)) {
        setError(tx("هذا الرقم مسجّل بالفعل في هذا البرنامج", "This phone number already has a record in this Program"));
        return;
      }
      const defaultStatus = globalStatuses.find((s) => s.isDefault);
      await addEngagement(customerId, {
        businessUnitId,
        catalogNodeId: program.id,
        statusId: defaultStatus?.id || null,
        studentProfile: { attendanceType, registrationDate: registrationDate || null },
        creationNote: "Added manually",
      });
      onClose();
    } catch (e) {
      setError(e.message || tx("حدث خطأ", "Something went wrong"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={tx("إضافة طالب", "Add Student")} onClose={onClose}>
      <Input label={tx("الاسم الكامل", "Full Name")} value={fullName} onChange={setFullName} />
      <Input label={tx("رقم الهاتف", "Phone Number")} value={phone} onChange={setPhone} dir="ltr" />
      <Input label={tx("البريد الإلكتروني (اختياري)", "Email (optional)")} value={email} onChange={setEmail} dir="ltr" />
      <Select label={tx("نوع الحضور", "Attendance Type")} value={attendanceType} onChange={setAttendanceType} options={attendanceOptions} />
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 4 }}>{tx("البرنامج", "Program")}</label>
        <div dir="ltr" style={{ background: "#F8FAFC", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "9px 13px", fontSize: 13 }}>
          {program.name_en}
        </div>
      </div>
      <Input label={tx("تاريخ التسجيل", "Registration Date")} type="date" value={registrationDate} onChange={setRegistrationDate} />
      {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn v="purple" onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
        <Btn v="primary" disabled={saving} onClick={submit}>{saving ? tx("جاري الإضافة…", "Adding…") : tx("إضافة الطالب", "Add Student")}</Btn>
      </div>
    </Modal>
  );
}
