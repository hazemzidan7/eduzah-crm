// Ad-hoc test suite for LEAD-IMPORT-01 (bulk "عملاء جدد" import from Excel), run
// against the real shipped pure planner, the real file parser (on real .xlsx
// bytes built in-memory) and the real source/rules files (no mocks of the
// code under test). Not part of the app build. Run with:
//   node --import ./scripts/esm-ext-loader.mjs scripts/test-lead-import.mjs
import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import {
  planLeadImport, detectColumns, extractPhones, normalizeImportPhone, splitProgramCell,
  buildProgramIndex, matchProgramToken, programTokenKey, MAX_IMPORT_ROWS,
} from "../src/utils/leadImport.js";
import { buildCustomerDoc } from "../src/utils/customerDoc.js";
import { validateInterestedProgramIds } from "../src/utils/interestedPrograms.js";
import { parseWorkbookFileWithRowNumbers } from "../src/utils/importEngine/fileParser.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); }
  else { fail++; console.log(`FAIL  - ${name}`); }
}
function eq(name, actual, expected) {
  check(`${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, JSON.stringify(actual) === JSON.stringify(expected));
}
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ── Catalog fixture (only `program` nodes that are active can ever be matched) ──
const PROGRAMS = [
  { id: "FRONT", type: "program", isActive: true, name_en: "Front-End", name_ar: "فرونت اند", slug: "front-end" },
  { id: "UIUX", type: "program", isActive: true, name_en: "UI/UX", name_ar: "تصميم واجهات", slug: "ui-ux" },
  { id: "DATA", type: "program", isActive: true, name_en: "Data Analysis", name_ar: "تحليل البيانات", slug: "data-analysis" },
  { id: "AI1", type: "program", isActive: true, name_en: "AI for Business", name_ar: "الذكاء الاصطناعي للأعمال", slug: "ai-business" },
  { id: "AI2", type: "program", isActive: true, name_en: "AI Engineering", name_ar: "هندسة الذكاء الاصطناعي", slug: "ai-eng" },
  { id: "BASICS", type: "program", isActive: true, name_en: "Computer Basics", name_ar: "أساسيات الكمبيوتر", slug: "computer-basics" },
  { id: "OLD", type: "program", isActive: false, name_en: "Old Course", name_ar: "كورس قديم", slug: "old" },
  { id: "BU", type: "business_unit", isActive: true, name_en: "Tech Unit", slug: "tech" },
];
const nodeById = (id) => PROGRAMS.find((n) => n.id === id) || null;
const NODES_BEFORE = JSON.stringify(PROGRAMS);

const MAP = { phone: "phone", name: "name", programs: ["courses"] };
async function plan(rows, { existing = [], mapping = MAP, overrides = {} } = {}) {
  return planLeadImport({ rows, rowNumbers: rows.map((_, i) => i + 2), mapping, existingCustomers: existing, programs: PROGRAMS, tokenOverrides: overrides, yieldEvery: 0 });
}
const cust = (over) => ({ id: "c1", fullName: "Existing Person", phone: "01012345678", normalizedPhone: "01012345678", secondaryPhones: [], interestedProgramIds: [], archivedAt: null, ...over });

// ── 1. name + phone accepted ─────────────────────────────────────────
console.log("REQ 1 — name + phone -> accepted");
{
  const p = await plan([{ name: "Ahmed Ali", phone: "01012345678", courses: "" }]);
  eq("row accepted", p.rows[0].status, "accepted");
  eq("one new customer", p.customersToCreate.length, 1);
  eq("name kept", p.customersToCreate[0].fullName, "Ahmed Ali");
  eq("phone stored cleaned", p.customersToCreate[0].phone, "01012345678");
}

// ── 2. phone only accepted ───────────────────────────────────────────
console.log("REQ 2 — phone only -> accepted (empty name, never invented)");
{
  const p = await plan([{ name: "", phone: "01112345678", courses: "" }]);
  eq("row accepted", p.rows[0].status, "accepted");
  eq("fullName is the empty string", p.customersToCreate[0].fullName, "");
  eq("counted as a customer with a missing name", p.stats.missingNameCustomers, 1);
  const noNameCol = await plan([{ phone: "01112345678" }], { mapping: { phone: "phone", name: null, programs: [] } });
  eq("works with no name COLUMN at all", [noNameCol.rows[0].status, noNameCol.customersToCreate[0].fullName], ["accepted", ""]);
  const doc = buildCustomerDoc({ fullName: p.customersToCreate[0].fullName, phone: p.customersToCreate[0].phone }, {});
  eq("built customer doc has empty fullName (schema default)", doc.fullName, "");
}

// ── 3. name only rejected ────────────────────────────────────────────
console.log("REQ 3 — name only -> rejected");
{
  const p = await plan([{ name: "Sara Hassan", phone: "", courses: "Front-End" }]);
  eq("row rejected", p.rows[0].status, "rejected");
  eq("reason NO_PHONE", p.rows[0].reasons[0].code, "NO_PHONE");
  eq("nothing created", [p.customersToCreate.length, p.customersToUpdate.length], [0, 0]);
  eq("counted as missing phone + needs manual review", [p.stats.missingPhoneRows, p.stats.manualReviewRows], [1, 1]);
}

// ── 4. neither rejected ──────────────────────────────────────────────
console.log("REQ 4 — no name and no phone -> rejected");
{
  const p = await plan([{ name: "", phone: "", courses: "" }, { name: "  ", phone: "   ", courses: "" }]);
  eq("both rows rejected", p.rows.map((r) => r.status), ["rejected", "rejected"]);
  eq("nothing created", p.customersToCreate.length, 0);
}

// ── 5. existing phone reuses the customer ────────────────────────────
console.log("REQ 5 — phone that already exists reuses that customer");
{
  const existing = [cust({ id: "c1", phone: "01012345678" })];
  const p = await plan([{ name: "Someone", phone: "+20 101 234 5678", courses: "Front-End" }], { existing });
  eq("no new customer", p.customersToCreate.length, 0);
  eq("update targets the existing customer id", p.customersToUpdate.map((u) => u.customerId), ["c1"]);
  eq("counted as existing", p.stats.existingCustomers, 1);
}

// ── 6. same phone twice in one file ──────────────────────────────────
console.log("REQ 6 — same phone repeated in the SAME file -> one customer, interests merged");
{
  const p = await plan([
    { name: "Omar", phone: "01234567890", courses: "Front-End" },
    { name: "Omar K", phone: "0020 123 456 7890", courses: "Data Analysis" },
    { name: "", phone: "+201234567890", courses: "UI/UX" },
  ]);
  eq("exactly one customer created", p.customersToCreate.length, 1);
  eq("interests from every row merged", p.customersToCreate[0].interestedProgramIds, ["FRONT", "DATA", "UIUX"]);
  eq("later rows flagged as duplicates", p.stats.duplicateRows, 2);
  eq("first name kept (a different later name is only a warning)", p.customersToCreate[0].fullName, "Omar");
  check("name conflict surfaced for review", p.rows[1].warnings.some((w) => w.code === "NAME_CONFLICT"));
  const fillsLater = await plan([{ name: "", phone: "01234567890", courses: "" }, { name: "Late Name", phone: "01234567890", courses: "" }]);
  eq("empty first name is filled from a later row", fillsLater.customersToCreate[0].fullName, "Late Name");
}

// ── 7. multiple interested programs ──────────────────────────────────
console.log("REQ 7 — multiple interested programs in one cell are all stored");
{
  for (const cell of ["Front-End, Data Analysis", "Front-End + Data Analysis", "Front-End ; Data Analysis", "Front-End، Data Analysis", "Front-End\nData Analysis", "Front-End | Data Analysis"]) {
    const p = await plan([{ name: "A", phone: "01012345678", courses: cell }]);
    eq(`delimiter in ${JSON.stringify(cell)}`, p.customersToCreate[0].interestedProgramIds, ["FRONT", "DATA"]);
  }
  const p = await plan([{ name: "A", phone: "01012345678", courses: "UI/UX, Front-End Development, Data Analysis" }]);
  eq("UI/UX stays one name; 'Front-End Development' resolves to Front-End", p.customersToCreate[0].interestedProgramIds, ["UIUX", "FRONT", "DATA"]);
  eq("counted as new interests", p.stats.newInterests, 3);
  const ar = await plan([{ name: "A", phone: "01012345678", courses: "فرونت اند، تحليل البيانات" }]);
  eq("Arabic program names match", ar.customersToCreate[0].interestedProgramIds, ["FRONT", "DATA"]);
  const bil = await plan([{ name: "A", phone: "01012345678", courses: "أساسيات الكمبيوتر - Computer Basics" }]);
  eq("a bilingual label is ONE program, not two", [bil.customersToCreate[0].interestedProgramIds, bil.stats.unmatchedProgramsDistinct], [["BASICS"], 0]);
  const multiCol = await plan([{ name: "A", phone: "01012345678", c1: "Front-End", c2: "Data Analysis" }], { mapping: { phone: "phone", name: "name", programs: ["c1", "c2"] } });
  eq("several interest columns combine", multiCol.customersToCreate[0].interestedProgramIds, ["FRONT", "DATA"]);
}

// ── 8. unknown program ───────────────────────────────────────────────
console.log("REQ 8 — unknown program: flagged for manual review, never creates a Program");
{
  const p = await plan([{ name: "A", phone: "01012345678", courses: "Front-End, Underwater Basket Weaving" }]);
  eq("known interest kept", p.customersToCreate[0].interestedProgramIds, ["FRONT"]);
  eq("unknown one reported", p.unmatchedPrograms.map((u) => [u.token, u.rows]), [["Underwater Basket Weaving", [2]]]);
  check("row flagged for manual review", p.rows[0].warnings.some((w) => w.code === "UNMATCHED_PROGRAM"));
  eq("the customer is STILL imported", p.customersToCreate.length, 1);
  eq("catalog fixture untouched", JSON.stringify(PROGRAMS), NODES_BEFORE);
  const archived = await plan([{ name: "A", phone: "01012345678", courses: "Old Course" }]);
  eq("an archived/inactive Program is never matched", [archived.customersToCreate[0].interestedProgramIds, archived.unmatchedPrograms.length], [[], 1]);
  const ai = await plan([{ name: "A", phone: "01012345678", courses: "AI" }]);
  eq("bare 'AI' (several AI programs) is never guessed", [ai.customersToCreate[0].interestedProgramIds, ai.unmatchedPrograms.length], [[], 1]);
  const idx = buildProgramIndex(PROGRAMS);
  const amb = matchProgramToken("AI", idx);
  eq("token overrides are explicit: mapping an unmatched name to a chosen Program", (await plan([{ name: "A", phone: "01012345678", courses: "AI" }], { overrides: { [programTokenKey("AI")]: "AI2" } })).customersToCreate[0].interestedProgramIds, ["AI2"]);
  eq("an unknown token stays unmatched at the matcher level", [amb.ids, amb.unmatched.length], [[], 1]);
  const bu = await plan([{ name: "A", phone: "01012345678", courses: "Tech Unit" }]);
  eq("a business unit / non-program node is never matched", bu.customersToCreate[0].interestedProgramIds, []);
}

// ── 9. existing + imported interests merge ───────────────────────────
console.log("REQ 9 — existing interests are kept, imported ones appended (never overwritten)");
{
  const existing = [cust({ interestedProgramIds: ["AI1", "OLD"] })];
  const p = await plan([{ name: "", phone: "01012345678", courses: "Front-End, AI for Business" }], { existing });
  eq("patch keeps existing (incl. one whose Program was later archived) and appends only NEW ids", p.customersToUpdate[0].patch.interestedProgramIds, ["AI1", "OLD", "FRONT"]);
  eq("only the new one is counted as an added interest", [p.customersToUpdate[0].addedInterestIds, p.stats.newInterests], [["FRONT"], 1]);
  const same = await plan([{ name: "", phone: "01012345678", courses: "AI for Business" }], { existing });
  eq("re-importing an interest already stored changes nothing", [same.customersToUpdate.length, same.stats.newInterests, same.stats.unchangedExistingCustomers], [0, 0, 1]);
  const none = await plan([{ name: "", phone: "01012345678", courses: "" }], { existing });
  eq("no interests in the file -> existing ones are never removed", [none.customersToUpdate.length], [0]);
  const v = validateInterestedProgramIds(p.customersToUpdate[0].patch.interestedProgramIds, { existingIds: ["AI1", "OLD"], nodeById });
  eq("the final commit guard accepts exactly that patch", [v.valid, v.invalid], [["AI1", "OLD", "FRONT"], []]);
}

// ── 10. existing name preserved ──────────────────────────────────────
console.log("REQ 10 — existing name is preserved when the imported name is empty (and never overwritten)");
{
  const existing = [cust({ fullName: "Existing Person" })];
  const emptyName = await plan([{ name: "", phone: "01012345678", courses: "Front-End" }], { existing });
  check("no fullName in the patch", !("fullName" in emptyName.customersToUpdate[0].patch));
  const otherName = await plan([{ name: "Totally Different", phone: "01012345678", courses: "Front-End" }], { existing });
  check("a different imported name does NOT overwrite the existing one", !("fullName" in otherName.customersToUpdate[0].patch));
  const blank = [cust({ fullName: "" })];
  const fill = await plan([{ name: "Now Known", phone: "01012345678", courses: "" }], { existing: blank });
  eq("an EMPTY existing name is filled from the file", fill.customersToUpdate[0].patch, { fullName: "Now Known" });
  const stillBlank = await plan([{ name: "", phone: "01012345678", courses: "" }], { existing: blank });
  eq("empty stays empty when the file has no name either", [stillBlank.customersToUpdate.length, stillBlank.stats.missingNameCustomers], [0, 1]);
}

// ── 11. existing phone never duplicates ──────────────────────────────
console.log("REQ 11 — an existing phone NEVER produces a duplicate customer, in any spelling");
{
  const existing = [cust({ id: "c1", phone: "01012345678", normalizedPhone: "01012345678" })];
  for (const spelling of ["01012345678", "+201012345678", "00201012345678", "201012345678", "1012345678", "010 1234 5678", "010-1234-5678", "٠١٠١٢٣٤٥٦٧٨", 1012345678]) {
    const p = await plan([{ name: "X", phone: spelling, courses: "Front-End" }], { existing });
    eq(`spelling ${JSON.stringify(spelling)} matches c1`, [p.customersToCreate.length, p.customersToUpdate.map((u) => u.customerId)], [0, ["c1"]]);
  }
  const viaSecondary = await plan([{ name: "X", phone: "01199999999", courses: "" }], { existing: [cust({ id: "c9", phone: "01000000000", normalizedPhone: "01000000000", secondaryPhones: ["01199999999"] })] });
  eq("matches a customer's SECONDARY number too", [viaSecondary.customersToCreate.length, viaSecondary.stats.existingCustomers], [0, 1]);
  const different = await plan([{ name: "X", phone: "01012345679", courses: "" }], { existing });
  eq("a DIFFERENT number is never merged", [different.customersToCreate.length, different.customersToUpdate.length], [1, 0]);
  const archived = await plan([{ name: "X", phone: "01012345678", courses: "Front-End" }], { existing: [cust({ archivedAt: "2026-01-01" })] });
  eq("archived match -> no duplicate, no resurrection, manual review", [archived.customersToCreate.length, archived.customersToUpdate.length, archived.rows[0].status], [0, 0, "skipped"]);
  const ambiguous = await plan([{ name: "X", phone: "01012345678", courses: "" }], { existing: [cust({ id: "a" }), cust({ id: "b" })] });
  eq("phone matching TWO customers is left alone for manual review", [ambiguous.customersToCreate.length, ambiguous.customersToUpdate.length, ambiguous.rows[0].status], [0, 0, "skipped"]);
  const rerun = await plan([{ name: "New Person", phone: "01555555555", courses: "Front-End" }], { existing: [] });
  const after = [{ ...cust({ id: "n1", phone: rerun.customersToCreate[0].phone, normalizedPhone: rerun.customersToCreate[0].normalizedPhone, fullName: "New Person", interestedProgramIds: rerun.customersToCreate[0].interestedProgramIds }) }];
  const again = await plan([{ name: "New Person", phone: "01555555555", courses: "Front-End" }], { existing: after });
  eq("REPEAT SAFETY: running the same file again after import writes nothing", [again.customersToCreate.length, again.customersToUpdate.length, again.stats.newInterests], [0, 0, 0]);
}

// ── 12-14. no engagement / payment / accounting ──────────────────────
console.log("REQ 12-14 — the import cannot create engagements, payments or accounting transactions");
{
  const p = await plan([
    { name: "A", phone: "01012345678", courses: "Front-End" },
    { name: "B", phone: "01112345678", courses: "" },
  ], { existing: [cust({ id: "c9", phone: "01212345678", normalizedPhone: "01212345678" })] });
  const allKeys = new Set([
    ...p.customersToCreate.flatMap((c) => Object.keys(c)),
    ...p.customersToUpdate.flatMap((u) => [...Object.keys(u), ...Object.keys(u.patch)]),
  ]);
  const forbidden = ["engagement", "engagementId", "paymentRecords", "payment", "pricingSnapshot", "amount", "accountingTransactions", "statusId", "ownerId", "assignedTo", "role"];
  eq("plan objects carry no engagement/payment/accounting/status/role fields", forbidden.filter((k) => allKeys.has(k)), []);
  const doc = buildCustomerDoc({ fullName: p.customersToCreate[0].fullName, phone: p.customersToCreate[0].phone, secondaryPhones: [] }, { interestedProgramIds: ["FRONT"] });
  eq("a created customer doc holds identity + interests only", Object.keys(doc).sort(), ["archivedAt", "authUid", "createdAt", "email", "fullName", "interestedProgramIds", "normalizedEmail", "normalizedPhone", "phone", "secondaryPhones", "updatedAt", "whatsapp"]);

  const planner = read("src/utils/leadImport.js");
  const hook = read("src/utils/leadImportCommit.js"); // the write logic (useLeadImportCommit.js is a thin wrapper around it)
  const hookWrapper = read("src/hooks/useLeadImportCommit.js");
  const panel = read("src/pages/admin/crm/newCustomers/LeadExcelImportPanel.jsx");
  const ctx = read("src/context/CustomerContext.jsx");
  const chunkFn = ctx.slice(ctx.indexOf("const commitLeadImportChunk"), ctx.indexOf("// Find-or-create by phone"));
  const sources = { "leadImport.js": planner, "leadImportCommit.js": hook, "useLeadImportCommit.js": hookWrapper, "LeadExcelImportPanel.jsx": panel, "importBatchDoc.js": read("src/utils/importBatchDoc.js") };
  for (const [file, src] of Object.entries(sources)) {
    const bad = ["addEngagement", "addDoc(", "setDoc(", "updateDoc(", "deleteDoc(", "accountingTransactions", "paymentRecords", "catalogNodes", "addCatalogNode", "archiveCustomer", "updateUser", "leadStatus", "collection(db"].filter((k) => src.includes(k));
    eq(`${file} has no write path to engagements/payments/accounting/catalog/statuses/users`, bad, []);
  }
  eq("the chunk writer touches ONLY the customers collection", [chunkFn.includes('collection(db, "customers")'), chunkFn.includes('doc(db, "customers"'), /engagements|accounting|payment|catalogNodes|importBatches/.test(chunkFn)], [true, true, false]);
  check("nothing is written on file selection (the panel's file handler + preview never call the commit hook)", !/onFile[\s\S]*?commitLeadImport[\s\S]*?const reset/.test(panel.slice(panel.indexOf("const onFile"), panel.indexOf("const setField"))));
  check("commitLeadImport is only called from doImport", (panel.match(/commitLeadImport\(/g) || []).length === 1 && panel.indexOf("commitLeadImport(") > panel.indexOf("const doImport"));
  check("the explicit confirmation button exists and asks window.confirm first", panel.includes("استيراد العملاء") && panel.indexOf("window.confirm") < panel.indexOf("commitLeadImport("));
  check("the confirmation sentence is the required one", panel.includes("سيتم إضافة ${s.newCustomers} عميل جديد، وتحديث ${s.updatedCustomers} عميل موجود، وإضافة ${s.newInterests} اهتمام."));
  check("re-plans against current customers before writing", panel.slice(panel.indexOf("const doImport")).indexOf("buildPlanRef.current(") < panel.slice(panel.indexOf("const doImport")).indexOf("commitLeadImport("));
  check("hook creates the tracking batch BEFORE any customer write and aborts if it fails", hook.indexOf("createBatch(") < hook.indexOf("commitLeadImportChunk(chunk)") && hook.includes("aborted: true"));
  check("hook chunks under Firestore's 500-op limit", /LEAD_IMPORT_CHUNK_SIZE = (\d+)/.test(hook) && Number(hook.match(/LEAD_IMPORT_CHUNK_SIZE = (\d+)/)[1]) <= 400);
  check("hook re-validates new interests against the ACTIVE catalog before writing", hook.includes("validateInterestedProgramIds"));
}

// ── phone normalization ──────────────────────────────────────────────
console.log("Phone normalization");
{
  for (const [raw, want] of [
    ["01012345678", "01012345678"], ["01112345678", "01112345678"], ["01212345678", "01212345678"], ["01512345678", "01512345678"],
    ["+201012345678", "01012345678"], ["00201012345678", "01012345678"], ["201012345678", "01012345678"], ["1012345678", "01012345678"],
    [1012345678, "01012345678"], ["010 1234 5678", "01012345678"], ["(010) 1234-5678", "01012345678"], ["٠١٠١٢٣٤٥٦٧٨", "01012345678"], ["۰۱۰۱۲۳۴۵۶۷۸", "01012345678"],
  ]) eq(`${JSON.stringify(raw)} -> ${want}`, extractPhones(raw).normalized, want);
  eq("landline is invalid", extractPhones("0233445566").status, "invalid");
  eq("too short is invalid", [extractPhones("0101234").status, normalizeImportPhone("0101234").why], ["invalid", "too_short"]);
  eq("12 digits starting with 0 is not a valid number (no country code starts with 0)", normalizeImportPhone("010123456789").why, "bad_country_code");
  eq("a foreign number WITH a country code is valid (the CRM is international)", [extractPhones("+447911123456").status, extractPhones("+447911123456").display], ["ok", "+447911123456"]);
  eq("text is invalid", extractPhones("abc").status, "invalid");
  eq("blank/whitespace is empty, not invalid", [extractPhones("").status, extractPhones("   ").status, extractPhones(null).status], ["empty", "empty", "empty"]);
  const two = extractPhones("01012345678 / 01112345678");
  eq("two numbers in one cell -> primary + secondary", [two.normalized, two.secondaryNormalized], ["01012345678", ["01112345678"]]);
  const p = await plan([{ name: "A", phone: "01012345678 - 01112345678", courses: "" }]);
  eq("secondary numbers are carried onto the new customer", p.customersToCreate[0].secondaryPhones, ["01112345678"]);
  const inv = await plan([{ name: "A", phone: "12345", courses: "" }, { name: "B", phone: "", courses: "" }]);
  eq("invalid vs missing are counted separately", [inv.stats.invalidPhoneRows, inv.stats.missingPhoneRows], [1, 1]);
  eq("original text is preserved on the rejected row", inv.rows[0].phoneRaw, "12345");
}

// ── column recognition ───────────────────────────────────────────────
console.log("Column recognition");
{
  const cases = [
    [["اسم الطالب رباعي", "رقم التليفون", "الكورسات المهتم بيها"], { phone: "رقم التليفون", name: "اسم الطالب رباعي", programs: ["الكورسات المهتم بيها"] }],
    [["الاسم", "رقم الهاتف", "الكورسات المهتم بها"], { phone: "رقم الهاتف", name: "الاسم", programs: ["الكورسات المهتم بها"] }],
    [["اسم الطالب", "الموبايل", "الكورس"], { phone: "الموبايل", name: "اسم الطالب", programs: ["الكورس"] }],
    [["name", "phone", "interested courses"], { phone: "phone", name: "name", programs: ["interested courses"] }],
    [["Name", "Mobile", "Courses"], { phone: "Mobile", name: "Name", programs: ["Courses"] }],
    [["الهاتف", "الدبلومة"], { phone: "الهاتف", name: null, programs: ["الدبلومة"] }],
    [["اسم الدبلومة", "phone"], { phone: "phone", name: null, programs: ["اسم الدبلومة"] }],
    [["phone"], { phone: "phone", name: null, programs: [] }],
    [["Phone", "programs"], { phone: "Phone", name: null, programs: ["programs"] }],
  ];
  for (const [headers, want] of cases) eq(`headers ${JSON.stringify(headers)}`, detectColumns(headers).mapping, want);
  const d = detectColumns(["الاسم", "رقم التليفون", "ملاحظات", "المصدر", "الموظف المسؤول", "عمود غريب"]);
  eq("notes / source / assigned are recognized (but not stored)", [d.recognizedButNotStored.notes, d.recognizedButNotStored.source, d.recognizedButNotStored.assignedTo], [["ملاحظات"], ["المصدر"], ["الموظف المسؤول"]]);
  eq("unknown columns are ignored", d.ignored, ["عمود غريب"]);
  const guessed = detectColumns(["col A", "col B"], [{ "col A": "Ali", "col B": "01012345678" }, { "col A": "Sara", "col B": "01112345678" }]);
  eq("headerless/odd sheet: phone column guessed from the VALUES", [guessed.mapping.phone, guessed.phoneGuessed], ["col B", true]);
  eq("only the phone is required — a sheet with just a phone column plans fine", (await plan([{ p: "01012345678" }], { mapping: detectColumns(["p"], [{ p: "01012345678" }]).mapping })).stats.newCustomers, 1);
}

// ── program token splitting / matching details ───────────────────────
console.log("Program token splitting");
{
  eq("spaced slash splits, bare slash does not", splitProgramCell("A / B, UI/UX"), ["A", "B", "UI/UX"]);
  eq("hyphenated names stay whole", splitProgramCell("Front-End, Back-End"), ["Front-End", "Back-End"]);
  eq("blank cell -> no tokens", splitProgramCell("   "), []);
  eq("'and' inside a program cell splits via weak split", (await plan([{ name: "A", phone: "01012345678", courses: "Front-End and Data Analysis" }])).customersToCreate[0].interestedProgramIds, ["FRONT", "DATA"]);
}

// ── stats / preview shape ────────────────────────────────────────────
console.log("Preview statistics");
{
  const existing = [cust({ id: "c1", phone: "01012345678", normalizedPhone: "01012345678" })];
  const rows = [
    { name: "Ex", phone: "01012345678", courses: "Front-End" },        // existing -> update
    { name: "New1", phone: "01112345678", courses: "Data Analysis" },  // new
    { name: "", phone: "01212345678", courses: "Nope" },               // new, no name, unmatched program
    { name: "Dup", phone: "01112345678", courses: "UI/UX" },          // duplicate of row 3
    { name: "NoPhone", phone: "", courses: "" },                       // missing phone
    { name: "Bad", phone: "123", courses: "" },                        // invalid phone
  ];
  const p = await plan(rows, { existing });
  eq("totals", [p.stats.totalRows, p.stats.validPhoneRows, p.stats.missingPhoneRows, p.stats.invalidPhoneRows, p.stats.duplicateRows], [6, 4, 1, 1, 1]);
  eq("customers", [p.stats.existingCustomers, p.stats.newCustomers, p.stats.updatedCustomers, p.stats.missingNameCustomers], [1, 2, 1, 1]);
  eq("programs", [p.stats.matchedProgramsDistinct, p.stats.unmatchedProgramsDistinct], [3, 1]);
  eq("new interests = FRONT (existing customer) + DATA + UIUX (new customer)", p.stats.newInterests, 3);
  eq("rows needing manual review = missing + invalid + unmatched-program row + name-conflict row", p.stats.manualReviewRows, 4);
  eq("rejected rows carry their real row number and reason", p.rows.filter((r) => r.status === "rejected").map((r) => [r.rowNumber, r.reasons[0].code]), [[6, "NO_PHONE"], [7, "INVALID_PHONE"]]);
  eq("plan is deterministic (planning twice is identical)", JSON.stringify(await plan(rows, { existing })), JSON.stringify(p));
  check("MAX_IMPORT_ROWS guard exists", MAX_IMPORT_ROWS >= 1000);
}

// ── performance: thousands of rows ───────────────────────────────────
console.log("Large files");
{
  const rows = [];
  for (let i = 0; i < 5000; i++) rows.push({ name: `N${i}`, phone: `010${String(10000000 + i)}`, courses: i % 2 ? "Front-End, Data Analysis" : "UI/UX" });
  const t0 = Date.now();
  const p = await planLeadImport({ rows, rowNumbers: rows.map((_, i) => i + 2), mapping: MAP, existingCustomers: [], programs: PROGRAMS, yieldEvery: 400 });
  const ms = Date.now() - t0;
  eq("5000 rows planned", [p.stats.totalRows, p.stats.newCustomers], [5000, 5000]);
  check(`5000 rows plan in a sane time (${ms}ms)`, ms < 5000);
  let progressCalls = 0;
  await planLeadImport({ rows: rows.slice(0, 1000), mapping: MAP, existingCustomers: [], programs: PROGRAMS, yieldEvery: 200, onProgress: () => { progressCalls++; } });
  check("yields to the UI between slices (progress callback fires)", progressCalls >= 4);
}

// ── real .xlsx bytes through the real parser ─────────────────────────
console.log("Real Excel file -> parser -> plan");
{
  const aoa = [
    ["اسم الطالب رباعي", "رقم التليفون", "الكورسات المهتم بيها", "ملاحظات"],
    ["أحمد علي", 1012345678, "Front-End, Data Analysis", "x"],   // numeric cell (Excel dropped the leading 0)
    [null, "01112345678", "UI/UX", null],                          // phone only
    [null, null, null, null],                                      // blank row (skipped, but numbering must survive)
    ["سارة", null, "Front-End", null],                             // name only -> rejected
    ["أحمد علي", "+20 101 234 5678", "AI", null],                  // duplicate of row 2, ambiguous program token
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const fakeFile = { name: "leads.xlsx", arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  const parsed = await parseWorkbookFileWithRowNumbers(fakeFile);
  const sh = parsed.sheets[0];
  eq("header detected", [sh.hasHeader, sh.headers], [true, ["اسم الطالب رباعي", "رقم التليفون", "الكورسات المهتم بيها", "ملاحظات"]]);
  eq("blank rows dropped but REAL Excel row numbers kept", sh.rowNumbers, [2, 3, 5, 6]);
  const det = detectColumns(sh.headers, sh.rows);
  const p = await planLeadImport({ rows: sh.rows, rowNumbers: sh.rowNumbers, mapping: det.mapping, existingCustomers: [], programs: PROGRAMS, yieldEvery: 0 });
  eq("numeric phone cell regains its leading zero and dedups with the +20 spelling", p.customersToCreate.map((c) => [c.phone, c.fullName, c.interestedProgramIds]), [
    ["01012345678", "أحمد علي", ["FRONT", "DATA"]],
    ["01112345678", "", ["UIUX"]],
  ]);
  eq("name-only row 5 is rejected with its real row number", p.rows.filter((r) => r.status === "rejected").map((r) => [r.rowNumber, r.name, r.reasons[0].code]), [[5, "سارة", "NO_PHONE"]]);
  eq("ambiguous 'AI' on row 6 surfaces for manual review", p.unmatchedPrograms.map((u) => [u.token, u.rows]), [["AI", [6]]]);
}

// ── permissions & rules (source-level) ───────────────────────────────
console.log("Permissions / Firestore rules");
{
  const rules = read("firestore.rules");
  const block = rules.slice(rules.indexOf("match /importBatches/{id}"), rules.indexOf("match /accountingEvents"));
  check("importBatches: read stays admin-only", /allow read: if isAdmin\(\);/.test(block));
  check("importBatches: delete stays admin-only", /allow delete: if isAdmin\(\);/.test(block));
  check("importBatches: Sales create limited to their OWN customer_leads batch", block.includes("get('kind', '') == 'customer_leads'") && block.includes("get('importedBy', '') == request.auth.uid") && block.includes("get('status', '') == 'committing'"));
  check("importBatches: Sales create cannot carry engagements", block.includes("get('createdEngagementIds', []).size() == 0"));
  check("importBatches: Sales update limited to a counter allow-list", /hasOnly\(\[[^\]]*'status'[^\]]*'interestsAddedCount'[^\]]*\]\)/.test(block) && !/hasOnly\(\[[^\]]*'importedBy'/.test(block));
  check("importBatches: no accounting role clause anywhere", !/isAccountingStaff/.test(block));
  const customersBlock = rules.slice(rules.indexOf("match /customers/{id}"), rules.indexOf("match /engagements/{id}"));
  check("customers rule unchanged: Sales update allow-list still covers interestedProgramIds + fullName", customersBlock.includes("'interestedProgramIds'") && customersBlock.includes("'fullName'"));
  check("engagements / accountingTransactions rules were not touched by this feature", !/LEAD-IMPORT/.test(rules.slice(rules.indexOf("match /engagements/{id}"), rules.indexOf("match /importProfiles"))));
  const shell = read("src/pages/admin/AdminShell.jsx");
  check("Accounting is still redirected away from عملاء جدد (admin + sales only)", shell.includes('section === "newCustomers" && currentUser?.role !== "admin" && currentUser?.role !== "sales"'));
  check("no 'operation' role was invented", !/["']operation["']/.test(read("src/utils/leadImport.js") + read("src/hooks/useLeadImportCommit.js") + read("src/utils/leadImportCommit.js") + read("src/pages/admin/crm/newCustomers/LeadExcelImportPanel.jsx")) && !/isOperationStaff/.test(rules));
  const batchCtx = read("src/context/ImportBatchContext.jsx");
  check("createBatch builds its document through buildImportBatchDoc (kind only when given, no undefined fields)", batchCtx.includes("buildImportBatchDoc(form, { currentUser })") && read("src/utils/importBatchDoc.js").includes("...(form.kind ? { kind: form.kind } : {})"));
  check("lead batches are excluded from Program Import History (their rollback would be partial)", read("src/pages/admin/crm/import/ImportHistoryList.jsx").includes('b.kind !== "customer_leads"'));
  const modal = read("src/pages/admin/crm/newCustomers/AddNewCustomerModal.jsx");
  check("manual Add New Customer no longer requires a name (phone only)", !/Enter a full name/.test(modal) && /Enter a phone number/.test(modal));
}

// ══════════════ WORKFLOW v2: any file in, programs chosen separately ══════════════
const asFile = (name, bytes) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => Buffer.from(bytes).toString("utf8") });
async function runFile(file, opts = {}) {
  const parsed = await parseWorkbookFileWithRowNumbers(file);
  const sh = parsed.sheets[0];
  const det = detectColumns(sh.headers, sh.rows, { hasHeader: sh.hasHeader });
  const p = await planLeadImport({ rows: sh.rows, rowNumbers: sh.rowNumbers, mapping: det.mapping, existingCustomers: opts.existing || [], programs: PROGRAMS, batchProgramIds: opts.batch || [], yieldEvery: 0 });
  return { sh, det, p };
}
const xlsxBytes = (aoa) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1"); return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }); };

const USER_EXAMPLE = [
  ["Name", "Phone"],
  ["Test Person A", "01200000001"],
  ["Test Person B", "01200000002"],
  ["Test Person C", "01100000003"],
  [null, "01000000004"],
  ["Test Person D", "01100000005"],
  ["Test Person E", "01000000006"],
  ["Test Person F", "01000000007"],
  ["Test Person G", "01200000008"],
  [null, "01000000009"],
];

console.log("V2 — the exact Name | Phone example (real .xlsx) is accepted, including the rows with no name");
{
  const { sh, det, p } = await runFile(asFile("waiting.xlsx", xlsxBytes(USER_EXAMPLE)));
  eq("only Name + Phone columns detected; no program column needed", [det.mapping.name, det.mapping.phone, det.mapping.programs], ["Name", "Phone", []]);
  eq("9 data rows parsed", sh.rows.length, 9);
  eq("ALL 9 accepted, none rejected", [p.rows.filter((r) => r.status === "accepted").length, p.rows.filter((r) => r.status !== "accepted").length], [9, 0]);
  eq("9 new customers", p.stats.newCustomers, 9);
  eq("عدد الأرقام (valid phone numbers) = 9", [p.stats.validPhoneRows, p.stats.uniquePhones], [9, 9]);
  eq("the two nameless rows were imported with an empty name", p.customersToCreate.filter((c) => c.fullName === "").map((c) => c.phone), ["01000000004", "01000000009"]);
  eq("missing-name customers counted (2), but NOT rejected and NOT in the review list", [p.stats.missingNameCustomers, p.stats.manualReviewRows, p.stats.notImportedRows], [2, 0, 0]);
  eq("no interests when none are chosen and the file has no program column", [p.stats.newInterests, p.customersToCreate.every((c) => c.interestedProgramIds.length === 0)], [0, true]);
  eq("names are kept for the rows that have them", p.customersToCreate.slice(0, 3).map((c) => c.fullName), ["Test Person A", "Test Person B", "Test Person C"]);
}
console.log("V2 — the same example as CSV");
{
  const csv = "Name,Phone\nTest Person A,01200000001\n,01000000004\nTest Person G,01200000008\n,01000000009\n";
  const { p } = await runFile(asFile("waiting.csv", Buffer.from("﻿" + csv)));
  eq("CSV (with BOM) -> 4 accepted, 2 nameless", [p.stats.newCustomers, p.stats.missingNameCustomers, p.stats.notImportedRows], [4, 2, 0]);
}

console.log("V2 — no template: any layout is fine");
{
  const phoneOnly = await runFile(asFile("p.xlsx", xlsxBytes([["Phone"], ["01012345678"], ["01112345678"]])));
  eq("a single Phone column", [phoneOnly.p.stats.newCustomers, phoneOnly.p.stats.missingNameCustomers], [2, 2]);
  const headerless = await runFile(asFile("h.xlsx", xlsxBytes([["01012345678"], ["01112345678"], ["01212345678"]])));
  eq("no header row at all, just numbers", [headerless.sh.hasHeader, headerless.det.mapping.phone, headerless.p.stats.newCustomers], [false, "Column 1", 3]);
  const headerlessNamed = await runFile(asFile("hn.xlsx", xlsxBytes([["أحمد علي", "01012345678"], ["سارة حسن", "01112345678"], [null, "01212345678"]])));
  eq("headerless Name|Phone: name column guessed from the values", [headerlessNamed.det.mapping.name, headerlessNamed.det.nameGuessed, headerlessNamed.p.customersToCreate.map((c) => c.fullName)], ["Column 1", true, ["أحمد علي", "سارة حسن", ""]]);
  const cols = await runFile(asFile("x.xlsx", xlsxBytes([["Phone Number", "City", "Notes", "Source", "Assigned Employee", "Age", "Whatever"], ["01012345678", "Cairo", "n", "FB", "Mona", 22, "z"], ["01112345678", null, null, null, null, null, null]])));
  eq("many unrelated extra columns never block the import", [cols.p.stats.newCustomers, cols.p.stats.notImportedRows, cols.det.mapping.programs], [2, 0, []]);
  eq("an unknown extra column is NOT mistaken for the name when headers exist", cols.det.mapping.name, null);
  const noPhone = await runFile(asFile("np.xlsx", xlsxBytes([["Name", "City"], ["Ahmed", "Cairo"], ["Sara", "Giza"]])));
  eq("a file with no phone column at all imports nothing (no phone to key on)", noPhone.det.mapping.phone, null);
  const reordered = await runFile(asFile("r.xlsx", xlsxBytes([["ملاحظات", "الموبايل", "الاسم"], ["x", "01012345678", "منى"], ["y", "01112345678", null]])));
  eq("columns in any order / Arabic headers", [reordered.p.customersToCreate.map((c) => [c.phone, c.fullName])], [[["01012345678", "منى"], ["01112345678", ""]]]);
}

console.log("V2 — programs chosen ONCE for the whole import (batch interests)");
{
  const { p } = await runFile(asFile("waiting.xlsx", xlsxBytes(USER_EXAMPLE)), { batch: ["FRONT", "DATA"] });
  eq("every one of the 9 new customers gets BOTH selected interests", p.customersToCreate.every((c) => JSON.stringify(c.interestedProgramIds) === JSON.stringify(["FRONT", "DATA"])), true);
  eq("new interests = 9 customers x 2 programs", p.stats.newInterests, 18);
  eq("selected-program count reported", p.stats.batchProgramCount, 2);
  eq("nameless rows get the interests too", p.customersToCreate.filter((c) => !c.fullName).every((c) => c.interestedProgramIds.length === 2), true);

  const existing = [
    cust({ id: "e1", phone: "01200000001", normalizedPhone: "01200000001", interestedProgramIds: ["AI1", "OLD"] }),
    cust({ id: "e2", phone: "01200000002", normalizedPhone: "01200000002", interestedProgramIds: ["FRONT"] }),
  ];
  const merged = (await runFile(asFile("waiting.xlsx", xlsxBytes(USER_EXAMPLE)), { existing, batch: ["FRONT", "DATA"] })).p;
  const u1 = merged.customersToUpdate.find((u) => u.customerId === "e1");
  const u2 = merged.customersToUpdate.find((u) => u.customerId === "e2");
  eq("existing customer: old interests (even an archived one) kept + selected appended", u1.patch.interestedProgramIds, ["AI1", "OLD", "FRONT", "DATA"]);
  eq("existing customer that already has one of them: only the missing one is added", [u2.patch.interestedProgramIds, u2.addedInterestIds], [["FRONT", "DATA"], ["DATA"]]);
  eq("existing customers reused, 7 new created", [merged.stats.existingCustomers, merged.stats.newCustomers], [2, 7]);
  eq("interests added = 7x2 new + 2 (e1) + 1 (e2)", merged.stats.newInterests, 17);
  check("existing names are not touched by a batch-interest import", merged.customersToUpdate.every((u) => !("fullName" in u.patch)));

  const repeat = await plan([{ name: "A", phone: "01012345678" }], { existing: [cust({ interestedProgramIds: ["FRONT", "DATA"] })], mapping: { phone: "phone", name: "name", programs: [] } });
  eq("nothing to do when the customer already has every selected interest (no batch passed here -> unchanged)", repeat.customersToUpdate.length, 0);
  const again = await planLeadImport({ rows: [{ phone: "01012345678" }], mapping: { phone: "phone", name: null, programs: [] }, existingCustomers: [cust({ interestedProgramIds: ["FRONT", "DATA"] })], programs: PROGRAMS, batchProgramIds: ["FRONT", "DATA"], yieldEvery: 0 });
  eq("REPEAT SAFETY with batch interests: already-stored -> writes nothing", [again.customersToUpdate.length, again.stats.newInterests, again.stats.unchangedExistingCustomers], [0, 0, 1]);

  const rejects = await planLeadImport({ rows: [{ phone: "" , name: "NoPhone" }, { phone: "12" }, { phone: "01012345678" }], mapping: { phone: "phone", name: "name", programs: [] }, existingCustomers: [], programs: PROGRAMS, batchProgramIds: ["FRONT"], yieldEvery: 0 });
  eq("batch interests apply ONLY to accepted rows (rejected rows create nothing)", [rejects.customersToCreate.length, rejects.customersToCreate[0].interestedProgramIds, rejects.stats.newInterests], [1, ["FRONT"], 1]);
  const skipped = await planLeadImport({ rows: [{ phone: "01012345678" }], mapping: { phone: "phone", name: null, programs: [] }, existingCustomers: [cust({ archivedAt: "2026-01-01" })], programs: PROGRAMS, batchProgramIds: ["FRONT"], yieldEvery: 0 });
  eq("archived-customer rows are skipped: no interests written to them", [skipped.customersToUpdate.length, skipped.stats.newInterests], [0, 0]);

  const bad = await planLeadImport({ rows: [{ phone: "01012345678" }], mapping: { phone: "phone", name: null, programs: [] }, existingCustomers: [], programs: PROGRAMS, batchProgramIds: ["OLD", "BU", "NOPE", "FRONT", "FRONT"], yieldEvery: 0 });
  eq("only ACTIVE catalog Programs can be applied (archived / business unit / unknown ids dropped, dupes collapsed)", [bad.customersToCreate[0].interestedProgramIds, bad.stats.batchProgramCount], [["FRONT"], 1]);
  eq("catalog fixture untouched by any plan", JSON.stringify(PROGRAMS), NODES_BEFORE);

  const both = await planLeadImport({ rows: [{ phone: "01012345678", courses: "UI/UX" }], mapping: MAP && { phone: "phone", name: null, programs: ["courses"] }, existingCustomers: [], programs: PROGRAMS, batchProgramIds: ["FRONT"], yieldEvery: 0 });
  eq("an OPTIONAL per-row program column and the batch selection combine", both.customersToCreate[0].interestedProgramIds, ["UIUX", "FRONT"]);
  const noBatch = await planLeadImport({ rows: [{ phone: "01012345678" }], mapping: { phone: "phone", name: null, programs: [] }, existingCustomers: [], programs: PROGRAMS, yieldEvery: 0 });
  eq("batch selection is optional", [noBatch.customersToCreate[0].interestedProgramIds, noBatch.stats.batchProgramCount], [[], 0]);
}

console.log("V2 — UI wiring (source-level)");
{
  const panel = read("src/pages/admin/crm/newCustomers/LeadExcelImportPanel.jsx");
  const picker = read("src/components/crm/InterestedPrograms.jsx");
  check("panel reuses the existing catalog multi-select (InterestedProgramsPicker), not a copy", panel.includes('import { InterestedProgramsPicker } from "../../../../components/crm/InterestedPrograms"') && /<InterestedProgramsPicker value=\{batchProgramIds\}/.test(panel));
  check('picker shows "الكورسات المهتم بيها" + "اختياري" (optional) and the interests-only note', picker.includes('tx("الكورسات المهتم بيها", "Interested Programs")') && picker.includes('tx("اختياري", "optional")') && picker.includes("INTEREST_ONLY_NOTE_AR"));
  check('"عدد الأرقام: X" is shown from the plan', panel.includes("عدد الأرقام: ${s.validPhoneRows}"));
  check("the picker and the count are shown BEFORE the preview grid + import button", panel.indexOf("<InterestedProgramsPicker") < panel.indexOf('tx("استيراد العملاء"') && panel.indexOf("عدد الأرقام") < panel.indexOf('tx("استيراد العملاء"'));
  check("batch programs feed BOTH the preview plan and the fresh confirm-time re-plan", (panel.match(/batchProgramIds \}\)/g) || []).length >= 2 && panel.includes("[sheet, mapping, tokenOverrides, batchProgramIds]"));
  check("choosing programs never writes: setBatchProgramIds only sets state", !/setBatchProgramIds\([^)]*commit/.test(panel));
  check("selection is reset when a new file is chosen (interests can't leak onto another list)", panel.slice(panel.indexOf("const onFile"), panel.indexOf("// Preview =")).includes("setBatchProgramIds([])"));
  const hook = read("src/utils/leadImportCommit.js");
  check("commit path is unchanged: still customers + one importBatches doc only, re-validating every interest", hook.includes("validateInterestedProgramIds") && !/engagement|payment|accounting/i.test(hook.replace(/No engagement[^\n]*\n|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")));
}

// ══════════════ FIX: importBatch payload + international phones ══════════════
import { buildImportBatchDoc, omitUndefined } from "../src/utils/importBatchDoc.js";
import { runLeadImportCommit } from "../src/utils/leadImportCommit.js";
import { normalizePhone } from "../src/utils/leadDedupe.js";

/** Same rule Firestore's addDoc/updateDoc/batch.set enforce: no `undefined` anywhere in a payload. */
function findUndefined(v, path = "$") {
  if (v === undefined) return [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => findUndefined(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => findUndefined(x, `${path}.${k}`));
  return [];
}
const firestoreStrict = (label, payload) => {
  const bad = findUndefined(payload);
  if (bad.length) throw new Error(`Function ${label}() called with invalid data. Unsupported field value: undefined (found in field ${bad[0]})`);
  return payload;
};

console.log("FIX #1 — lead import batch is created WITHOUT an importProfileId");
{
  const user = { id: "uid-sales", name: "Sales 01" };
  const leadDoc = buildImportBatchDoc({ kind: "customer_leads", fileName: "waiting.xlsx" }, { currentUser: user, now: "2026-09-19T00:00:00.000Z" });
  check("importProfileId is omitted entirely (not undefined, not null)", !("importProfileId" in leadDoc));
  check("importProfileVersion is omitted entirely", !("importProfileVersion" in leadDoc));
  eq("no undefined anywhere in the lead batch payload", findUndefined(leadDoc), []);
  eq("lead batch keeps kind + tracking fields", [leadDoc.kind, leadDoc.status, leadDoc.importedBy, leadDoc.fileName, leadDoc.createdEngagementIds], ["customer_leads", "committing", "uid-sales", "waiting.xlsx", []]);
  eq("programId is null (a valid Firestore value), not undefined", leadDoc.programId, null);
  let threw = null;
  try { firestoreStrict("addDoc", leadDoc); } catch (e) { threw = e; }
  eq("the strict Firestore stand-in ACCEPTS the lead batch", threw, null);
  let oldThrew = null;
  try { firestoreStrict("addDoc", { fileName: "x", importProfileId: undefined, importProfileVersion: undefined }); } catch (e) { oldThrew = e.message; }
  check("(control) the old payload shape is rejected by the same stand-in with the production error", /Unsupported field value: undefined \(found in field \$\.importProfileId\)/.test(oldThrew || ""));

  const noUser = buildImportBatchDoc({ kind: "customer_leads", fileName: "a.csv" }, { currentUser: undefined });
  eq("even with no current user: no undefined, importedBy/Name are null", [findUndefined(noUser), noUser.importedBy, noUser.importedByName], [[], null, null]);
  eq("a missing fileName is omitted rather than written as undefined", [findUndefined(buildImportBatchDoc({ kind: "customer_leads" }, {})), "fileName" in buildImportBatchDoc({ kind: "customer_leads" }, {})], [[], false]);
  eq("omitUndefined is deep (objects + arrays) and keeps null / 0 / false / ''", omitUndefined({ a: undefined, b: null, c: 0, d: false, e: "", f: { g: undefined, h: 1 }, i: [1, undefined, { j: undefined, k: 2 }] }), { b: null, c: 0, d: false, e: "", f: { h: 1 }, i: [1, { k: 2 }] });
}

console.log("FIX #1 — Program imports (which DO use an Import Profile) are unchanged");
{
  const NOW = "2026-09-19T00:00:00.000Z";
  const user = { id: "uid-admin", name: "Admin" };
  const form = { fileName: "prog.xlsx", importProfileId: "prof-1", importProfileVersion: 3, programId: "FRONT" };
  const doc = buildImportBatchDoc(form, { currentUser: user, now: NOW });
  // The exact document ImportBatchContext.createBatch wrote before this fix, for a Program import:
  const legacy = {
    fileName: "prog.xlsx", importProfileId: "prof-1", importProfileVersion: 3, programId: "FRONT",
    importedBy: "uid-admin", importedByName: "Admin", status: "committing",
    createdCount: 0, updatedCount: 0, skippedCount: 0, errorCount: 0,
    createdCustomerIds: [], createdEngagementIds: [], rolledBackAt: null, createdAt: NOW, updatedAt: NOW,
  };
  eq("byte-for-byte the same document as before (key set + values)", JSON.stringify(Object.entries(doc).sort()), JSON.stringify(Object.entries(legacy).sort()));
  check("carries importProfileId + version", doc.importProfileId === "prof-1" && doc.importProfileVersion === 3);
  check("no kind on Program imports", !("kind" in doc));
  eq("an Import Profile with version 0 is still written (0 is not 'missing')", buildImportBatchDoc({ ...form, importProfileVersion: 0 }, { currentUser: user }).importProfileVersion, 0);
  const wizard = read("src/hooks/useImportCommit.js");
  check("the Program import call site still passes importProfileId + version (untouched)", /createBatch\(\{[\s\S]*importProfileId: wiz\.profile\.id[\s\S]*importProfileVersion: wiz\.profileVersion\.version[\s\S]*programId: wiz\.program\.id/.test(wizard));
}

console.log("FIX #1 — the WHOLE lead-import commit flow succeeds with a strict (Firestore-like) writer and never writes an undefined");
{
  const written = { batches: [], batchUpdates: [], chunks: [] };
  const fakeFirestore = () => {
    let n = 0;
    return {
      createBatch: async (form) => { const d = firestoreStrict("addDoc", buildImportBatchDoc(form, { currentUser: { id: "uid-sales", name: "Sales 01" } })); written.batches.push(d); return "batch1"; },
      updateBatch: async (id, updates) => { written.batchUpdates.push(firestoreStrict("updateDoc", { ...omitUndefined(updates), updatedAt: "now" })); },
      commitLeadImportChunk: async (ops) => {
        firestoreStrict("writeBatch.commit", ops);
        written.chunks.push(ops);
        return ops.filter((o) => o.type === "create").map(() => `new${++n}`);
      },
    };
  };
  const existing = [cust({ id: "e1", phone: "01200000001", normalizedPhone: "01200000001", interestedProgramIds: ["AI1"] })];
  const rows = [
    { Name: "Test Person A", Phone: "01200000001" },
    { Name: "Test Person B", Phone: "01200000002" },
    { Name: "", Phone: "01000000004" },
    { Name: "Intl", Phone: "+971 50 123 4567" },
  ];
  const pl = await planLeadImport({ rows, rowNumbers: [2, 3, 4, 5], mapping: { phone: "Phone", name: "Name", programs: [] }, existingCustomers: existing, programs: PROGRAMS, batchProgramIds: ["FRONT", "DATA"], yieldEvery: 0 });
  const fs = fakeFirestore();
  const res = await runLeadImportCommit({ plan: pl, fileName: "waiting.xlsx", customers: existing, nodeById, ...fs, now: "2026-09-19T00:00:00.000Z" });
  eq("commit completed, not aborted, no errors", [res.aborted, res.errors, res.failedChunks], [false, [], 0]);
  eq("3 customers created, 1 existing updated, 8 interests added", [res.createdCustomers, res.updatedCustomers, res.addedInterests], [3, 1, 8]);
  eq("the batch doc was created (kind customer_leads) with NO importProfileId", [written.batches.length, written.batches[0].kind, "importProfileId" in written.batches[0]], [1, "customer_leads", false]);
  eq("batch finalized as committed with the customer ids", [written.batchUpdates[0].status, written.batchUpdates[0].createdCustomerIds, written.batchUpdates[0].updatedCustomerIds], ["committed", ["new1", "new2", "new3"], ["e1"]]);
  eq("NO payload anywhere contains undefined", findUndefined([written.batches, written.batchUpdates, written.chunks]), []);
  const opsFlat = written.chunks.flat();
  eq("every op is a customers create/update — nothing else", [...new Set(opsFlat.map((o) => o.type))].sort(), ["create", "update"]);
  const created = opsFlat.filter((o) => o.type === "create").map((o) => o.data);
  const badKeys = ["engagement", "engagementId", "paymentRecords", "payment", "pricingSnapshot", "amount", "statusId", "ownerId", "role", "importProfileId"];
  eq("no created customer doc carries engagement/payment/accounting/status/role/profile fields", created.flatMap((d) => Object.keys(d)).filter((k) => badKeys.includes(k)), []);
  eq("the selected Programs landed on every created customer (nameless one included)", created.map((d) => [d.phone, d.fullName, d.interestedProgramIds]), [["01200000002", "Test Person B", ["FRONT", "DATA"]], ["01000000004", "", ["FRONT", "DATA"]], ["+971501234567", "Intl", ["FRONT", "DATA"]]]);
  eq("the existing customer's interest was preserved and merged", opsFlat.find((o) => o.type === "update").patch.interestedProgramIds, ["AI1", "FRONT", "DATA"]);
  check("normalizedPhone stored for the international customer equals the matching key the planner used", created[2].normalizedPhone === pl.customersToCreate[2].normalizedPhone && created[2].normalizedPhone === normalizePhone("+971501234567"));
  eq("the tracking batch is created BEFORE any customer chunk", written.batches.length === 1 && written.chunks.length >= 1, true);

  // failure path: batch creation fails -> abort BEFORE any customer is written
  let customerWrites = 0;
  const aborted = await runLeadImportCommit({
    plan: pl, fileName: "w.xlsx", customers: existing, nodeById,
    createBatch: async () => { throw new Error("nope"); }, updateBatch: async () => {}, commitLeadImportChunk: async () => { customerWrites++; return []; },
  });
  eq("if the batch can't be created nothing is written to customers", [aborted.aborted, aborted.errors[0].code, customerWrites], [true, "BATCH_CREATE_FAILED", 0]);
  const nothing = await runLeadImportCommit({ plan: await planLeadImport({ rows: [{ Phone: "" }], mapping: { phone: "Phone", name: null, programs: [] }, existingCustomers: [], programs: PROGRAMS, yieldEvery: 0 }), fileName: "e.xlsx", customers: [], nodeById, ...fakeFirestore() });
  eq("a plan with nothing to write creates no batch at all", [nothing.nothingToDo, nothing.batchId], [true, null]);
}

console.log("FIX #2 — international phone numbers are accepted");
{
  const cases = [
    ["+971 50 123 4567", "+971501234567", "international"],
    ["+966 512345678", "+966512345678", "international"],
    ["+201012345678", "01012345678", "egypt"],
    ["+20 1012345678", "01012345678", "egypt"],
    ["+20 (10) 1234-5678", "01012345678", "egypt"],
    ["0020 101 234 5678", "01012345678", "egypt"],
    ["00971501234567", "+971501234567", "international"],
    ["+44 7911 123456", "+447911123456", "international"],
    ["+1 (202) 555-0123", "+12025550123", "international"],
    ["+٩٧١ ٥٠ ١٢٣ ٤٥٦٧", "+971501234567", "international"],
    ["\u200e+971 50 123 4567\u200f", "+971501234567", "international"],
    ["+971-50-123-4567", "+971501234567", "international"],
    ["971501234567", "+971501234567", "international"],
    ["01012345678", "01012345678", "egypt"],
    ["01112345678", "01112345678", "egypt"],
    ["01212345678", "01212345678", "egypt"],
    ["01512345678", "01512345678", "egypt"],
    ["1012345678", "01012345678", "egypt"],
    ["201012345678", "01012345678", "egypt"],
  ];
  for (const [raw, display, kind] of cases) {
    const r = normalizeImportPhone(raw);
    eq(`${JSON.stringify(raw)} -> ${display} (${kind})`, [r.valid, r.display, r.kind], [true, display, kind]);
  }
  eq("a 12-digit international number is NOT rejected for having more than 11 digits", normalizeImportPhone("+971 50 123 4567").valid, true);
  eq("the digits are never truncated (15-digit E.164 kept whole)", normalizeImportPhone("+123456789012345").display, "+123456789012345");
  eq("matching key equals what the rest of the CRM computes (normalizePhone) for the same number", ["+971 50 123 4567", "+966 512345678", "+201012345678", "01012345678"].map((x) => normalizeImportPhone(x).normalized === normalizePhone(x)), [true, true, true, true]);
  eq("+20 and local Egyptian are the same customer key", normalizeImportPhone("+201012345678").normalized, normalizeImportPhone("01012345678").normalized);
  eq("extractPhones exposes display + key for the international cell", (({ status, display, normalized }) => [status, display, normalized])(extractPhones("+971 50 123 4567")), ["ok", "+971501234567", "971501234567"]);
}

console.log("FIX #2 — invalid / ambiguous values are rejected for manual review, never guessed");
{
  const rej = (raw, why) => { const r = extractPhones(raw); return [r.status, r.why]; };
  eq("empty -> empty (rejected: phone required)", extractPhones("").status, "empty");
  eq("whitespace only -> empty", extractPhones("   ").status, "empty");
  eq('"hello" -> rejected', rej("hello"), ["invalid", "contains_letters"]);
  eq("random text with digits -> rejected", rej("abc123456789"), ["invalid", "contains_letters"]);
  eq("Arabic text -> rejected", rej("مش عارف"), ["invalid", "contains_letters"]);
  eq('"123" -> too short', rej("123"), ["invalid", "too_short"]);
  eq("7 digits -> too short", rej("1234567"), ["invalid", "too_short"]);
  eq("+ with too few digits -> too short", rej("+9715"), ["invalid", "too_short"]);
  eq("16+ digits -> too long (not silently truncated)", rej("+1234567890123456"), ["invalid", "too_long"]);
  eq("international number starting with 0 -> bad country code", rej("+0971501234567"), ["invalid", "bad_country_code"]);
  eq("an unmarked non-Egyptian 10-digit number is AMBIGUOUS, not guessed (asks for the country code)", rej("0512345678"), ["invalid", "ambiguous_country"]);
  eq("an Egyptian landline without +20 is ambiguous too (write it with +20)", rej("0233445566"), ["invalid", "ambiguous_country"]);
  eq("11 digits with an unknown prefix is ambiguous", rej("01312345678"), ["invalid", "ambiguous_country"]);
  eq("the same Egyptian landline WITH +20 is accepted", (({ status, display }) => [status, display])(extractPhones("+20 2 3344 5566")), ["ok", "+20233445566"]);
  eq("stray symbols -> rejected", rej("010@1234#5678"), ["invalid", "invalid_characters"]);
  eq("a + in the middle -> rejected", rej("0101+2345678"), ["invalid", "invalid_characters"]);
  eq("two + signs -> rejected", rej("++971501234567"), ["invalid", "invalid_characters"]);
  eq("counted separately from empty ones in the plan", await (async () => { const p = await plan([{ name: "A", phone: "hello", courses: "" }, { name: "B", phone: "", courses: "" }, { name: "C", phone: "123", courses: "" }]); return [p.stats.invalidPhoneRows, p.stats.missingPhoneRows, p.customersToCreate.length]; })(), [2, 1, 0]);
  eq("a rejected row keeps its original text and a reason", await (async () => { const p = await plan([{ name: "A", phone: "hello", courses: "" }]); return [p.rows[0].phoneRaw, p.rows[0].reasons[0].code, p.rows[0].reasons[0].params.why]; })(), ["hello", "INVALID_PHONE", "contains_letters"]);
}

console.log("FIX #2 — import planning with international numbers");
{
  const p = await plan([
    { name: "Intl UAE", phone: "+971 50 123 4567", courses: "" },
    { name: "Intl KSA", phone: "+966 512345678", courses: "" },
    { name: "Egypt +20", phone: "+201012345678", courses: "" },
    { name: "Egypt local", phone: "01112345678", courses: "" },
  ]);
  eq("all four accepted", [p.rows.map((r) => r.status), p.stats.newCustomers], [["accepted", "accepted", "accepted", "accepted"], 4]);
  eq("stored phones: international keeps +country, Egyptian is the local form", p.customersToCreate.map((c) => c.phone), ["+971501234567", "+966512345678", "01012345678", "01112345678"]);
  eq("phoneKind reported per row", p.rows.map((r) => r.phoneKind), ["international", "international", "egypt", "egypt"]);

  const ex = [cust({ id: "eg", phone: "01012345678", normalizedPhone: "01012345678" })];
  const same = await plan([{ name: "x", phone: "+20 101 234 5678", courses: "" }], { existing: ex });
  eq("+20 number matches the existing local-format Egyptian customer (no duplicate)", [same.customersToCreate.length, same.customersToUpdate.length, same.stats.existingCustomers], [0, 0, 1]);
  const exIntl = [cust({ id: "ae", phone: "+971 50 123 4567", normalizedPhone: normalizePhone("+971 50 123 4567") })];
  const again = await plan([{ name: "x", phone: "+971501234567", courses: "Front-End" }], { existing: exIntl });
  eq("an international customer already in the CRM (however it was typed) is matched, not duplicated", [again.customersToCreate.length, again.customersToUpdate.map((u) => u.customerId)], [0, ["ae"]]);

  const diff = await plan([
    { name: "A", phone: "+971 50 123 4567", courses: "" },
    { name: "B", phone: "+966 50 123 4567", courses: "" },
    { name: "C", phone: "+20 50 123 4567", courses: "" },
    { name: "D", phone: "01001234567", courses: "" },
  ]);
  eq("numbers that merely END the same way are NEVER merged", [diff.customersToCreate.length, diff.stats.duplicateRows], [4, 0]);
  const dup = await plan([{ name: "A", phone: "+971 50 123 4567", courses: "" }, { name: "A2", phone: "00971501234567", courses: "" }, { name: "A3", phone: "971-50-123-4567", courses: "" }]);
  eq("the SAME international number in different spellings is one customer", [dup.customersToCreate.length, dup.stats.duplicateRows], [1, 2]);
  const sec = await plan([{ name: "A", phone: "+971 50 123 4567 / 01012345678", courses: "" }]);
  eq("two numbers in one cell: international primary + Egyptian secondary", [sec.customersToCreate[0].phone, sec.customersToCreate[0].secondaryPhones], ["+971501234567", ["01012345678"]]);
  const withDoc = buildCustomerDoc({ fullName: "", phone: p.customersToCreate[0].phone, secondaryPhones: [] }, {});
  eq("buildCustomerDoc stores an international phone as given and its normalizedPhone equals the plan's key", [withDoc.phone, withDoc.normalizedPhone === p.customersToCreate[0].normalizedPhone], ["+971501234567", true]);
}

console.log("FIX #2 — real .xlsx: Name | Phone with missing names and an international number");
{
  const aoa = [
    ["Name", "Phone"],
    ["Test Person A", "01200000001"],
    ["Test Person B", "01200000002"],
    ["Test Person C", "01100000003"],
    [null, "01000000004"],
    ["Test Person D", "01100000005"],
    ["Test Person E", "01000000006"],
    ["Test Person F", "01000000007"],
    ["Test Person G", "01200000008"],
    [null, "01000000009"],
    ["Intl Customer", "+971 50 123 4567"],
    [null, "+966 512345678"],
  ];
  const { p, det } = await runFile(asFile("waiting.xlsx", xlsxBytes(aoa)), { batch: ["FRONT", "DATA"] });
  eq("Name + Phone detected", [det.mapping.name, det.mapping.phone], ["Name", "Phone"]);
  eq("ALL 11 rows accepted (missing names + international numbers)", [p.rows.filter((r) => r.status === "accepted").length, p.stats.notImportedRows, p.stats.invalidPhoneRows], [11, 0, 0]);
  eq("the international numbers were imported intact", p.customersToCreate.filter((c) => c.phone.startsWith("+")).map((c) => [c.phone, c.fullName]), [["+971501234567", "Intl Customer"], ["+966512345678", ""]]);
  eq("3 customers have no name, none rejected for it", p.stats.missingNameCustomers, 3);
  eq("every accepted customer got both selected interests", p.customersToCreate.every((c) => c.interestedProgramIds.join() === "FRONT,DATA"), true);
  const onlyPhone = await runFile(asFile("p.xlsx", xlsxBytes([["Phone"], ["01012345678"], ["01112345678"], ["+971 50 123 4567"]])));
  eq("a file with ONLY a Phone column (incl. an international number) is accepted", [onlyPhone.p.stats.newCustomers, onlyPhone.p.stats.notImportedRows, onlyPhone.p.stats.missingNameCustomers], [3, 0, 3]);
  const csv = await runFile(asFile("w.csv", Buffer.from("Name,Phone\nA,+971 50 123 4567\n,+966 512345678\nB,01012345678\n")));
  eq("CSV with international numbers", [csv.p.stats.newCustomers, csv.p.customersToCreate.map((c) => c.phone)], [3, ["+971501234567", "+966512345678", "01012345678"]]);
  const mixed = await runFile(asFile("m.xlsx", xlsxBytes([["Name", "Phone"], ["ok", "+971 50 123 4567"], ["txt", "hello"], ["short", "123"], ["none", null], [null, "0512345678"]])));
  eq("bad rows are rejected with reasons, good rows still import", [mixed.p.stats.newCustomers, mixed.p.rows.filter((r) => r.status === "rejected").map((r) => [r.rowNumber, r.reasons[0].code, r.reasons[0].params?.why])], [1, [[3, "INVALID_PHONE", "contains_letters"], [4, "INVALID_PHONE", "too_short"], [5, "NO_PHONE", undefined], [6, "INVALID_PHONE", "ambiguous_country"]]]);
  const numeric = await runFile(asFile("n.xlsx", xlsxBytes([["Phone"], [971501234567], [1012345678]])));
  eq("numeric Excel cells (leading +/0 lost) are still understood", numeric.p.customersToCreate.map((c) => c.phone), ["+971501234567", "01012345678"]);
}

console.log("FIX — scope & safety of this change");
{
  const phoneSrc = read("src/utils/leadImport.js");
  check("dataCleaning.cleanPhone / leadDedupe.normalizePhone (used by the rest of the CRM) are NOT modified by this fix", !/normalizePhone\s*=|function normalizePhone/.test(phoneSrc) && read("src/utils/leadDedupe.js").includes("if (digits.startsWith(\"20\")) digits = digits.slice(2);"));
  check("leadImport.js no longer contains an Egypt-only validity rule for the general phone", !/valid = EG_MOBILE/.test(phoneSrc));
  const importCtx = read("src/context/ImportBatchContext.jsx");
  check("updateBatch strips undefined too", importCtx.includes("...omitUndefined(updates)"));
  const rules = read("firestore.rules");
  check("firestore.rules is not needed for this fix (no importProfileId rule anywhere)", !/importProfileId/.test(rules));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
