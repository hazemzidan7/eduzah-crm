/**
 * Initial CRM v2 catalog data: Business Units and their first-pass Category
 * children. Seeded once into `catalogNodes` when the collection is empty
 * (mirrors DataContext's seed-from-local-array pattern for courses/news/etc).
 *
 * These children are seeded as `type: "category"` — a first-pass classification,
 * not a final one. None of them have concrete Program/Batch data (dates,
 * capacity) yet, so there was nothing to justify seeding them any deeper.
 * Reclassifying/renaming any node is expected once the Catalog admin UI exists.
 */
export const CATALOG_SEED = [
  {
    name_ar: "التكنولوجيا", name_en: "Technology",
    children: [
      { name_ar: "الواجهة الأمامية", name_en: "Frontend" },
      { name_ar: "الواجهة الخلفية", name_en: "Backend" },
      { name_ar: "الذكاء الاصطناعي", name_en: "AI" },
      { name_ar: "تحليل البيانات", name_en: "Data Analysis" },
      { name_ar: "تجربة وواجهة المستخدم", name_en: "UI/UX" },
      { name_ar: "أساسيات البرمجة", name_en: "Programming Fundamentals" },
      { name_ar: "فلاتر", name_en: "Flutter" },
    ],
  },
  {
    name_ar: "اللغات", name_en: "Language",
    children: [
      { name_ar: "اللغة الإنجليزية العامة", name_en: "General English" },
      { name_ar: "من A1 إلى A2", name_en: "A1 → A2" },
      { name_ar: "من A2 إلى B1", name_en: "A2 → B1" },
      { name_ar: "من B1 إلى B2", name_en: "B1 → B2" },
      { name_ar: "يتطلب اختبار تحديد المستوى", name_en: "Placement Test Required" },
    ],
  },
  {
    name_ar: "البراعم", name_en: "Juniors",
    children: [
      { name_ar: "برمجة للأطفال", name_en: "Programming for Juniors" },
      { name_ar: "إنجليزي للأطفال", name_en: "English for Juniors" },
    ],
  },
  {
    name_ar: "الشركات والمؤسسات", name_en: "Corporate",
    children: [
      { name_ar: "المدارس", name_en: "Schools" },
      { name_ar: "الشركات", name_en: "Companies" },
      { name_ar: "عقود تدريب", name_en: "Training Contracts" },
    ],
  },
  {
    name_ar: "الإدارة", name_en: "Management",
    children: [
      { name_ar: "المهارات الناعمة", name_en: "Soft Skills" },
      { name_ar: "الموارد البشرية", name_en: "HR" },
      { name_ar: "التصميم التعليمي", name_en: "Instructional Design" },
    ],
  },
];
