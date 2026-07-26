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
