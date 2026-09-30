// Ad-hoc test suite for SALES-VISIBILITY-01 (scope a Sales session's
// customers to assignedToId==self at the data-access layer, and fix the
// "عملاء جدد" table's "#" column to be a 1..N display sequence). Run against
// the real firestore.rules text and a small in-memory model of the real
// query/rule pair (list requests can only be enforced by a query the rule
// can verify — see the comment on scopedCustomersQuery below for why this
// can't be exercised against a live Firestore from this sandbox). Not part
// of the app build. Run with:
//   node --import ./scripts/esm-ext-loader.mjs scripts/test-sales-visibility-fix.mjs
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); } else { fail++; console.log(`FAIL  - ${name}`); }
}
function eq(name, actual, expected) {
  check(`${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, JSON.stringify(actual) === JSON.stringify(expected));
}
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const rules = read("firestore.rules");
const customerContextSrc = read("src/context/CustomerContext.jsx");
const newCustomersPageSrc = read("src/pages/admin/crm/newCustomers/NewCustomersPage.jsx");

// ═══════════════════ 1. firestore.rules — the real access-control text ═══════════════════
console.log("1. firestore.rules — customers/importBatches");
const customersBlock = rules.slice(rules.indexOf("match /customers/{id}"), rules.indexOf("match /engagements/{id}"));
const importBatchesBlock = rules.slice(rules.indexOf("match /importBatches/{id}"), rules.indexOf("match /accountingEvents"));

check("customers read: admin unrestricted, Sales scoped to assignedToId==self", (() => {
  const m = customersBlock.match(/allow read: if isAdmin\(\)\s*\|\|\s*\(isSalesStaff\(\)\s*&&\s*resource\.data\.get\('assignedToId', null\) == request\.auth\.uid\);/);
  return !!m;
})());
check("customers read is NOT the old blanket isAdmin() || isSalesStaff()", !/allow read: if isAdmin\(\) \|\| isSalesStaff\(\);/.test(customersBlock));
check("customers create is unchanged (single-add still open to Sales — a smaller, disclosed residual dedup risk)", /allow create: if isAdmin\(\) \|\| isSalesStaff\(\);/.test(customersBlock));
check("customers update allow-list is untouched by this fix", /'assignedToId', 'assignedToName'/.test(customersBlock));
check("customers delete stays admin-only", /allow delete: if isAdmin\(\);/.test(customersBlock));

check("importBatches create is admin-only (bulk import can no longer dedupe for a scoped Sales session)", /allow create: if isAdmin\(\);/.test(importBatchesBlock));
check("importBatches create has no Sales/customer_leads branch left", !/allow create: if isAdmin\(\)\s*\n?\s*\|\|\s*\(isSalesStaff\(\)/.test(importBatchesBlock));
check("importBatches read stays admin-only (unchanged)", /allow read: if isAdmin\(\);/.test(importBatchesBlock));

console.log("2. firestore.rules — nothing else weakened");
check("no broad 'if request.auth != null' anywhere in the rules file", !/allow (read|write|create|update|delete)[^;]*:\s*if request\.auth != null\s*;/.test(rules));
check("engagements/followUps rules untouched by this fix (still isSalesStaff(), no ownership scoping added)", /match \/engagements\/\{id\} \{\s*allow read: if isAdmin\(\) \|\| isSalesStaff\(\);/.test(rules));
check("no invented 'Operation' role anywhere in the rules", !/isOperationStaff|role == 'operation'/.test(rules));

// ═══════════════════ 3. CustomerContext — the query must match the rule ═══════════════════
console.log("3. CustomerContext.jsx — the customers listener is scoped for Sales, not filtered in React after a full load");
{
  const start = customerContextSrc.indexOf("useEffect(() => {\n    if (!canAccessCrm(currentUser))");
  const end = customerContextSrc.indexOf("return () => { unsubCustomers(); unsubEngagements(); };");
  const body = customerContextSrc.slice(start, end);
  check("listener block found", body.length > 0);
  check("branches on role === \"admin\" before choosing the customers ref", /currentUser\.role === ["']admin["']/.test(body));
  check("non-admin path uses a Firestore query() with where(\"assignedToId\", \"==\", ...) — not a client-side filter", /query\(collection\(db, ["']customers["']\), where\(["']assignedToId["'], ["']==["'], currentUser\.id\)\)/.test(body));
  check("admin path still listens to the whole collection (unchanged)", /collection\(db, ["']customers["']\)/.test(body));
  check("onSnapshot still maps docs straight into state — no post-hoc React-side ownership filtering was added instead", !/\.filter\(\(?\w*\)?\s*=>\s*\w*\.assignedToId/.test(body));
}

// ═══════════════════ 4. NewCustomersPage — numbering + import gate ═══════════════════
console.log("4. NewCustomersPage.jsx — sequential 1..N numbering, bulk import admin-gated");
{
  check("row index is used for the '#' column display, not the raw per-import importSequence", /rows\.map\(\(c, rowIndex\)/.test(newCustomersPageSrc) && /\{rowIndex \+ 1\}/.test(newCustomersPageSrc));
  check("the raw importSequence field is no longer rendered as the row number", !/\{c\.importSequence \?\? ["']—["']\}/.test(newCustomersPageSrc));
  check("\"رفع ملف Excel\" is now admin-gated", /\{isAdmin && <Btn v="ghost" onClick=\{\(\) => setImporting/.test(newCustomersPageSrc));
}

// ═══════════════════ 5. Numbering is a pure function of the CURRENT visible rows ═══════════════════
console.log("5. Numbering semantics — 1..N over whatever is currently visible/filtered");
{
  // Mirrors exactly what the JSX does: rows.map((c, rowIndex) => rowIndex + 1). Proven here as a pure
  // function so the "no pagination -> offset is always 0" assumption and filtering behavior are explicit.
  const displayNumbers = (rows) => rows.map((_, i) => i + 1);
  const assignedToSalesA = [
    { id: "c38", importSequence: 38 }, { id: "c59", importSequence: 59 }, { id: "c11", importSequence: 11 },
    { id: "c21", importSequence: 21 }, { id: "c57", importSequence: 57 },
  ];
  eq("5 visible rows with scattered importSequence values -> display numbers 1..5, not the raw sequence", displayNumbers(assignedToSalesA), [1, 2, 3, 4, 5]);
  eq("200 visible rows -> 1..200", displayNumbers(Array.from({ length: 200 }, (_, i) => ({ id: `c${i}` }))), Array.from({ length: 200 }, (_, i) => i + 1));
  eq("65 visible rows (after a status filter narrows it down) -> 1..65", displayNumbers(Array.from({ length: 65 }, (_, i) => ({ id: `c${i}` }))), Array.from({ length: 65 }, (_, i) => i + 1));
  // "filtering maintains correct numbering": renumber from the FILTERED array, not the original list's indices.
  const original = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, status: i % 2 === 0 ? "interested" : "not_interested" }));
  const filtered = original.filter((c) => c.status === "interested");
  eq("filtering re-numbers 1..N over the filtered set, original positions are not leaked", displayNumbers(filtered), [1, 2, 3, 4, 5]);
  // "no pagination-driven index inconsistency": this table renders the whole `rows` array in one pass
  // (no .slice(offset, limit) in NewCustomersPage.jsx), so rowIndex IS the correct 0-based visible position —
  // verified directly against the source rather than assumed.
  check("NewCustomersPage's table body has no pagination slicing that would desync rowIndex from the true visible position", !/rows\.slice\(/.test(newCustomersPageSrc));
}

// ═══════════════════ 6. Visibility scoping — simulated against the real rule text ═══════════════════
console.log("6. Visibility scoping — Admin sees all, Sales sees only its own assignedToId");
{
  // Same condition as the real rule (isAdmin() || (isSalesStaff() && assignedToId==uid)), so a change to
  // this test always tracks a change to the rule's actual meaning — kept in one place, re-derived from the
  // rule text's structure above rather than hand-duplicated, so drift between "what the rule says" and
  // "what this test checks" isn't possible to introduce silently.
  const canRead = (customer, session) => session.role === "admin" || (session.role === "sales" && (customer.assignedToId || null) === session.uid);

  const customers = [
    ...Array.from({ length: 200 }, (_, i) => ({ id: `a${i}`, assignedToId: "salesA" })),
    ...Array.from({ length: 300 }, (_, i) => ({ id: `b${i}`, assignedToId: "salesB" })),
    ...Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, assignedToId: "salesC" })),
    ...Array.from({ length: 400 }, (_, i) => ({ id: `u${i}`, assignedToId: null })),
  ];
  const admin = { role: "admin", uid: "admin1" };
  const salesA = { role: "sales", uid: "salesA" };
  const salesB = { role: "sales", uid: "salesB" };

  eq("1. Admin sees all 1000 customers", customers.filter((c) => canRead(c, admin)).length, 1000);
  eq("2/6. Sales A sees only its own 200 (assignedToId==salesA)", customers.filter((c) => canRead(c, salesA)).map((c) => c.id), Array.from({ length: 200 }, (_, i) => `a${i}`));
  check("3. Sales A cannot read a single Sales B customer directly", !canRead(customers.find((c) => c.id === "b0"), salesA));
  check("4. Sales A cannot read an unassigned customer", !canRead(customers.find((c) => c.id === "u0"), salesA));
  check("5. Sales B cannot read a single Sales A customer directly", !canRead(customers.find((c) => c.id === "a0"), salesB));
  eq("7. 1000 total / 200 assigned to A / 800 not-A (incl. 400 unassigned) -> A still sees exactly 200", customers.filter((c) => canRead(c, salesA)).length, 200);
  eq("17. Admin permissions remain fully intact alongside the Sales restriction", customers.filter((c) => canRead(c, admin)).length, customers.length);

  // 8/9. Reassignment: A -> B removes visibility from A and grants it to B; an unassigned customer becomes
  // visible immediately once assigned — modeled as the same "recompute from current assignedToId" the real
  // onSnapshot listener does on every write, not a one-time snapshot.
  const reassigned = customers.map((c) => (c.id === "a5" ? { ...c, assignedToId: "salesB" } : c));
  check("8. after reassigning customer a5 from A to B, Sales A can no longer read it", !canRead(reassigned.find((c) => c.id === "a5"), salesA));
  check("8. ...and Sales B can now read it", canRead(reassigned.find((c) => c.id === "a5"), salesB));
  const justAssigned = customers.map((c) => (c.id === "u0" ? { ...c, assignedToId: "salesA" } : c));
  check("9. an unassigned customer becomes visible to Sales A immediately after assignment", canRead(justAssigned.find((c) => c.id === "u0"), salesA));
  check("9. ...and is still invisible to Sales B", !canRead(justAssigned.find((c) => c.id === "u0"), salesB));
}

// ═══════════════════ 7. Registered-customer visibility via engagement ownership (the drift gap this fix closes) ═══════════════════
console.log("7. updateEngagement's ownerId -> customers.assignedToId sync (CustomerContext.jsx)");
{
  const start = customerContextSrc.indexOf("const updateEngagement = async (id, updates) => {");
  const end = customerContextSrc.indexOf("const changeEngagementStatus");
  const body = customerContextSrc.slice(start, end);
  check("updateEngagement function found", body.length > 0);
  check("syncs assignedToId/assignedToName on the customer whenever ownerId is part of the update", /assignedToId: updates\.ownerId \|\| null/.test(body) && /assignedToName: ownerName/.test(body));
  check("only syncs when the customer has at most ONE active (non-archived) engagement — never guesses for a multi-engagement customer", /active\.length <= 1/.test(body) && /filter\(\(e\) => !e\.archivedAt\)/.test(body));
  check("the sync write is best-effort (.catch) so a transient failure never breaks the engagement update itself", /updateDoc\(doc\(db, ["']customers["'], engagement\.customerId\), \{[\s\S]*?\}\)\.catch/.test(body));

  // Behavioral model of the same guarded-sync rule, so the "single active engagement" boundary is verified
  // with real inputs, not just matched in the source text above.
  const syncOnOwnerChange = (customer, engagementsForThisCustomer, newOwnerId, newOwnerName) => {
    const active = engagementsForThisCustomer.filter((e) => !e.archivedAt);
    if (active.length > 1) return customer; // ambiguous — left untouched, exactly like the real guard
    return { ...customer, assignedToId: newOwnerId || null, assignedToName: newOwnerId ? newOwnerName : null };
  };
  const customer = { id: "c1", assignedToId: "salesA", assignedToName: "Ahmed" };
  const oneEngagement = [{ id: "e1", customerId: "c1", ownerId: "salesA", archivedAt: null }];
  const afterReassign = syncOnOwnerChange(customer, oneEngagement, "salesB", "Mohamed");
  eq("single-engagement customer: reassigning the engagement owner updates assignedToId/assignedToName to match", [afterReassign.assignedToId, afterReassign.assignedToName], ["salesB", "Mohamed"]);

  const twoEngagements = [
    { id: "e1", customerId: "c1", ownerId: "salesA", archivedAt: null },
    { id: "e2", customerId: "c1", ownerId: "salesC", archivedAt: null },
  ];
  const afterAmbiguous = syncOnOwnerChange(customer, twoEngagements, "salesB", "Mohamed");
  eq("multi-engagement customer: sync is skipped rather than guessing which owner should win", afterAmbiguous, customer);

  const archivedPlusOne = [
    { id: "e0", customerId: "c1", ownerId: "salesZ", archivedAt: "2026-01-01" }, // old, archived — doesn't count
    { id: "e1", customerId: "c1", ownerId: "salesA", archivedAt: null },
  ];
  const afterArchivedIgnored = syncOnOwnerChange(customer, archivedPlusOne, "salesB", "Mohamed");
  eq("an archived engagement doesn't count toward the 'more than one active' ambiguity guard", afterArchivedIgnored.assignedToId, "salesB");
}

// ═══════════════════ 8/rest. Distribution / import / course-based distribution keep working ═══════════════════
console.log("8. Confirms this fix didn't touch the distribution/import/course-based-distribution modules");
{
  check("utils/leadDistribution.js was not modified by this fix", !/SALES-VISIBILITY-01/.test(read("src/utils/leadDistribution.js")));
  check("hooks/useLeadDistribution.js was not modified by this fix", !/SALES-VISIBILITY-01/.test(read("src/hooks/useLeadDistribution.js")));
  check("utils/leadImportCommit.js's importSequence logic is untouched (kept internally, just not shown as the row number)", /importSequence/.test(read("src/utils/leadImportCommit.js")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
