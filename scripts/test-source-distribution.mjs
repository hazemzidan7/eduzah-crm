// Ad-hoc test suite for IMPORT-SOURCE-01 (distribute new customers by import
// source). Run against the real shipped pure modules and the real source/rules
// files; Firestore is replaced by an in-memory capture of what the real import
// commit code would write. The distribution pipeline is replayed with the SAME
// functions the panel + hook call (no source-specific engine exists — that is
// one of the things asserted). Synthetic data only. Not part of the app build.
//   node --import ./scripts/esm-ext-loader.mjs scripts/test-source-distribution.mjs
import { readFileSync } from "node:fs";
import * as dist from "../src/utils/leadDistribution.js";
import { runLeadImportCommit } from "../src/utils/leadImportCommit.js";
import { planLeadImport } from "../src/utils/leadImport.js";
import { buildImportBatchDoc } from "../src/utils/importBatchDoc.js";

const {
  DISTRIBUTION_METHODS, selectUnassignedLeads, selectLeadsByInterestedPrograms, selectLeadsBySource,
  buildBatchSourceIndex, customerSourceEntries, buildSourceOptions, sourceKeyOf,
  validateDistribution, computeAllocationCounts, buildSequentialAssignments, buildAssignmentPatches, buildDistributionPreview,
} = dist;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  - ${name}`); } else { fail++; console.log(`FAIL  - ${name}`); }
}
function eq(name, actual, expected) {
  check(`${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, JSON.stringify(actual) === JSON.stringify(expected));
}
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// ── fixtures ────────────────────────────────────────────────────────────
const src = (name, batchId = `b-${name}`) => ({ batchId, sourceName: name, fileName: `${name}.xlsx`, importedAt: "2026-10-01T00:00:00.000Z" });
const WA = "WhatsApp Group - September";
const FB = "Facebook Leads";
const WS = "Workshop Registration";
let n = 0;
const mk = (o = {}) => { n += 1; return { id: `c${n}`, fullName: `Customer ${n}`, phone: `0100000${String(n).padStart(4, "0")}`, createdAt: "2026-10-01T00:00:00.000Z", importSequence: n, interestedProgramIds: [], assignedToId: null, ...o }; };
const index = (customers) => { const m = new Map(customers.map((c) => [c.id, c])); return (id) => m.get(id) || null; };
const NO_BATCHES = buildBatchSourceIndex([]);

/** The exact pipeline DistributeLeadsPanel + useLeadDistribution run: unassigned pool -> source -> course -> existing engine. */
function run({ customers, sourceKey = "", programIds = [], method, allocations, distributeCount, batchIndex = NO_BATCHES, user = { id: "admin1", name: "Admin" } }) {
  const customerById = index(customers);
  const pool = selectUnassignedLeads(customers).map((c) => c.id);
  const sourced = sourceKey ? selectLeadsBySource(pool, sourceKey, customerById, batchIndex) : pool;
  const eligible = programIds.length ? selectLeadsByInterestedPrograms(sourced, programIds, customerById) : sourced;
  const availableCount = eligible.length;
  const errors = validateDistribution({ method, availableCount, allocations, distributeCount: distributeCount ?? availableCount });
  if (errors.length) return { pool, eligible, errors, patches: [], assignments: [], remaining: availableCount };
  const counts = computeAllocationCounts({ method, availableCount, allocations, distributeCount: distributeCount ?? availableCount });
  const assignments = buildSequentialAssignments(eligible, counts, (id) => id.toUpperCase());
  const { patches, unchangedCount } = buildAssignmentPatches(assignments, { customerById, method, sourceBatchId: null, currentUser: user, now: "2026-10-04T00:00:00.000Z" });
  return { pool, eligible, errors: [], counts, assignments, patches, unchangedCount, remaining: availableCount - assignments.length };
}
const apply = (customers, patches) => customers.map((c) => { const p = patches.find((x) => x.customerId === c.id); return p ? { ...c, ...p.patch, assignmentHistory: [...(c.assignmentHistory || []), p.historyEntry] } : c; });

// ═════════════ A. source filtering ═════════════
console.log("A. Source filtering");
{
  const a = mk({ importSources: [src(WA)] }), b = mk({ importSources: [src(FB)] }), c = mk({ importSources: [src(WA)] }), d = mk();
  const customers = [a, b, c, d];
  const customerById = index(customers);
  const pool = selectUnassignedLeads(customers).map((x) => x.id);
  eq("only customers of the selected source", selectLeadsBySource(pool, sourceKeyOf(WA), customerById, NO_BATCHES), [a.id, c.id]);
  eq("a source nobody has -> nobody", selectLeadsBySource(pool, sourceKeyOf("Nope"), customerById, NO_BATCHES), []);
  eq("source key is case/whitespace-insensitive", selectLeadsBySource(pool, "  whatsapp   GROUP - september ", customerById, NO_BATCHES), [a.id, c.id]);
  eq("customers with no source at all are excluded when a source is selected", selectLeadsBySource([d.id], sourceKeyOf(WA), customerById, NO_BATCHES), []);
}

// ═════════════ B. multiple sources ═════════════
console.log("B. Multiple sources");
{
  const ahmed = mk({ fullName: "Ahmed", importSources: [src(WA), src(FB)] });
  const other = mk({ importSources: [src(WS)] });
  const customers = [ahmed, other];
  const by = index(customers);
  const pool = [ahmed.id, other.id];
  eq("eligible under the first of his sources", selectLeadsBySource(pool, sourceKeyOf(WA), by, NO_BATCHES), [ahmed.id]);
  eq("eligible under the second of his sources", selectLeadsBySource(pool, sourceKeyOf(FB), by, NO_BATCHES), [ahmed.id]);
  eq("not eligible under a source he is not in", selectLeadsBySource(pool, sourceKeyOf(WS), by, NO_BATCHES), [other.id]);
}

// ═════════════ C. no duplicate eligibility ═════════════
console.log("C. A customer appears once");
{
  const dup = mk({ importSources: [src(WA, "b1"), src(WA, "b2"), src("whatsapp group - september", "b3")] });
  const by = index([dup]);
  eq("duplicate source entries (same name, any case) -> still ONE eligible row", selectLeadsBySource([dup.id], sourceKeyOf(WA), by, NO_BATCHES), [dup.id]);
  eq("customerSourceEntries collapses them to one source", customerSourceEntries(dup, NO_BATCHES).length, 1);
  const batches = [{ id: "b9", kind: "customer_leads", sourceName: WA, createdCustomerIds: [dup.id], updatedCustomerIds: [dup.id] }];
  eq("stored + batch-derived entry for the same source -> still one", customerSourceEntries(dup, buildBatchSourceIndex(batches)).length, 1);
  const opts = buildSourceOptions({ universeIds: [dup.id], poolIds: [dup.id], customerById: by, batchIndex: buildBatchSourceIndex(batches) });
  eq("the option counts that customer once", [opts.length, opts[0].total, opts[0].unassigned], [1, 1, 1]);
}

// ═════════════ D. assigned customers excluded ═════════════
console.log("D. Assigned customers");
{
  const free = mk({ importSources: [src(WA)] }), owned = mk({ importSources: [src(WA)], assignedToId: "salesX", assignedToName: "X" });
  const r = run({ customers: [free, owned], sourceKey: sourceKeyOf(WA), method: DISTRIBUTION_METHODS.EQUAL, allocations: [{ salesId: "salesA" }] });
  eq("the already-assigned customer never enters the pool", r.eligible, [free.id]);
  eq("only the unassigned one is assigned; the owner of the other is untouched", r.patches.map((p) => p.customerId), [free.id]);
  const opts = buildSourceOptions({ universeIds: [free.id, owned.id], poolIds: [free.id], customerById: index([free, owned]), batchIndex: NO_BATCHES });
  eq("source option shows total 2 but only 1 unassigned", [opts[0].total, opts[0].unassigned], [2, 1]);
  const allAssigned = mk({ importSources: [src(FB)], assignedToId: "salesX" });
  const o2 = buildSourceOptions({ universeIds: [allAssigned.id], poolIds: [], customerById: index([allAssigned]), batchIndex: NO_BATCHES });
  eq("a source whose customers are ALL assigned is still listed, with 0 unassigned", [o2[0].name, o2[0].unassigned], [FB, 0]);
}

// ═════════════ E/F/G/H. source + program, source only, program only, no filters ═════════════
console.log("E-H. Combining with the course filter");
const AI = "prog-ai", DATA = "prog-data";
{
  const wa_data = mk({ importSources: [src(WA)], interestedProgramIds: [DATA] });
  const wa_ai = mk({ importSources: [src(WA)], interestedProgramIds: [AI] });
  const wa_none = mk({ importSources: [src(WA)] });
  const fb_data = mk({ importSources: [src(FB)], interestedProgramIds: [DATA] });
  const wa_data_assigned = mk({ importSources: [src(WA)], interestedProgramIds: [DATA], assignedToId: "salesX" });
  const customers = [wa_data, wa_ai, wa_none, fb_data, wa_data_assigned];
  const E = { method: DISTRIBUTION_METHODS.EQUAL, allocations: [{ salesId: "salesA" }] };

  eq("E. source + program = unassigned AND source AND program", run({ customers, sourceKey: sourceKeyOf(WA), programIds: [DATA], ...E }).eligible, [wa_data.id]);
  eq("F. source only (program not selected)", run({ customers, sourceKey: sourceKeyOf(WA), ...E }).eligible, [wa_data.id, wa_ai.id, wa_none.id]);
  const programOnly = run({ customers, programIds: [DATA], ...E }).eligible;
  eq("G. program only = exactly today's course-based result", programOnly, selectLeadsByInterestedPrograms(selectUnassignedLeads(customers).map((c) => c.id), [DATA], index(customers)));
  eq("G. ...(and that includes the other source's customer)", programOnly, [wa_data.id, fb_data.id]);
  const none = run({ customers, ...E });
  eq("H. no filters = the whole unassigned pool, untouched", none.eligible, none.pool);
  eq("H. ...which is today's normal pool (unassigned, import order)", none.pool, selectUnassignedLeads(customers).map((c) => c.id));
  eq("source + program with no overlap -> empty", run({ customers, sourceKey: sourceKeyOf(FB), programIds: [AI], ...E }).eligible, []);
}

// ═════════════ I/J/K. the EXISTING engine on the filtered pool ═════════════
console.log("I-K. Existing equal / percentage / manual engine");
const bigCustomers = (count, source) => Array.from({ length: count }, () => mk({ importSources: [src(source)] }));
{
  const wa = bigCustomers(347, WA), fb = bigCustomers(120, FB);
  const customers = [...fb, ...wa];
  const r = run({ customers, sourceKey: sourceKeyOf(WA), method: DISTRIBUTION_METHODS.EQUAL, allocations: [{ salesId: "A" }, { salesId: "B" }, { salesId: "C" }], distributeCount: 300 });
  eq("I. equal: 347 eligible, distribute 300 -> 100/100/100", r.counts.map((c) => c.count), [100, 100, 100]);
  eq("I. ...47 stay unassigned and are never touched", [r.remaining, r.patches.length], [47, 300]);
  check("I. ...nothing outside the source was assigned", r.patches.every((p) => wa.some((c) => c.id === p.customerId)));

  const p = run({ customers: bigCustomers(500, FB), sourceKey: sourceKeyOf(FB), method: DISTRIBUTION_METHODS.PERCENTAGE, allocations: [{ salesId: "A", percent: 50 }, { salesId: "B", percent: 30 }, { salesId: "C", percent: 20 }] });
  eq("J. percentage 50/30/20 of 500 -> 250/150/100", p.counts.map((c) => c.count), [250, 150, 100]);
  const partial = run({ customers: bigCustomers(500, FB), sourceKey: sourceKeyOf(FB), method: DISTRIBUTION_METHODS.PERCENTAGE, allocations: [{ salesId: "A", percent: 40 }, { salesId: "B", percent: 20 }] });
  eq("J. partial percentage (60% total) is still supported -> 200/100, 200 left unassigned", [partial.errors, partial.counts.map((c) => c.count), partial.remaining], [[], [200, 100], 200]);
  eq("J. over 100% is still rejected by the existing validation", run({ customers: bigCustomers(10, FB), sourceKey: sourceKeyOf(FB), method: DISTRIBUTION_METHODS.PERCENTAGE, allocations: [{ salesId: "A", percent: 70 }, { salesId: "B", percent: 40 }] }).errors.map((e) => e.code), ["PERCENT_TOTAL_INVALID"]);

  const m = run({ customers: bigCustomers(300, FB), sourceKey: sourceKeyOf(FB), method: DISTRIBUTION_METHODS.MANUAL, allocations: [{ salesId: "A", count: 100 }, { salesId: "B", count: 50 }, { salesId: "C", count: 25 }] });
  eq("K. manual 100/50/25 -> 175 assigned, 125 remain unassigned (not auto-assigned)", [m.assignments.length, m.remaining], [175, 125]);
  eq("K. manual beyond the eligible pool is rejected", run({ customers: bigCustomers(10, FB), sourceKey: sourceKeyOf(FB), method: DISTRIBUTION_METHODS.MANUAL, allocations: [{ salesId: "A", count: 11 }] }).errors.map((e) => e.code), ["MANUAL_EXCEEDS_AVAILABLE"]);

  const preview = buildDistributionPreview({ method: DISTRIBUTION_METHODS.EQUAL, availableCount: 180, allocations: [{ salesId: "A" }, { salesId: "B" }, { salesId: "C" }], distributeCount: 180, salesNameById: (id) => id });
  eq("preview from the filtered pool: 60/60/60, 0 unassigned after", [preview.rows.map((r) => r.count), preview.remaining], [[60, 60, 60], 0]);
}

// ═════════════ L. sequential order ═════════════
console.log("L. Sequential ordering");
{
  const first = mk({ importSources: [src(WA)], importSequence: 1, createdAt: "2026-10-01T00:00:00.000Z" });
  const second = mk({ importSources: [src(WA)], importSequence: 2, createdAt: "2026-10-01T00:00:00.000Z" });
  const third = mk({ importSources: [src(WA)], importSequence: 3, createdAt: "2026-10-01T00:00:00.000Z" });
  const other = mk({ importSources: [src(FB)], importSequence: 1, createdAt: "2026-10-01T00:00:00.000Z" });
  const customers = [third, other, second, first]; // deliberately scrambled input
  const r = run({ customers, sourceKey: sourceKeyOf(WA), method: DISTRIBUTION_METHODS.MANUAL, allocations: [{ salesId: "A", count: 2 }, { salesId: "B", count: 1 }] });
  eq("the filtered pool keeps import order; ranges are contiguous and in rep order", r.assignments.map((a) => [a.customerId, a.toSalesId]), [[first.id, "A"], [second.id, "A"], [third.id, "B"]]);
  const again = run({ customers, sourceKey: sourceKeyOf(WA), method: DISTRIBUTION_METHODS.MANUAL, allocations: [{ salesId: "A", count: 2 }, { salesId: "B", count: 1 }] });
  eq("same input -> same output (deterministic, never randomized)", again.assignments, r.assignments);
  eq("importSequence values are never changed by distribution", [first, second, third].map((c) => c.importSequence), [1, 2, 3]);
}

// ═════════════ M/N. history + idempotency ═════════════
console.log("M-N. Assignment history & idempotency");
{
  const customers = bigCustomers(4, WA);
  const r = run({ customers, sourceKey: sourceKeyOf(WA), method: DISTRIBUTION_METHODS.EQUAL, allocations: [{ salesId: "A" }, { salesId: "B" }] });
  eq("assignedToId/assignedToName only (no new owner field)", Object.keys(r.patches[0].patch).sort(), ["assignedToId", "assignedToName", "updatedAt"]);
  eq("history entry is the normal one: from nobody to the rep, by the admin", [r.patches[0].historyEntry.fromSalesId, r.patches[0].historyEntry.toSalesId, r.patches[0].historyEntry.assignedBy, r.patches[0].historyEntry.method], [null, "A", "admin1", "equal"]);
  const after = apply(customers, r.patches);
  check("every distributed customer now carries exactly one history entry", after.every((c) => c.assignmentHistory.length === 1));
  const retry = run({ customers: after, sourceKey: sourceKeyOf(WA), method: DISTRIBUTION_METHODS.EQUAL, allocations: [{ salesId: "A" }, { salesId: "B" }] });
  eq("a repeated request finds nothing left unassigned in that source -> writes nothing", [retry.eligible.length, retry.patches.length], [0, 0]);
  const replay = buildAssignmentPatches(r.assignments, { customerById: index(after), method: "equal", currentUser: { id: "admin1" } });
  eq("even replaying the SAME assignments is a no-op (no duplicate history)", [replay.patches.length, replay.unchangedCount], [0, 4]);
  const ownedByA = after.map((c) => ({ ...c }));
  const noSteal = run({ customers: ownedByA, sourceKey: sourceKeyOf(WA), method: DISTRIBUTION_METHODS.EQUAL, allocations: [{ salesId: "Z" }] });
  eq("a source distribution can never move A -> Z (assigned customers are not in the pool)", noSteal.patches.length, 0);
}

// ═════════════ P. empty ═════════════
console.log("P. Empty source");
{
  const r = run({ customers: [mk({ importSources: [src(WA)] })], sourceKey: sourceKeyOf(FB), method: DISTRIBUTION_METHODS.EQUAL, allocations: [{ salesId: "A" }] });
  eq("no match -> empty pool, the engine refuses to distribute", [r.eligible.length, r.errors.map((e) => e.code)], [0, ["NO_AVAILABLE_LEADS"]]);
}

// ═════════════ batch-derived sources (customers imported before this feature) ═════════════
console.log("Batch-derived sources (no migration needed)");
{
  const old1 = mk(), old2 = mk(), newer = mk({ importSources: [src(FB, "b-new")] });
  const batches = [
    { id: "b1", kind: "customer_leads", fileName: "march-leads.xlsx", createdAt: "2026-03-01", createdCustomerIds: [old1.id], updatedCustomerIds: [old2.id] },
    { id: "b2", kind: "customer_leads", fileName: "x.xlsx", sourceName: "Named Batch", createdCustomerIds: [old2.id] },
    { id: "b3", kind: "customer_leads", fileName: "undone.xlsx", rolledBackAt: "2026-04-01", createdCustomerIds: [old1.id] },
    { id: "b4", fileName: "program-import.xlsx", createdCustomerIds: [old1.id] }, // a Program import: no kind
  ];
  const bi = buildBatchSourceIndex(batches);
  eq("an old batch without sourceName uses its FILE NAME as the source", customerSourceEntries(old1, bi).map((e) => e.sourceName), ["march-leads.xlsx"]);
  eq("a customer in two batches has both sources (created or updated both count)", customerSourceEntries(old2, bi).map((e) => e.sourceName), ["march-leads.xlsx", "Named Batch"]);
  check("rolled-back batches and Program imports contribute nothing", !customerSourceEntries(old1, bi).some((e) => e.batchId === "b3" || e.batchId === "b4"));
  eq("options are derived from real data, sorted, with unassigned counts", buildSourceOptions({ universeIds: [old1.id, old2.id, newer.id], poolIds: [old1.id, old2.id, newer.id], customerById: index([old1, old2, newer]), batchIndex: bi }).map((o) => [o.name, o.unassigned]), [["Facebook Leads", 1], ["march-leads.xlsx", 2], ["Named Batch", 1]]);
  check("nothing is hardcoded: with no data there are no options", buildSourceOptions({ universeIds: [], poolIds: [], customerById: () => null, batchIndex: NO_BATCHES }).length === 0);
}

// ═════════════ Q. source tracking at import ═════════════
console.log("Q. Import source tracking");
{
  const NOW = "2026-10-04T10:00:00.000Z";
  const planFor = (rows, existing = []) => planLeadImport({ rows, mapping: { phone: "Phone", name: "Name", programs: [] }, existingCustomers: existing, programs: [], yieldEvery: 0 });
  const written = [];
  const batchForms = [];
  let seq = 0;
  const commit = async (rows, existing, sourceName, fileName = "file.xlsx") => {
    written.length = 0; batchForms.length = 0;
    const plan = await planFor(rows, existing);
    const res = await runLeadImportCommit({
      plan, fileName, sourceName, customers: existing, nodeById: () => null, now: NOW,
      createBatch: async (form) => { batchForms.push(form); return "batch-X"; }, updateBatch: async () => {},
      commitLeadImportChunk: async (ops) => { written.push(...ops); return ops.filter((o) => o.type === "create").map(() => `new${++seq}`); },
    });
    return { plan, res };
  };

  const { res } = await commit([{ Name: "A", Phone: "01001234567" }, { Name: "B", Phone: "01111111111" }], [], WA, "whatsapp.xlsx");
  const created = written.filter((o) => o.type === "create").map((o) => o.data);
  eq("new customers get importSources [ {batchId, sourceName, fileName, importedAt} ]", created[0].importSources, [{ batchId: "batch-X", sourceName: WA, fileName: "whatsapp.xlsx", importedAt: NOW }]);
  eq("the batch document is created with the source name", [batchForms[0].kind, batchForms[0].sourceName, batchForms[0].fileName], ["customer_leads", WA, "whatsapp.xlsx"]);
  eq("the import still returns every accepted lead", res.acceptedCustomerIds.length, 2);
  eq("buildImportBatchDoc stores sourceName", buildImportBatchDoc({ kind: "customer_leads", fileName: "f.xlsx", sourceName: WA }, { currentUser: { id: "u" }, now: NOW }).sourceName, WA);
  check("...and omits it when none was given (Program imports / old callers unchanged)", !("sourceName" in buildImportBatchDoc({ kind: "customer_leads", fileName: "f.xlsx" }, { currentUser: { id: "u" } })));

  const base = { id: "c1", fullName: "Old", phone: "01001234567", normalizedPhone: "01001234567", interestedProgramIds: [], importSequence: 1, importSources: [src(WA, "b-old")] };
  await commit([{ Name: "", Phone: "01001234567" }], [base], FB, "facebook.xlsx");
  const upd = written.find((o) => o.type === "update");
  eq("an existing customer in a NEW file: old source kept, new source appended", upd.patch.importSources.map((e) => e.sourceName), [WA, FB]);
  eq("...no new customer was created because of the new source (phone dedupe unchanged)", written.filter((o) => o.type === "create").length, 0);

  const r2 = await commit([{ Name: "", Phone: "01001234567" }], [base], "  whatsapp GROUP - september ", "again.xlsx");
  check("the same source (any case/spacing) is NOT added twice, so nothing is written", r2.res.nothingToDo === true && written.length === 0);

  const noSource = { ...base, importSources: undefined };
  await commit([{ Name: "", Phone: "01001234567" }], [noSource], WA);
  eq("an existing customer with nothing else to change still gets the source (one write)", [written.length, written[0].patch.importSources.map((e) => e.sourceName), Object.keys(written[0].patch).sort()], [1, [WA], ["importSources", "updatedAt"]]);

  await commit([{ Name: "Z", Phone: "01222222222" }], [], undefined);
  check("no source name given -> NO importSources written anywhere (existing behavior)", !("importSources" in written[0].data) && !("sourceName" in batchForms[0]));

  const withSeq = await commit([{ Name: "", Phone: "01001234567" }], [{ ...base, importSequence: undefined, importSources: [] }], WA);
  const u2 = written.find((o) => o.type === "update");
  eq("sequence flow is untouched: importSequence/importBatchId still injected alongside the source", [u2.patch.importSequence, u2.patch.importBatchId, u2.patch.importSources.length], [1, "batch-X", 1]);
  void withSeq;
}

// ═════════════ permissions & architecture ═════════════
console.log("Permissions & architecture");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const rules = read("firestore.rules");
  const cust = rules.slice(rules.indexOf("match /customers/{id}"), rules.indexOf("match /engagements/{id}"));
  const allow = [...cust.slice(cust.indexOf("hasOnly([")).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  check("rules: Sales still CANNOT write assignmentHistory or importSources (distribution/source data is admin-only)", !allow.includes("assignmentHistory") && !allow.includes("importSources"));
  check("rules: Sales read scope intact (assigned customers only — no unassigned)", cust.includes("resource.data.get('assignedToId', null) == request.auth.uid"));
  check("rules: bulk import (the only writer of sources) is still admin-only", /match \/importBatches\/\{id\} \{[\s\S]*?allow create: if isAdmin\(\);/.test(rules));
  check("rules: no broad allow", !/allow (read|write)[^;]*:\s*if request\.auth != null\s*;/.test(rules));

  const page = strip(read("src/pages/admin/crm/newCustomers/NewCustomersPage.jsx"));
  check("page: the distribute / reassign controls are admin-only", /\{isAdmin && <Btn v="primary" onClick=\{startDistribute\}/.test(page) && /\{isAdmin && selectedIds\.size > 0/.test(page));
  const panel = strip(read("src/pages/admin/crm/newCustomers/DistributeLeadsPanel.jsx"));
  check("panel: the source filter narrows the pool BEFORE the existing engine (pool -> source -> course)", panel.includes("selectLeadsBySource(pool, activeSourceKey") && panel.includes("selectLeadsByInterestedPrograms(sourcePool"));
  check("panel: the engine call receives the filtered pool (eligiblePool) and the same mode as before", /distributeLeads\(\{ customerIds: eligiblePool, method, allocations, distributeCount: effectiveDistributeCount, sourceBatchId, mode \}\)/.test(panel));
  check("panel: 'All sources' is the default and means no filter", panel.includes('useState("")') && panel.includes('tx("كل المصادر", "All sources")'));
  check("panel: hidden during reassignment (source filter is for the unassigned pool)", panel.includes('mode === "reassign" ? "" : sourceKey'));
  check("panel: empty result message and no distribution action", panel.includes("No unassigned customers match the selected filters.") && /noMatch \?/.test(panel));
  check("panel: source options are derived, not hardcoded", !/WhatsApp Group|Facebook Leads/.test(panel));

  const hook = read("src/hooks/useLeadDistribution.js");
  check("NO second engine: the distribution hook is not source-aware at all", !/importSources|selectLeadsBySource|sourceKey/.test(hook));
  const expectedNew = ["sourceKeyOf", "buildBatchSourceIndex", "customerSourceEntries", "selectLeadsBySource", "buildSourceOptions"];
  check("leadDistribution.js gained ONLY the five read-only source helpers (no source-specific equal/percentage/manual)", expectedNew.every((f) => typeof dist[f] === "function") && !Object.keys(dist).some((k) => /source/i.test(k) && !expectedNew.includes(k)));
  const importPanel = strip(read("src/pages/admin/crm/newCustomers/LeadExcelImportPanel.jsx"));
  check("import panel: asks for a source name (prefilled from the file) and passes it to the commit", importPanel.includes('data-testid="lead-import-source-name"') && importPanel.includes("sourceName: sourceName.trim()"));
  check("accounting / payments / registration code is untouched", ["src/utils/accounting.js", "src/utils/paymentRecords.js", "src/utils/salesPerformance.js"].every((f) => !/importSources|sourceName/.test(read(f))));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
