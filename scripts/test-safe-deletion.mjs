// Ad-hoc test suite for SAFE-DELETE-01 (safe bulk customer deletion + "Delete
// Import"). Run against the real shipped pure modules (planning + the chunked
// runner) and the real source/rules files. Firestore is replaced by an
// in-memory store that records every write, so the tests can prove exactly
// what was and was NOT touched. Synthetic data only. Not part of the app build.
//   node --import ./scripts/esm-ext-loader.mjs scripts/test-safe-deletion.mjs
import { readFileSync } from "node:fs";
import {
  buildProtectionIndex, classifyCustomer, planBulkDeletion, summarizeProtectedReasons,
  buildBatchMembership, buildDeadBatchIds, planImportDeletion, buildDeletionAuditEntry, PROTECTED_REASONS,
} from "../src/utils/safeDelete.js";
import { runBulkDeletion, runImportDeletion } from "../src/utils/safeDeleteRun.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); } else { fail++; console.log(`FAIL  - ${name}`); }
}
function eq(name, actual, expected) {
  check(`${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, JSON.stringify(actual) === JSON.stringify(expected));
}
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const NOW = "2026-10-05T10:00:00.000Z";
const ADMIN = { id: "admin1", name: "Admin One", role: "admin" };

// ── an in-memory "Firestore" that records every write ───────────────────
function makeWorld({ customers = [], engagements = [], followUps = [], transactions = [], batches = [] } = {}) {
  const w = {
    customers: new Map(customers.map((c) => [c.id, { ...c }])),
    engagements: engagements.map((e) => ({ ...e })), followUps: followUps.map((f) => ({ ...f })), transactions: transactions.map((t) => ({ ...t })),
    batches: new Map(batches.map((b) => [b.id, { ...b }])),
    audit: [], commitCalls: [], batchWrites: [],
    failChunkAt: new Set(), failVerifyAt: new Set(), failBatchWrite: false, failAudit: false, chunkNo: 0, verifyNo: 0,
    // the AUTHORITATIVE truth the runner re-checks (may differ from what the UI's context held)
    truthEngagements: null,
  };
  w.customerById = (id) => w.customers.get(id) || null;
  w.index = () => buildProtectionIndex({ engagements: w.engagements, followUps: w.followUps, transactions: w.transactions });
  w.commitChunk = async (ops) => {
    const n = w.chunkNo++;
    w.commitCalls.push(ops.map((o) => ({ ...o })));
    if (w.failChunkAt.has(n)) throw new Error("network down");
    for (const op of ops) {
      if (op.type === "delete") w.customers.delete(op.id);
      else if (op.type === "update") w.customers.set(op.id, { ...w.customers.get(op.id), ...op.patch });
    }
  };
  w.verifyLinked = async (ids) => {
    const n = w.verifyNo++;
    if (w.failVerifyAt.has(n)) throw new Error("verify unavailable");
    const src = w.truthEngagements || w.engagements;
    const found = new Map();
    for (const e of src) if (ids.includes(e.customerId)) found.set(e.customerId, ["HAS_ENGAGEMENT"]);
    for (const f of w.followUps) if (ids.includes(f.customerId)) found.set(f.customerId, [...(found.get(f.customerId) || []), "HAS_FOLLOW_UP"]);
    for (const t of w.transactions) if (ids.includes(t.relatedCustomerId)) found.set(t.relatedCustomerId, [...(found.get(t.relatedCustomerId) || []), "HAS_ACCOUNTING"]);
    return found;
  };
  w.updateBatch = async (id, patch) => {
    if (w.failBatchWrite && patch.status !== "deleting") throw new Error("batch write failed");
    w.batchWrites.push({ id, patch: { ...patch } });
    w.batches.set(id, { ...w.batches.get(id), ...patch });
  };
  w.writeAudit = async (entry) => { if (w.failAudit) throw new Error("audit failed"); w.audit.push(entry); };
  return w;
}
let n = 0;
const mk = (o = {}) => { n += 1; return { id: `c${n}`, fullName: `Name ${n}`, phone: `0100000${String(n).padStart(4, "0")}`, createdAt: "2026-10-01", assignedToId: null, ...o }; };
const bulk = (w, ids, extra = {}) => runBulkDeletion({ plan: planBulkDeletion(ids, { customerById: w.customerById, index: w.index() }), currentUser: ADMIN, commitChunk: w.commitChunk, verifyLinked: w.verifyLinked, writeAudit: w.writeAudit, now: NOW, ...extra });

// ═════════════ A. bulk deletion ═════════════
console.log("A. Bulk deletion");
{
  const page = read("src/pages/admin/crm/newCustomers/NewCustomersPage.jsx");
  check("1. a checkbox per row + select-all-visible, admin only", /\{isAdmin && \(\s*<th style=\{th\}>\s*<input\s+type="checkbox"\s+checked=\{rows\.length > 0 && rows\.every/.test(page) && /\{isAdmin && \(\s*<td style=\{td\}>\s*<input\s+type="checkbox"\s+checked=\{selectedIds\.has\(c\.id\)\}/.test(page));
  check("2. the selected count is shown and the selection can be cleared", page.includes("تم تحديد ${selectedIds.size} عميل") && page.includes('tx("إلغاء التحديد", "Clear selection")'));
  check("3. 'حذف المحدد' exists only inside the admin-only selection bar, and the modal only renders for an admin", /\{isAdmin && selectedIds\.size > 0 && \([\s\S]*?حذف المحدد/.test(page) && /\{isAdmin && deleteOpen && \(/.test(page));
}
{
  const hook = read("src/hooks/useSafeCustomerDeletion.js");
  const rules = read("firestore.rules");
  const cust = rules.slice(rules.indexOf("match /customers/{id}"), rules.indexOf("match /engagements/{id}"));
  const allow = [...cust.slice(cust.indexOf("hasOnly([")).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  check("3. Sales cannot delete: the hook refuses every non-admin and Firestore agrees (customers delete = admin)", /if \(!isAdmin\) return \{ forbidden: true \}/.test(hook) && /allow delete: if isAdmin\(\);/.test(cust));
  check("3. ...and Sales cannot rewrite importSources/assignmentHistory (not in their allow-list)", !allow.includes("importSources") && !allow.includes("assignmentHistory"));
  const audit = rules.slice(rules.indexOf("match /customerDeletionAudit"));
  check("3. the deletion audit collection is admin read/create only and immutable", /allow read, create: if isAdmin\(\);\s*allow update, delete: if false;/.test(audit));
  const ib = rules.slice(rules.indexOf("match /importBatches/{id}"), rules.indexOf("match /accountingEvents"));
  check("3. Sales cannot touch import history at all (create/update/delete/read all admin-only)", /allow read: if isAdmin\(\);/.test(ib) && /allow create: if isAdmin\(\);/.test(ib) && /allow update: if isAdmin\(\);/.test(ib) && /allow delete: if isAdmin\(\);/.test(ib) && !/isSalesStaff|isAccountingStaff/.test(ib));
  check("3. Sales read scope intact (assigned customers only)", cust.includes("resource.data.get('assignedToId', null) == request.auth.uid"));
}
{
  const free = mk(), free2 = mk();
  const w = makeWorld({ customers: [free, free2] });
  const r = await bulk(w, [free.id, free2.id]);
  eq("4. customers with no operational data are deleted", [r.deleted, r.protected, r.failed, [...w.customers.keys()]], [2, 0, 0, []]);
  eq("   the selection count is carried through (selected 2)", r.requested, 2);
  eq("   one audit entry, counts only", [w.audit.length, w.audit[0].action, w.audit[0].affectedCustomerCount, w.audit[0].protectedCustomerCount, w.audit[0].performedById, w.audit[0].performedByName], [1, "bulk_customer_delete", 2, 0, "admin1", "Admin One"]);
  check("   the audit entry holds NO customer content", !Object.keys(w.audit[0]).some((k) => /name$|phone|email|notes/i.test(k) && !/^performedByName$/.test(k)) && !JSON.stringify(w.audit[0]).includes(free.phone));
}
{
  const cases = [
    ["5. a customer with an engagement", (c) => ({ engagements: [{ id: "e1", customerId: c.id, archivedAt: null, paymentRecords: [] }] }), ["HAS_ENGAGEMENT"]],
    ["5. ...even an ARCHIVED engagement (history is history)", (c) => ({ engagements: [{ id: "e1", customerId: c.id, archivedAt: "2026-01-01", paymentRecords: [] }] }), ["HAS_ENGAGEMENT"]],
    ["6. a customer with payment records", (c) => ({ engagements: [{ id: "e1", customerId: c.id, paymentRecords: [{ id: "p1", amount: 100 }] }] }), ["HAS_ENGAGEMENT", "HAS_PAYMENT"]],
    ["7. accounting linked by customer id", (c) => ({ transactions: [{ id: "t1", relatedCustomerId: c.id }] }), ["HAS_ACCOUNTING"]],
    ["7. accounting linked only through the customer's engagement", (c) => ({ engagements: [{ id: "e1", customerId: c.id, paymentRecords: [] }], transactions: [{ id: "t1", relatedEngagementId: "e1" }] }), ["HAS_ENGAGEMENT", "HAS_ACCOUNTING"]],
    ["7. accounting linked only through the customer's payment", (c) => ({ engagements: [{ id: "e1", customerId: c.id, paymentRecords: [{ id: "p9" }] }], transactions: [{ id: "t1", relatedPaymentId: "p9" }] }), ["HAS_ENGAGEMENT", "HAS_PAYMENT", "HAS_ACCOUNTING"]],
    ["8. a customer with a follow-up", (c) => ({ followUps: [{ id: "f1", customerId: c.id }] }), ["HAS_FOLLOW_UP"]],
  ];
  for (const [name, build, reasons] of cases) {
    const c = mk();
    const extras = build(c);
    const w = makeWorld({ customers: [c], ...extras });
    const r = await bulk(w, [c.id]);
    eq(`${name} is protected`, [r.deleted, r.protected, w.customers.has(c.id), r.protectedList[0]?.reasons], [0, 1, true, reasons]);
    check("   nothing at all was written", w.commitCalls.length === 0 && w.audit.length === 0);
  }
  const sole = [
    ["8. assignment history", mk({ assignmentHistory: [{ toSalesId: "s1" }] }), "HAS_ASSIGNMENT_HISTORY"],
    ["8. a current Sales owner", mk({ assignedToId: "s1" }), "HAS_ASSIGNMENT_HISTORY"],
    ["8. a recorded contact outcome", mk({ contactStatusId: "st1" }), "HAS_CONTACT_OUTCOME"],
    ["8. a planned program", mk({ plannedProgramId: "prog1" }), "HAS_CONTACT_OUTCOME"],
    ["8. a linked login account", mk({ authUid: "uid1" }), "HAS_ACCOUNT"],
  ];
  for (const [name, c, reason] of sole) {
    const w = makeWorld({ customers: [c] });
    const r = await bulk(w, [c.id]);
    eq(`${name} -> protected`, [r.deleted, w.customers.has(c.id), r.protectedList[0].reasons], [0, true, [reason]]);
  }
  check("every protected reason code is a known, documented one", [...new Set(cases.flatMap((x) => x[2]).concat(sole.map((s) => s[2])))].every((r) => PROTECTED_REASONS.includes(r)));
}
{
  const free = mk(), prot = mk(), prot2 = mk({ assignedToId: "s1" });
  const w = makeWorld({ customers: [free, prot, prot2], engagements: [{ id: "e1", customerId: prot.id, paymentRecords: [] }] });
  const plan = planBulkDeletion([free.id, prot.id, prot2.id, free.id], { customerById: w.customerById, index: w.index() });
  eq("preview: duplicates in the selection count once; can-delete vs protected split", [plan.requested, plan.deletable, plan.protectedList.map((p) => p.id)], [3, [free.id], [prot.id, prot2.id]]);
  eq("preview: protected reasons summarized for the UI", summarizeProtectedReasons(plan.protectedList), { HAS_ENGAGEMENT: 1, HAS_ASSIGNMENT_HISTORY: 1 });
  const r = await bulk(w, [free.id, prot.id, prot2.id]);
  eq("the safe one is deleted, the protected ones stay UNCHANGED", [r.deleted, r.protected, [...w.customers.keys()].sort()], [1, 2, [prot.id, prot2.id].sort()]);
  eq("   (and a protected customer's document is byte-identical)", w.customers.get(prot2.id), prot2);
}

// ═════════════ B. import deletion ═════════════
console.log("B. Delete Import");
const WA = "WhatsApp September", FB = "Facebook Leads";
const e = (batchId, sourceName) => ({ batchId, sourceName, fileName: `${sourceName}.xlsx`, importedAt: "2026-09-01" });
function importWorld() {
  const c = {
    only1: mk({ importSources: [e("b1", WA)] }), only2: mk({ importSources: [e("b1", WA)] }),
    multi: mk({ importSources: [e("b1", WA), e("b2", FB)] }),
    protEng: mk({ importSources: [e("b1", WA)] }),
    protAssigned: mk({ importSources: [e("b1", WA)], assignedToId: "s1", assignmentHistory: [{}] }),
    legacyMulti: mk(), // no stored sources; also created by batch b2 -> "other source" through the batch record
    preExisting: mk({ importSources: [e("b1", WA)] }), // existed before, only UPDATED by b1
    preMulti: mk({ importSources: [e("b2", FB), e("b1", WA)] }),
  };
  const batches = [
    { id: "b1", kind: "customer_leads", sourceName: WA, fileName: "whatsapp.xlsx", importedBy: "admin1", importedByName: "Admin One", status: "committed", createdAt: "2026-09-01", createdCustomerIds: [c.only1.id, c.only2.id, c.multi.id, c.protEng.id, c.protAssigned.id, c.legacyMulti.id], updatedCustomerIds: [c.preExisting.id, c.preMulti.id] },
    { id: "b2", kind: "customer_leads", sourceName: FB, fileName: "facebook.xlsx", status: "committed", createdAt: "2026-09-02", createdCustomerIds: [c.legacyMulti.id], updatedCustomerIds: [c.multi.id] },
  ];
  const engagements = [{ id: "e1", customerId: c.protEng.id, paymentRecords: [{ id: "p1" }] }];
  const followUps = [{ id: "f1", customerId: c.protEng.id }];
  const transactions = [{ id: "t1", relatedCustomerId: c.protEng.id }, { id: "t2", relatedPaymentId: "p1" }];
  return { c, w: makeWorld({ customers: Object.values(c), engagements, followUps, transactions, batches }), batches };
}
const planImport = (w, batchId) => planImportDeletion(w.batches.get(batchId), {
  customers: [...w.customers.values()], customerById: w.customerById, index: w.index(),
  membership: buildBatchMembership([...w.batches.values()]), deadBatchIds: buildDeadBatchIds([...w.batches.values()]),
});
const runImport = (w, batchId, extra = {}) => runImportDeletion({ batch: w.batches.get(batchId), plan: planImport(w, batchId), currentUser: ADMIN, commitChunk: w.commitChunk, verifyLinked: w.verifyLinked, updateBatch: w.updateBatch, writeAudit: w.writeAudit, now: NOW, ...extra });
{
  const { c, w } = importWorld();
  const plan = planImport(w, "b1");
  eq("9. preview numbers: linked / delete / other sources / pre-existing / protected", plan.counts, { linked: 8, delete: 2, removeSourceOnly: 3, preExisting: 1, protected: 2, missing: 0, sourceEdits: 5 });
  eq("10. only customers created by this import AND with no other source AND no operational data are deletable", plan.deletable, [c.only1.id, c.only2.id]);
  eq("11. a customer with another source is kept (stored OR recorded on the other batch)", plan.removeSourceOnly.sort(), [c.multi.id, c.legacyMulti.id, c.preMulti.id].sort());
  eq("    ...and so is one that merely existed before and was only updated by this import", plan.preExisting, [c.preExisting.id]);
  eq("13. protected customers (engagement / assignment) are kept", plan.protectedKept.sort(), [c.protEng.id, c.protAssigned.id].sort());
  eq("12. the edit removes ONLY the deleted source and keeps every other entry exactly", plan.sourceEdits.get(c.multi.id), [e("b2", FB)]);
  eq("    a customer whose only stored source was this one ends with an empty list (no dangling reference)", plan.sourceEdits.get(c.protEng.id), []);
  check("    a customer that is deleted needs no source edit; a legacy one with no stored entry gets none", !plan.sourceEdits.has(c.only1.id) && !plan.sourceEdits.has(c.legacyMulti.id));

  const before = JSON.stringify({ eng: w.engagements, fu: w.followUps, tr: w.transactions });
  const r = await runImport(w, "b1");
  eq("10. the two exclusive, safe customers are deleted", [r.deleted, w.customers.has(c.only1.id), w.customers.has(c.only2.id)], [2, false, false]);
  eq("11. every other customer still exists", [c.multi, c.protEng, c.protAssigned, c.legacyMulti, c.preExisting, c.preMulti].map((x) => w.customers.has(x.id)), [true, true, true, true, true, true]);
  eq("12. the multi-source customer keeps Facebook, loses only WhatsApp", w.customers.get(c.multi.id).importSources.map((x) => x.sourceName), [FB]);
  eq("    ...and the second-batch order is preserved for the other multi-source customer", w.customers.get(c.preMulti.id).importSources.map((x) => x.sourceName), [FB]);
  eq("13. protected customers lose only the source link; every other field is untouched (only updatedAt is stamped)", [w.customers.get(c.protEng.id).importSources, (({ updatedAt, importSources, ...rest }) => rest)(w.customers.get(c.protEng.id)), w.customers.get(c.protEng.id).updatedAt], [[], (({ importSources, ...rest }) => rest)(c.protEng), NOW]);
  check("    no dangling source reference to the deleted batch remains on any customer", [...w.customers.values()].every((x) => !(x.importSources || []).some((s) => s.batchId === "b1")));
  eq("14. the batch record is UPDATED (never deleted) and keeps its original metadata", [w.batches.has("b1"), w.batches.get("b1").sourceName, w.batches.get("b1").fileName, w.batches.get("b1").createdAt, w.batches.get("b1").importedBy, w.batches.get("b1").createdCustomerIds.length], [true, WA, "whatsapp.xlsx", "2026-09-01", "admin1", 6]);
  eq("    final state: status deleted + who/when + summary", [w.batches.get("b1").status, w.batches.get("b1").deletedAt, w.batches.get("b1").deletedById, w.batches.get("b1").deletedByName, w.batches.get("b1").rolledBackAt, w.batches.get("b1").deletionSummary.deleted], ["deleted", NOW, "admin1", "Admin One", NOW, 2]);
  eq("    it was marked 'deleting' BEFORE any customer was touched", [w.batchWrites[0].patch.status, w.batchWrites.length], ["deleting", 2]);
  check("    the original-metadata fields were never overwritten by the batch updates", w.batchWrites.every((b) => !("sourceName" in b.patch) && !("fileName" in b.patch) && !("createdAt" in b.patch) && !("importedBy" in b.patch) && !("createdCustomerIds" in b.patch)));
  eq("    audit entry: import_delete with counts + batch id", [w.audit[0].action, w.audit[0].batchId, w.audit[0].affectedCustomerCount, w.audit[0].protectedCustomerCount, w.audit[0].sourceRemovedCount], ["import_delete", "b1", 2, 2, 5]);
  eq("15. NO engagement, follow-up, payment or accounting record was deleted or changed", JSON.stringify({ eng: w.engagements, fu: w.followUps, tr: w.transactions }), before);
  check("15. every write the runner made addressed a customer id and only delete / importSources-update (nothing else is expressible)", w.commitCalls.flat().every((op) => (op.type === "delete" && Object.keys(op).sort().join() === "id,type") || (op.type === "update" && Object.keys(op.patch).sort().join() === "importSources,updatedAt")));
  const after = planImport(w, "b2");
  eq("    the OTHER import is unaffected; with b1 gone, its legacy-only customer is now exclusively its own (a later Delete Import of b2 would take it)", [after.counts.linked, after.deletable.length, after.removeSourceOnly.length], [3, 1, 0]);
  const callsBefore = w.commitCalls.length;
  const again = await runImport(w, "b1");
  check("    running Delete Import on an already-deleted import does nothing", again.alreadyDeleted === true && w.commitCalls.length === callsBefore);
  eq("    a deleted import's source no longer feeds the dead-batch logic of a later plan", buildDeadBatchIds([...w.batches.values()]).has("b1"), true);
}

// ═════════════ C. safety ═════════════
console.log("C. Safety: double click, retry, chunks, partial failure");
{
  const items = Array.from({ length: 5 }, () => mk());
  const w = makeWorld({ customers: items });
  const stalePlan = planBulkDeletion(items.map((x) => x.id), { customerById: w.customerById, index: w.index() });
  const args = { currentUser: ADMIN, commitChunk: w.commitChunk, verifyLinked: w.verifyLinked, writeAudit: w.writeAudit, now: NOW };
  await runBulkDeletion({ plan: stalePlan, ...args });
  const snapshot = JSON.stringify([...w.customers.entries()]);
  await runBulkDeletion({ plan: stalePlan, ...args }); // the same (stale) plan submitted again — a double click / replayed request
  eq("16. replaying the SAME plan again changes nothing that is left (deleting twice is harmless)", JSON.stringify([...w.customers.entries()]), snapshot);
  const fresh = planBulkDeletion(items.map((x) => x.id), { customerById: w.customerById, index: w.index() });
  eq("16. a fresh re-plan (what the UI does on every click) finds them already gone and writes nothing", [fresh.deletable.length, fresh.missing.length, fresh.requested], [0, 5, 5]);
  const calls = w.commitCalls.length;
  const r = await bulk(w, items.map((x) => x.id));
  check("16. ...no further commit is issued", r.deleted === 0 && w.commitCalls.length === calls);
  const modals = read("src/pages/admin/crm/newCustomers/SafeDeleteModals.jsx");
  const hook = read("src/hooks/useSafeCustomerDeletion.js");
  check("16. UI: the confirm button is disabled while running and needs the acknowledgement; the hook holds an in-flight lock", /const canRun = ack && !running/.test(modals) && /lockRef\.current = true/.test(hook) && /if \(lockRef\.current\) return \{ busy: true \}/.test(hook));
}
{
  const items = Array.from({ length: 9 }, () => mk());
  const w = makeWorld({ customers: items });
  w.failChunkAt = new Set([1]);
  const r1 = await bulk(w, items.map((x) => x.id), { chunkSize: 3 });
  eq("19. a failed chunk is reported exactly: 6 deleted, 3 failed — never 'all done'", [r1.deleted, r1.failed, r1.failedIds.length, r1.errors.map((x) => x.code)], [6, 3, 3, ["CHUNK_FAILED"]]);
  eq("19. the audit entry records the partial result", [w.audit[0].affectedCustomerCount, w.audit[0].failedCount, w.audit[0].requestedCount], [6, 3, 9]);
  eq("17. nothing was lost or double-deleted: exactly the failed three remain", [...w.customers.keys()].sort(), r1.failedIds.slice().sort());
  const r2 = await bulk(w, items.map((x) => x.id), { chunkSize: 3 });
  eq("17. a retry re-plans from live data and deletes exactly the remaining three", [r2.deleted, r2.failed, r2.missing, w.customers.size], [3, 0, 6, 0]);
}
{
  const items = Array.from({ length: 1000 }, () => mk());
  const w = makeWorld({ customers: items });
  const r = await bulk(w, items.map((x) => x.id), { chunkSize: 400 });
  eq("18. 1000 deletions go out as 400 / 400 / 200 atomic chunks (never one giant write)", [w.commitCalls.map((c) => c.length), r.deleted], [[400, 400, 200], 1000]);
  check("18. every chunk is under Firestore's 500-op batch limit", w.commitCalls.every((c) => c.length <= 500));
  const it = Array.from({ length: 700 }, () => mk({ importSources: [e("bX", "Big")] }));
  const w2 = makeWorld({ customers: it, batches: [{ id: "bX", kind: "customer_leads", sourceName: "Big", status: "committed", createdCustomerIds: it.map((x) => x.id), updatedCustomerIds: [] }] });
  const ri = await runImport(w2, "bX", { chunkSize: 400 });
  eq("18. a large Delete Import is chunked too (400 + 300) and completes", [w2.commitCalls.map((c) => c.length), ri.deleted, ri.ok], [[400, 300], 700, true]);
}
{
  // The authoritative check beats a stale/partial live context.
  const stale = mk(), ok = mk();
  const w = makeWorld({ customers: [stale, ok] });
  w.truthEngagements = [{ id: "eLate", customerId: stale.id, paymentRecords: [] }]; // exists in Firestore, not yet in the UI's context
  const r = await bulk(w, [stale.id, ok.id]);
  eq("19. an engagement the UI's context hadn't loaded yet is caught at delete time: that customer is KEPT", [r.deleted, r.protected, w.customers.has(stale.id), w.customers.has(ok.id), r.protectedList[0].found], [1, 1, true, false, "verified"]);
  const w2 = makeWorld({ customers: [mk(), mk()] });
  w2.failVerifyAt = new Set([0]);
  const r2 = await bulk(w2, [...w2.customers.keys()]);
  eq("19. if the safety check itself can't run, nothing is deleted (unverifiable is never assumed safe)", [r2.deleted, r2.failed, w2.customers.size, r2.errors[0].code], [0, 2, 2, "VERIFY_FAILED"]);
  const w3 = makeWorld({ customers: [mk()] });
  w3.failAudit = true;
  const r3 = await bulk(w3, [...w3.customers.keys()]);
  eq("19. an audit-write failure is reported, and does not pretend the deletion didn't happen", [r3.deleted, r3.auditWritten, r3.errors.map((x) => x.code)], [1, false, ["AUDIT_FAILED"]]);
}
{
  // import partial failure + retry
  const { c, w } = importWorld();
  w.failChunkAt = new Set([1]); // chunk 0 = source edits, chunk 1 = the deletes
  const r = await runImport(w, "b1");
  eq("19. import: a failed delete chunk -> status deleted_partial, NOT deleted, and the failure is counted", [r.ok, r.status, r.failed, w.batches.get("b1").status, w.batches.get("b1").rolledBackAt ?? null], [false, "deleted_partial", 2, "deleted_partial", null]);
  check("19. ...the source edits that DID commit stay committed; no importSources was corrupted", w.customers.get(c.multi.id).importSources.length === 1 && w.customers.has(c.only1.id) && w.customers.has(c.only2.id));
  w.failChunkAt = new Set();
  const retry = await runImport(w, "b1");
  eq("17. retrying the import deletes the remaining two and finishes as deleted", [retry.deleted, retry.ok, w.batches.get("b1").status], [2, true, "deleted"]);
  eq("17. ...without touching anyone's sources twice (multi-source customer still has exactly Facebook)", w.customers.get(c.multi.id).importSources.map((x) => x.sourceName), [FB]);
}
{
  const { w } = importWorld();
  const original = w.updateBatch;
  w.updateBatch = async (id, patch) => { if (patch.status === "deleting") throw new Error("denied"); return original(id, patch); };
  const r = await runImport(w, "b1");
  check("17. if the batch can't be marked 'deleting', NOTHING is written to any customer", r.aborted === true && w.commitCalls.length === 0 && w.customers.size === 8);
}
{
  const { c, w } = importWorld();
  w.truthEngagements = [...w.engagements, { id: "eLate", customerId: c.only1.id, paymentRecords: [] }];
  const r = await runImport(w, "b1");
  eq("19. import: a customer that gained an engagement after the preview is kept, and ONLY loses this source", [w.customers.has(c.only1.id), w.customers.get(c.only1.id).importSources, r.deleted, r.protected], [true, [], 1, 3]);
}

// ═════════════ architecture / wording / regression guards ═════════════
console.log("Architecture, wording, and existing paths");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const run = strip(read("src/utils/safeDeleteRun.js"));
  check("the runner cannot address engagements / payments / accounting / follow-ups at all", !/engagements|followUps|accountingTransactions|accountingEvents|paymentRecords|ENGAGEMENTS_COLLECTION|FOLLOW_UPS_COLLECTION/.test(run));
  const hook = strip(read("src/hooks/useSafeCustomerDeletion.js"));
  check("the hook only READS the operational collections (getDocs) and writes no document directly except the audit entry", !/deleteDoc|updateDoc|setDoc|writeBatch/.test(hook) && (hook.match(/addDoc\(/g) || []).length === 1 && hook.includes("CUSTOMER_DELETION_AUDIT_COLLECTION"));
  const ctx = read("src/context/CustomerContext.jsx");
  const fn = ctx.slice(ctx.indexOf("const commitCustomerDeletionChunk"), ctx.indexOf("const archiveCustomer"));
  check("the only new Firestore write primitive touches the customers collection only (delete / update)", fn.includes('doc(db, "customers", op.id)') && !/engagements|accounting|followUps|payment/.test(fn.replace(/\/\/.*$/gm, "")));
  for (const f of ["src/utils/deleteCustomer.js", "src/utils/deleteTrack.js", "src/pages/admin/crm/DeleteStudentModal.jsx", "src/pages/admin/crm/DeleteTrackModal.jsx"]) {
    check(`existing explicit delete path ${f} is untouched (no safe-delete code in it)`, !/safeDelete|SAFE-DELETE/.test(read(f)));
  }
  const importer = read("src/utils/leadImportCommit.js") + read("src/utils/leadImport.js") + read("src/utils/leadDistribution.js");
  check("import / dedup / source tracking / distribution modules are untouched by this feature", !/safeDelete|SAFE-DELETE/.test(importer));
  const modals = read("src/pages/admin/crm/newCustomers/SafeDeleteModals.jsx");
  const history = read("src/pages/admin/crm/newCustomers/LeadImportHistoryPanel.jsx");
  const page = read("src/pages/admin/crm/newCustomers/NewCustomersPage.jsx");
  for (const phrase of ["حذف المحدد", "حذف الاستيراد", "عملاء محميون", "لا يمكن حذف هذا العميل لوجود بيانات تشغيلية مرتبطة به", "سيتم حذف", "سيتم إزالة مصدر الاستيراد فقط من", "تأكيد حذف الاستيراد"]) {
    check(`Arabic wording present: ${phrase}`, (modals + history + page).includes(phrase));
  }
  check("Delete Import is behind an explicit acknowledgement + a separate confirm button (no one-click delete)", /Ack checked=\{ack\}/.test(modals) && /Confirm Delete Import/.test(modals));
  check("a deleted import stays listed (audit trail) and can't be deleted twice from the UI", history.includes('b.status !== "deleted"') && history.includes('Badge color={C.muted}>{tx("محذوف"'));
  check("the history panel is only reachable by an admin", /\{isAdmin && <Btn v="ghost" onClick=\{\(\) => setHistoryOpen/.test(page) && /\{isAdmin && historyOpen/.test(page));
  eq("audit entries are built from counts + who + when only", Object.keys(buildDeletionAuditEntry({ action: "bulk_customer_delete", currentUser: ADMIN, now: NOW, requestedCount: 3, affectedCustomerCount: 2, protectedCustomerCount: 1 })).sort(), ["action", "affectedCustomerCount", "failedCount", "performedAt", "performedById", "performedByName", "protectedCustomerCount", "requestedCount"]);
  eq("classifyCustomer on a plain imported lead is NOT protected", classifyCustomer({ id: "x", fullName: "A", phone: "010", importSources: [e("b", "S")], notes: "[ملاحظة استيراد]" }, buildProtectionIndex({})).protected, false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
