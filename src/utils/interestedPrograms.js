/**
 * INTEREST-01 — "Interested Programs" (الكورسات المهتم بيها).
 *
 * Customer-level LEAD information: which existing catalog Programs a person
 * has shown interest in. Stored on the customer document as
 * `customers/{id}.interestedProgramIds: string[]` (catalogNodes Program ids).
 *
 * This is deliberately NOT a registration: it never creates or touches an
 * engagement, enrollment, payment record, or booking. Registering in a
 * Program is the normal engagement workflow (AddStudentModal /
 * CustomerContext.addEngagement) and stays completely separate — removing a
 * Program from this list never deletes or modifies an engagement, and
 * registering never edits this list. A missing/absent field means "no
 * interests recorded" (every customer written before this feature).
 *
 * Pure module (no Firestore, no React) — same split as pricingSnapshot.js /
 * paymentRecords.js — so the rules below are testable without a browser.
 */

/** Unique, trimmed, non-empty string ids, original order preserved. Anything else (null, numbers, blanks) is dropped. */
export function normalizeInterestedProgramIds(ids) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of ids) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** The customer's stored interest ids, normalized (handles legacy customers with no field at all). */
export function customerInterestedProgramIds(customer) {
  return normalizeInterestedProgramIds(customer?.interestedProgramIds);
}

/**
 * Which of `nextIds` may be saved.
 *  - An id ALREADY on the customer (`existingIds`) is always kept — even if
 *    that Program has since been archived or hard-deleted from the catalog,
 *    historical interest information must not silently vanish just because
 *    someone saved an unrelated change; only an explicit removal drops it.
 *  - A NEWLY added id must be an existing, active catalog node of type
 *    "program" — never a business unit/category/batch, never an invented or
 *    unknown id, never an archived Program.
 * `nodeById(id)` returns the catalogNodes doc (or null) — injected so this
 * stays pure.
 */
export function validateInterestedProgramIds(nextIds, { existingIds = [], nodeById } = {}) {
  const next = normalizeInterestedProgramIds(nextIds);
  const existing = new Set(normalizeInterestedProgramIds(existingIds));
  const valid = [];
  const invalid = [];
  for (const id of next) {
    if (existing.has(id)) { valid.push(id); continue; }
    const node = nodeById ? nodeById(id) : null;
    const isActiveProgram = !!node && node.type === "program" && node.isActive !== false && !node.archivedAt;
    (isActiveProgram ? valid : invalid).push(id);
  }
  return { valid, invalid };
}
