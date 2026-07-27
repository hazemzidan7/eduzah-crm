/**
 * The core Customer/Engagement fields a spreadsheet column can map to.
 * This is a structural vocabulary (mirrors the schema itself), not a
 * hardcoded business value — Custom Field Definitions extend this list
 * dynamically per Business Unit, they are not enumerated here.
 *
 * `section` marks where the mapped value ends up at commit time:
 *  - "identity"       -> the Customer doc (person-level, cross-Business-Unit)
 *  - "studentProfile" -> engagement.studentProfile (registration data — the
 *                        CRM never invents these, they only ever come from
 *                        a form/import; sales staff never hand-edit them)
 *  - "resolved"       -> not stored verbatim; resolved to a real id
 *                        (engagement.statusId / catalogNodeId) during commit
 */
export const CANONICAL_FIELDS = [
  { key: "fullName", label_ar: "الاسم الكامل", label_en: "Full Name", section: "identity" },
  { key: "phone", label_ar: "رقم الهاتف", label_en: "Phone", section: "identity" },
  { key: "secondaryPhone", label_ar: "رقم هاتف إضافي", label_en: "Secondary Phone", section: "identity" },
  { key: "whatsapp", label_ar: "واتساب", label_en: "WhatsApp", section: "identity" },
  { key: "email", label_ar: "البريد الإلكتروني", label_en: "Email", section: "identity" },

  { key: "registrationDate", label_ar: "تاريخ التسجيل", label_en: "Registration Date", section: "studentProfile" },
  { key: "governorate", label_ar: "المحافظة", label_en: "Governorate", section: "studentProfile" },
  { key: "educationalLevel", label_ar: "المستوى التعليمي", label_en: "Educational Level", section: "studentProfile" },
  { key: "employmentStatus", label_ar: "الحالة الوظيفية", label_en: "Employment Status", section: "studentProfile" },
  { key: "attendanceType", label_ar: "نوع الحضور", label_en: "Attendance Type", section: "studentProfile" },
  { key: "courseLevel", label_ar: "المستوى (في الكورس)", label_en: "Level (course-specific)", section: "studentProfile" },
  { key: "hasLaptop", label_ar: "يمتلك لابتوب", label_en: "Has Laptop", section: "studentProfile" },
  { key: "preferredContactMethod", label_ar: "طريقة التواصل المفضلة", label_en: "Preferred Contact Method", section: "studentProfile" },
  { key: "leadSource", label_ar: "مصدر العميل", label_en: "Lead Source", section: "studentProfile" },
  { key: "studentComment", label_ar: "تعليق الطالب", label_en: "Student Comment", section: "studentProfile" },

  { key: "statusRaw", label_ar: "الحالة (نص خام)", label_en: "Status (raw text)", section: "resolved" },
  { key: "programRaw", label_ar: "البرنامج (نص خام)", label_en: "Program (raw text)", section: "resolved" },
  { key: "businessUnitRaw", label_ar: "وحدة العمل (نص خام)", label_en: "Business Unit (raw text)", section: "resolved" },
];

// The subset that lands in engagement.studentProfile at commit time.
export const STUDENT_PROFILE_FIELD_KEYS = CANONICAL_FIELDS
  .filter((f) => f.section === "studentProfile")
  .map((f) => f.key);

export function canonicalFieldLabel(key, lang) {
  const f = CANONICAL_FIELDS.find((c) => c.key === key);
  if (!f) return key;
  return lang === "ar" ? f.label_ar : f.label_en;
}
