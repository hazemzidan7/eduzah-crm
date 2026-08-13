/**
 * Mirrors src/utils/leadDedupe.js exactly (that file lives in the Vite app's
 * src/ tree, not importable from the Functions codebase, so duplicated here
 * on purpose — keep both in sync if the normalization rule ever changes).
 */
export function normalizePhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("20")) digits = digits.slice(2);
  if (digits.length === 10 && !digits.startsWith("0")) digits = `0${digits}`;
  return digits;
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
