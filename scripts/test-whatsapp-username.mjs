// Ad-hoc test suite for WHATSAPP-USERNAME-01 (an optional WhatsApp username
// stored next to — never inside — a customer's phone; Name|Phone|Username
// import; phone/username WhatsApp links; search; edit/add forms). Run against
// the real shipped pure modules and the real source/rules files; Firestore is
// replaced by an in-memory capture of the ops the real commit code produces.
// Synthetic data only. Not part of the app build. Run with:
//   node --import ./scripts/esm-ext-loader.mjs scripts/test-whatsapp-username.mjs
import { readFileSync } from "node:fs";
import {
  normalizeWhatsappUsername, parseWhatsappUsername, whatsappUsernameLink, whatsappPhoneLink,
  customerContactTargets, matchesWhatsappUsernameQuery,
} from "../src/utils/whatsappContact.js";
import { planLeadImport, detectColumns } from "../src/utils/leadImport.js";
import { runLeadImportCommit } from "../src/utils/leadImportCommit.js";
import { buildCustomerDoc } from "../src/utils/customerDoc.js";
import { buildCustomerEditPatch, selectNewCustomers } from "../src/utils/newCustomerWorkflow.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); } else { fail++; console.log(`FAIL  - ${name}`); }
}
function eq(name, actual, expected) {
  check(`${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, JSON.stringify(actual) === JSON.stringify(expected));
}
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const NOW = "2026-10-04T10:00:00.000Z";
const plan = (rows, { mapping, existing = [], note = "" } = {}) => planLeadImport({
  rows, mapping: mapping || { phone: "Phone", name: "Name", username: "Username", programs: [] }, existingCustomers: existing, programs: [], sharedNote: note, yieldEvery: 0,
});

// ══════════════ 1. username normalization / validation ══════════════
console.log("1. Username normalization and validation");
eq("lowercased, leading @ stripped, invisible chars removed", normalizeWhatsappUsername("  @Ahmed.Dev‏ "), "ahmed.dev");
eq("a pasted wa.me link is reduced to the username", normalizeWhatsappUsername("https://wa.me/Mohamed_99?text=hi"), "mohamed_99");
eq("a bare value is never truncated at a slash (it just stays invalid)", parseWhatsappUsername("a/b").status, "invalid");
eq("nothing -> empty", [parseWhatsappUsername("").status, parseWhatsappUsername(null).status, parseWhatsappUsername("  @ ").status], ["empty", "empty", "empty"]);
eq("the spec's examples are valid", ["ahmed123", "mohamed.dev", "ali_123"].map((u) => parseWhatsappUsername(u).status), ["ok", "ok", "ok"]);
eq("digits only is NOT a username (so it can never be mistaken for, or turned into, a phone)", parseWhatsappUsername("201001234567"), { status: "invalid", normalized: "201001234567", why: "no_letter" });
eq("too short / too long", [parseWhatsappUsername("ab").why, parseWhatsappUsername("a".repeat(36)).why], ["too_short", "too_long"]);
eq("bad characters", parseWhatsappUsername("ahmed-123").why, "invalid_characters");
eq("periods may not lead, trail or repeat", ["a.b.", ".ab.c", "a..b"].map((u) => parseWhatsappUsername(u).why), ["bad_period", "bad_period", "bad_period"]);

// ══════════════ 2. WhatsApp links — phone only / username only / both / neither ══════════════
console.log("2. WhatsApp links");
{
  const phoneOnly = customerContactTargets({ phone: "01001234567" });
  const userOnly = customerContactTargets({ phone: "", whatsappUsername: "ahmed123" });
  const both = customerContactTargets({ phone: "+971501234567", whatsappUsername: "Ali_123" });
  const neither = customerContactTargets({ phone: "", fullName: "x" });
  eq("phone only -> phone link, no username link", [phoneOnly.phoneLink, phoneOnly.usernameLink, phoneOnly.username], ["https://wa.me/201001234567", null, null]);
  eq("username only -> username link IS the WhatsApp contact, no phone link", [userOnly.phoneLink, userOnly.usernameLink, userOnly.username], [null, "https://wa.me/ahmed123", "ahmed123"]);
  eq("both -> both links, each from its own field", [both.phoneLink, both.usernameLink], ["https://wa.me/971501234567", "https://wa.me/ali_123"]);
  eq("neither -> no WhatsApp link at all", [neither.phoneLink, neither.usernameLink, neither.e164], [null, null, null]);
  check("the username link never contains an @ and the phone link never contains a username", !both.usernameLink.includes("@") && !both.phoneLink.includes("ali"));
  eq("whatsappUsernameLink of an invalid username is null (never a link to a made-up target)", [whatsappUsernameLink("201001234567"), whatsappUsernameLink("")], [null, null]);
  eq("whatsappPhoneLink of a non-dialable value is null", whatsappPhoneLink("abc"), null);
  eq("a customer doc from before this feature behaves exactly as before", customerContactTargets({ phone: "01012345678", fullName: "Old" }).phoneLink, "https://wa.me/201012345678");
}

// ══════════════ 3. the customer document ══════════════
console.log("3. Customer document");
{
  const phoneOnly = buildCustomerDoc({ fullName: "A", phone: "01001234567" }, { now: NOW });
  check("a phone-only customer has NO whatsappUsername key at all (document unchanged)", !("whatsappUsername" in phoneOnly));
  const both = buildCustomerDoc({ fullName: "B", phone: "01001234567", whatsappUsername: "@Ahmed123" }, { now: NOW });
  eq("phone + username: both kept, username normalized, phone untouched", [both.phone, both.whatsappUsername, both.normalizedPhone], ["01001234567", "ahmed123", "01001234567"]);
  const userOnly = buildCustomerDoc({ fullName: "C", phone: "", whatsappUsername: "mohamed.dev" }, { now: NOW });
  eq("username only: phone stays EMPTY — the username is never put in the phone field", [userOnly.phone, userOnly.normalizedPhone, userOnly.whatsappUsername], ["", "", "mohamed.dev"]);
  const neither = buildCustomerDoc({ fullName: "D" }, { now: NOW });
  eq("neither: both empty/absent", [neither.phone, "whatsappUsername" in neither], ["", false]);
}

// ══════════════ 4. column detection ══════════════
console.log("4. Column detection (flexible, case-insensitive)");
{
  eq("Name | Phone | Username", detectColumns(["Name", "Phone", "Username"]).mapping, { phone: "Phone", name: "Name", programs: [], username: "Username" });
  eq("case-insensitive", detectColumns(["NAME", "PHONE", "USERNAME"]).mapping.username, "USERNAME");
  eq("'WhatsApp Username' is the username, NOT the phone (even though 'whatsapp' is a phone keyword)", (({ mapping }) => [mapping.phone, mapping.username])(detectColumns(["Name", "WhatsApp Username"], [{ Name: "A", "WhatsApp Username": "ahmed123" }])), [null, "WhatsApp Username"]);
  eq("Arabic header", detectColumns(["الاسم", "رقم التليفون", "اسم المستخدم"]).mapping.username, "اسم المستخدم");
  check("a phone-only sheet maps with NO username key (mapping shape unchanged)", !("username" in detectColumns(["Name", "Phone"]).mapping));
  eq("the username column is not reported as an ignored column", detectColumns(["Name", "Phone", "Username"]).ignored, []);
}

// ══════════════ 5. import plan — the spec's example file ══════════════
console.log("5. Import: Phone + Username");
{
  const rows = [
    { Name: "Ahmed", Phone: "201001234567", Username: "ahmed123" },
    { Name: "Mohamed", Phone: "", Username: "mohamed.dev" },
    { Name: "Ali", Phone: "201111111111", Username: "ali_123" },
  ];
  const p = await plan(rows);
  eq("all 3 rows accepted as 3 new customers", [p.stats.newCustomers, p.stats.notImportedRows], [3, 0]);
  const [a, m, l] = p.customersToCreate;
  eq("Ahmed keeps BOTH, separately", [a.phone, a.whatsappUsername, a.normalizedPhone], ["01001234567", "ahmed123", "01001234567"]);
  eq("Mohamed (username only): phone empty, username kept", [m.phone, m.normalizedPhone, m.whatsappUsername], ["", "", "mohamed.dev"]);
  eq("Ali keeps both", [l.phone, l.whatsappUsername], ["01111111111", "ali_123"]);
  check("a username is never stored in any phone field", p.customersToCreate.every((c) => c.phone !== c.whatsappUsername && !c.secondaryPhones.includes(c.whatsappUsername) && !(c.normalizedPhone || "").includes("mohamed")));
  eq("stats: all rows have a usable contact; one is username-only", [p.stats.validPhoneRows, p.stats.usernameOnlyRows, p.stats.invalidUsernameRows], [3, 1, 0]);
  eq("accepted order is first-seen file order", p.acceptedCustomers.map((x) => x.key), ["01001234567", "u:mohamed.dev", "01111111111"]);
}

console.log("6. Import: Username only (no phone column at all)");
{
  const p = await plan([{ Name: "Sara", Username: "sara_ali" }, { Name: "Omar", Username: "omar.k" }], { mapping: { phone: null, name: "Name", username: "Username", programs: [] } });
  eq("both rows import with no phone column", [p.stats.newCustomers, p.rows.map((r) => r.status)], [2, ["accepted", "accepted"]]);
  eq("phones empty, usernames set", p.customersToCreate.map((c) => [c.phone, c.whatsappUsername]), [["", "sara_ali"], ["", "omar.k"]]);
}

console.log("7. Import: rejects / warnings");
{
  const p = await plan([
    { Name: "Nobody", Phone: "", Username: "" },
    { Name: "Digits", Phone: "", Username: "201001234567" },
    { Name: "BadPhoneGoodUser", Phone: "abc", Username: "good_user" },
    { Name: "GoodPhoneBadUser", Phone: "01001234567", Username: "x" },
    { Name: "BadBoth", Phone: "abc", Username: "x" },
  ]);
  eq("neither -> NO_CONTACT", [p.rows[0].status, p.rows[0].reasons[0].code], ["rejected", "NO_CONTACT"]);
  eq("a digits-only username is rejected (never turned into a phone)", [p.rows[1].status, p.rows[1].reasons[0].code, p.rows[1].reasons[0].params.why], ["rejected", "INVALID_USERNAME", "no_letter"]);
  eq("bad phone + good username -> accepted via the username, flagged for review", [p.rows[2].status, p.rows[2].warnings.map((w) => w.code)], ["accepted", ["INVALID_PHONE_IGNORED"]]);
  eq("good phone + bad username -> accepted via the phone, flagged for review", [p.rows[3].status, p.rows[3].warnings.map((w) => w.code)], ["accepted", ["INVALID_USERNAME_IGNORED"]]);
  eq("bad phone + bad username -> rejected on the phone (as before)", [p.rows[4].status, p.rows[4].reasons[0].code], ["rejected", "INVALID_PHONE"]);
  const created = p.customersToCreate.map((c) => [c.fullName, c.phone, c.whatsappUsername ?? null]);
  eq("only the accepted rows create customers, bad values stay out of the customer", created, [["BadPhoneGoodUser", "", "good_user"], ["GoodPhoneBadUser", "01001234567", null]]);
}

console.log("8. Import: no duplicate customers across phone-rows and username-rows");
{
  let p = await plan([{ Name: "A", Phone: "01001234567", Username: "ahmed123" }, { Name: "", Phone: "", Username: "ahmed123" }]);
  eq("phone+username row then a username-only row of the same username -> ONE customer", [p.stats.newCustomers, p.stats.duplicateRows, p.customersToCreate[0].phone, p.customersToCreate[0].whatsappUsername], [1, 1, "01001234567", "ahmed123"]);

  p = await plan([{ Name: "", Phone: "", Username: "ahmed123" }, { Name: "Ahmed", Phone: "01001234567", Username: "AHMED123" }]);
  eq("username-only row first, then the same person with their phone -> ONE customer holding both", [p.stats.newCustomers, p.customersToCreate[0].phone, p.customersToCreate[0].whatsappUsername, p.customersToCreate[0].fullName], [1, "01001234567", "ahmed123", "Ahmed"]);
  eq("...and both rows resolve to that one customer", p.rows.map((r) => r.outcome), ["create", "duplicate"]);

  p = await plan([{ Name: "A", Phone: "01001234567", Username: "" }, { Name: "A2", Phone: "01001234567", Username: "ahmed123" }]);
  eq("same phone twice (second row adds the username) -> ONE customer, username attached", [p.stats.newCustomers, p.customersToCreate[0].whatsappUsername], [1, "ahmed123"]);

  p = await plan([{ Name: "A", Phone: "01001234567", Username: "shared_user" }, { Name: "B", Phone: "01111111111", Username: "shared_user" }]);
  eq("one username on two DIFFERENT phones -> two customers; the username stays with the first, the second is flagged", [p.stats.newCustomers, p.customersToCreate.map((c) => c.whatsappUsername ?? null), p.rows[1].warnings.map((w) => w.code)], [2, ["shared_user", null], ["USERNAME_CONFLICT"]]);

  p = await plan([{ Name: "A", Phone: "01001234567", Username: "" }, { Name: "B", Phone: "01001234567", Username: "" }, { Name: "C", Phone: "01111111111", Username: "" }]);
  eq("DUPLICATE PHONE HANDLING IS UNCHANGED: same phone twice -> one customer, one duplicate row", [p.stats.newCustomers, p.stats.duplicateRows, p.rows[1].outcome], [2, 1, "duplicate"]);
}

console.log("9. Import: existing customers (matched by phone as before, or by username)");
{
  const mkc = (o) => ({ id: "c1", fullName: "Old Name", phone: "01001234567", normalizedPhone: "01001234567", secondaryPhones: [], interestedProgramIds: [], archivedAt: null, ...o });

  let p = await plan([{ Name: "", Phone: "01001234567", Username: "ahmed123" }], { existing: [mkc()] });
  eq("existing phone-only customer + row with phone & username -> username FILLED IN, phone untouched", [p.stats.newCustomers, p.customersToUpdate[0].patch], [0, { whatsappUsername: "ahmed123" }]);

  p = await plan([{ Name: "", Phone: "01001234567", Username: "new_name" }], { existing: [mkc({ whatsappUsername: "keep_me" })] });
  eq("an existing username is NEVER overwritten (customer matched, nothing to write)", [p.customersToUpdate.length, p.stats.unchangedExistingCustomers, p.rows[0].warnings.map((w) => w.code)], [0, 1, ["EXISTING_USERNAME_KEPT"]]);

  p = await plan([{ Name: "", Phone: "", Username: "ahmed123" }], { existing: [mkc({ whatsappUsername: "ahmed123" })] });
  eq("username-only row matches the existing customer by username -> no new customer", [p.stats.newCustomers, p.stats.existingCustomers], [0, 1]);

  p = await plan([{ Name: "", Phone: "01111111111", Username: "ahmed123" }], { existing: [mkc({ phone: "", normalizedPhone: "", whatsappUsername: "ahmed123" })] });
  eq("existing username-only customer + row that brings a phone -> phone FILLED IN (no duplicate)", [p.stats.newCustomers, p.customersToUpdate[0].patch], [0, { phone: "01111111111", normalizedPhone: "01111111111" }]);

  p = await plan([{ Name: "", Phone: "01111111111", Username: "ahmed123" }], { existing: [mkc({ whatsappUsername: "ahmed123" })] });
  eq("existing customer has a DIFFERENT phone -> their phone is kept, the row's is not written", [p.customersToUpdate.length, p.rows[0].warnings.map((w) => w.code)], [0, ["EXISTING_PHONE_KEPT"]]);

  p = await plan([{ Name: "", Phone: "01001234567", Username: "other_user" }], { existing: [mkc(), mkc({ id: "c2", phone: "01222222222", normalizedPhone: "01222222222", whatsappUsername: "other_user" })] });
  eq("phone matches one customer, username another -> ambiguous, left for manual review, nothing written", [p.stats.newCustomers, p.customersToUpdate.length, p.rows[0].status, p.rows[0].reasons[0].code], [0, 0, "skipped", "AMBIGUOUS_EXISTING"]);

  p = await plan([{ Name: "", Phone: "01001234567", Username: "" }], { existing: [mkc()] });
  eq("PHONE-BASED MATCHING IS UNCHANGED: a phone-only row still matches by phone", [p.stats.newCustomers, p.stats.existingCustomers], [0, 1]);
}

// ══════════════ 10. commit: what really reaches Firestore ══════════════
console.log("10. Commit — documents and patches written");
{
  const written = [];
  let n = 0;
  const run = async (rows, existing = []) => {
    written.length = 0;
    const pl = await plan(rows, { existing });
    return runLeadImportCommit({
      plan: pl, fileName: "t.xlsx", customers: existing, nodeById: () => null, now: NOW,
      createBatch: async () => "batch1", updateBatch: async () => {},
      commitLeadImportChunk: async (ops) => { written.push(...ops); return ops.filter((o) => o.type === "create").map(() => `new${++n}`); },
    });
  };
  const res = await run([{ Name: "Ahmed", Phone: "201001234567", Username: "ahmed123" }, { Name: "Mohamed", Phone: "", Username: "mohamed.dev" }]);
  const docs = written.filter((o) => o.type === "create").map((o) => o.data);
  eq("created docs: phone and username in their own fields", docs.map((d) => [d.phone, d.normalizedPhone, d.whatsappUsername]), [["01001234567", "01001234567", "ahmed123"], ["", "", "mohamed.dev"]]);
  eq("both accepted leads come back (a username-only lead is a full lead)", res.acceptedCustomerIds.length, 2);
  await run([{ Name: "", Phone: "01001234567", Username: "ahmed123" }], [{ id: "c1", fullName: "Old", phone: "01001234567", normalizedPhone: "01001234567", interestedProgramIds: [], importSequence: 1 }]);
  const upd = written.find((o) => o.type === "update");
  eq("the commit writes ONLY the username onto the existing customer", [Object.keys(upd.patch).sort(), upd.patch.whatsappUsername], [["updatedAt", "whatsappUsername"], "ahmed123"]);
  const rerun = await run([{ Name: "", Phone: "01001234567", Username: "ahmed123" }], [{ id: "c1", fullName: "Old", phone: "01001234567", normalizedPhone: "01001234567", whatsappUsername: "ahmed123", interestedProgramIds: [], importSequence: 1 }]);
  check("re-importing the same file writes nothing (safe to repeat)", rerun.nothingToDo === true && written.length === 0);
}

// ══════════════ 11. forms: add / edit rules ══════════════
console.log("11. Edit form rules (buildCustomerEditPatch)");
{
  const c = { id: "c1", fullName: "A", phone: "01001234567", normalizedPhone: "01001234567", interestedProgramIds: [] };
  let r = buildCustomerEditPatch({ customer: c, edits: { whatsappUsername: "@Ahmed123" }, nodeById: () => null, now: NOW });
  eq("adding a username stores the normalized form", [r.patch.whatsappUsername, r.errors], ["ahmed123", []]);
  r = buildCustomerEditPatch({ customer: c, edits: { fullName: "A", phone: c.phone, whatsappUsername: "" }, nodeById: () => null });
  eq("a phone-only customer saved with an empty username is not changed at all", r.changed, false);
  r = buildCustomerEditPatch({ customer: c, edits: { whatsappUsername: "12345" }, nodeById: () => null });
  eq("invalid username -> USERNAME_INVALID", r.errors.map((e) => e.code), ["USERNAME_INVALID"]);
  r = buildCustomerEditPatch({ customer: c, edits: { whatsappUsername: "taken_one" }, otherCustomers: [{ id: "c9", whatsappUsername: "Taken_One" }], nodeById: () => null });
  eq("username already on another customer -> USERNAME_DUPLICATE (case-insensitive)", r.errors.map((e) => e.code), ["USERNAME_DUPLICATE"]);
  const withUser = { ...c, whatsappUsername: "ahmed123" };
  r = buildCustomerEditPatch({ customer: withUser, edits: { phone: "" }, nodeById: () => null, now: NOW });
  eq("clearing the phone is allowed while a username remains", [r.errors, r.patch.phone, r.patch.normalizedPhone], [[], "", ""]);
  r = buildCustomerEditPatch({ customer: c, edits: { phone: "" }, nodeById: () => null });
  eq("clearing the phone with NO username is still refused (existing rule)", r.errors.map((e) => e.code), ["PHONE_REQUIRED"]);
  const userOnly = { id: "c2", fullName: "U", phone: "", normalizedPhone: "", whatsappUsername: "ahmed123", interestedProgramIds: [] };
  r = buildCustomerEditPatch({ customer: userOnly, edits: { whatsappUsername: "" }, nodeById: () => null });
  eq("clearing the only contact (the username) is refused", r.errors.map((e) => e.code), ["CONTACT_REQUIRED"]);
  r = buildCustomerEditPatch({ customer: userOnly, edits: { phone: "01001234567" }, nodeById: () => null, now: NOW });
  eq("a username-only customer can gain a phone; the username is kept", [r.errors, r.patch.phone, "whatsappUsername" in r.patch], [[], "01001234567", false]);
  r = buildCustomerEditPatch({ customer: c, edits: { fullName: "New" }, nodeById: () => null, now: NOW });
  eq("a name-only edit of a phone-only customer patches just the name (existing behavior)", Object.keys(r.patch).sort(), ["fullName", "updatedAt"]);
}

// ══════════════ 12. search ══════════════
console.log("12. Search");
{
  const customers = [
    { id: "a", fullName: "Ahmed", phone: "01001234567", whatsappUsername: "ahmed123", createdAt: "2026-01-01" },
    { id: "b", fullName: "Mohamed", phone: "", whatsappUsername: "mohamed.dev", createdAt: "2026-01-02" },
    { id: "c", fullName: "Ali", phone: "01111111111", createdAt: "2026-01-03" },
  ];
  eq("by username", selectNewCustomers(customers, [], { search: "mohamed.dev" }).map((c) => c.id), ["b"]);
  eq("by @username", selectNewCustomers(customers, [], { search: "@ahmed123" }).map((c) => c.id), ["a"]);
  eq("by phone still works", selectNewCustomers(customers, [], { search: "0111" }).map((c) => c.id), ["c"]);
  eq("by name still works", selectNewCustomers(customers, [], { search: "ali" }).map((c) => c.id), ["c"]);
  check("matchesWhatsappUsernameQuery ignores customers without a username", !matchesWhatsappUsernameQuery({ phone: "01" }, "ahmed"));
}

// ══════════════ 13. source-level guarantees ══════════════
console.log("13. Source & rules");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const page = strip(read("src/pages/admin/crm/newCustomers/NewCustomersPage.jsx"));
  const sheet = strip(read("src/pages/admin/crm/catalogBrowser/ProgramSalesSheet.jsx"));
  check("NewCustomersPage builds its WhatsApp links from the shared helper (phone link and username link)", page.includes("contact.phoneLink") && page.includes("contact.usernameLink") && !/wa\.me\/\$\{/.test(page));
  check("ProgramSalesSheet does too", sheet.includes("contact.phoneLink") && sheet.includes("contact.usernameLink") && !/wa\.me\/\$\{/.test(sheet));
  check("the username link is only rendered when the customer HAS a username (contact.username guard)", /contact\.username \?/.test(page) && /contact\.username && \(/.test(sheet));
  check("the existing Phone column is kept (phone cell + header still there)", page.includes('tx("الهاتف", "Phone")') && page.includes("{c.phone || \"—\"}"));
  check("a WhatsApp Username column was ADDED next to it", page.includes('tx("واتساب (اسم المستخدم)", "WhatsApp Username")'));
  const add = read("src/pages/admin/crm/newCustomers/AddNewCustomerModal.jsx");
  const edit = read("src/pages/admin/crm/newCustomers/EditNewCustomerModal.jsx");
  check("Add form: WhatsApp Username field, phone no longer the only way in", add.includes("WhatsApp Username") && add.includes("parseWhatsappUsername") && add.includes("findCustomerByWhatsappUsername"));
  check("Edit form: WhatsApp Username field passed to saveCustomerEdits", edit.includes("WhatsApp Username") && /fullName, phone, whatsappUsername, notes/.test(edit));

  const rules = read("firestore.rules");
  const cust = rules.slice(rules.indexOf("match /customers/{id}"), rules.indexOf("match /engagements/{id}"));
  check("rules: Sales may edit whatsappUsername (same form as phone)", /'whatsappUsername'/.test(cust));
  check("rules: the Sales read scope from SALES-VISIBILITY-01 is intact", cust.includes("resource.data.get('assignedToId', null) == request.auth.uid"));
  check("rules: no broad allow added anywhere", !/allow (read|write)[^;]*:\s*if request\.auth != null\s*;/.test(rules));

  const ctx = read("src/context/CustomerContext.jsx");
  check("Sales visibility query untouched (still scoped by assignedToId)", /where\(["']assignedToId["'], ["']==["'], currentUser\.id\)/.test(ctx));
  for (const f of ["src/utils/leadDistribution.js", "src/hooks/useLeadDistribution.js", "src/pages/admin/crm/newCustomers/DistributeLeadsPanel.jsx", "src/utils/salesPerformance.js", "src/utils/accounting.js", "src/utils/paymentRecords.js"]) {
    check(`${f} has no WhatsApp-username code (distribution / registration / payments / accounting untouched)`, !/whatsappUsername|whatsappContact/.test(read(f)));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
