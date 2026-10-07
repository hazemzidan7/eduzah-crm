/**
 * CUSTOMER-NOTES-SPLIT-01 — `customers/{id}.notes` is a single string that
 * mixes two different origins, each with its own format:
 *  - a GENERAL note: written once per Excel/CSV import (see
 *    utils/leadImport.js's buildImportNoteBlock, "[ملاحظة استيراد - DD/MM/YYYY]\n<text>")
 *    or typed directly by an admin in "تعديل" — free text, may span several lines;
 *  - a SALES CONTACT note: one line per "تسجيل متابعة" (see
 *    utils/newCustomerWorkflow.js's buildContactPatch), always exactly
 *    "[YYYY-MM-DD · Name] text" on its own line (cleanWhitespace strips the
 *    text's own newlines before it's appended).
 * Pure, read-only split for DISPLAY — it never changes how either kind is
 * written. Admin sees the general note in "تعديل"; Sales's contact notes get
 * their own "ملاحظات" column on the "عملاء جدد" table.
 */
const CONTACT_LINE_RE = /^\[\d{4}-\d{2}-\d{2}(?: · .+)?\] /;

/**
 * Splits raw notes into { generalText, contactNotes }. Any line that isn't a
 * recognized Sales contact line — including notes typed before this split
 * existed — stays in `generalText`, so nothing already on a customer record
 * silently disappears from either place.
 */
export function splitCustomerNotes(raw) {
  const lines = String(raw ?? "").split("\n");
  const generalLines = [];
  const contactNotes = [];
  for (const line of lines) {
    if (CONTACT_LINE_RE.test(line)) contactNotes.push(line);
    else generalLines.push(line);
  }
  return {
    generalText: generalLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    contactNotes,
  };
}

/** The inverse of the general-text half of the split — reattaches the (possibly edited) general text ahead of the untouched Sales contact lines, so saving an edit never drops or reorders them. */
export function combineCustomerNotes(generalText, contactNotes) {
  const general = String(generalText ?? "").trim();
  const contact = (contactNotes || []).join("\n");
  if (general && contact) return `${general}\n${contact}`;
  return general || contact;
}
