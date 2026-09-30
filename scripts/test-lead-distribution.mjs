// Ad-hoc test suite for LEAD-DISTRIBUTION-01 (partial-allocation revision),
// run against the real shipped pure functions (no mocks of the code under
// test — only a tiny in-memory fake Firestore for the commit-level tests).
// Not part of the app build; not wired into any npm script. Run with:
//   node --import ./scripts/esm-ext-loader.mjs scripts/test-lead-distribution.mjs
import {
  selectActiveSalesUsers, computeEqualDistribution, validatePercentageAllocations,
  computePercentageDistribution, validateManualAllocations, validateEqualDistribution,
  validateDistribution, computeAllocationCounts, buildSequentialAssignments,
  buildAssignmentPatches, buildDistributionPreview, chunkDistributionOps,
  selectUnassignedLeads, computeDistributionStats, DISTRIBUTION_METHODS,
} from "../src/utils/leadDistribution.js";
import { planLeadImport } from "../src/utils/leadImport.js";
import { runLeadImportCommit } from "../src/utils/leadImportCommit.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); }
  else { fail++; console.log(`FAIL  - ${name}`); }
}
function eq(name, actual, expected) {
  check(`${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, JSON.stringify(actual) === JSON.stringify(expected));
}
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const ids = (n, prefix = "c") => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

// ── selectActiveSalesUsers (22 — no Sales users) ─────────────────────────
console.log("selectActiveSalesUsers");
eq("only role sales, excludes rejected, excludes other roles", selectActiveSalesUsers([
  { id: "a", role: "sales", status: "approved" },
  { id: "b", role: "sales", status: "rejected" },
  { id: "c", role: "admin", status: "approved" },
  { id: "d", role: "accounting", status: "approved" },
  { id: "e", role: "sales" },
]).map((u) => u.id), ["a", "e"]);
eq("no sales users at all -> []", selectActiveSalesUsers([{ id: "c", role: "admin" }]), []);

// ── computeDistributionStats (1 — 1000 imported / 600 assigned / 400 unassigned) ─
console.log("computeDistributionStats");
{
  const customers = [...ids(600).map((id) => ({ id, assignedToId: "a" })), ...ids(400, "u").map((id) => ({ id, assignedToId: null }))];
  eq("1000/600/400", computeDistributionStats(customers), { total: 1000, assigned: 600, unassigned: 400 });
}
eq("empty pool -> 0/0/0", computeDistributionStats([]), { total: 0, assigned: 0, unassigned: 0 });

// ── selectUnassignedLeads (7 — remaining pool starts from first unassigned; 26 — unassigned filter) ─
console.log("selectUnassignedLeads");
{
  // 1000 leads from ONE import share one createdAt (see utils/leadImportCommit.js) — importSequence disambiguates.
  const customers = Array.from({ length: 1000 }, (_, i) => ({
    id: `c${i + 1}`, createdAt: "2026-09-30T00:00:00.000Z", importSequence: i + 1,
    assignedToId: i < 600 ? "a" : null, // 1..600 assigned, 601..1000 unassigned
  }));
  const unassigned = selectUnassignedLeads(customers);
  eq("400 unassigned, starting from position 601 (not renumbered to 1)", unassigned.map((c) => c.importSequence).slice(0, 3), [601, 602, 603]);
  eq("all 400 present, in original order, none from the assigned 1..600", unassigned.map((c) => c.id), ids(400, "c").map((_, i) => `c${601 + i}`));
}
{
  // customers never imported (no importSequence) sort by their own createdAt among the rest.
  const customers = [
    { id: "manual1", createdAt: "2026-09-29T00:00:00.000Z", assignedToId: null },
    { id: "batchA-1", createdAt: "2026-09-30T00:00:00.000Z", importSequence: 1, assignedToId: null },
    { id: "batchA-2", createdAt: "2026-09-30T00:00:00.000Z", importSequence: 2, assignedToId: null },
  ];
  eq("manually-added customer (older createdAt) sorts before a later import batch", selectUnassignedLeads(customers).map((c) => c.id), ["manual1", "batchA-1", "batchA-2"]);
}
eq("already-assigned customers never appear in the unassigned pool", selectUnassignedLeads([{ id: "a1", assignedToId: "s1" }]), []);

// ── percentage validation (2,3,4 — <100 valid, =100 valid, >100 rejected) ────
console.log("validatePercentageAllocations — partial allocation is normal now");
eq("sums to 60 -> VALID (partial allocation, no error)", validatePercentageAllocations([{ salesId: "a", percent: 30 }, { salesId: "b", percent: 20 }, { salesId: "c", percent: 10 }]), []);
eq("sums to exactly 100 -> valid", validatePercentageAllocations([{ salesId: "a", percent: 40 }, { salesId: "b", percent: 25 }, { salesId: "c", percent: 15 }, { salesId: "d", percent: 10 }, { salesId: "e", percent: 10 }]), []);
eq("sums to 101 -> PERCENT_TOTAL_INVALID (only >100 is rejected)", validatePercentageAllocations([{ salesId: "a", percent: 60 }, { salesId: "b", percent: 41 }]).map((e) => e.code), ["PERCENT_TOTAL_INVALID"]);
eq("a single 1% allocation is valid (0% < total <= 100%)", validatePercentageAllocations([{ salesId: "a", percent: 1 }]), []);
eq("empty -> NO_SALES_SELECTED", validatePercentageAllocations([]).map((e) => e.code), ["NO_SALES_SELECTED"]);
eq("duplicate salesId -> DUPLICATE_SALES_SELECTED", validatePercentageAllocations([{ salesId: "a", percent: 50 }, { salesId: "a", percent: 50 }]).map((e) => e.code), ["DUPLICATE_SALES_SELECTED"]);
eq("negative percent -> PERCENT_INVALID", validatePercentageAllocations([{ salesId: "a", percent: -5 }, { salesId: "b", percent: 105 }]).map((e) => e.code), ["PERCENT_INVALID"]);

// ── percentage -> count against the AVAILABLE pool, not the whole import (5 — 1000/30-20-10) ─
console.log("computePercentageDistribution — targets the assigned amount, not the whole pool");
eq("1000 available at 30/20/10% -> exact 300/200/100 (600 assigned, 400 untouched)", computePercentageDistribution(1000, [
  { salesId: "a", percent: 30 }, { salesId: "b", percent: 20 }, { salesId: "c", percent: 10 },
]).map((r) => r.count), [300, 200, 100]);
eq("400 available at 50/25% -> 200/100 (100 remain unassigned)", computePercentageDistribution(400, [
  { salesId: "a", percent: 50 }, { salesId: "b", percent: 25 },
]).map((r) => r.count), [200, 100]);
eq("1000/5 at 40/25/15/10/10 (=100%) -> exact 400/250/150/100/100", computePercentageDistribution(1000, [
  { salesId: "a", percent: 40 }, { salesId: "b", percent: 25 }, { salesId: "c", percent: 15 }, { salesId: "d", percent: 10 }, { salesId: "e", percent: 10 },
]).map((r) => r.count), [400, 250, 150, 100, 100]);
{
  const r = computePercentageDistribution(333, [{ salesId: "a", percent: 30 }, { salesId: "b", percent: 20 }]);
  check("fractional partial percentages: counts sum to round(333*0.5)=167, not 333", sum(r, (x) => x.count) === 167);
}

// ── manual validation (10,11 — basic + exceeds available rejected) ──────────
console.log("validateManualAllocations — total may be LESS than available, never more");
eq("60+40=100 of 100 available -> valid", validateManualAllocations(100, [{ salesId: "a", count: 60 }, { salesId: "b", count: 40 }]), []);
eq("100+50+25=175 of 400 available -> VALID (partial, spec section 11 example)", validateManualAllocations(400, [{ salesId: "a", count: 100 }, { salesId: "b", count: 50 }, { salesId: "c", count: 25 }]), []);
eq("40+40=80 of 100 -> valid (used to be a mismatch error, no longer)", validateManualAllocations(100, [{ salesId: "a", count: 40 }, { salesId: "b", count: 40 }]), []);
eq("exceeds available -> MANUAL_EXCEEDS_AVAILABLE", validateManualAllocations(100, [{ salesId: "a", count: 60 }, { salesId: "b", count: 60 }]).map((e) => e.code), ["MANUAL_EXCEEDS_AVAILABLE"]);
eq("negative/non-integer -> one MANUAL_COUNT_INVALID per bad entry", validateManualAllocations(100, [{ salesId: "a", count: -1 }, { salesId: "b", count: 1.5 }]).map((e) => e.code), ["MANUAL_COUNT_INVALID", "MANUAL_COUNT_INVALID"]);

// ── equal distribution with an explicit, admin-chosen amount (8,9,12,13,23,24) ─
console.log("validateEqualDistribution / computeEqualDistribution — explicit distributeCount");
eq("distribute 200 of 400 available among 5 -> valid, 40 each (partial quantity)", validateEqualDistribution(400, 200, [{ salesId: "a" }, { salesId: "b" }, { salesId: "c" }, { salesId: "d" }, { salesId: "e" }]), []);
eq("200/5 -> 40 each", computeEqualDistribution(200, ["a", "b", "c", "d", "e"]).map((r) => r.count), [40, 40, 40, 40, 40]);
eq("distribute all 400 of 400 among 5 -> 80 each", computeEqualDistribution(400, ["a", "b", "c", "d", "e"]).map((r) => r.count), [80, 80, 80, 80, 80]);
eq("distributeCount > available -> EQUAL_COUNT_EXCEEDS_AVAILABLE", validateEqualDistribution(400, 500, [{ salesId: "a" }]).map((e) => e.code), ["EQUAL_COUNT_EXCEEDS_AVAILABLE"]);
eq("negative/non-integer distributeCount -> EQUAL_COUNT_INVALID", validateEqualDistribution(400, -1, [{ salesId: "a" }]).map((e) => e.code), ["EQUAL_COUNT_INVALID"]);
eq("1000/5 (all) -> 200 each", computeEqualDistribution(1000, ["a", "b", "c", "d", "e"]).map((r) => r.count), [200, 200, 200, 200, 200]);
eq("1001/5 -> 201,200,200,200,200 (remainder to the first)", computeEqualDistribution(1001, ["a", "b", "c", "d", "e"]).map((r) => r.count), [201, 200, 200, 200, 200]);
eq("999/5 -> 200,200,200,200,199", computeEqualDistribution(999, ["a", "b", "c", "d", "e"]).map((r) => r.count), [200, 200, 200, 200, 199]);
check("1 sales user gets everything chosen", computeEqualDistribution(500, ["a"])[0].count === 500);
check("more sales users than selected leads -> some get 0, total still matches (24)", sum(computeEqualDistribution(3, ["a", "b", "c", "d", "e"]), (r) => r.count) === 3);

// ── validateDistribution / edge cases ─────────────────────────────────────
console.log("validateDistribution — edge cases");
eq("0 available leads -> NO_AVAILABLE_LEADS", validateDistribution({ method: DISTRIBUTION_METHODS.EQUAL, availableCount: 0, allocations: [{ salesId: "a" }] }).map((e) => e.code), ["NO_AVAILABLE_LEADS"]);
eq("equal with no sales selected -> NO_SALES_SELECTED", validateDistribution({ method: DISTRIBUTION_METHODS.EQUAL, availableCount: 10, allocations: [] }).map((e) => e.code), ["NO_SALES_SELECTED"]);
eq("unknown method -> METHOD_INVALID", validateDistribution({ method: "bogus", availableCount: 10, allocations: [] }).map((e) => e.code), ["METHOD_INVALID"]);
check("one sales user (equal, distributeCount omitted = all) -> valid, gets everything (23)", validateDistribution({ method: DISTRIBUTION_METHODS.EQUAL, availableCount: 50, allocations: [{ salesId: "a" }] }).length === 0
  && computeAllocationCounts({ method: DISTRIBUTION_METHODS.EQUAL, availableCount: 50, allocations: [{ salesId: "a" }], distributeCount: 50 })[0].count === 50);

// ── sequential assignment (6 — deterministic; 25 — selected-lead distribution) ─
console.log("buildSequentialAssignments");
{
  const customerIds = ids(10);
  const counts = [{ salesId: "a", count: 4 }, { salesId: "b", count: 3 }, { salesId: "c", count: 3 }];
  const assignments = buildSequentialAssignments(customerIds, counts, (id) => id.toUpperCase());
  eq("contiguous ranges in customerIds order, never randomized", assignments.map((a) => [a.customerId, a.toSalesId]), [
    ["c1", "a"], ["c2", "a"], ["c3", "a"], ["c4", "a"],
    ["c5", "b"], ["c6", "b"], ["c7", "b"],
    ["c8", "c"], ["c9", "c"], ["c10", "c"],
  ]);
  const again = buildSequentialAssignments(customerIds, counts, (id) => id.toUpperCase());
  eq("same input always produces the same output", again, assignments);
}
{
  // partial allocation: only 6 of 10 get consumed, the tail is left completely alone.
  const customerIds = ids(10);
  const counts = [{ salesId: "a", count: 4 }, { salesId: "b", count: 2 }];
  const assignments = buildSequentialAssignments(customerIds, counts, () => "x");
  eq("only the first 6 are touched; c7..c10 never appear", assignments.map((a) => a.customerId), ["c1", "c2", "c3", "c4", "c5", "c6"]);
}
{
  // selected-lead distribution (25): distributing from a specific hand-picked subset (not the whole pool) —
  // the pool passed in IS the selection; order/slicing works identically.
  const selection = ["c3", "c17", "c42", "c99"];
  const assignments = buildSequentialAssignments(selection, [{ salesId: "a", count: 2 }, { salesId: "b", count: 2 }], () => "x");
  eq("selection distributed in the given order, nothing outside the selection touched", assignments.map((a) => a.customerId), ["c3", "c17", "c42", "c99"]);
}

// ── buildAssignmentPatches: diffing against current state (18,19,20,21) ─────
console.log("buildAssignmentPatches");
{
  const store = { c1: { assignedToId: null, assignedToName: null }, c2: { assignedToId: "b", assignedToName: "Mohamed" } };
  const customerById = (id) => store[id];
  const assignments = [
    { customerId: "c1", toSalesId: "a", toSalesName: "Ahmed" },
    { customerId: "c2", toSalesId: "a", toSalesName: "Ahmed" },
  ];
  const { patches, unchangedCount } = buildAssignmentPatches(assignments, { customerById, method: "manual", sourceBatchId: "batch1", currentUser: { id: "admin1", name: "Admin" }, now: "2026-09-30T00:00:00.000Z" });
  eq("both changed -> 2 patches, 0 unchanged", [patches.length, unchangedCount], [2, 0]);
  const p2 = patches.find((p) => p.customerId === "c2");
  eq("reassignment history (19) captures previous owner", [p2.historyEntry.fromSalesId, p2.historyEntry.fromSalesName, p2.historyEntry.toSalesId], ["b", "Mohamed", "a"]);
  eq("history entry records batchId/method/assignedBy", [p2.historyEntry.batchId, p2.historyEntry.method, p2.historyEntry.assignedBy, p2.historyEntry.assignedByName], ["batch1", "manual", "admin1", "Admin"]);
  eq("patch (18) never touches importSequence/importBatchId — only assignedToId/assignedToName/updatedAt", Object.keys(p2.patch).sort(), ["assignedToId", "assignedToName", "updatedAt"].sort());

  // Retry / idempotency (21): apply the patches, then recompute the identical assignment again.
  for (const p of patches) store[p.customerId] = { ...store[p.customerId], assignedToId: p.patch.assignedToId, assignedToName: p.patch.assignedToName };
  const retry = buildAssignmentPatches(assignments, { customerById, method: "manual", sourceBatchId: "batch1", currentUser: { id: "admin1" }, now: "2026-09-30T00:01:00.000Z" });
  eq("re-running the identical distribution writes nothing (retry-safe)", [retry.patches.length, retry.unchangedCount], [0, 2]);
}
{
  // no-op assignment (20): already correctly assigned to the SAME target -> no history entry, no patch.
  const store = { c1: { assignedToId: "a", assignedToName: "Ahmed" } };
  const { patches, unchangedCount } = buildAssignmentPatches(
    [{ customerId: "c1", toSalesId: "a", toSalesName: "Ahmed" }],
    { customerById: (id) => store[id], method: "equal", sourceBatchId: null, currentUser: { id: "admin1" } },
  );
  eq("already-correct existing customer -> unchanged, no patch, no history", [patches.length, unchangedCount], [0, 1]);
}

// ── full preview (13 — shows available/selected/remaining) ──────────────────
console.log("buildDistributionPreview");
{
  // Section 13's own numbers (Ahmed 50%->150, Mohamed 30%->90, Ali 20%->60, out of "selected for distribution: 300")
  // only reconcile when the admin has already narrowed 400 unassigned down to a 300 SELECTION first — percentages
  // are "of the pool passed in", i.e. of that 300, not of the full 400 (see section 2's own heading). A separate,
  // un-narrowed 60/40% split against the full 400 available is exercised further down for the "less than 100%" case.
  const salesNameById = (id) => ({ a: "Ahmed", b: "Mohamed", c: "Ali" }[id] || id);
  const preview = buildDistributionPreview({
    method: DISTRIBUTION_METHODS.PERCENTAGE, availableCount: 300, salesNameById,
    allocations: [{ salesId: "a", percent: 50 }, { salesId: "b", percent: 30 }, { salesId: "c", percent: 20 }],
  });
  eq("section 13's own example: 150/90/60 out of a 300-selection, 0 remaining OF THAT SELECTION", [preview.errors, preview.totalAssigned, preview.remaining], [[], 300, 0]);
  eq("names resolved, percent carried, counts exact", preview.rows.map((r) => [r.salesName, r.percent, r.count]), [["Ahmed", 50, 150], ["Mohamed", 30, 90], ["Ali", 20, 60]]);

  // Same allocations against the FULL 400-lead pool (no pre-narrowing) instead sum to 100% of 400 -> fully assigned.
  const previewFull = buildDistributionPreview({ method: DISTRIBUTION_METHODS.PERCENTAGE, availableCount: 400, salesNameById, allocations: [{ salesId: "a", percent: 50 }, { salesId: "b", percent: 30 }, { salesId: "c", percent: 20 }] });
  eq("same 50/30/20% against the full 400 (not pre-narrowed) -> 200/120/80, 0 remaining", [previewFull.rows.map((r) => r.count), previewFull.remaining], [[200, 120, 80], 0]);

  // A genuinely partial percentage against the full pool: 30%+20% of 400 -> 120+80=200 assigned, 200 remaining unassigned.
  const previewPartial = buildDistributionPreview({ method: DISTRIBUTION_METHODS.PERCENTAGE, availableCount: 400, salesNameById, allocations: [{ salesId: "a", percent: 30 }, { salesId: "b", percent: 20 }] });
  eq("30%+20% of 400 available -> 120+80=200 assigned, 200 remain unassigned", [previewPartial.totalAssigned, previewPartial.remaining], [200, 200]);
}
{
  const invalidPreview = buildDistributionPreview({ method: DISTRIBUTION_METHODS.PERCENTAGE, availableCount: 100, allocations: [{ salesId: "a", percent: 150 }], salesNameById: () => null });
  eq("invalid preview -> errors surfaced, no rows", [invalidPreview.errors.map((e) => e.code), invalidPreview.rows, invalidPreview.totalAssigned], [["PERCENT_TOTAL_INVALID"], [], 0]);
}

// ── chunking (22/29 — performance, large imports) ────────────────────────
console.log("chunkDistributionOps");
{
  const ops = ids(1000).map((id) => ({ customerId: id }));
  const chunks = chunkDistributionOps(ops, 400);
  eq("1000 ops in chunks of 400 -> 3 chunks of 400/400/200", chunks.map((c) => c.length), [400, 400, 200]);
  check("chunk sizes never exceed Firestore's own 500-op batch limit", chunks.every((c) => c.length <= 500));
}
{
  // 29 — large import: 5000 leads, partial distribution of 3000, sums stay exact.
  const customerIds = ids(5000);
  const counts = computeEqualDistribution(3000, ["a", "b", "c"]);
  const assignments = buildSequentialAssignments(customerIds, counts, () => "x");
  eq("5000-lead pool, 3000 distributed among 3 -> exactly 3000 assignments, 2000 untouched", assignments.length, 3000);
  check("large-import chunk count is proportional (3000/400 = 8 chunks)", chunkDistributionOps(assignments.map((a) => ({ id: a.customerId }))).length === 8);
}

// ═══════════════════════ commit-level: sequence numbers (14,15,16,17) ═══════════════════════
console.log("\nrunLeadImportCommit — importSequence / importBatchId");

// A tiny in-memory fake Firestore: customers keyed by id, batches keyed by id, auto-incrementing ids.
function makeFakeStore(initialCustomers = []) {
  const customers = new Map(initialCustomers.map((c) => [c.id, { ...c }]));
  const batches = new Map();
  let nextId = 1;
  return {
    customers,
    createBatch: async (form) => { const id = `batch${nextId++}`; batches.set(id, { id, ...form }); return id; },
    updateBatch: async (id, patch) => { batches.set(id, { ...batches.get(id), ...patch }); },
    commitLeadImportChunk: async (ops) => {
      const createdIds = [];
      for (const op of ops) {
        if (op.type === "create") {
          const id = `cust${nextId++}`;
          customers.set(id, { id, ...op.data });
          createdIds.push(id);
        } else if (op.type === "update") {
          customers.set(op.id, { ...customers.get(op.id), ...op.patch });
        }
      }
      return createdIds;
    },
  };
}
const nodeById = () => null;

// 16 — rejected rows do not consume sequence numbers.
{
  const rows = [
    { name: "A", phone: "01011111111" },   // accepted -> seq 1
    { name: "B", phone: "" },              // rejected (no phone) -> consumes NOTHING
    { name: "C", phone: "01033333333" },   // accepted -> seq 2
    { name: "D", phone: "bad-phone" },     // rejected (invalid) -> consumes NOTHING
    { name: "E", phone: "01055555555" },   // accepted -> seq 3
  ];
  const plan = await planLeadImport({ rows, rowNumbers: rows.map((_, i) => i + 2), mapping: { phone: "phone", name: "name", programs: [] }, existingCustomers: [], programs: [], yieldEvery: 0 });
  eq("5 rows in, 3 accepted (2 rejected)", [plan.rows.length, plan.acceptedCustomers.length], [5, 3]);
  const store = makeFakeStore();
  const result = await runLeadImportCommit({ plan, fileName: "t.xlsx", customers: [...store.customers.values()], nodeById, createBatch: store.createBatch, updateBatch: store.updateBatch, commitLeadImportChunk: store.commitLeadImportChunk });
  const seqs = result.acceptedCustomerIds.map((id) => store.customers.get(id).importSequence);
  eq("sequence numbers are 1,2,3 — never 1,3,5 (rejected rows never consume a position)", seqs, [1, 2, 3]);
  check("every sequenced customer also carries the batch id", result.acceptedCustomerIds.every((id) => store.customers.get(id).importBatchId === result.batchId));
}

// 14/8 — existing customer, first time ever imported, otherwise nothing to change -> still gets exactly one write for the sequence.
{
  const existing = { id: "existingA", fullName: "Existing", phone: "01099999999", normalizedPhone: "01099999999", secondaryPhones: [], interestedProgramIds: [], notes: "" };
  const rows = [{ name: "Existing", phone: "01099999999" }];
  const plan = await planLeadImport({ rows, rowNumbers: [2], mapping: { phone: "phone", name: "name", programs: [] }, existingCustomers: [existing], programs: [], yieldEvery: 0 });
  eq("matched, nothing to update in the OLD sense (plan says unchanged)", plan.customersToUpdate.length, 0);
  const store = makeFakeStore([existing]);
  const result = await runLeadImportCommit({ plan, fileName: "t2.xlsx", customers: [existing], nodeById, createBatch: store.createBatch, updateBatch: store.updateBatch, commitLeadImportChunk: store.commitLeadImportChunk });
  eq("still exactly one accepted id (the existing customer, sequenced for the first time)", result.acceptedCustomerIds, ["existingA"]);
  eq("existing customer's OWN identity is preserved (reused, not duplicated) and now sequenced", [store.customers.get("existingA").fullName, store.customers.get("existingA").importSequence], ["Existing", 1]);
}

// 17 — re-importing the SAME customer a second time never renumbers it.
{
  const existing = { id: "existingB", fullName: "Existing2", phone: "01088888888", normalizedPhone: "01088888888", secondaryPhones: [], interestedProgramIds: [], notes: "", importSequence: 42, importBatchId: "batchOld" };
  const rows = [{ name: "Existing2", phone: "01088888888" }];
  const plan = await planLeadImport({ rows, rowNumbers: [2], mapping: { phone: "phone", name: "name", programs: [] }, existingCustomers: [existing], programs: [], yieldEvery: 0 });
  const store = makeFakeStore([existing]);
  const result = await runLeadImportCommit({ plan, fileName: "t3.xlsx", customers: [existing], nodeById, createBatch: store.createBatch, updateBatch: store.updateBatch, commitLeadImportChunk: store.commitLeadImportChunk });
  eq("nothing to write at all — already sequenced, nothing else changed (nothingToDo)", result.nothingToDo, true);
  eq("sequence number stays 42, batch stays batchOld — never renumbered on re-import", [store.customers.get("existingB").importSequence, store.customers.get("existingB").importBatchId], [42, "batchOld"]);
}

// 15 — duplicate rows in the SAME file: one phone appearing twice consumes exactly one sequence number.
{
  const rows = [
    { name: "Dup", phone: "01077777777" },
    { name: "Dup", phone: "01077777777" }, // same phone again -> merged, not a second accepted lead
    { name: "Other", phone: "01066666666" },
  ];
  const plan = await planLeadImport({ rows, rowNumbers: rows.map((_, i) => i + 2), mapping: { phone: "phone", name: "name", programs: [] }, existingCustomers: [], programs: [], yieldEvery: 0 });
  eq("2 unique accepted leads out of 3 rows (one duplicate merged)", plan.acceptedCustomers.length, 2);
  const store = makeFakeStore();
  const result = await runLeadImportCommit({ plan, fileName: "t4.xlsx", customers: [...store.customers.values()], nodeById, createBatch: store.createBatch, updateBatch: store.updateBatch, commitLeadImportChunk: store.commitLeadImportChunk });
  eq("only 2 real customers created (no duplicate customer for the repeated row)", result.acceptedCustomerIds.length, 2);
  eq("sequence numbers 1,2 — the duplicate row never consumed its own number", result.acceptedCustomerIds.map((id) => store.customers.get(id).importSequence), [1, 2]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
