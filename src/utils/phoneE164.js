/** Normalize common Egypt/local input to E.164 for Firebase Phone Auth (+20…). */
export function toE164Phone(raw) {
  const t = String(raw || "").trim().replace(/\s/g, "");
  if (!t) return null;
  if (t.startsWith("+")) {
    const d = t.slice(1).replace(/\D/g, "");
    return d.length >= 10 ? `+${d}` : null;
  }
  const d = t.replace(/\D/g, "");
  if (d.startsWith("20") && d.length >= 11) return `+${d}`;
  if (d.startsWith("0") && d.length >= 10) return `+20${d.slice(1)}`;
  if (d.length === 10 && d.startsWith("1")) return `+20${d}`;
  return null;
}

export const PHONE_PENDING_KEY = "eduzah_phone_pending";
