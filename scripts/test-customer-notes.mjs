// Ad-hoc test suite for CUSTOMER-NOTES-SPLIT-01 — splitting customers.notes
// into the general/import note vs Sales's per-call "تسجيل متابعة" log, and
// recombining them losslessly on save. Run with:
//   node --import ./scripts/esm-ext-loader.mjs scripts/test-customer-notes.mjs
import { splitCustomerNotes, combineCustomerNotes } from "../src/utils/customerNotes.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); }
  else { fail++; console.log(`FAIL  - ${name}`); }
}
function eq(name, actual, expected) {
  check(`${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, JSON.stringify(actual) === JSON.stringify(expected));
}

console.log("splitCustomerNotes");

{
  // The exact real-world shape reported: an import note followed by two Sales contact lines.
  const raw = "[ملاحظة استيراد - 04/10/2026]\nتانية حسابات سوهاج الاهلية\n[2026-10-07 · Youstena] قال ان محتوى الدبلومة مناسب و عايز يحضر اوفلاين لكن لما وصلنا للسعر مردش تاني\n[2026-10-07 · Hazem Zidan] هيرد بكره";
  const { generalText, contactNotes } = splitCustomerNotes(raw);
  eq("import block (marker + its text) goes to generalText", generalText, "[ملاحظة استيراد - 04/10/2026]\nتانية حسابات سوهاج الاهلية");
  eq("both Sales contact lines extracted, in order, untouched", contactNotes, [
    "[2026-10-07 · Youstena] قال ان محتوى الدبلومة مناسب و عايز يحضر اوفلاين لكن لما وصلنا للسعر مردش تاني",
    "[2026-10-07 · Hazem Zidan] هيرد بكره",
  ]);
}

{
  // No import note at all, only contact lines (e.g. a manually-added customer, never imported).
  const raw = "[2026-10-07 · Ahmed] لم يرد";
  eq("pure contact-only notes -> empty general, one contact line", splitCustomerNotes(raw), { generalText: "", contactNotes: ["[2026-10-07 · Ahmed] لم يرد"] });
}

{
  // No contact notes yet, only the general/import note.
  const raw = "[ملاحظة استيراد - 01/01/2026]\nحملة يناير";
  eq("pure general notes -> all general, no contact lines", splitCustomerNotes(raw), { generalText: "[ملاحظة استيراد - 01/01/2026]\nحملة يناير", contactNotes: [] });
}

{
  // Empty / null / undefined notes.
  eq("empty string -> both empty", splitCustomerNotes(""), { generalText: "", contactNotes: [] });
  eq("null -> both empty", splitCustomerNotes(null), { generalText: "", contactNotes: [] });
  eq("undefined -> both empty", splitCustomerNotes(undefined), { generalText: "", contactNotes: [] });
}

{
  // A contact line with NO name (buildContactPatch omits " · Name" when currentUser.name is missing).
  const raw = "[2026-10-07] no answer, retry tomorrow";
  eq("contact line without a name is still recognized", splitCustomerNotes(raw).contactNotes, ["[2026-10-07] no answer, retry tomorrow"]);
}

{
  // Legacy free-text notes typed before this split existed (no recognizable prefix at all) must not be lost.
  const raw = "عميل كويس، اتصل الساعة 5 المرة الجاية";
  eq("legacy untagged free text stays visible as general text (never silently dropped)", splitCustomerNotes(raw), { generalText: raw, contactNotes: [] });
}

{
  // A second import (re-import of an already-existing customer) appends its own block with a blank-line separator
  // (see utils/leadImport.js's appendImportNote), interleaved with an earlier contact line.
  const raw = "[ملاحظة استيراد - 01/01/2026]\nحملة يناير\n[2026-03-01 · Sara] مهتم\n\n[ملاحظة استيراد - 10/04/2026]\nحملة ابريل";
  const { generalText, contactNotes } = splitCustomerNotes(raw);
  eq("both import blocks land in generalText, contact line correctly pulled out from between them", generalText, "[ملاحظة استيراد - 01/01/2026]\nحملة يناير\n\n[ملاحظة استيراد - 10/04/2026]\nحملة ابريل");
  eq("the one contact line in between is still extracted correctly", contactNotes, ["[2026-03-01 · Sara] مهتم"]);
}

console.log("combineCustomerNotes — round-trip losslessness");

{
  const raw = "[ملاحظة استيراد - 04/10/2026]\nتانية حسابات سوهاج الاهلية\n[2026-10-07 · Youstena] قال ان محتوى الدبلومة مناسب\n[2026-10-07 · Hazem Zidan] هيرد بكره";
  const { generalText, contactNotes } = splitCustomerNotes(raw);
  eq("re-combining an UNCHANGED split reconstructs the exact original string", combineCustomerNotes(generalText, contactNotes), raw);
}

{
  // Admin edits the general note — the Sales contact log must be untouched and still appended after it.
  const raw = "old general note\n[2026-10-07 · Youstena] قال هيفكر\n[2026-10-07 · Hazem Zidan] هيرد بكره";
  const { contactNotes } = splitCustomerNotes(raw);
  const edited = combineCustomerNotes("new, corrected general note", contactNotes);
  eq("editing only the general half preserves both contact lines, in order, after it", edited, "new, corrected general note\n[2026-10-07 · Youstena] قال هيفكر\n[2026-10-07 · Hazem Zidan] هيرد بكره");
}

{
  // Clearing the general note entirely must still keep the Sales contact log intact.
  const { contactNotes } = splitCustomerNotes("some note\n[2026-10-07 · Ahmed] مهتم");
  eq("blanking the general note keeps the contact log, with no leading blank line", combineCustomerNotes("", contactNotes), "[2026-10-07 · Ahmed] مهتم");
}

{
  // No contact notes at all — combining must not add a stray trailing newline.
  eq("general text only, no contact notes -> just the general text", combineCustomerNotes("just a note", []), "just a note");
  eq("both empty -> empty string", combineCustomerNotes("", []), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
