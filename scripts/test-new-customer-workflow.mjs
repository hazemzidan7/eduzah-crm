// Ad-hoc test suite for NEW-CUSTOMER-WORKFLOW-01 (the Sales workflow inside
// "عملاء جدد"), run against the real shipped pure module, the real pricing and
// follow-up utilities and the real source/rules files. Firestore is replaced by
// an in-memory stand-in that ENFORCES the real firestore.rules' Sales allow-list
// for customers and models the transactional create-if-absent. Synthetic data
// only. Not part of the app build. Run with:
//   node --import ./scripts/esm-ext-loader.mjs scripts/test-new-customer-workflow.mjs
import { readFileSync } from "node:fs";
import {
  WORKFLOW_STATUS_KEYS, NEW_CUSTOMER_REQUIRED_STATUSES, FOLLOW_UP_STATUS_KEYS, WORKFLOW_CUSTOMER_FIELDS,
  workflowStatusOptions, contactStatusKey, validateContactOutcome, buildContactPatch, buildCustomerEditPatch,
  selectNewCustomers, registrationEngagementId, runRegistration, businessUnitIdOfProgram, REGISTRATION_STATUS_KEYS,
} from "../src/utils/newCustomerWorkflow.js";
import { buildPricingSnapshot, applyPaymentPlan, effectiveCoursePrice } from "../src/utils/pricingSnapshot.js";
import { validateFollowUpDraft, buildFollowUp, buildNextFollowUpDraft } from "../src/utils/followUps.js";
import { normalizePhone } from "../src/utils/leadDedupe.js";
import { buildCustomerDeletionSet } from "../src/utils/deleteCustomer.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); } else { fail++; console.log(`FAIL  - ${name}`); }
}
function eq(name, actual, expected) {
  check(`${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, JSON.stringify(actual) === JSON.stringify(expected));
}
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"); // repo files are CRLF on Windows
const rules = read("firestore.rules");

// ── what the REAL rules say ──────────────────────────────────────────
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const customersBlock = stripComments(rules.slice(rules.indexOf("match /customers/{id}"), rules.indexOf("match /engagements/{id}")));
const SALES_CUSTOMER_ALLOW = [...customersBlock.slice(customersBlock.indexOf("hasOnly([")).matchAll(/'([^']+)'/g)].map((m) => m[1]);
const engagementsBlock = stripComments(rules.slice(rules.indexOf("match /engagements/{id}"), rules.indexOf("match /", rules.indexOf("match /engagements/{id}") + 20)));

// ── catalog + statuses fixtures ──────────────────────────────────────
const NODES = [
  { id: "BU_TECH", type: "business_unit", name_en: "Technology", isActive: true, path: [], parentId: null },
  { id: "BU_LANG", type: "business_unit", name_en: "Language", isActive: true, path: [], parentId: null },
  { id: "CAT", type: "category", name_en: "Dev", isActive: true, path: ["BU_TECH"], parentId: "BU_TECH" },
  { id: "AI", type: "program", name_en: "AI", isActive: true, path: ["BU_TECH", "CAT"], parentId: "CAT", originalPrice: 6000, priceUnit: "program" },
  { id: "DATA", type: "program", name_en: "Data Analysis", isActive: true, path: ["BU_TECH", "CAT"], parentId: "CAT", originalPrice: 5000 },
  { id: "FRONT", type: "program", name_en: "Front-End", isActive: true, path: ["BU_TECH", "CAT"], parentId: "CAT", originalPrice: 4000 },
  { id: "ENGLISH", type: "program", name_en: "English", isActive: true, path: ["BU_LANG"], parentId: "BU_LANG", originalPrice: 2000 },
  { id: "OLD", type: "program", name_en: "Old", isActive: false, archivedAt: "2026-01-01", path: ["BU_TECH"], parentId: "BU_TECH" },
];
const nodeById = (id) => NODES.find((n) => n.id === id) || null;

const SEEDED = [ // what production already has (LeadStatusContext's GLOBAL_STATUS_SEED)
  { id: "s_nc", key: "not_contacted", name_ar: "لم يتم التواصل", name_en: "Not Contacted", isDefault: true, isActive: true },
  { id: "s_fu", key: "follow_up", name_ar: "متابعة", name_en: "Follow-up", isActive: true },
  { id: "s_th", key: "thinking", name_ar: "بيفكر", name_en: "Thinking", isActive: true },
  { id: "s_ni", key: "not_interested", name_ar: "غير مهتم", name_en: "Not Interested", isActive: true },
  { id: "s_wn", key: "wrong_number", name_ar: "رقم خاطئ", name_en: "Wrong Number", isActive: true },
  { id: "s_na", key: "no_answer", name_ar: "لا يرد", name_en: "No Answer", isActive: true },
  { id: "s_bk", key: "booked", name_ar: "تم الحجز", name_en: "Booked", isActive: true },
];
const ADDED = NEW_CUSTOMER_REQUIRED_STATUSES.map((s, i) => ({ id: `s_new${i}`, ...s, isActive: true }));
const ALL_STATUSES = [...SEEDED, ...ADDED];
const statusById = (id) => ALL_STATUSES.find((s) => s.id === id) || null;

const SALES = { id: "uid-sales", name: "Sales 01", role: "sales" };
const ADMIN = { id: "uid-admin", name: "Admin", role: "admin" };
const NOW = "2026-09-19T10:00:00.000Z";
const mk = (over = {}) => ({ id: "c1", fullName: "", phone: "01000000001", normalizedPhone: "01000000001", secondaryPhones: [], email: "", interestedProgramIds: [], archivedAt: null, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", ...over });

// ── in-memory Firestore stand-in ─────────────────────────────────────
function makeEnv({ customers = [mk()], engagements = [] } = {}) {
  const env = {
    customers: new Map(customers.map((c) => [c.id, { ...c }])),
    engagements: new Map(engagements.map((e) => [e.id, { ...e }])),
    counters: { customerCreates: 0, engagementCreates: 0, payments: 0, accounting: 0 },
  };
  env.buildEngagementDoc = (customerId, form) => ({ // stand-in for CustomerContext.buildEngagementDoc: same fields, REAL pricing snapshot
    customerId, businessUnitId: form.businessUnitId, catalogNodeId: form.catalogNodeId || null, stage: "lead",
    studentProfile: { registrationDate: form.studentProfile?.registrationDate || null, attendanceType: form.studentProfile?.attendanceType || "" },
    statusId: form.statusId || null, enrollmentStatus: "not_enrolled", ownerId: form.ownerId || null, salesNotes: form.salesNotes || "",
    payment: { coursePrice: null, paymentPlan: "" }, paymentRecords: [],
    pricingSnapshot: buildPricingSnapshot({ program: nodeById(form.catalogNodeId), businessUnit: nodeById(form.businessUnitId) }),
    timeline: [{ type: "system", text: form.creationNote }], archivedAt: null, createdAt: NOW, updatedAt: NOW,
  });
  env.listCustomerEngagements = async (customerId) => { await Promise.resolve(); return [...env.engagements.entries()].filter(([, e]) => e.customerId === customerId).map(([id, e]) => ({ id, ...e })); };
  env.createEngagementIfAbsent = async (id, data) => { await Promise.resolve(); if (env.engagements.has(id)) return false; env.engagements.set(id, data); env.counters.engagementCreates++; return true; };
  // a SALES session's customer update: only keys in the real rules' allow-list may change
  env.patchCustomer = async (id, patch) => {
    const bad = Object.keys(patch).filter((k) => !SALES_CUSTOMER_ALLOW.includes(k));
    if (bad.length) throw new Error(`PERMISSION_DENIED: customers.update touches ${bad.join(", ")}`);
    if (!env.customers.has(id)) throw new Error("NOT_FOUND");
    env.customers.set(id, { ...env.customers.get(id), ...patch });
  };
  env.customerList = () => [...env.customers.values()];
  env.engagementList = () => [...env.engagements.entries()].map(([id, e]) => ({ id, ...e }));
  return env;
}
const register = (env, customerId, opts = {}) => runRegistration({
  customer: env.customers.get(customerId), programId: opts.programId, name: opts.name, attendanceType: opts.attendanceType, registrationDate: opts.registrationDate,
  currentUser: opts.user || SALES, nodeById, activeGlobalStatuses: opts.statuses || ALL_STATUSES,
  listCustomerEngagements: env.listCustomerEngagements, buildEngagementDoc: env.buildEngagementDoc,
  createEngagementIfAbsent: env.createEngagementIfAbsent, patchCustomer: env.patchCustomer, now: NOW,
});
/** The hook's recordContactOutcome, replayed against the stand-in. */
const recordOutcome = async (env, customerId, { statusKey, plannedProgramId, note, user = SALES, statuses = ALL_STATUSES }) => {
  const statusDoc = workflowStatusOptions(statuses).find((o) => o.key === statusKey)?.status || null;
  const errors = validateContactOutcome({ statusKey, statusDoc, plannedProgramId, nodeById });
  if (errors.length) return { errors };
  await env.patchCustomer(customerId, buildContactPatch({ statusDoc, statusKey, plannedProgramId, note, customer: env.customers.get(customerId), currentUser: user, now: NOW }));
  return { errors: [] };
};

// ══════════════════ 1-3. editing the customer / the name ══════════════════
console.log("1-3. The name is editable, optional, and can arrive later");
{
  const c = mk({ fullName: "Old Name" });
  const r = buildCustomerEditPatch({ customer: c, edits: { fullName: "New Name" }, nodeById, now: NOW });
  eq("name can be edited", [r.patch.fullName, r.errors], ["New Name", []]);
  eq("unchanged name -> no patch at all", buildCustomerEditPatch({ customer: c, edits: { fullName: "Old Name", phone: c.phone, notes: "" }, nodeById }).changed, false);

  const nameless = mk({ fullName: "" });
  eq("a customer can have NO name initially and still be edited (name not required)", buildCustomerEditPatch({ customer: nameless, edits: { fullName: "", notes: "wants weekend batch" }, nodeById, now: NOW }).errors, []);
  eq("a nameless customer appears in the new-customers list", selectNewCustomers([nameless], []).map((x) => x.id), ["c1"]);

  const env = makeEnv({ customers: [nameless] });
  const later = buildCustomerEditPatch({ customer: env.customers.get("c1"), edits: { fullName: "  Sara   Ali " }, nodeById, now: NOW });
  await env.patchCustomer("c1", later.patch);
  eq("the customer later receives a name (whitespace cleaned)", env.customers.get("c1").fullName, "Sara Ali");
  const cleared = buildCustomerEditPatch({ customer: c, edits: { fullName: "" }, nodeById, now: NOW });
  eq("clearing the name is allowed (never a required field)", [cleared.errors, cleared.patch.fullName], [[], ""]);

  eq("phone can never be emptied", buildCustomerEditPatch({ customer: c, edits: { phone: "  " }, nodeById }).errors.map((e) => e.code), ["PHONE_REQUIRED"]);
  eq("an invalid phone is rejected with a reason", buildCustomerEditPatch({ customer: c, edits: { phone: "hello" }, nodeById }).errors.map((e) => [e.code, e.why]), [["PHONE_INVALID", "contains_letters"]]);
  eq("an international phone is accepted (any country)", buildCustomerEditPatch({ customer: c, edits: { phone: "+971 50 123 4567" }, nodeById, now: NOW }).patch, { phone: "+971501234567", normalizedPhone: normalizePhone("+971501234567"), updatedAt: NOW });
  const other = mk({ id: "c2", phone: "01111111111", normalizedPhone: "01111111111" });
  eq("a phone that belongs to ANOTHER customer is refused (no duplicate customer)", buildCustomerEditPatch({ customer: c, edits: { phone: "+20 111 111 1111" }, otherCustomers: [c, other], nodeById }).errors.map((e) => e.code), ["PHONE_DUPLICATE"]);
  eq("saving the customer's own unchanged phone is fine", buildCustomerEditPatch({ customer: c, edits: { phone: c.phone }, otherCustomers: [c, other], nodeById }).errors, []);
  const legacy = mk({ phone: "0233445566", normalizedPhone: "0233445566" });
  eq("a legacy phone is not re-validated when it isn't being changed (name-only edit works)", buildCustomerEditPatch({ customer: legacy, edits: { fullName: "X", phone: legacy.phone }, nodeById, now: NOW }).errors, []);
  eq("notes are editable", buildCustomerEditPatch({ customer: c, edits: { notes: "call after 5pm" }, nodeById, now: NOW }).patch.notes, "call after 5pm");
  eq("assigned employee is admin-only in the form (canAssign)", [
    Object.keys(buildCustomerEditPatch({ customer: c, edits: { assignedToId: "u9", assignedToName: "Mona" }, nodeById, canAssign: false })).includes("assignedToId"),
    buildCustomerEditPatch({ customer: c, edits: { assignedToId: "u9", assignedToName: "Mona" }, nodeById, canAssign: true, now: NOW }).patch.assignedToId,
  ], [false, "u9"]);
}

// ══════════════════ 4. multiple interested programs ══════════════════
console.log("4. Multiple interested Programs remain supported");
{
  const c = mk({ interestedProgramIds: ["OLD"] });
  const r = buildCustomerEditPatch({ customer: c, edits: { interestedProgramIds: ["OLD", "AI", "DATA", "FRONT"] }, nodeById, now: NOW });
  eq("several interests saved; a stored (now archived) interest is kept", r.patch.interestedProgramIds, ["OLD", "AI", "DATA", "FRONT"]);
  eq("a NEW interest must be an active catalog Program (not archived / business unit / unknown)", ["OLD_NEW", "BU_TECH", "NOPE"].map((id) => buildCustomerEditPatch({ customer: mk(), edits: { interestedProgramIds: [id] }, nodeById }).errors[0]?.code), ["INVALID_INTERESTED_PROGRAMS", "INVALID_INTERESTED_PROGRAMS", "INVALID_INTERESTED_PROGRAMS"]);
  eq("an interest can be removed explicitly", buildCustomerEditPatch({ customer: mk({ interestedProgramIds: ["AI", "DATA"] }), edits: { interestedProgramIds: ["AI"] }, nodeById, now: NOW }).patch.interestedProgramIds, ["AI"]);
}

// ══════════════════ 5. contact status ══════════════════
console.log("5. The contact status maps onto EXISTING lead statuses and can be updated");
{
  const opts = workflowStatusOptions(ALL_STATUSES);
  eq("all 7 requested outcomes resolve to a status doc", opts.map((o) => [o.key, !!o.status]), WORKFLOW_STATUS_KEYS.map((k) => [k, true]));
  eq("mapping: لم يتم التواصل / لم يرد / هيفكر / مش مهتم / حجز بالفعل reuse the EXISTING seeded statuses (no duplicates)", ["not_contacted", "no_answer", "thinking", "not_interested", "booked"].map((k) => opts.find((o) => o.key === k).status.id), ["s_nc", "s_na", "s_th", "s_ni", "s_bk"]);
  eq("only مهتم and هيحجز are added", ADDED.map((s) => [s.key, s.name_ar]), [["interested", "مهتم"], ["will_book", "هيحجز"]]);
  const seed = read("src/context/LeadStatusContext.jsx");
  const seededKeys = [...seed.slice(seed.indexOf("GLOBAL_STATUS_SEED = ["), seed.indexOf("];", seed.indexOf("GLOBAL_STATUS_SEED = ["))).matchAll(/key: "([^"]+)"/g)].map((m) => m[1]);
  const seededNamesAr = [...seed.slice(seed.indexOf("GLOBAL_STATUS_SEED = ["), seed.indexOf("];", seed.indexOf("GLOBAL_STATUS_SEED = ["))).matchAll(/name_ar: "([^"]+)"/g)].map((m) => m[1]);
  eq("the two added keys/names collide with NO existing seeded status", [NEW_CUSTOMER_REQUIRED_STATUSES.some((s) => seededKeys.includes(s.key)), NEW_CUSTOMER_REQUIRED_STATUSES.some((s) => seededNamesAr.includes(s.name_ar))], [false, false]);
  eq("and every OTHER outcome key exists in the seed", WORKFLOW_STATUS_KEYS.filter((k) => !NEW_CUSTOMER_REQUIRED_STATUSES.some((s) => s.key === k)).every((k) => seededKeys.includes(k)), true);
  check("the two statuses are ensured idempotently (claim transaction + per-key existence check), admin-only", seed.includes("newCustomerStatusesEnsured") && seed.includes('where("key", "==", st.key)') && /currentUser\?\.role !== "admin"\) return;\s*\(async \(\) => \{\s*const seedStateRef[\s\S]{0,400}newCustomerStatusesEnsured/.test(seed));
  const before = workflowStatusOptions(SEEDED);
  eq("before an admin has opened the CRM the two new statuses are simply unavailable (never invented client-side)", before.filter((o) => !o.status).map((o) => o.key), ["interested", "will_book"]);
  eq("recording one of them then fails cleanly with STATUS_REQUIRED", (await recordOutcome(makeEnv(), "c1", { statusKey: "interested", statuses: SEEDED })).errors, ["STATUS_REQUIRED"]);

  const env = makeEnv();
  await recordOutcome(env, "c1", { statusKey: "thinking", note: "will call back" });
  eq("status recorded on the customer (contactStatusId -> leadStatuses id)", [env.customers.get("c1").contactStatusId, contactStatusKey(env.customers.get("c1"), statusById)], ["s_th", "thinking"]);
  await recordOutcome(env, "c1", { statusKey: "not_interested" });
  eq("the status can be updated later", contactStatusKey(env.customers.get("c1"), statusById), "not_interested");
  eq("a customer with no status recorded reads as لم يتم التواصل", contactStatusKey(mk(), statusById), "not_contacted");
  const patch = buildContactPatch({ statusDoc: statusById("s_th"), statusKey: "thinking", note: "will call back", customer: mk(), currentUser: SALES, now: NOW });
  eq("the note is appended (dated, attributed) to the customer's notes", patch.notes, "[2026-09-19 · Sales 01] will call back");
  eq("an existing note is kept, new one appended", buildContactPatch({ statusDoc: statusById("s_th"), statusKey: "thinking", note: "second", customer: mk({ notes: "first" }), currentUser: SALES, now: NOW }).notes, "first\n[2026-09-19 · Sales 01] second");
  eq("the Sales user who records contact is assigned when the lead has no owner", [patch.assignedToId, patch.assignedToName], ["uid-sales", "Sales 01"]);
  eq("an existing assignee is never taken over", "assignedToId" in buildContactPatch({ statusDoc: statusById("s_th"), statusKey: "thinking", customer: mk({ assignedToId: "someone" }), currentUser: SALES, now: NOW }), false);
  eq("an admin recording contact does not auto-assign themselves", "assignedToId" in buildContactPatch({ statusDoc: statusById("s_th"), statusKey: "thinking", customer: mk(), currentUser: ADMIN, now: NOW }), false);
}

// ══════════════════ 6-8. no engagement for not-ready outcomes ══════════════════
console.log("6-8. لم يرد / هيفكر / مهتم (and the other non-booking outcomes) NEVER create an Engagement");
for (const [n, key] of [[6, "no_answer"], [7, "thinking"], [8, "interested"], [0, "not_contacted"], [0, "not_interested"]]) {
  const env = makeEnv();
  const r = await recordOutcome(env, "c1", { statusKey: key, note: "x" });
  eq(`${key}: recorded, NO engagement created, customer still listed in عملاء جدد`, [r.errors, env.engagementList().length, env.counters.engagementCreates, selectNewCustomers(env.customerList(), env.engagementList()).length], [[], 0, 0, 1]);
}
{
  const hook = read("src/hooks/useNewCustomerWorkflow.js");
  const fn = hook.slice(hook.indexOf("const recordContactOutcome"), hook.indexOf("/** \"تسجيل العميل\""));
  eq("the real recordContactOutcome never touches the engagement builder / create / registration", ["buildEngagementDoc", "createEngagementIfAbsent", "registerCustomer", "runRegistration", "addEngagement"].filter((s) => fn.includes(s)), []);
  const modal = read("src/pages/admin/crm/newCustomers/ContactOutcomeModal.jsx");
  check("saving an outcome from the modal only calls recordContactOutcome (registration is a separate explicit step)", modal.includes("recordContactOutcome(customer") && !modal.includes("registerCustomer"));
}

// ══════════════════ 9. هيحجز requires the actual Program ══════════════════
console.log("9. هيحجز requires selecting an ACTUAL, existing, active catalog Program");
{
  const sd = statusById("s_new1");
  const v = (plannedProgramId) => validateContactOutcome({ statusKey: "will_book", statusDoc: sd, plannedProgramId, nodeById });
  eq("no Program -> PROGRAM_REQUIRED", v(""), ["PROGRAM_REQUIRED"]);
  eq("undefined -> PROGRAM_REQUIRED", v(undefined), ["PROGRAM_REQUIRED"]);
  eq("free text / made-up id -> PROGRAM_INVALID", [v("Machine Learning"), v("fake-program-1")], [["PROGRAM_INVALID"], ["PROGRAM_INVALID"]]);
  eq("an archived Program is refused", v("OLD"), ["PROGRAM_INVALID"]);
  eq("a Business Unit / category is not a Program", [v("BU_TECH"), v("CAT")], [["PROGRAM_INVALID"], ["PROGRAM_INVALID"]]);
  eq("ANY active Program is allowed — no Business-Unit restriction (Technology and Language)", [v("AI"), v("ENGLISH")], [[], []]);
  const env = makeEnv();
  eq("the planned Program is stored on the customer (intent only) with the status", await (async () => { await recordOutcome(env, "c1", { statusKey: "will_book", plannedProgramId: "AI" }); const c = env.customers.get("c1"); return [c.contactStatusId, c.plannedProgramId, env.engagementList().length]; })(), ["s_new1", "AI", 0]);
  await recordOutcome(env, "c1", { statusKey: "thinking" });
  eq("switching to another outcome clears the planned Program (no stale intent)", env.customers.get("c1").plannedProgramId, null);
  const blocked = await recordOutcome(makeEnv(), "c1", { statusKey: "will_book" });
  eq("without a Program nothing is written", blocked.errors, ["PROGRAM_REQUIRED"]);
  eq("حجز بالفعل cannot be set on a customer without an Engagement — it goes through registration", validateContactOutcome({ statusKey: "booked", statusDoc: statusById("s_bk"), nodeById }), ["USE_REGISTRATION"]);
  const modal = read("src/pages/admin/crm/newCustomers/ContactOutcomeModal.jsx");
  const sel = read("src/components/crm/ProgramSelect.jsx");
  check("the UI takes the Program from a <select> of catalog Programs only (no free-text input)", sel.includes("<select") && !/type="text"|<input/.test(sel) && modal.includes("<ProgramSelect") && sel.includes("programsUnder"));
}

// ══════════════════ 10-12. registration ══════════════════
console.log("10-12. Registration creates the normal Engagement for the selected Program, reuses the customer, keeps the interests");
{
  const env = makeEnv({ customers: [mk({ fullName: "", interestedProgramIds: ["AI", "DATA", "FRONT"], notes: "prefers evening", contactStatusId: "s_new1", plannedProgramId: "DATA" })] });
  const res = await register(env, "c1", { programId: "DATA", name: "Mona Samir", attendanceType: "online", registrationDate: "2026-09-19" });
  eq("registered, one engagement", [res.status, env.engagementList().length], ["registered", 1]);
  const e = env.engagementList()[0];
  eq("10. the engagement points at the SELECTED Program and its Business Unit", [e.catalogNodeId, e.businessUnitId, e.customerId], ["DATA", "BU_TECH", "c1"]);
  eq("engagement id is deterministic (customer + Program)", e.id, registrationEngagementId("c1", "DATA"));
  eq("it is a normal not-enrolled engagement: no payment records, no payment, not archived", [e.enrollmentStatus, e.paymentRecords, e.payment.coursePrice, e.archivedAt], ["not_enrolled", [], null, null]);
  eq("status = تم الحجز (booked), owner = the Sales user, notes carried to the Sales Sheet", [e.statusId, e.ownerId, e.salesNotes], ["s_bk", "uid-sales", "prefers evening"]);
  eq("studentProfile matches Add Student's (attendance + registration date)", e.studentProfile, { registrationDate: "2026-09-19", attendanceType: "online" });
  eq("timeline says where it came from", e.timeline[0].text, "Registered from New Customers");
  eq("11. NO second customer was created — the same customer id is reused", [env.customers.size, env.counters.customerCreates, env.customerList().map((c) => c.id)], [1, 0, ["c1"]]);
  const c = env.customers.get("c1");
  eq("12. interestedProgramIds are preserved exactly (interest list is not deleted)", c.interestedProgramIds, ["AI", "DATA", "FRONT"]);
  eq("the customer record follows: status booked, planned Program cleared, name learned", [c.contactStatusId, c.plannedProgramId, c.fullName], ["s_bk", null, "Mona Samir"]);
  eq("no payment / accounting record was created", [env.counters.payments, env.counters.accounting], [0, 0]);
  eq("only workflow fields were written on the customer (patch passed the Sales allow-list)", res.customerPatchError, undefined);

  const unnamed = makeEnv({ customers: [mk({ fullName: "Keep Me" })] });
  await register(unnamed, "c1", { programId: "AI", name: "" });
  eq("registering with an empty name field never blanks an existing name", unnamed.customers.get("c1").fullName, "Keep Me");
  const nameless = makeEnv();
  const r2 = await register(nameless, "c1", { programId: "AI" });
  eq("a customer with no name can still be registered (name optional)", [r2.status, nameless.customers.get("c1").fullName], ["registered", ""]);

  const stmtErr = async (fn) => { try { await fn(); return null; } catch (x) { return x.message; } };
  eq("registration requires a Program", await stmtErr(() => register(makeEnv(), "c1", { programId: "" })), "PROGRAM_REQUIRED");
  eq("free text / fake Program refused", await stmtErr(() => register(makeEnv(), "c1", { programId: "Machine Learning" })), "PROGRAM_INVALID");
  eq("archived Program refused", await stmtErr(() => register(makeEnv(), "c1", { programId: "OLD" })), "PROGRAM_INVALID");
  eq("a Business Unit is not a Program", await stmtErr(() => register(makeEnv(), "c1", { programId: "BU_TECH" })), "PROGRAM_INVALID");
  eq("an archived customer is refused", await stmtErr(() => register(makeEnv({ customers: [mk({ archivedAt: "2026-01-01" })] }), "c1", { programId: "AI" })), "CUSTOMER_ARCHIVED");
  const bad = makeEnv(); await register(bad, "c1", { programId: "AI" }).catch(() => {});
  eq("Program from ANY Business Unit works (Sales isn't limited to Technology)", (await register(makeEnv(), "c1", { programId: "ENGLISH" })).status, "registered");
  eq("Business Unit resolves via the node path, or the parent chain when path is missing", [businessUnitIdOfProgram(nodeById("AI"), nodeById), businessUnitIdOfProgram({ id: "X", type: "program", parentId: "CAT" }, nodeById)], ["BU_TECH", "BU_TECH"]);

  const noBooked = makeEnv();
  const r3 = await register(noBooked, "c1", { programId: "AI", statuses: SEEDED.filter((s) => s.key !== "booked") });
  eq("if the booked status is unavailable the engagement falls back to the default status", [r3.status, noBooked.engagementList()[0].statusId], ["registered", "s_nc"]);

  const failPatch = makeEnv();
  failPatch.patchCustomer = async () => { throw new Error("offline"); };
  const r4 = await register(failPatch, "c1", { programId: "AI" });
  eq("a failure updating the customer AFTER the engagement exists never hides or undoes the registration", [r4.status, failPatch.engagementList().length, r4.customerPatchError], ["registered", 1, "offline"]);
}

// ══════════════════ 13. leaves عملاء جدد ══════════════════
console.log("13. The customer disappears from عملاء جدد once a real Engagement exists");
{
  const env = makeEnv({ customers: [mk(), mk({ id: "c2", phone: "01000000002", normalizedPhone: "01000000002" })] });
  eq("both are listed before", selectNewCustomers(env.customerList(), env.engagementList()).map((c) => c.id).sort(), ["c1", "c2"]);
  await register(env, "c1", { programId: "AI" });
  eq("after registering c1 only c2 remains", selectNewCustomers(env.customerList(), env.engagementList()).map((c) => c.id), ["c2"]);
  eq("c1 is NOT deleted and NOT archived — only the list membership changed", [env.customers.has("c1"), env.customers.get("c1").archivedAt], [true, null]);
  eq("an ARCHIVED engagement doesn't count as registered (they'd return to the list)", selectNewCustomers([mk()], [{ customerId: "c1", archivedAt: "2026-09-01" }]).length, 1);
  eq("interests alone never remove a customer from the list", selectNewCustomers([mk({ interestedProgramIds: ["AI", "DATA"] })], []).length, 1);
  eq("search still works", [selectNewCustomers([mk({ fullName: "Sara" })], [], { search: "sar" }).length, selectNewCustomers([mk({ fullName: "Sara" })], [], { search: "zzz" }).length], [1, 0]);
  const page = read("src/pages/admin/crm/newCustomers/NewCustomersPage.jsx");
  check("the page's list IS selectNewCustomers (no separate 'new customer' flag to keep in sync)", page.includes("selectNewCustomers(customers, engagements"));
  check("nothing in the workflow deletes or archives a customer", !/archiveCustomer|deleteCustomer|archivedAt:/.test(read("src/utils/newCustomerWorkflow.js").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").replace(/archivedAt: null/g, "")));
}

// ══════════════════ 14. double submission ══════════════════
console.log("14. Double submission / retry never creates duplicate Engagements");
{
  const env = makeEnv();
  const [a, b] = await Promise.all([register(env, "c1", { programId: "AI" }), register(env, "c1", { programId: "AI" })]);
  eq("two simultaneous submits -> exactly ONE engagement", [env.engagementList().length, env.counters.engagementCreates], [1, 1]);
  eq("one registered, the other reported 'already registered' with the SAME engagement id", [[a.status, b.status].sort(), a.engagementId === b.engagementId], [["already_registered", "registered"], true]);
  const many = makeEnv();
  await Promise.all(Array.from({ length: 6 }, () => register(many, "c1", { programId: "DATA" })));
  eq("six racing submits -> still one engagement", many.engagementList().length, 1);
  const seq = makeEnv();
  await register(seq, "c1", { programId: "AI" });
  const again = await register(seq, "c1", { programId: "AI" });
  eq("a retry afterwards is recognised (live check), creates nothing", [again.status, seq.engagementList().length], ["already_registered", 1]);
  const stale = makeEnv();
  stale.listCustomerEngagements = async () => []; // the live check misses (stale/other tab) -> the transactional create is the safety net
  await register(stale, "c1", { programId: "AI" });
  const staleAgain = await register(stale, "c1", { programId: "AI" });
  eq("even when the pre-check misses, the transaction guard prevents a second document", [staleAgain.status, stale.engagementList().length], ["already_registered", 1]);
  const other = makeEnv();
  await register(other, "c1", { programId: "AI" });
  await register(other, "c1", { programId: "DATA" });
  eq("registering the same customer in a DIFFERENT Program is a separate, legitimate engagement", other.engagementList().map((e) => e.catalogNodeId).sort(), ["AI", "DATA"]);
  const existing = makeEnv({ engagements: [{ id: "autoid1", customerId: "c1", catalogNodeId: "AI", archivedAt: null }] });
  eq("an engagement that already exists (e.g. via Add Student, auto id) is detected — no duplicate", [(await register(existing, "c1", { programId: "AI" })).status, existing.engagementList().length], ["already_registered", 1]);
  const archived = makeEnv({ engagements: [{ id: "autoid2", customerId: "c1", catalogNodeId: "AI", archivedAt: "2026-08-01" }] });
  const ar = await register(archived, "c1", { programId: "AI" });
  eq("an ARCHIVED record for that Program is flagged (restore it) rather than duplicated", [ar.status, ar.archivedExisting, archived.engagementList().length], ["already_registered", true, 1]);
  const modal = read("src/pages/admin/crm/newCustomers/RegisterCustomerModal.jsx");
  check("the confirm button has an in-flight lock and is disabled while saving", modal.includes("inFlight.current") && /disabled=\{saving \|\| !programId\}/.test(modal));
  const ctx = read("src/context/CustomerContext.jsx");
  check("the real create is a Firestore transaction that reads the id first", /createEngagementIfAbsent = \(id, data\) => runTransaction[\s\S]{0,200}tx\.get\(ref\)[\s\S]{0,120}snap\.exists\(\)\) return false;[\s\S]{0,60}tx\.set\(ref, data\)/.test(ctx));
}

// ══════════════════ 15. price ══════════════════
console.log("15. Cash vs Installment never changes the manually entered course price");
{
  const env = makeEnv();
  await register(env, "c1", { programId: "AI" });
  const eng = env.engagementList()[0];
  eq("registration snapshots the catalog price once (6000)", [eng.pricingSnapshot.originalPrice, effectiveCoursePrice(eng)], [6000, 6000]);
  const manual = { ...eng, pricingSnapshot: { ...eng.pricingSnapshot, originalPrice: 4321 } }; // Sales typed a manual price in the Sales Sheet
  for (const plan of ["full", "installments", "full", "installments", null]) {
    const snap = applyPaymentPlan(manual.pricingSnapshot, plan, "Technology");
    eq(`plan ${plan}: the manually entered price stays 4321`, [snap.originalPrice, effectiveCoursePrice({ pricingSnapshot: snap })], [4321, 4321]);
  }
  const reg = read("src/utils/newCustomerWorkflow.js");
  check("registration never sets a price or a payment plan (that stays in the Sales Sheet's own editor)", !/coursePrice|paymentPlan|applyPaymentPlan|originalPrice/.test(reg.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")));
  const ctx = read("src/context/CustomerContext.jsx");
  check("the engagement builder is the one shared by Add Student (pricing snapshot unchanged)", ctx.includes("const pricingSnapshot = buildPricingSnapshot({ program, businessUnit });") && ctx.includes("buildEngagementDoc(customerId, form)") && /const addEngagement = async \(customerId, form\) => \{\s*const ref = await addDoc\(collection\(db, "engagements"\), buildEngagementDoc\(customerId, form\)\);/.test(ctx));
  check("the Sales Sheet's price editor is untouched by this feature", !/setEngagementCoursePrice|setEngagementPricingPlan/.test(read("src/pages/admin/crm/newCustomers/RegisterCustomerModal.jsx") + read("src/hooks/useNewCustomerWorkflow.js")));
}

// ══════════════════ follow-ups ══════════════════
console.log("8b. Follow-ups reuse the EXISTING follow-up system (customer-level, no engagement needed)");
{
  const draft = { customerId: "c1", dueAt: "2026-09-20T15:00:00.000Z", note: "call back", assignedTo: "uid-sales", customerName: "Sara", customerPhone: "01000000001" };
  eq("a customer-only draft (no engagement) is valid", validateFollowUpDraft(draft), []);
  eq("customer and date are still required", [validateFollowUpDraft({ dueAt: "x" }), validateFollowUpDraft({ customerId: "c1" })], [["MISSING_CUSTOMER"], ["MISSING_DUE_AT"]]);
  const doc = buildFollowUp(draft, { currentUser: SALES });
  eq("it builds an ordinary followUps doc with engagementId null (not undefined)", [doc.engagementId, doc.status, doc.customerId, doc.createdBy, doc.assignedTo], [null, "pending", "c1", "uid-sales", "uid-sales"]);
  eq("no undefined values in the doc (Firestore rejects them)", Object.values(doc).includes(undefined), false);
  const withEng = buildFollowUp({ ...draft, engagementId: "e1" }, { currentUser: SALES });
  eq("engagement-based follow-ups are unchanged", withEng.engagementId, "e1");
  eq("chaining a next follow-up from a customer-level one stays customer-level", buildNextFollowUpDraft(doc, { dueAt: "2026-09-25T10:00:00.000Z" }).engagementId, null);
  // firestore.rules for followUps (untouched): a Sales create needs createdBy == assignedTo == own uid, which the doc satisfies
  const fuRules = stripComments(rules.slice(rules.indexOf("match /followUps/{id}"), rules.indexOf("match /tags/{id}")));
  check("the followUps rules are unchanged and don't mention engagementId on create (so a null one is fine)", /allow create: if isAdmin\(\)[\s\S]*createdBy == request\.auth\.uid[\s\S]*assignedTo == request\.auth\.uid/.test(fuRules) && !/allow create[^;]*engagementId/.test(fuRules));
  eq("the doc satisfies the Sales create rule (createdBy == assignedTo == own uid)", [doc.createdBy === SALES.id, doc.assignedTo === SALES.id], [true, true]);
  eq("follow-ups are offered for exactly لم يرد / هيفكر / مهتم", FOLLOW_UP_STATUS_KEYS, ["no_answer", "thinking", "interested"]);
  const form = read("src/pages/admin/crm/followups/FollowUpFormModal.jsx");
  check("the existing FollowUpFormModal is reused (customer mode), not a new reminder UI", form.includes("customer, followUp") && form.includes("engagementId: engagement ? engagement.id : null") && read("src/pages/admin/crm/newCustomers/NewCustomersPage.jsx").includes("<FollowUpFormModal"));
  const del = buildCustomerDeletionSet("c1", { engagements: [], followUps: [{ id: "fu1", customerId: "c1", engagementId: null }, { id: "fu2", customerId: "other", engagementId: null }], transactions: [] });
  eq("admin's delete-customer cascade (the real function) removes a customer-level follow-up, and only that customer's", del.followUpIds, ["fu1"]);
}

// ══════════════════ 16-17. permissions ══════════════════
console.log("16. Sales permissions remain safe");
{
  eq("every field the workflow writes is inside the Sales allow-list in firestore.rules", WORKFLOW_CUSTOMER_FIELDS.filter((f) => !SALES_CUSTOMER_ALLOW.includes(f)), []);
  eq("the allow-list gained ONLY the 7 lead-workflow fields", SALES_CUSTOMER_ALLOW.filter((f) => !["fullName", "phone", "normalizedPhone", "secondaryPhones", "email", "normalizedEmail", "whatsapp", "updatedAt", "interestedProgramIds"].includes(f)).sort(), ["assignedToId", "assignedToName", "contactStatusId", "contactStatusUpdatedAt", "contactStatusUpdatedBy", "notes", "plannedProgramId"]);
  eq("Sales still cannot touch archivedAt / authUid / createdAt on a customer", ["archivedAt", "authUid", "createdAt"].filter((f) => SALES_CUSTOMER_ALLOW.includes(f)), []);
  check("customers: delete stays admin-only; create/read unchanged", /allow delete: if isAdmin\(\);/.test(customersBlock) && /allow create: if isAdmin\(\) \|\| isSalesStaff\(\);/.test(customersBlock) && /allow read: if isAdmin\(\) \|\| isSalesStaff\(\);/.test(customersBlock));
  const env = makeEnv();
  let denied = null;
  try { await env.patchCustomer("c1", { archivedAt: "2026-09-19" }); } catch (e) { denied = e.message; }
  check("(stand-in check) a Sales write touching archivedAt is denied by the real allow-list", /PERMISSION_DENIED/.test(denied || ""));
  for (const [label, run] of [
    ["record outcome", () => recordOutcome(makeEnv(), "c1", { statusKey: "will_book", plannedProgramId: "AI" })],
    ["register", () => register(makeEnv(), "c1", { programId: "AI", name: "N" })],
  ]) { let err = null; try { await run(); } catch (e) { err = e.message; } eq(`${label}: every write passes the Sales allow-list`, err, null); }
  const eng = makeEnv(); await register(eng, "c1", { programId: "AI" });
  const d = eng.engagementList()[0];
  check("the created engagement satisfies the Sales engagements.create rule (not_enrolled, no payment records, not archived)", engagementsBlock.includes("== 'not_enrolled'") && engagementsBlock.includes("paymentRecords', []).size() == 0") && d.enrollmentStatus === "not_enrolled" && d.paymentRecords.length === 0 && d.archivedAt === null);
  check("the engagements rules were NOT changed by this feature", !/NEW-CUSTOMER-WORKFLOW/.test(engagementsBlock) && !/NEW-CUSTOMER-WORKFLOW/.test(rules.slice(rules.indexOf("match /followUps/{id}"), rules.indexOf("match /tags/{id}"))));
  const lsBlock = stripComments(rules.slice(rules.indexOf("match /leadStatuses/{id}"), rules.indexOf("match /customers/{id}")));
  check("leadStatuses stay READ for Sales, WRITE admin-only (Sales cannot create/edit statuses)", /allow read: if isAdmin\(\) \|\| isSalesStaff\(\);/.test(lsBlock) && /allow write: if isAdmin\(\);/.test(lsBlock));
  check("the Sales section allow-list already includes newCustomers (no navigation change needed)", read("src/pages/admin/AdminShell.jsx").includes('"reminders", "newCustomers"'));
}
console.log("17. Accounting permissions are unchanged");
{
  check("customers rules mention NO accounting clause (Accounting still has no CRM customer access)", !/isAccountingStaff/.test(customersBlock));
  check("engagements rules mention NO accounting clause either", !/isAccountingStaff/.test(engagementsBlock));
  const shell = read("src/pages/admin/AdminShell.jsx");
  check("an Accounting session is still redirected away from عملاء جدد", shell.includes('section === "newCustomers" && currentUser?.role !== "admin" && currentUser?.role !== "sales"'));
  check("canAccessCrm is unchanged (admin + sales only)", /canAccessCrm = \(currentUser\) =>\s*currentUser\?\.role === "admin" \|\| currentUser\?\.role === "sales";/.test(read("src/context/CustomerContext.jsx")));
  check("the workflow adds no accounting transaction / payment / event code paths", !/accountingTransactions|paymentRecords|buildTransaction|emitAccountingEvent|addPaymentRecord/.test(read("src/utils/newCustomerWorkflow.js").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "") + read("src/hooks/useNewCustomerWorkflow.js")));
  check("no 'operation' role was invented (it does not exist in the code)", !/["']operation["']|isOperationStaff/.test(read("src/utils/newCustomerWorkflow.js") + read("src/hooks/useNewCustomerWorkflow.js") + rules));
  eq("the ensure-statuses effect and status writes are admin-only in the client too", read("src/context/LeadStatusContext.jsx").includes('if (currentUser?.role !== "admin") return;\n    (async () => {\n      const seedStateRef = doc(db, "settings", "seedState");\n      const claimed = await runTransaction(db, async (tx) => {\n        const s = await tx.get(seedStateRef);\n        const seeded = s.exists() ? (s.data() || {}) : {};\n        if (seeded.newCustomerStatusesEnsured'), true);
}

// ══════════════════ 13b. UI ══════════════════
console.log("UI — what each customer row shows and offers");
{
  const page = read("src/pages/admin/crm/newCustomers/NewCustomersPage.jsx");
  for (const [label, needle] of [["Name", 'tx("الاسم", "Name")'], ["Phone", 'tx("الهاتف", "Phone")'], ["Interested Programs", 'tx("الكورسات المهتم بيها", "Interested Programs")'], ["Contact status", 'tx("حالة التواصل", "Contact status")'], ["Assigned employee", 'tx("الموظف المسؤول", "Assigned")'], ["Last update", 'tx("آخر تحديث", "Last update")']]) check(`column: ${label}`, page.includes(needle));
  for (const [label, needle] of [["تعديل", 'tx("تعديل", "Edit")'], ["تسجيل متابعة", 'tx("تسجيل متابعة", "Record contact")'], ["تسجيل العميل", 'tx("تسجيل العميل", "Register customer")']]) check(`action: ${label}`, page.includes(needle));
  check("تسجيل العميل is offered only for هيحجز / حجز بالفعل", page.includes("REGISTRATION_STATUS_KEYS.includes(key)") && JSON.stringify(REGISTRATION_STATUS_KEYS) === '["will_book","booked"]');
  const reg = read("src/pages/admin/crm/newCustomers/RegisterCustomerModal.jsx");
  check("registration flow: 1) select Program 2) review 3) confirm (then the list updates on its own)", reg.indexOf("١) الكورس الفعلي") < reg.indexOf("٢) مراجعة بيانات العميل") && reg.indexOf("٢) مراجعة بيانات العميل") < reg.indexOf("٣) تأكيد التسجيل") && reg.includes("ProgramSelect"));
  check("the interest list is shown as kept and never edited by the registration modal", reg.includes("تفضل زي ما هي") && !reg.includes("InterestedProgramsPicker"));
  check("RTL/Arabic design kept (tx() pairs, dir attributes for phones)", page.includes('dir="ltr"'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
