/**
 * The core Customer/Engagement fields a spreadsheet column can map to.
 * This is a structural vocabulary (mirrors the schema itself), not a
 * hardcoded business value — Custom Field Definitions extend this list
 * dynamically per Business Unit, they are not enumerated here.
 */
export const CANONICAL_FIELDS = [
  { key: "fullName", label_ar: "الاسم الكامل", label_en: "Full Name" },
  { key: "phone", label_ar: "رقم الهاتف", label_en: "Phone" },
  { key: "secondaryPhone", label_ar: "رقم هاتف إضافي", label_en: "Secondary Phone" },
  { key: "whatsapp", label_ar: "واتساب", label_en: "WhatsApp" },
  { key: "email", label_ar: "البريد الإلكتروني", label_en: "Email" },
  { key: "city", label_ar: "المدينة", label_en: "City" },
  { key: "leadSource", label_ar: "مصدر العميل", label_en: "Lead Source" },
  { key: "contactMethod", label_ar: "طريقة التواصل", label_en: "Contact Method" },
  { key: "notes", label_ar: "ملاحظات", label_en: "Notes" },
  { key: "registrationDate", label_ar: "تاريخ التسجيل", label_en: "Registration Date" },
  { key: "statusRaw", label_ar: "الحالة (نص خام)", label_en: "Status (raw text)" },
  { key: "programRaw", label_ar: "البرنامج (نص خام)", label_en: "Program (raw text)" },
  { key: "businessUnitRaw", label_ar: "وحدة العمل (نص خام)", label_en: "Business Unit (raw text)" },
];

export function canonicalFieldLabel(key, lang) {
  const f = CANONICAL_FIELDS.find((c) => c.key === key);
  if (!f) return key;
  return lang === "ar" ? f.label_ar : f.label_en;
}
