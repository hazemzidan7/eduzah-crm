/**
 * CRM-05 — Follow-up & Reminders data model + pure logic. Same split as
 * paymentRecords.js/accounting.js: this file owns shape/vocabulary/
 * validation/derived calculations, src/context/FollowUpContext.jsx does the
 * actual Firestore I/O. Deliberately independent of paymentRecords.js/
 * pricingSnapshot.js/enrollment.js/accountingEvents.js — a follow-up only
 * ever references an existing customerId/engagementId, it never duplicates
 * or re-derives anything from those modules.
 */

export const FOLLOW_UPS_COLLECTION = "followUps";

export const FOLLOW_UP_STATUSES = {
  PENDING: "pending",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

export const FOLLOW_UP_STATUS_OPTIONS = [
  { v: FOLLOW_UP_STATUSES.PENDING, ar: "قيد الانتظار", en: "Pending" },
  { v: FOLLOW_UP_STATUSES.COMPLETED, ar: "مكتملة", en: "Completed" },
  { v: FOLLOW_UP_STATUSES.CANCELLED, ar: "ملغاة", en: "Cancelled" },
];

export const FOLLOW_UP_QUICK_FILTERS = {
  ALL: "all",
  MINE: "mine",
  OVERDUE: "overdue",
  TODAY: "today",
  UPCOMING: "upcoming",
  COMPLETED: "completed",
};

// Local calendar date as 'YYYY-MM-DD' — NOT toISOString(), which converts to
// UTC first and (in any timezone ahead of UTC, e.g. Cairo) can land one
// calendar day early. Same fix already applied in utils/accounting.js
// (localIsoDate/todayIso there) — duplicated here rather than imported since
// that helper isn't exported, and it's a 3-line, dependency-free primitive.
function localIsoDate(year, monthIndex0, day) {
  const mm = String(monthIndex0 + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Builds a real UTC-instant ISO string from a local date + time picked in
 * the UI (e.g. "2026-08-25" + "17:00" -> that instant in the browser's own
 * timezone). Unlike the calendar-day helpers above, this is a genuine point
 * in time (not just a date), so `new Date(...).toISOString()` is the correct
 * tool here — no timezone bug, since `new Date("YYYY-MM-DDTHH:mm")` (no `Z`
 * suffix) parses as local time first.
 */
export function buildDueAt(dateStr, timeStr) {
  if (!dateStr) return null;
  const t = timeStr && /^\d{2}:\d{2}$/.test(timeStr) ? timeStr : "23:59";
  const d = new Date(`${dateStr}T${t}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Inverse of buildDueAt — splits a stored dueAt instant back into local date/time input values, for the Edit form. */
export function splitDueAt(iso) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: localIsoDate(d.getFullYear(), d.getMonth(), d.getDate()),
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

/**
 * Validates a draft follow-up (plain form data, not yet a Firestore doc).
 * Returns an array of error codes — empty means valid. Same
 * codes-not-strings convention as utils/accounting.js's validateTransaction.
 */
export function validateFollowUpDraft(draft) {
  const errors = [];
  if (!draft?.customerId) errors.push("MISSING_CUSTOMER");
  if (!draft?.engagementId) errors.push("MISSING_ENGAGEMENT");
  if (!draft?.dueAt) errors.push("MISSING_DUE_AT");
  return errors;
}

export const isValidFollowUpDraft = (draft) => validateFollowUpDraft(draft).length === 0;

/** Builds the Firestore-ready follow-up doc from a validated draft. Throws if invalid — same last-line-guard convention as buildTransaction. */
export function buildFollowUp(draft, { currentUser } = {}) {
  const errors = validateFollowUpDraft(draft);
  if (errors.length > 0) throw new Error(`INVALID_FOLLOW_UP: ${errors.join(", ")}`);
  const now = new Date().toISOString();
  return {
    customerId: draft.customerId,
    engagementId: draft.engagementId,
    assignedTo: draft.assignedTo || null,
    dueAt: draft.dueAt,
    status: FOLLOW_UP_STATUSES.PENDING,
    note: draft.note || "",
    createdBy: currentUser?.id || null,
    createdByName: currentUser?.name || null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    completedBy: null,
    completedByName: null,
    result: null,
    // CRM-05 FINALIZATION — a frozen display snapshot (student name/phone,
    // Program label), same "capture once at creation, never re-derive"
    // precedent as pricingSnapshot. Exists specifically so a Sales-role
    // follow-up is self-contained: Sales has no Firestore read access to
    // customers/engagements (see firestore.rules), so this is the only way
    // their own Follow-ups list can show who a follow-up is for. The admin
    // UI still prefers the live customer/engagement join when available
    // (see FollowUpsPage.jsx) — this is a fallback, not a new source of
    // truth, and is never re-synced if the customer's name/phone changes
    // later (acceptable: it's a point-in-time record of who this was for).
    customerName: draft.customerName || null,
    customerPhone: draft.customerPhone || null,
    programLabel: draft.programLabel || null,
  };
}

/** Patch applied when marking a pending follow-up Complete. Never mutates dueAt/note/assignedTo — those stay as the historical record of what was originally scheduled. */
export function buildCompletionPatch({ result, currentUser }) {
  const now = new Date().toISOString();
  return {
    status: FOLLOW_UP_STATUSES.COMPLETED,
    result: result || "",
    completedAt: now,
    completedBy: currentUser?.id || null,
    completedByName: currentUser?.name || null,
    updatedAt: now,
  };
}

/**
 * Draft for the optional "create next follow-up" step — a NEW doc chained to
 * the same customer/engagement, never a rewrite of the one just completed.
 * Inherits the previous doc's denormalized customerName/customerPhone/
 * programLabel rather than re-resolving them — required so a Sales-role user
 * (no customers/engagements read access) can still chain a next follow-up;
 * this is exactly why buildFollowUp captures that snapshot in the first
 * place, not a new lookup happening here.
 */
export function buildNextFollowUpDraft(prev, { dueAt, note, assignedTo }) {
  return {
    customerId: prev.customerId,
    engagementId: prev.engagementId,
    dueAt,
    note: note || "",
    assignedTo: assignedTo || prev.assignedTo || null,
    customerName: prev.customerName || null,
    customerPhone: prev.customerPhone || null,
    programLabel: prev.programLabel || null,
  };
}

const BUCKET_PRIORITY = { overdue: 0, today: 1, upcoming: 2, completed: 3, cancelled: 4 };

/**
 * Which bucket a follow-up currently falls in. `dueAt` strings are full ISO
 * instants, so lexicographic comparison against `now.toISOString()` is a
 * valid (and exact-to-the-minute) chronological comparison — same trick this
 * codebase already relies on for `submittedAt`/`createdAt` string sorts. A
 * follow-up due later today but whose time hasn't passed yet reads as
 * "today", not "overdue"; once its time passes it moves to "overdue" even
 * though the calendar day hasn't changed.
 */
export function getDueBucket(followUp, now = new Date()) {
  if (followUp.status === FOLLOW_UP_STATUSES.COMPLETED) return "completed";
  if (followUp.status === FOLLOW_UP_STATUSES.CANCELLED) return "cancelled";
  if (!followUp.dueAt) return "upcoming";
  const nowIso = now.toISOString();
  const today = localIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDate = new Date(followUp.dueAt);
  const dueDay = localIsoDate(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  if (followUp.dueAt < nowIso) return "overdue";
  if (dueDay === today) return "today";
  return "upcoming";
}

/** Default sort: Overdue, then Due Today, then Upcoming, then Completed/Cancelled — soonest-due first within each group. */
export function sortFollowUps(list, now = new Date()) {
  return [...(list || [])].sort((a, b) => {
    const pa = BUCKET_PRIORITY[getDueBucket(a, now)] ?? 99;
    const pb = BUCKET_PRIORITY[getDueBucket(b, now)] ?? 99;
    if (pa !== pb) return pa - pb;
    return (a.dueAt || "").localeCompare(b.dueAt || "");
  });
}

/**
 * Shared filter for the Follow-ups list — quick-filter tab + free-text
 * search. `searchTextFor(followUp)` is an optional caller-supplied hook for
 * search terms this module can't know about itself (resolved student name/
 * phone/program), same pattern as filterTransactions' searchTextFor in
 * utils/accounting.js — keeps this file CRM-context-agnostic.
 */
export function filterFollowUps(list, { quickFilter = FOLLOW_UP_QUICK_FILTERS.ALL, currentUserId = null, search = "" } = {}, { searchTextFor, now = new Date() } = {}) {
  let out = list || [];
  if (quickFilter === FOLLOW_UP_QUICK_FILTERS.MINE) out = out.filter((f) => f.assignedTo === currentUserId);
  else if (quickFilter !== FOLLOW_UP_QUICK_FILTERS.ALL) out = out.filter((f) => getDueBucket(f, now) === quickFilter);

  const q = search.trim().toLowerCase();
  if (q) {
    out = out.filter((f) => {
      const extra = searchTextFor ? searchTextFor(f) : "";
      const haystack = [f.note, extra].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }
  return out;
}

/**
 * Management Dashboard's small Follow-up section (section 8 of the spec) —
 * Overdue / Due Today / Upcoming / Completed Today, from this same followUps
 * collection (no duplicate page, no new data source).
 */
export function computeFollowUpDashboardStats(followUps, now = new Date()) {
  const today = localIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
  let overdue = 0, dueToday = 0, upcoming = 0, completedToday = 0;
  for (const f of followUps || []) {
    const bucket = getDueBucket(f, now);
    if (bucket === "overdue") overdue += 1;
    else if (bucket === "today") dueToday += 1;
    else if (bucket === "upcoming") upcoming += 1;
    if (f.status === FOLLOW_UP_STATUSES.COMPLETED && f.completedAt) {
      const d = new Date(f.completedAt);
      if (!Number.isNaN(d.getTime()) && localIsoDate(d.getFullYear(), d.getMonth(), d.getDate()) === today) {
        completedToday += 1;
      }
    }
  }
  return { overdue, dueToday, upcoming, completedToday };
}
