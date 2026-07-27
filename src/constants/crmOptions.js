/**
 * Predefined option lists for Student Profile fields the sales team fills in
 * after import (not expected in the uploaded Excel file). Controlled
 * vocabularies wherever a fixed list makes sense, per the "dropdowns/radio
 * buttons instead of free text whenever possible" requirement — free text
 * stays free text only for Sales Notes and the Additional (student) Comment.
 */

export const CONTACT_STATUS_OPTIONS = [
  { v: "not_contacted", ar: "لم يتم التواصل", en: "Not Contacted" },
  { v: "called", ar: "تم الاتصال", en: "Called" },
  { v: "no_answer", ar: "لا يوجد رد", en: "No Answer" },
  { v: "wrong_number", ar: "رقم خاطئ", en: "Wrong Number" },
  { v: "whatsapp_sent", ar: "تم إرسال واتساب", en: "WhatsApp Sent" },
  { v: "call_back_later", ar: "اتصل لاحقاً", en: "Call Back Later" },
];

export const EDUCATIONAL_LEVEL_OPTIONS = [
  { v: "preparatory", ar: "إعدادي", en: "Preparatory" },
  { v: "secondary", ar: "ثانوي", en: "Secondary" },
  { v: "university_student", ar: "طالب جامعي", en: "University Student" },
  { v: "graduate", ar: "خريج", en: "Graduate" },
];

export const EMPLOYMENT_STATUS_OPTIONS = [
  { v: "student", ar: "طالب", en: "Student" },
  { v: "employee", ar: "موظف", en: "Employee" },
  { v: "job_seeker", ar: "يبحث عن عمل", en: "Job Seeker" },
  { v: "freelancer", ar: "فريلانسر", en: "Freelancer" },
];

export const PROGRAMMING_LEVEL_OPTIONS = [
  { v: "beginner", ar: "مبتدئ", en: "Beginner" },
  { v: "basic_knowledge", ar: "معرفة أساسية", en: "Basic Knowledge" },
  { v: "intermediate", ar: "متوسط", en: "Intermediate" },
  { v: "advanced", ar: "متقدم", en: "Advanced" },
];

export const PREFERRED_CONTACT_METHOD_OPTIONS = [
  { v: "phone_call", ar: "مكالمة هاتفية", en: "Phone Call" },
  { v: "whatsapp", ar: "واتساب", en: "WhatsApp" },
];

export const ATTENDANCE_TYPE_OPTIONS = [
  { v: "online", ar: "أونلاين", en: "Online" },
  { v: "offline", ar: "حضوري", en: "Offline" },
];

export const GOVERNORATE_OPTIONS = [
  { v: "cairo", ar: "القاهرة", en: "Cairo" },
  { v: "giza", ar: "الجيزة", en: "Giza" },
  { v: "alexandria", ar: "الإسكندرية", en: "Alexandria" },
  { v: "dakahlia", ar: "الدقهلية", en: "Dakahlia" },
  { v: "red_sea", ar: "البحر الأحمر", en: "Red Sea" },
  { v: "beheira", ar: "البحيرة", en: "Beheira" },
  { v: "fayoum", ar: "الفيوم", en: "Fayoum" },
  { v: "gharbia", ar: "الغربية", en: "Gharbia" },
  { v: "ismailia", ar: "الإسماعيلية", en: "Ismailia" },
  { v: "monufia", ar: "المنوفية", en: "Monufia" },
  { v: "minya", ar: "المنيا", en: "Minya" },
  { v: "qalyubia", ar: "القليوبية", en: "Qalyubia" },
  { v: "new_valley", ar: "الوادي الجديد", en: "New Valley" },
  { v: "suez", ar: "السويس", en: "Suez" },
  { v: "aswan", ar: "أسوان", en: "Aswan" },
  { v: "asyut", ar: "أسيوط", en: "Asyut" },
  { v: "beni_suef", ar: "بني سويف", en: "Beni Suef" },
  { v: "port_said", ar: "بورسعيد", en: "Port Said" },
  { v: "damietta", ar: "دمياط", en: "Damietta" },
  { v: "sharqia", ar: "الشرقية", en: "Sharqia" },
  { v: "south_sinai", ar: "جنوب سيناء", en: "South Sinai" },
  { v: "kafr_el_sheikh", ar: "كفر الشيخ", en: "Kafr El Sheikh" },
  { v: "matrouh", ar: "مطروح", en: "Matrouh" },
  { v: "luxor", ar: "الأقصر", en: "Luxor" },
  { v: "qena", ar: "قنا", en: "Qena" },
  { v: "north_sinai", ar: "شمال سيناء", en: "North Sinai" },
  { v: "sohag", ar: "سوهاج", en: "Sohag" },
];

/** Looks up the display label for a stored option code; falls back to the
 * raw value itself (e.g. leftover free text from an older import). */
export function optionLabel(options, code, ar) {
  if (!code) return null;
  const opt = options.find((o) => o.v === code);
  if (!opt) return code;
  return ar ? opt.ar : opt.en;
}
