import { normalizePhone, normalizeEmail } from "../leadDedupe";
import { convertArabicDigits } from "./arabicNormalize";

export function cleanPhone(raw) {
  return normalizePhone(convertArabicDigits(raw));
}

export function cleanEmail(raw) {
  return normalizeEmail(raw);
}

export function cleanWhitespace(raw) {
  return String(raw == null ? "" : raw).trim().replace(/\s+/g, " ");
}

/** Splits on explicit separators only (dash/comma/semicolon/slash) — never on
 * bare "و" (and), which appears inside ordinary Arabic words and would corrupt names. */
export function splitMultiValue(raw) {
  if (raw == null || raw === "") return [];
  return String(raw).split(/\s*[-,/;]\s*/).map((s) => s.trim()).filter(Boolean);
}

export function isRowEmpty(row) {
  return Object.values(row).every((v) => v == null || String(v).trim() === "");
}

const TRUE_WORDS = new Set(["yes", "true", "1", "نعم", "ايوه", "أيوه", "معه", "عنده", "y"]);
const FALSE_WORDS = new Set(["no", "false", "0", "لا", "لأ", "مفيش", "مش عنده", "n"]);

/** Parses yes/no-shaped cells (Arabic or English). Unrecognized text returns
 * null rather than guessing — a "has laptop" column with a stray comment in
 * it shouldn't silently become false. */
export function cleanBoolean(raw) {
  const s = cleanWhitespace(raw).toLowerCase();
  if (!s) return null;
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return null;
}
