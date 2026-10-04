/**
 * LEAD-DISTRIBUTION-01 — splits a POOL of unassigned "عملاء جدد" leads among
 * Sales users. Pure module (no React, no Firestore): this only computes WHO
 * gets WHICH customers and WHY; the actual write is
 * hooks/useLeadDistribution.js, reusing CustomerContext.commitLeadImportChunk
 * exactly as the lead import already does — no new Firestore write path.
 *
 * PARTIAL ALLOCATION IS THE NORMAL CASE — an admin is never forced to assign
 * every available lead in one operation. Percentage/equal/manual all accept
 * an allocation that covers LESS than the full available pool; whatever
 * isn't covered stays exactly as it was (still unassigned, or — in a
 * reassignment — still with its current owner). Only "more than available"
 * is ever rejected.
 *
 * SCOPE — this only ever writes `customers/{id}.assignedToId` /
 * `.assignedToName` (the field the CRM already uses everywhere else) plus an
 * append-only `assignmentHistory[]` entry when the assignee actually changes.
 * It never touches an engagement, payment, or accounting record, and never
 * creates a second "who owns this lead" concept.
 *
 * DETERMINISM — every function here is a pure computation over its inputs:
 * the same available-lead order + the same distribution config always
 * produces the exact same per-customer assignment. Nothing is randomized.
 *
 * COURSE-BASED FILTERING (additive) — selectLeadsByInterestedPrograms() below
 * is the ONLY course-related addition: a plain, order-preserving membership
 * filter over an already-built pool. It produces an ordered subset of
 * customer ids that is then handed, completely unchanged, to the exact same
 * computeAllocationCounts/buildSequentialAssignments/buildAssignmentPatches
 * functions every other distribution already uses — there is no second
 * assignment engine.
 */
import { customerInterestedProgramIds } from "./interestedPrograms";

/** Firestore's own writeBatch() hard limit is 500 ops/batch — same ceiling utils/leadImportCommit.js already respects. */
export const LEAD_DISTRIBUTION_CHUNK_SIZE = 400;

const round2 = (n) => Math.round(n * 100) / 100;

// ───────────────────────── sales eligibility ─────────────────────────

/**
 * The only users ever offered as distribution targets: role "sales", not
 * rejected. Never an "operation" role, never Accounting — those aren't Sales
 * and this doesn't invent a role to include them.
 */
export function selectActiveSalesUsers(users) {
  return (users || []).filter((u) => u.role === "sales" && u.status !== "rejected");
}

// ───────────────────────── imported/assigned/unassigned ─────────────────────────

/**
 * Stable ordering for any pool of "عملاء جدد" customers that may span
 * several import batches (or include manually-added customers with no
 * import batch at all): by the batch's own commit time first (every customer
 * created in the SAME commit shares one `createdAt`, so this alone can't
 * separate them), then by `importSequence` — the position assigned once, at
 * first import, by utils/leadImportCommit.js — as the tiebreaker, then by id
 * for total determinism. A customer that was never imported (no
 * `importSequence`) sorts by its own `createdAt` among the rest.
 */
function compareByImportOrder(a, b) {
  const ca = a.createdAt || "", cb = b.createdAt || "";
  if (ca !== cb) return ca < cb ? -1 : 1;
  const sa = a.importSequence ?? Infinity, sb = b.importSequence ?? Infinity;
  if (sa !== sb) return sa - sb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Imported/total, assigned, unassigned — the three numbers "عملاء جدد" always shows the admin. */
export function computeDistributionStats(newCustomers) {
  const total = (newCustomers || []).length;
  const assigned = (newCustomers || []).filter((c) => c.assignedToId).length;
  return { total, assigned, unassigned: total - assigned };
}

/**
 * The default source pool for a NEW (non-reassignment) distribution: every
 * "عملاء جدد" customer with no current `assignedToId`, in stable import
 * order. Never includes an already-assigned customer — reassignment is a
 * deliberately separate, explicit workflow (see hooks/useLeadDistribution.js's
 * `mode`).
 */
export function selectUnassignedLeads(newCustomers) {
  return (newCustomers || []).filter((c) => !c.assignedToId).sort(compareByImportOrder);
}

/**
 * Narrows an ORDERED pool of customer ids down to those interested in at
 * least one of `programIds` — using the customer's EXISTING, unmodified
 * `interestedProgramIds` purely as a read-only filter (never touched,
 * never converted into an engagement/registration/payment). Order is
 * preserved (a plain Array.filter never reorders), and a customer with
 * SEVERAL matching interests still appears exactly once, since it is only
 * ever visited once in the input pool — no separate dedup step is needed.
 * `programIds` empty/nullish means "no course filter" — returns the pool
 * unchanged, so this is fully opt-in and never alters the normal (non
 * course-based) distribution path.
 */
export function selectLeadsByInterestedPrograms(customerIds, programIds, customerById) {
  if (!programIds || programIds.length === 0) return [...(customerIds || [])];
  const wanted = new Set(programIds);
  return (customerIds || []).filter((id) => customerInterestedProgramIds(customerById(id)).some((pid) => wanted.has(pid)));
}

// ───────────────────────── import-source filtering (additive) ─────────────────────────

/**
 * IMPORT-SOURCE FILTERING (additive, like the course filter above) — a source
 * is the name an admin gave one lead import ("WhatsApp Group - September").
 * A customer can have several (`customers/{id}.importSources[]`, appended by
 * utils/leadImportCommit.js, never rewritten). Everything here is a read-only
 * ELIGIBILITY filter over an already-ordered pool of ids; the survivors go to
 * the exact same allocation/assignment functions as every other distribution.
 */

/** Comparable identity of a source: case/whitespace-insensitive name, so "Facebook Leads" imported twice is ONE source. */
export const sourceKeyOf = (name) => String(name ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const batchSourceName = (b) => String(b?.sourceName || b?.fileName || "").replace(/\s+/g, " ").trim();

/**
 * customerId -> source entries derived from the lead-import batches
 * themselves (each batch records which customers it created/updated). This is
 * what gives customers imported BEFORE `importSources` existed a source with
 * no data migration: the batch's own name (sourceName, else its file name).
 * Only customer-lead batches count — never a Program import — and a rolled
 * back batch contributes nothing.
 */
export function buildBatchSourceIndex(batches) {
  const index = new Map();
  for (const b of batches || []) {
    if (b?.kind !== "customer_leads" || b.rolledBackAt) continue;
    const sourceName = batchSourceName(b);
    if (!sourceKeyOf(sourceName)) continue;
    const entry = { batchId: b.id, sourceName, fileName: b.fileName || "", importedAt: b.createdAt || null };
    for (const id of [...(b.createdCustomerIds || []), ...(b.updatedCustomerIds || [])]) {
      const list = index.get(id);
      if (!list) index.set(id, [entry]);
      else if (!list.some((e) => e.batchId === b.id)) list.push(entry);
    }
  }
  return index;
}

/** A customer's effective sources: its stored `importSources` plus the batch-derived ones, ONE entry per distinct source (stored entry wins). */
export function customerSourceEntries(customer, batchIndex) {
  const out = [];
  const seen = new Set();
  const add = (e) => {
    const k = sourceKeyOf(e?.sourceName);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(e);
  };
  for (const e of Array.isArray(customer?.importSources) ? customer.importSources : []) add(e);
  for (const e of batchIndex?.get(customer?.id) || []) add(e);
  return out;
}

/**
 * Narrows an ORDERED pool of ids to customers that have the given source
 * (any one of their sources matching is enough, and a customer is visited
 * once, so it can never appear twice). No source (""/null) = no filter: the
 * pool comes back unchanged — fully opt-in, "All Sources" is exactly today's
 * behavior. Order is preserved; nothing is reassigned or modified.
 */
export function selectLeadsBySource(customerIds, sourceKey, customerById, batchIndex) {
  const key = sourceKeyOf(sourceKey);
  if (!key) return [...(customerIds || [])];
  return (customerIds || []).filter((id) => customerSourceEntries(customerById(id), batchIndex).some((e) => sourceKeyOf(e.sourceName) === key));
}

/**
 * The Source dropdown's options, derived from real data only (never a hardcoded
 * list): every distinct source found on the `universeIds` customers, with how
 * many customers have it (`total`) and how many of those are in the
 * distributable `poolIds` AND unassigned (`unassigned`). A source whose
 * customers are all assigned is still listed, with 0 unassigned.
 */
export function buildSourceOptions({ universeIds, poolIds, customerById, batchIndex }) {
  const pool = new Set(poolIds || []);
  const options = new Map();
  for (const id of universeIds || []) {
    const c = customerById(id);
    if (!c) continue;
    for (const e of customerSourceEntries(c, batchIndex)) {
      const key = sourceKeyOf(e.sourceName);
      if (!options.has(key)) options.set(key, { key, name: String(e.sourceName).replace(/\s+/g, " ").trim(), total: 0, unassigned: 0 });
      const o = options.get(key);
      o.total += 1;
      if (pool.has(id) && !c.assignedToId) o.unassigned += 1;
    }
  }
  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ───────────────────────── method: equal ─────────────────────────

/**
 * Splits `distributeCount` (an admin-chosen amount, NOT necessarily the
 * whole available pool) as evenly as possible: everyone gets
 * `floor(distributeCount/n)`, and the remainder (always < n) goes one-each to
 * the FIRST `remainder` sales users in the given order — deterministic, and
 * the spread across all allocations never differs by more than 1.
 */
export function computeEqualDistribution(distributeCount, salesIds) {
  const n = (salesIds || []).length;
  if (n === 0) return [];
  const base = Math.floor(distributeCount / n);
  const remainder = distributeCount - base * n;
  return salesIds.map((salesId, i) => ({ salesId, count: base + (i < remainder ? 1 : 0) }));
}

export function validateEqualDistribution(availableCount, distributeCount, allocations) {
  const errors = [];
  const ids = (allocations || []).map((a) => a.salesId);
  if (ids.length === 0) { errors.push({ code: "NO_SALES_SELECTED" }); return errors; }
  if (new Set(ids).size !== ids.length) errors.push({ code: "DUPLICATE_SALES_SELECTED" });
  const n = Number(distributeCount);
  if (!Number.isInteger(n) || n < 0) errors.push({ code: "EQUAL_COUNT_INVALID" });
  else if (n > availableCount) errors.push({ code: "EQUAL_COUNT_EXCEEDS_AVAILABLE", total: n, available: availableCount });
  return errors;
}

// ───────────────────────── method: percentage ─────────────────────────

/**
 * "Percentage" means percentage OF THE AVAILABLE POOL being distributed FROM
 * — not the whole import. The total may be anywhere in (0, 100]; it does NOT
 * need to reach 100 (whatever isn't covered stays unassigned). Only a
 * negative/invalid percentage or a total over 100% is rejected.
 */
export function validatePercentageAllocations(allocations) {
  const errors = [];
  const ids = (allocations || []).map((a) => a.salesId);
  if (ids.length === 0) { errors.push({ code: "NO_SALES_SELECTED" }); return errors; }
  if (new Set(ids).size !== ids.length) errors.push({ code: "DUPLICATE_SALES_SELECTED" });
  for (const a of allocations) {
    const p = Number(a.percent);
    if (!Number.isFinite(p) || p < 0) errors.push({ code: "PERCENT_INVALID", salesId: a.salesId });
  }
  if (errors.length > 0) return errors;
  const total = round2(allocations.reduce((sum, a) => sum + Number(a.percent), 0));
  if (total > 100) errors.push({ code: "PERCENT_TOTAL_INVALID", total });
  return errors;
}

/**
 * Percent -> count via the largest-remainder method (Hamilton's method),
 * targeting `round(availableCount * sumPercent/100)` — the actual amount
 * this operation assigns, not the whole available pool. Every allocation
 * gets floor(availableCount * percent/100), then the leftover units (to
 * reach the rounded target) go one-each to the allocations with the largest
 * fractional remainder — ties broken by the ORIGINAL list order, so the
 * result is fully deterministic. Whatever isn't covered by the target stays
 * unassigned. Caller must validate first — this assumes percentages already
 * sum to at most 100.
 */
export function computePercentageDistribution(availableCount, allocations) {
  const sumPercent = allocations.reduce((sum, a) => sum + Number(a.percent), 0);
  const target = Math.round((availableCount * sumPercent) / 100);
  const raw = allocations.map((a, i) => {
    const exact = (availableCount * Number(a.percent)) / 100;
    const floor = Math.floor(exact);
    return { salesId: a.salesId, percent: Number(a.percent), floor, remainder: exact - floor, i };
  });
  const flooredTotal = raw.reduce((sum, r) => sum + r.floor, 0);
  let leftover = target - flooredTotal;
  const order = [...raw].sort((a, b) => (b.remainder - a.remainder) || (a.i - b.i));
  const bonus = new Set();
  for (const r of order) { if (leftover <= 0) break; bonus.add(r.i); leftover -= 1; }
  return raw.map((r) => ({ salesId: r.salesId, percent: r.percent, count: r.floor + (bonus.has(r.i) ? 1 : 0) }));
}

// ───────────────────────── method: manual ─────────────────────────

/**
 * Exact counts entered by the admin. The total must not EXCEED the available
 * pool — it may be less (the rest stays unassigned); it no longer has to
 * match exactly.
 */
export function validateManualAllocations(availableCount, allocations) {
  const errors = [];
  const ids = (allocations || []).map((a) => a.salesId);
  if (ids.length === 0) { errors.push({ code: "NO_SALES_SELECTED" }); return errors; }
  if (new Set(ids).size !== ids.length) errors.push({ code: "DUPLICATE_SALES_SELECTED" });
  for (const a of allocations) {
    const c = Number(a.count);
    if (!Number.isInteger(c) || c < 0) errors.push({ code: "MANUAL_COUNT_INVALID", salesId: a.salesId });
  }
  if (errors.length > 0) return errors;
  const total = allocations.reduce((sum, a) => sum + Number(a.count), 0);
  if (total > availableCount) errors.push({ code: "MANUAL_EXCEEDS_AVAILABLE", total, available: availableCount });
  return errors;
}

export const DISTRIBUTION_METHODS = { PERCENTAGE: "percentage", EQUAL: "equal", MANUAL: "manual" };

/**
 * Validates a distribution config against the AVAILABLE pool size. Returns
 * an array of error codes (empty = valid) — same "codes, not strings"
 * convention utils/accounting.js's validateTransaction already uses, so the
 * UI localizes them, this never invents user-facing text. `distributeCount`
 * only matters for the "equal" method (the admin-chosen amount to split);
 * it defaults to the whole available pool ("distribute all") when omitted.
 */
export function validateDistribution({ method, availableCount, allocations, distributeCount }) {
  if (availableCount <= 0) return [{ code: "NO_AVAILABLE_LEADS" }];
  if (method === DISTRIBUTION_METHODS.PERCENTAGE) return validatePercentageAllocations(allocations);
  if (method === DISTRIBUTION_METHODS.MANUAL) return validateManualAllocations(availableCount, allocations);
  if (method === DISTRIBUTION_METHODS.EQUAL) return validateEqualDistribution(availableCount, distributeCount ?? availableCount, allocations);
  return [{ code: "METHOD_INVALID" }];
}

/**
 * The per-sales-user {salesId, count} the confirmation preview shows, for
 * whichever method is selected. Callers should validateDistribution() first —
 * this does not re-validate.
 */
export function computeAllocationCounts({ method, availableCount, allocations, distributeCount }) {
  if (method === DISTRIBUTION_METHODS.PERCENTAGE) return computePercentageDistribution(availableCount, allocations);
  if (method === DISTRIBUTION_METHODS.MANUAL) return allocations.map((a) => ({ salesId: a.salesId, count: Number(a.count) }));
  if (method === DISTRIBUTION_METHODS.EQUAL) return computeEqualDistribution(distributeCount ?? availableCount, allocations.map((a) => a.salesId));
  return [];
}

// ───────────────────────── sequential assignment ─────────────────────────

/**
 * The actual per-customer decision: walks `customerIds` IN ORDER (the
 * available pool's stable import order) and slices it into contiguous
 * ranges, one per allocation, IN THE ORDER the allocations were configured —
 * never randomized. Whatever comes AFTER the last consumed slice (i.e.
 * `customerIds.slice(sum(counts))`) is left completely untouched — this is
 * exactly how a partial allocation naturally leaves the rest of the pool
 * unassigned, with no extra bookkeeping needed. `salesNameById` resolves the
 * display name once, up front, so a later rename doesn't change what a
 * completed distribution recorded.
 */
export function buildSequentialAssignments(customerIds, allocationCounts, salesNameById) {
  const assignments = [];
  let cursor = 0;
  for (const { salesId, count } of allocationCounts) {
    const slice = customerIds.slice(cursor, cursor + count);
    cursor += count;
    for (const customerId of slice) assignments.push({ customerId, toSalesId: salesId, toSalesName: salesNameById(salesId) || null });
  }
  return assignments;
}

// ───────────────────────── diffing against current state ─────────────────────────

/**
 * Turns {customerId, toSalesId, toSalesName} decisions into the actual
 * customer-doc patches to write — SKIPPING any customer whose `assignedToId`
 * is already exactly that value (the no-op case: never a history entry, never
 * a write, for "assigning" someone to the Sales user they already have). This
 * is also what makes a retried/double-submitted distribution safe: recomputing
 * the same deterministic assignment and diffing against current data means a
 * repeat run only ever touches whatever didn't already get written.
 *
 * `customerById(id)` resolves the CURRENT customer doc (for its existing
 * assignedToId/assignedToName, to build the history entry's "from" side).
 * Returns { patches: [{customerId, patch}], unchangedCount }.
 */
export function buildAssignmentPatches(assignments, { customerById, method, sourceBatchId = null, currentUser, now = new Date().toISOString() }) {
  const patches = [];
  let unchangedCount = 0;
  for (const { customerId, toSalesId, toSalesName } of assignments) {
    const customer = customerById(customerId);
    const fromSalesId = customer?.assignedToId || null;
    if (fromSalesId === toSalesId) { unchangedCount += 1; continue; }
    const historyEntry = {
      fromSalesId, fromSalesName: customer?.assignedToName || null,
      toSalesId, toSalesName,
      method, batchId: sourceBatchId,
      assignedBy: currentUser?.id || null, assignedByName: currentUser?.name || currentUser?.email || null,
      assignedAt: now,
    };
    patches.push({
      customerId,
      patch: { assignedToId: toSalesId, assignedToName: toSalesName, updatedAt: now },
      historyEntry,
    });
  }
  return { patches, unchangedCount };
}

/** Splits an ops list into ≤LEAD_DISTRIBUTION_CHUNK_SIZE chunks, same chunking shape utils/leadImportCommit.js already uses. */
export function chunkDistributionOps(ops, chunkSize = LEAD_DISTRIBUTION_CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < ops.length; i += chunkSize) chunks.push(ops.slice(i, i + chunkSize));
  return chunks;
}

/**
 * The full preview the confirmation UI shows: per-sales-user name/percent-or-
 * null/count, the total this operation would assign, and — critically — how
 * many of the available pool would remain unassigned afterward, so the admin
 * always sees that the rest isn't lost.
 */
export function buildDistributionPreview({ method, availableCount, allocations, distributeCount, salesNameById }) {
  const errors = validateDistribution({ method, availableCount, allocations, distributeCount });
  if (errors.length > 0) return { errors, rows: [], totalAssigned: 0, remaining: availableCount };
  const counts = computeAllocationCounts({ method, availableCount, allocations, distributeCount });
  const rows = counts.map((c) => ({
    salesId: c.salesId,
    salesName: salesNameById(c.salesId) || c.salesId,
    percent: method === DISTRIBUTION_METHODS.PERCENTAGE ? c.percent : null,
    count: c.count,
  }));
  const totalAssigned = rows.reduce((s, r) => s + r.count, 0);
  return { errors: [], rows, totalAssigned, remaining: availableCount - totalAssigned };
}
