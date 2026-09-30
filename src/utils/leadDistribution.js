/**
 * LEAD-DISTRIBUTION-01 — splits a batch of accepted "عملاء جدد" leads among
 * Sales users. Pure module (no React, no Firestore): this only computes WHO
 * gets WHICH customers and WHY; the actual write is
 * hooks/useLeadDistribution.js, reusing CustomerContext.commitLeadImportChunk
 * exactly as the lead import already does — no new Firestore write path.
 *
 * SCOPE — this only ever writes `customers/{id}.assignedToId` /
 * `.assignedToName` (the field the CRM already uses everywhere else) plus an
 * append-only `assignmentHistory[]` entry when the assignee actually changes.
 * It never touches an engagement, payment, or accounting record, and never
 * creates a second "who owns this lead" concept.
 *
 * DETERMINISM — every function here is a pure computation over its inputs:
 * the same accepted-lead list + the same distribution config always produces
 * the exact same per-customer assignment, in the exact same order. Nothing
 * is randomized by default (see `method` below).
 */

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

// ───────────────────────── method: equal ─────────────────────────

/**
 * As even as mathematically possible: everyone gets `floor(total/n)`, and the
 * remainder (always < n) goes one-each to the FIRST `remainder` sales users
 * in the given order — deterministic, and the spread across all allocations
 * never differs by more than 1 (1001/5 -> 201,200,200,200,200; 999/5 ->
 * 200,200,200,200,199).
 */
export function computeEqualDistribution(totalCount, salesIds) {
  const n = (salesIds || []).length;
  if (n === 0) return [];
  const base = Math.floor(totalCount / n);
  const remainder = totalCount - base * n;
  return salesIds.map((salesId, i) => ({ salesId, count: base + (i < remainder ? 1 : 0) }));
}

// ───────────────────────── method: percentage ─────────────────────────

/**
 * Percentages must sum to EXACTLY 100 (rounded to 2 decimals, so 33.33 x 3 +
 * 0.01 style inputs that visually read as "100%" still pass) — anything else
 * is a validation error, never silently normalized.
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
  if (total !== 100) errors.push({ code: "PERCENT_TOTAL_INVALID", total });
  return errors;
}

/**
 * Percent -> count via the largest-remainder method (Hamilton's method): every
 * allocation gets floor(total * percent/100), then the leftover units (always
 * < allocations.length) go one-each to the allocations with the largest
 * fractional remainder — ties broken by the ORIGINAL list order, so the
 * result is fully deterministic. Counts always sum to exactly `totalCount`.
 * Caller must validate first (validatePercentageAllocations) — this assumes
 * the percentages already sum to 100.
 */
export function computePercentageDistribution(totalCount, allocations) {
  const raw = allocations.map((a, i) => {
    const exact = (totalCount * Number(a.percent)) / 100;
    const floor = Math.floor(exact);
    return { salesId: a.salesId, percent: Number(a.percent), floor, remainder: exact - floor, i };
  });
  const flooredTotal = raw.reduce((sum, r) => sum + r.floor, 0);
  let leftover = totalCount - flooredTotal;
  const order = [...raw].sort((a, b) => (b.remainder - a.remainder) || (a.i - b.i));
  const bonus = new Set();
  for (const r of order) { if (leftover <= 0) break; bonus.add(r.i); leftover -= 1; }
  return raw.map((r) => ({ salesId: r.salesId, percent: r.percent, count: r.floor + (bonus.has(r.i) ? 1 : 0) }));
}

// ───────────────────────── method: manual ─────────────────────────

/** Exact counts entered by the admin. Must sum to exactly the accepted-lead count — never auto-adjusted. */
export function validateManualAllocations(totalCount, allocations) {
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
  if (total !== totalCount) errors.push({ code: "MANUAL_TOTAL_MISMATCH", total, expected: totalCount });
  return errors;
}

export const DISTRIBUTION_METHODS = { PERCENTAGE: "percentage", EQUAL: "equal", MANUAL: "manual" };

/**
 * Validates a distribution config against the accepted-lead count. Returns
 * an array of error codes (empty = valid) — same "codes, not strings"
 * convention utils/accounting.js's validateTransaction already uses, so the
 * UI localizes them, this never invents user-facing text.
 */
export function validateDistribution({ method, totalCount, allocations }) {
  if (totalCount <= 0) return [{ code: "NO_ACCEPTED_LEADS" }];
  if (method === DISTRIBUTION_METHODS.PERCENTAGE) return validatePercentageAllocations(allocations);
  if (method === DISTRIBUTION_METHODS.MANUAL) return validateManualAllocations(totalCount, allocations);
  if (method === DISTRIBUTION_METHODS.EQUAL) return (allocations || []).length === 0 ? [{ code: "NO_SALES_SELECTED" }] : [];
  return [{ code: "METHOD_INVALID" }];
}

/**
 * The per-sales-user {salesId, count} the confirmation preview shows, for
 * whichever method is selected. Callers should validateDistribution() first —
 * this does not re-validate (equal/manual pass counts through almost as-is;
 * percentage needs the conversion).
 */
export function computeAllocationCounts({ method, totalCount, allocations }) {
  if (method === DISTRIBUTION_METHODS.PERCENTAGE) return computePercentageDistribution(totalCount, allocations);
  if (method === DISTRIBUTION_METHODS.MANUAL) return allocations.map((a) => ({ salesId: a.salesId, count: Number(a.count) }));
  if (method === DISTRIBUTION_METHODS.EQUAL) return computeEqualDistribution(totalCount, allocations.map((a) => a.salesId));
  return [];
}

// ───────────────────────── sequential assignment ─────────────────────────

/**
 * The actual per-customer decision: walks `customerIds` IN ORDER (the "final
 * accepted lead list order" — see utils/leadImport.js's acceptedCustomers)
 * and slices it into contiguous ranges, one per allocation, IN THE ORDER the
 * allocations were configured (rep #1's range comes first, then rep #2's,
 * etc.) — never randomized. `salesNameById` resolves the display name once,
 * up front, so a later rename doesn't change what a completed distribution
 * recorded.
 *
 * Every customer id is assigned to EXACTLY one sales user — the ranges are
 * contiguous and non-overlapping, and their lengths always sum to
 * customerIds.length (guaranteed by validateDistribution + the count
 * functions above, both of which force the total to match exactly).
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
 * is already exactly that value (the no-op case). This is what makes a
 * retried/double-submitted distribution safe: recomputing the same
 * deterministic assignment and diffing against current data means a repeat
 * run only ever touches whatever didn't already get written, never anything
 * else, and never appends a duplicate history entry for an unchanged customer.
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
 * null/count, ready to render without the UI re-deriving any of the
 * arithmetic above.
 */
export function buildDistributionPreview({ method, totalCount, allocations, salesNameById }) {
  const errors = validateDistribution({ method, totalCount, allocations });
  if (errors.length > 0) return { errors, rows: [], totalAssigned: 0 };
  const counts = computeAllocationCounts({ method, totalCount, allocations });
  const rows = counts.map((c) => ({
    salesId: c.salesId,
    salesName: salesNameById(c.salesId) || c.salesId,
    percent: method === DISTRIBUTION_METHODS.PERCENTAGE ? c.percent : null,
    count: c.count,
  }));
  return { errors: [], rows, totalAssigned: rows.reduce((s, r) => s + r.count, 0) };
}
