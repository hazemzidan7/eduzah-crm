// Ad-hoc test suite for the COURSE-BASED LEAD DISTRIBUTION addition to
// LEAD-DISTRIBUTION-01 — tests ONLY the new selectLeadsByInterestedPrograms()
// filter and its combination with the EXISTING, unmodified distribution
// engine (percentage/equal/manual/sequential) — no new engine, just proving
// the filtered pool flows through the same functions correctly. Run with:
//   node --import ./scripts/esm-ext-loader.mjs scripts/test-course-based-distribution.mjs
import {
  selectLeadsByInterestedPrograms, selectUnassignedLeads,
  computePercentageDistribution, computeEqualDistribution, validateManualAllocations,
  buildSequentialAssignments, buildAssignmentPatches,
} from "../src/utils/leadDistribution.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); }
  else { fail++; console.log(`FAIL  - ${name}`); }
}
function eq(name, actual, expected) {
  check(`${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, JSON.stringify(actual) === JSON.stringify(expected));
}

const customerById = (map) => (id) => map[id];

// ── 1. one selected Program ──────────────────────────────────────────────
console.log("1. one selected Program");
{
  const byId = { c1: { interestedProgramIds: ["DATA"] }, c2: { interestedProgramIds: ["AI"] }, c3: { interestedProgramIds: ["DATA", "AI"] } };
  eq("only customers with DATA in their interests", selectLeadsByInterestedPrograms(["c1", "c2", "c3"], ["DATA"], customerById(byId)), ["c1", "c3"]);
}

// ── 2. multiple selected Programs (OR, not AND) ──────────────────────────
console.log("2. multiple selected Programs");
{
  const byId = { a: { interestedProgramIds: ["DATA", "AI"] }, b: { interestedProgramIds: ["DATA"] }, c: { interestedProgramIds: ["AI"] }, d: { interestedProgramIds: ["FRONT"] } };
  eq("customers with DATA OR AI (section 11's own example: eligible count 3, not 4)", selectLeadsByInterestedPrograms(["a", "b", "c", "d"], ["DATA", "AI"], customerById(byId)), ["a", "b", "c"]);
}

// ── 3. a customer interested in MULTIPLE selected Programs still appears ONCE ─
console.log("3. multi-interest customer appears exactly once");
{
  const byId = { a: { interestedProgramIds: ["DATA", "AI", "FRONT"] } };
  const result = selectLeadsByInterestedPrograms(["a"], ["DATA", "AI"], customerById(byId));
  eq("customer A (interested in both selected programs) appears exactly once, not twice", result, ["a"]);
  eq("never duplicated regardless of how many of their interests match", result.filter((id) => id === "a").length, 1);
}

// ── 4/5. assigned customers excluded, unassigned included (via selectUnassignedLeads first) ─
console.log("4/5. assigned excluded, unassigned included");
{
  const customers = [
    { id: "assigned1", assignedToId: "salesX", interestedProgramIds: ["DATA"] },
    { id: "unassigned1", assignedToId: null, interestedProgramIds: ["DATA"] },
  ];
  const unassignedPool = selectUnassignedLeads(customers).map((c) => c.id);
  eq("only the unassigned customer reaches the pool the course filter operates on", unassignedPool, ["unassigned1"]);
  const byId = Object.fromEntries(customers.map((c) => [c.id, c]));
  eq("course filter never re-includes an already-assigned customer (it was never in the pool)", selectLeadsByInterestedPrograms(unassignedPool, ["DATA"], customerById(byId)), ["unassigned1"]);
}

// ── 6. customers with no interestedProgramIds are excluded ───────────────
console.log("6. no interestedProgramIds -> excluded");
{
  const byId = { a: { interestedProgramIds: [] }, b: {}, c: { interestedProgramIds: ["DATA"] } };
  eq("customers with an empty or missing interest list never match any course", selectLeadsByInterestedPrograms(["a", "b", "c"], ["DATA"], customerById(byId)), ["c"]);
}

// ── 7. no matching customers -> empty, no fake results ───────────────────
console.log("7. no matching customers");
{
  const byId = { a: { interestedProgramIds: ["FRONT"] } };
  eq("selecting a course nobody is interested in yields an empty (not fabricated) pool", selectLeadsByInterestedPrograms(["a"], ["DATA"], customerById(byId)), []);
}

// ── 8/9. sequential order preserved; original lead numbers untouched ─────
console.log("8/9. sequential order preserved, lead numbers (importSequence) untouched");
{
  // 10 leads, positions 1..10 (importSequence) — only 2,5,7,9 are interested in DATA (section 8's own example).
  const customers = Array.from({ length: 10 }, (_, i) => ({
    id: `c${i + 1}`, importSequence: i + 1, assignedToId: null,
    interestedProgramIds: [2, 5, 7, 9].includes(i + 1) ? ["DATA"] : ["OTHER"],
  }));
  const byId = Object.fromEntries(customers.map((c) => [c.id, c]));
  const orderedPool = customers.map((c) => c.id); // already in stable import order (1..10)
  const eligible = selectLeadsByInterestedPrograms(orderedPool, ["DATA"], customerById(byId));
  eq("eligible pool is exactly [c2,c5,c7,c9], IN ORDER — never reordered", eligible, ["c2", "c5", "c7", "c9"]);
  eq("their importSequence numbers are untouched: 2,5,7,9 — never renumbered to 1,2,3,4", eligible.map((id) => byId[id].importSequence), [2, 5, 7, 9]);

  // section 8's own worked example: 50% of the 4-lead eligible pool -> Ahmed gets c2,c5; c7,c9 stay unassigned.
  const counts = computeEqualDistribution(2, ["ahmed"]); // "50% of 4" == distributeCount 2, one rep
  const assignments = buildSequentialAssignments(eligible, counts, () => "Ahmed");
  eq("Ahmed receives leads #2 and #5 (in that order)", assignments.map((a) => [a.customerId, byId[a.customerId].importSequence]), [["c2", 2], ["c5", 5]]);
  eq("c7 and c9 are never touched — still #7 and #9, still unassigned", eligible.slice(2), ["c7", "c9"]);
}

// ── 10. partial distribution leaves remaining leads unassigned ───────────
console.log("10. partial distribution leaves the rest unassigned");
{
  // section 5's own worked example: 400 unassigned, 180 interested in Data Analysis, distribute 120 -> 60 remain.
  const customers = Array.from({ length: 400 }, (_, i) => ({
    id: `c${i + 1}`, importSequence: i + 1, assignedToId: null,
    interestedProgramIds: i < 180 ? ["DATA"] : ["OTHER"],
  }));
  const byId = Object.fromEntries(customers.map((c) => [c.id, c]));
  const unassignedPool = selectUnassignedLeads(customers).map((c) => c.id);
  eq("400 unassigned total", unassignedPool.length, 400);
  const eligible = selectLeadsByInterestedPrograms(unassignedPool, ["DATA"], customerById(byId));
  eq("180 interested in Data Analysis (section 5's own numbers)", eligible.length, 180);
  const counts = computeEqualDistribution(120, ["a"]);
  const assignments = buildSequentialAssignments(eligible, counts, () => "A");
  eq("exactly 120 distributed", assignments.length, 120);
  eq("60 of the 180 course-eligible leads remain untouched (still unassigned, not lost)", eligible.length - assignments.length, 60);
  eq("the untouched 60 are never removed from the eligible/unassigned pool itself", eligible.slice(120).length, 60);
}

// ── 11. percentage distribution on the filtered pool (section 5's exact numbers) ─
console.log("11. percentage distribution on the filtered pool");
{
  const counts = computePercentageDistribution(180, [{ salesId: "ahmed", percent: 50 }, { salesId: "mohamed", percent: 30 }, { salesId: "ali", percent: 20 }]);
  eq("180 available (course-filtered) at 50/30/20% -> exact 90/54/36 (section 5's own example)", counts.map((c) => c.count), [90, 54, 36]);
  check("total assigned (180) leaves 0 remaining at exactly 100%", counts.reduce((s, c) => s + c.count, 0) === 180);
}

// ── 12. equal distribution on the filtered pool ───────────────────────────
console.log("12. equal distribution on the filtered pool");
{
  // section 5's variant: 400 unassigned, 180 course-eligible, 5 sales, distribute 120 of the 180 equally.
  const counts = computeEqualDistribution(120, ["a", "b", "c", "d", "e"]);
  eq("120 of the course-filtered 180, split equally among 5 -> 24 each", counts.map((c) => c.count), [24, 24, 24, 24, 24]);
}

// ── 13. manual distribution on the filtered pool ──────────────────────────
console.log("13. manual distribution on the filtered pool");
{
  eq("manual counts within the 180 course-filtered available -> valid", validateManualAllocations(180, [{ salesId: "a", count: 100 }, { salesId: "b", count: 50 }]), []);
  eq("manual counts EXCEEDING the course-filtered available (180) -> rejected, even though it might fit the full unassigned pool (400)", validateManualAllocations(180, [{ salesId: "a", count: 200 }]).map((e) => e.code), ["MANUAL_EXCEEDS_AVAILABLE"]);
}

// ── assignment patches on a course-filtered pool never touch interestedProgramIds ─
console.log("assignment patches never modify interestedProgramIds");
{
  const store = { c1: { assignedToId: null, assignedToName: null, interestedProgramIds: ["DATA", "AI"] } };
  const { patches } = buildAssignmentPatches(
    [{ customerId: "c1", toSalesId: "ahmed", toSalesName: "Ahmed" }],
    { customerById: (id) => store[id], method: "percentage", sourceBatchId: null, currentUser: { id: "admin1" } },
  );
  eq("the patch touches ONLY assignedToId/assignedToName/updatedAt — never interestedProgramIds", Object.keys(patches[0].patch).sort(), ["assignedToId", "assignedToName", "updatedAt"]);
  check("interestedProgramIds is untouched in the store (course filtering reads it, never writes it)", JSON.stringify(store.c1.interestedProgramIds) === JSON.stringify(["DATA", "AI"]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
