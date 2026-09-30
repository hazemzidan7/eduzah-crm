// Ad-hoc test suite for LEAD-DISTRIBUTION-01, run against the real shipped
// pure functions (no mocks). Not part of the app build; not wired into any
// npm script. Run with:
//   node --import ./scripts/esm-ext-loader.mjs scripts/test-lead-distribution.mjs
import {
  selectActiveSalesUsers, computeEqualDistribution, validatePercentageAllocations,
  computePercentageDistribution, validateManualAllocations, validateDistribution,
  computeAllocationCounts, buildSequentialAssignments, buildAssignmentPatches,
  buildDistributionPreview, chunkDistributionOps, DISTRIBUTION_METHODS,
} from "../src/utils/leadDistribution.js";

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

// ── selectActiveSalesUsers ──────────────────────────────────────────────
console.log("selectActiveSalesUsers");
eq("only role sales, excludes rejected, excludes other roles", selectActiveSalesUsers([
  { id: "a", role: "sales", status: "approved" },
  { id: "b", role: "sales", status: "rejected" },
  { id: "c", role: "admin", status: "approved" },
  { id: "d", role: "accounting", status: "approved" },
  { id: "e", role: "sales" },
]).map((u) => u.id), ["a", "e"]);

// ── computeEqualDistribution ────────────────────────────────────────────
console.log("computeEqualDistribution");
eq("1000/5 -> 200 each", computeEqualDistribution(1000, ["a", "b", "c", "d", "e"]).map((r) => r.count), [200, 200, 200, 200, 200]);
eq("1001/5 -> 201,200,200,200,200", computeEqualDistribution(1001, ["a", "b", "c", "d", "e"]).map((r) => r.count), [201, 200, 200, 200, 200]);
eq("999/5 -> 200,200,200,200,199", computeEqualDistribution(999, ["a", "b", "c", "d", "e"]).map((r) => r.count), [200, 200, 200, 200, 199]);
eq("0 sales -> []", computeEqualDistribution(100, []), []);
check("1 sales user gets everything", computeEqualDistribution(500, ["a"])[0].count === 500);
check("more sales than leads -> some get 0, total still matches", sum(computeEqualDistribution(3, ["a", "b", "c", "d", "e"]), (r) => r.count) === 3);

// ── percentage validation ────────────────────────────────────────────────
console.log("validatePercentageAllocations");
eq("empty -> NO_SALES_SELECTED", validatePercentageAllocations([]).map((e) => e.code), ["NO_SALES_SELECTED"]);
eq("duplicate salesId -> DUPLICATE_SALES_SELECTED", validatePercentageAllocations([{ salesId: "a", percent: 50 }, { salesId: "a", percent: 50 }]).map((e) => e.code), ["DUPLICATE_SALES_SELECTED"]);
eq("negative percent -> PERCENT_INVALID", validatePercentageAllocations([{ salesId: "a", percent: -5 }, { salesId: "b", percent: 105 }]).map((e) => e.code), ["PERCENT_INVALID"]);
eq("non-numeric percent -> PERCENT_INVALID", validatePercentageAllocations([{ salesId: "a", percent: "abc" }]).map((e) => e.code), ["PERCENT_INVALID"]);
eq("sums to 99 -> PERCENT_TOTAL_INVALID", validatePercentageAllocations([{ salesId: "a", percent: 99 }]).map((e) => e.code), ["PERCENT_TOTAL_INVALID"]);
eq("sums to 101 -> PERCENT_TOTAL_INVALID", validatePercentageAllocations([{ salesId: "a", percent: 60 }, { salesId: "b", percent: 41 }]).map((e) => e.code), ["PERCENT_TOTAL_INVALID"]);
eq("sums to exactly 100 -> valid", validatePercentageAllocations([{ salesId: "a", percent: 40 }, { salesId: "b", percent: 25 }, { salesId: "c", percent: 15 }, { salesId: "d", percent: 10 }, { salesId: "e", percent: 10 }]), []);
eq("33.33 x3 + 0.01 reads as 100% -> valid", validatePercentageAllocations([{ salesId: "a", percent: 33.33 }, { salesId: "b", percent: 33.33 }, { salesId: "c", percent: 33.34 }]), []);

// ── percentage -> count (largest remainder / Hamilton) ──────────────────
console.log("computePercentageDistribution");
eq("1000/5 at 40/25/15/10/10 -> exact 400/250/150/100/100", computePercentageDistribution(1000, [
  { salesId: "a", percent: 40 }, { salesId: "b", percent: 25 }, { salesId: "c", percent: 15 }, { salesId: "d", percent: 10 }, { salesId: "e", percent: 10 },
]).map((r) => r.count), [400, 250, 150, 100, 100]);
{
  const r = computePercentageDistribution(10, [{ salesId: "a", percent: 33.33 }, { salesId: "b", percent: 33.33 }, { salesId: "c", percent: 33.34 }]);
  check("fractional percentages: counts sum to exactly totalCount (10)", sum(r, (x) => x.count) === 10);
}
{
  const r1001 = computePercentageDistribution(1001, [{ salesId: "a", percent: 20 }, { salesId: "b", percent: 20 }, { salesId: "c", percent: 20 }, { salesId: "d", percent: 20 }, { salesId: "e", percent: 20 }]);
  check("1001 at equal 20% x5: counts sum to exactly 1001", sum(r1001, (x) => x.count) === 1001);
  const r999 = computePercentageDistribution(999, [{ salesId: "a", percent: 20 }, { salesId: "b", percent: 20 }, { salesId: "c", percent: 20 }, { salesId: "d", percent: 20 }, { salesId: "e", percent: 20 }]);
  check("999 at equal 20% x5: counts sum to exactly 999", sum(r999, (x) => x.count) === 999);
}
{
  // deterministic tie-break: two allocations with the identical remainder — original order wins.
  const r = computePercentageDistribution(3, [{ salesId: "a", percent: 50 }, { salesId: "b", percent: 50 }]);
  eq("tied remainders resolve by original list order (deterministic)", r.map((x) => x.count), [2, 1]);
}

// ── manual validation ────────────────────────────────────────────────────
console.log("validateManualAllocations");
eq("empty -> NO_SALES_SELECTED", validateManualAllocations(100, []).map((e) => e.code), ["NO_SALES_SELECTED"]);
eq("duplicate -> DUPLICATE_SALES_SELECTED", validateManualAllocations(100, [{ salesId: "a", count: 50 }, { salesId: "a", count: 50 }]).map((e) => e.code), ["DUPLICATE_SALES_SELECTED"]);
eq("negative/non-integer -> one MANUAL_COUNT_INVALID per bad entry", validateManualAllocations(100, [{ salesId: "a", count: -1 }, { salesId: "b", count: 1.5 }]).map((e) => e.code), ["MANUAL_COUNT_INVALID", "MANUAL_COUNT_INVALID"]);
eq("sum mismatch -> MANUAL_TOTAL_MISMATCH", validateManualAllocations(100, [{ salesId: "a", count: 40 }, { salesId: "b", count: 40 }]).map((e) => e.code), ["MANUAL_TOTAL_MISMATCH"]);
eq("exact sum -> valid", validateManualAllocations(100, [{ salesId: "a", count: 60 }, { salesId: "b", count: 40 }]), []);

// ── validateDistribution / edge cases (Phase 17) ─────────────────────────
console.log("validateDistribution — edge cases");
eq("0 accepted leads -> NO_ACCEPTED_LEADS", validateDistribution({ method: DISTRIBUTION_METHODS.EQUAL, totalCount: 0, allocations: [{ salesId: "a" }] }).map((e) => e.code), ["NO_ACCEPTED_LEADS"]);
eq("equal with no sales selected -> NO_SALES_SELECTED", validateDistribution({ method: DISTRIBUTION_METHODS.EQUAL, totalCount: 10, allocations: [] }).map((e) => e.code), ["NO_SALES_SELECTED"]);
eq("unknown method -> METHOD_INVALID", validateDistribution({ method: "bogus", totalCount: 10, allocations: [] }).map((e) => e.code), ["METHOD_INVALID"]);
check("one sales user (equal) -> valid, gets everything", validateDistribution({ method: DISTRIBUTION_METHODS.EQUAL, totalCount: 50, allocations: [{ salesId: "a" }] }).length === 0
  && computeAllocationCounts({ method: DISTRIBUTION_METHODS.EQUAL, totalCount: 50, allocations: [{ salesId: "a" }] })[0].count === 50);

// ── sequential assignment (Phase 5 — deterministic, never randomized) ────
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
  check("every customer assigned exactly once, total matches", assignments.length === customerIds.length);
  // same input twice -> identical output (determinism)
  const again = buildSequentialAssignments(customerIds, counts, (id) => id.toUpperCase());
  eq("same input always produces the same output", again, assignments);
}

// ── buildAssignmentPatches: diffing against current state (idempotency, Phase 13) ─
console.log("buildAssignmentPatches");
{
  const store = { c1: { assignedToId: null, assignedToName: null }, c2: { assignedToId: "b", assignedToName: "Mohamed" } };
  const customerById = (id) => store[id];
  const assignments = [
    { customerId: "c1", toSalesId: "a", toSalesName: "Ahmed" }, // unassigned -> a : real change
    { customerId: "c2", toSalesId: "a", toSalesName: "Ahmed" }, // was b -> a : real reassignment
  ];
  const { patches, unchangedCount } = buildAssignmentPatches(assignments, { customerById, method: "manual", sourceBatchId: "batch1", currentUser: { id: "admin1", name: "Admin" }, now: "2026-09-30T00:00:00.000Z" });
  eq("both changed -> 2 patches, 0 unchanged", [patches.length, unchangedCount], [2, 0]);
  const p2 = patches.find((p) => p.customerId === "c2");
  eq("reassignment history captures previous owner", [p2.historyEntry.fromSalesId, p2.historyEntry.fromSalesName, p2.historyEntry.toSalesId], ["b", "Mohamed", "a"]);
  eq("history entry records batchId/method/assignedBy", [p2.historyEntry.batchId, p2.historyEntry.method, p2.historyEntry.assignedBy, p2.historyEntry.assignedByName], ["batch1", "manual", "admin1", "Admin"]);
  eq("patch only ever touches assignedToId/assignedToName/updatedAt", Object.keys(p2.patch).sort(), ["assignedToId", "assignedToName", "updatedAt"].sort());

  // Retry / idempotency: apply the patches to the store, then recompute the identical assignment again.
  for (const p of patches) store[p.customerId] = { ...store[p.customerId], assignedToId: p.patch.assignedToId, assignedToName: p.patch.assignedToName };
  const retry = buildAssignmentPatches(assignments, { customerById, method: "manual", sourceBatchId: "batch1", currentUser: { id: "admin1" }, now: "2026-09-30T00:01:00.000Z" });
  eq("re-running the identical distribution writes nothing (retry-safe)", [retry.patches.length, retry.unchangedCount], [0, 2]);
}
{
  // existing customer already correctly assigned to the SAME target the distribution would pick — no-op, no duplicate history.
  const store = { c1: { assignedToId: "a", assignedToName: "Ahmed" } };
  const { patches, unchangedCount } = buildAssignmentPatches(
    [{ customerId: "c1", toSalesId: "a", toSalesName: "Ahmed" }],
    { customerById: (id) => store[id], method: "equal", sourceBatchId: null, currentUser: { id: "admin1" } },
  );
  eq("already-correct existing customer -> unchanged, no patch", [patches.length, unchangedCount], [0, 1]);
}

// ── full preview (Phase 6) ────────────────────────────────────────────────
console.log("buildDistributionPreview");
{
  const salesNameById = (id) => ({ a: "Ahmed", b: "Mohamed", c: "Ali", d: "Mahmoud", e: "Youssef" }[id] || id);
  const preview = buildDistributionPreview({
    method: DISTRIBUTION_METHODS.PERCENTAGE, totalCount: 1000, salesNameById,
    allocations: [{ salesId: "a", percent: 40 }, { salesId: "b", percent: 25 }, { salesId: "c", percent: 15 }, { salesId: "d", percent: 10 }, { salesId: "e", percent: 10 }],
  });
  eq("no errors, 5 rows, totalAssigned == totalCount", [preview.errors, preview.rows.length, preview.totalAssigned], [[], 5, 1000]);
  eq("names resolved, percent carried, counts exact", preview.rows.map((r) => [r.salesName, r.percent, r.count]), [
    ["Ahmed", 40, 400], ["Mohamed", 25, 250], ["Ali", 15, 150], ["Mahmoud", 10, 100], ["Youssef", 10, 100],
  ]);
}
{
  const invalidPreview = buildDistributionPreview({ method: DISTRIBUTION_METHODS.PERCENTAGE, totalCount: 100, allocations: [{ salesId: "a", percent: 50 }], salesNameById: () => null });
  eq("invalid preview -> errors surfaced, no rows", [invalidPreview.errors.map((e) => e.code), invalidPreview.rows, invalidPreview.totalAssigned], [["PERCENT_TOTAL_INVALID"], [], 0]);
}

// ── chunking ───────────────────────────────────────────────────────────
console.log("chunkDistributionOps");
{
  const ops = ids(1000).map((id) => ({ customerId: id }));
  const chunks = chunkDistributionOps(ops, 400);
  eq("1000 ops in chunks of 400 -> 3 chunks of 400/400/200", chunks.map((c) => c.length), [400, 400, 200]);
  check("chunk sizes never exceed Firestore's own 500-op batch limit", chunks.every((c) => c.length <= 500));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
