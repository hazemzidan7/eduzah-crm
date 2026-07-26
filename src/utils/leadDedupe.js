/**
 * Collapse common Egyptian phone formats (spaces, dashes, +20/20/0 prefixes)
 * to one comparable local digit string, e.g. "+20 10 1234 5678" -> "01012345678".
 * Not full E.164 parsing — good enough for exact-match duplicate lookups.
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
