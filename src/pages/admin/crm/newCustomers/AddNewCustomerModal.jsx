import { useState } from "react";
import { Modal, Input, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useCustomers } from "../../../../context/CustomerContext";
import { InterestedProgramsPicker } from "../../../../components/crm/InterestedPrograms";
import { parseWhatsappUsername } from "../../../../utils/whatsappContact";

/**
 * "عملاء جدد" — add a customer who has NOT registered in any course yet.
 * Creates ONLY a customer document (identity + optional interested Programs).
 * No engagement, enrollment, payment or booking is ever created here —
 * registering later is the normal Add Student flow inside a Program, which
 * finds this customer by phone and reuses them (customers are deduplicated
 * globally by phone/email; the interest list is left exactly as it is).
 */
export default function AddNewCustomerModal({ onClose }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { addCustomer, findCustomerByPhone, findCustomerByEmail, findCustomerByWhatsappUsername } = useCustomers();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsappUsername, setWhatsappUsername] = useState("");
  const [email, setEmail] = useState("");
  const [interestedProgramIds, setInterestedProgramIds] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError("");
    // A customer needs a phone number OR a WhatsApp username (either alone is fine, both are kept) — the name is optional.
    const parsedUsername = parseWhatsappUsername(whatsappUsername);
    if (!phone.trim() && parsedUsername.status === "empty") { setError(tx("أدخل رقم الهاتف أو اسم مستخدم واتساب", "Enter a phone number or a WhatsApp username")); return; }
    if (parsedUsername.status === "invalid") {
      setError(tx(
        "اسم مستخدم واتساب غير صالح — حروف إنجليزية صغيرة وأرقام ونقطة وشرطة سفلية فقط، من 3 إلى 35 حرفًا، وبه حرف واحد على الأقل",
        "Invalid WhatsApp username — lowercase letters, digits, periods and underscores only, 3–35 characters, with at least one letter",
      ));
      return;
    }
    // Same global person-level dedup the rest of the CRM uses — never a second customer for the same phone/username/email.
    const existing = (phone.trim() ? findCustomerByPhone(phone) : null)
      || (parsedUsername.status === "ok" ? findCustomerByWhatsappUsername(parsedUsername.normalized) : null)
      || (email.trim() ? findCustomerByEmail(email) : null);
    if (existing) {
      setError(tx(
        `العميل ده مسجّل بالفعل: ${existing.fullName || existing.phone || existing.whatsappUsername}. لتعديل الكورسات المهتم بيها افتح ملفه.`,
        `This customer already exists: ${existing.fullName || existing.phone || existing.whatsappUsername}. Open their profile to edit interested programs.`,
      ));
      return;
    }
    setSaving(true);
    try {
      await addCustomer({ fullName: fullName.trim(), phone: phone.trim(), whatsappUsername: parsedUsername.normalized, email: email.trim(), interestedProgramIds });
      onClose();
    } catch (e) {
      setError(e?.message?.startsWith("INVALID_INTERESTED_PROGRAMS")
        ? tx("في كورس مش متاح — اختار من القائمة فقط", "A selected program isn't available — pick from the list only")
        : (e?.message || tx("حدث خطأ", "Something went wrong")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={tx("إضافة عميل جديد", "Add New Customer")} onClose={onClose}>
      <Input label={tx("الاسم الكامل (اختياري)", "Full Name (optional)")} value={fullName} onChange={setFullName} />
      <Input label={tx("رقم الهاتف", "Phone Number")} value={phone} onChange={setPhone} dir="ltr" />
      <Input label={tx("اسم مستخدم واتساب (اختياري إذا أدخلت رقم الهاتف)", "WhatsApp Username (optional if you enter a phone)")} value={whatsappUsername} onChange={setWhatsappUsername} dir="ltr" placeholder="ahmed123" />
      <Input label={tx("البريد الإلكتروني (اختياري)", "Email (optional)")} value={email} onChange={setEmail} dir="ltr" />
      <InterestedProgramsPicker value={interestedProgramIds} onChange={setInterestedProgramIds} />
      {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Btn v="purple" onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
        <Btn v="primary" disabled={saving} onClick={submit}>{saving ? tx("جارٍ الإضافة…", "Adding…") : tx("إضافة العميل", "Add Customer")}</Btn>
      </div>
    </Modal>
  );
}
