const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const ARABIC_DIGIT_MAP = Object.fromEntries([...ARABIC_DIGITS].map((d, i) => [d, String(i)]));

export function convertArabicDigits(str) {
  return String(str || "").replace(/[٠-٩]/g, (d) => ARABIC_DIGIT_MAP[d] ?? d);
}

/**
 * Aggressive normalization for FUZZY comparison only — strips diacritics/tatweel,
 * unifies alef/yaa/taa-marbuta variants, lowercases. This is deliberately more
 * aggressive than DictionaryContext's normalizeForDictionary (which is exact-match
 * only), since fuzzy matching needs "جامعة القاهرة" and "جامعه القاهره" to compare equal.
 */
export function normalizeForFuzzyMatch(str) {
  let s = convertArabicDigits(String(str || ""));
  s = s.replace(/[ً-ٰٟـ]/g, ""); // diacritics + tatweel
  s = s.replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
