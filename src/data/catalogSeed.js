/**
 * Initial CRM v2 catalog data: Business Unit -> Category (optional) -> Program.
 * Seeded once into `catalogNodes` when the collection is empty. This is a
 * starting point only — the whole tree (including this shape) is fully
 * admin-editable afterward via the Catalog UI; nothing about the hierarchy
 * is hardcoded elsewhere in the app.
 *
 * A child with no `type` is a "category"; a child with `type: "program"` is
 * a program. Categories are optional — a program can sit directly under a
 * Business Unit (no category layer) or inside a category, to any depth.
 */
export const CATALOG_SEED = [
  {
    name_ar: "التكنولوجيا", name_en: "Technology",
    children: [
      { type: "program", name_ar: "أساسيات البرمجة", name_en: "Programming Fundamentals" },
      {
        name_ar: "تطوير الويب", name_en: "Web Development",
        children: [
          { type: "program", name_ar: "الواجهة الأمامية", name_en: "Front-End" },
          { type: "program", name_ar: "الواجهة الخلفية", name_en: "Back-End" },
          { type: "program", name_ar: "فل ستاك", name_en: "Full Stack" },
        ],
      },
      {
        name_ar: "البيانات والذكاء الاصطناعي", name_en: "Data & AI",
        children: [
          { type: "program", name_ar: "تحليل البيانات", name_en: "Data Analysis" },
          { type: "program", name_ar: "الذكاء الاصطناعي وعلوم البيانات", name_en: "AI & Data Science" },
          { type: "program", name_ar: "أتمتة الذكاء الاصطناعي", name_en: "AI Automation" },
        ],
      },
      {
        name_ar: "تطوير تطبيقات الموبايل", name_en: "Mobile Development",
        children: [
          { type: "program", name_ar: "فلاتر", name_en: "Flutter" },
          { type: "program", name_ar: "أندرويد", name_en: "Android" },
        ],
      },
    ],
  },
  {
    name_ar: "اللغات", name_en: "Language",
    children: [
      { type: "program", name_ar: "اللغة الإنجليزية", name_en: "English" },
      { type: "program", name_ar: "اللغة الألمانية", name_en: "German" },
    ],
  },
  {
    name_ar: "الإدارة", name_en: "Management",
    children: [
      { type: "program", name_ar: "المهارات الناعمة", name_en: "Soft Skills" },
      { type: "program", name_ar: "التصميم التعليمي", name_en: "Instructional Design" },
      { type: "program", name_ar: "تدريب المدربين", name_en: "Training of Trainers (TOT)" },
      { type: "program", name_ar: "ريادة الأعمال", name_en: "Entrepreneurship" },
      { type: "program", name_ar: "الموارد البشرية", name_en: "Human Resources (HR)" },
      { type: "program", name_ar: "التسويق الرقمي", name_en: "Digital Marketing" },
    ],
  },
  {
    name_ar: "البراعم", name_en: "Juniors",
    children: [
      { type: "program", name_ar: "برمجة للأطفال", name_en: "Programming for Kids" },
      { type: "program", name_ar: "إنجليزي للأطفال", name_en: "English for Kids" },
    ],
  },
  {
    name_ar: "الشركات والمؤسسات", name_en: "Corporate",
    children: [
      { type: "program", name_ar: "الذكاء الاصطناعي للأعمال", name_en: "AI for Business" },
      { type: "program", name_ar: "أدوات الذكاء الاصطناعي", name_en: "AI Tools" },
    ],
  },
];
