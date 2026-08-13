/**
 * CRM-CATALOG-01 — the exact program list, slugs, and pricing given for the
 * Landing -> CRM integration. Consumed only by
 * CatalogContext.ensureCatalogPricingPlan(), which is a manual, admin-
 * triggered upsert (Settings > Catalog > "Ensure Program Catalog & Pricing")
 * — it never runs automatically, so nothing here touches production data
 * until an admin explicitly clicks that button.
 *
 * `matchNameEn` is how an existing program already in the catalog is found
 * and preserved (same id, same tree position — only pricing/slug fields are
 * added/updated). `matchNameEn: null` means no confident existing match was
 * found by hand-reviewing the current catalog tree (src/data/catalogSeed.js)
 * against this list, so ensureCatalogPricingPlan creates a new Program node
 * for it instead of guessing and possibly overwriting the wrong one. Every
 * `matchNameEn: null` entry here should be reviewed once against the live
 * catalog before/after running the ensure action, in case a matching
 * program was created some other way in the meantime.
 *
 * priceUnit: "per_level" (Children's programs only) means originalPrice is
 * the price for ONE level, not a total program price — per CRM-CATALOG-01
 * requirement 5, no total is invented.
 */
export const CATALOG_PRICING_PLAN = [
  // ── Technology ──────────────────────────────────────────
  { businessUnit: "Technology", matchNameEn: "Programming Fundamentals", slug: "programming-fundamentals", name_en: "Programming Fundamentals", name_ar: "أساسيات البرمجة", originalPrice: 4000, depositAmount: 1000 },
  { businessUnit: "Technology", matchNameEn: "Front-End", slug: "frontend-web-development", name_en: "Front-End Web Development", name_ar: "تطوير الواجهة الأمامية", originalPrice: 4500, depositAmount: 1000 },
  { businessUnit: "Technology", matchNameEn: "Back-End", slug: "backend-web-development", name_en: "Back-End Web Development", name_ar: "تطوير الواجهة الخلفية", originalPrice: 6000, depositAmount: 1000 },
  { businessUnit: "Technology", matchNameEn: "Flutter", slug: "flutter-app-development", name_en: "Flutter App Development", name_ar: "تطوير تطبيقات فلاتر", originalPrice: 4500, depositAmount: 1000 },
  { businessUnit: "Technology", matchNameEn: "UI/UX", slug: "ui-ux-design", name_en: "UI/UX Design", name_ar: "تصميم واجهة وتجربة المستخدم", originalPrice: 4500, depositAmount: 1000 },
  { businessUnit: "Technology", matchNameEn: null, slug: "cybersecurity", name_en: "Cybersecurity", name_ar: "الأمن السيبراني", originalPrice: 6000, depositAmount: 1000 },
  { businessUnit: "Technology", matchNameEn: null, slug: "artificial-intelligence", name_en: "Artificial Intelligence", name_ar: "الذكاء الاصطناعي", originalPrice: 5000, depositAmount: 1000 },
  { businessUnit: "Technology", matchNameEn: "Data Analysis", slug: "data-analysis", name_en: "Data Analysis", name_ar: "تحليل البيانات", originalPrice: 5000, depositAmount: 1000 },

  // ── Juniors (Children) ──────────────────────────────────
  { businessUnit: "Juniors", matchNameEn: "Programming for Kids", slug: "childrens-programming", name_en: "Programming for Kids", name_ar: "برمجة للأطفال", originalPrice: 800, depositAmount: 500, priceUnit: "per_level" },
  { businessUnit: "Juniors", matchNameEn: "English for Kids", slug: "childrens-english", name_en: "English for Kids", name_ar: "إنجليزي للأطفال", originalPrice: 800, depositAmount: 500, priceUnit: "per_level" },

  // ── Language (English) — 6 distinct level/track programs; the existing
  // generic "English" program is left untouched (not one of these 6). ──
  { businessUnit: "Language", matchNameEn: null, slug: "general-english-fundamental", name_en: "General English - Fundamental", name_ar: "إنجليزي عام - أساسي", originalPrice: 1000, depositAmount: 500 },
  { businessUnit: "Language", matchNameEn: null, slug: "english-conversational", name_en: "Conversational English", name_ar: "إنجليزي محادثة", originalPrice: 1500, depositAmount: 500 },
  { businessUnit: "Language", matchNameEn: null, slug: "english-a1", name_en: "English A1", name_ar: "إنجليزي A1", originalPrice: 1000, depositAmount: 500 },
  { businessUnit: "Language", matchNameEn: null, slug: "english-a2", name_en: "English A2", name_ar: "إنجليزي A2", originalPrice: 1000, depositAmount: 500 },
  { businessUnit: "Language", matchNameEn: null, slug: "english-b1", name_en: "English B1", name_ar: "إنجليزي B1", originalPrice: 1000, depositAmount: 500 },
  { businessUnit: "Language", matchNameEn: null, slug: "english-b2", name_en: "English B2", name_ar: "إنجليزي B2", originalPrice: 1000, depositAmount: 500 },

  // ── Management ──────────────────────────────────────────
  { businessUnit: "Management", matchNameEn: null, slug: "computer-basics", name_en: "Computer Basics", name_ar: "أساسيات الحاسوب", originalPrice: 1500, depositAmount: 500 },
  { businessUnit: "Management", matchNameEn: "Soft Skills", slug: "soft-skills", name_en: "Soft Skills", name_ar: "المهارات الناعمة", originalPrice: 1500, depositAmount: 500 },
  { businessUnit: "Management", matchNameEn: "Instructional Design", slug: "instructional-design", name_en: "Instructional Design", name_ar: "التصميم التعليمي", originalPrice: 1500, depositAmount: 500 },
  { businessUnit: "Management", matchNameEn: "Human Resources (HR)", slug: "human-resources", name_en: "Human Resources", name_ar: "الموارد البشرية", originalPrice: 1500, depositAmount: 500 },
  { businessUnit: "Management", matchNameEn: "Training of Trainers (TOT)", slug: "training-of-trainers", name_en: "Training of Trainers", name_ar: "تدريب المدربين", originalPrice: 1500, depositAmount: 500 },
];

// installmentCount "allow 2 or 3" — default applied when a program is first
// created/priced by the ensure action; admin-editable afterward per program
// via the Catalog node's Pricing fields (2 or 3 only).
export const DEFAULT_INSTALLMENT_COUNT = 3;
export const CURRENCY = "EGP";
export const FULL_PAYMENT_DISCOUNT = 300;

export function computeFullPaymentPrice(originalPrice) {
  return originalPrice - FULL_PAYMENT_DISCOUNT;
}
