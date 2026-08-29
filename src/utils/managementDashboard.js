/**
 * ACCOUNTING-05 — Management Dashboard pure calculations. Sits ABOVE both
 * the CRM (paymentRecords.js/pricingSnapshot.js) and Accounting
 * (accounting.js) domains as a read-only aggregation layer — it imports
 * from both (normal layering for a cross-cutting summary view) but adds no
 * new business rules of its own: every figure here is either reused
 * directly from an existing function, or a plain count/sum over fields that
 * already exist. Nothing here writes anything, and nothing here is
 * imported back into paymentRecords.js/pricingSnapshot.js/accounting.js —
 * the one-way dependency direction those modules' own docstrings describe
 * stays intact.
 */

import {
  effectivePaymentRecords, confirmedAmountPaid, findPaymentConflicts,
} from "./paymentRecords";
import { effectiveCoursePrice } from "./pricingSnapshot";
import { TRANSACTION_TYPES } from "./accounting";

export const MANAGEMENT_PERIODS = {
  TODAY: "today",
  THIS_WEEK: "this_week",
  THIS_MONTH: "this_month",
  CUSTOM: "custom",
};

export const MANAGEMENT_PERIOD_OPTIONS = [
  { v: MANAGEMENT_PERIODS.TODAY, ar: "اليوم", en: "Today" },
  { v: MANAGEMENT_PERIODS.THIS_WEEK, ar: "هذا الأسبوع", en: "This Week" },
  { v: MANAGEMENT_PERIODS.THIS_MONTH, ar: "هذا الشهر", en: "This Month" },
  { v: MANAGEMENT_PERIODS.CUSTOM, ar: "نطاق مخصص", en: "Custom Range" },
];

/**
 * Payment-record STATUS counts (pending/under_review/confirmed/rejected),
 * period-scoped by `record.submittedAt`. This is the one figure Accounting
 * genuinely cannot provide (by design, only confirmed payments ever reach
 * Accounting — see ACCOUNTING-03A) — same tally PaymentVerificationQueue's
 * own `counts` already computes inline for its filter pills, extracted here
 * as a small reusable pure function rather than duplicated logic.
 */
export function computePaymentStatusCounts(engagements, { dateFrom, dateTo } = {}) {
  const counts = { pending: 0, under_review: 0, confirmed: 0, rejected: 0 };
  for (const engagement of engagements || []) {
    for (const record of effectivePaymentRecords(engagement)) {
      const day = (record.submittedAt || "").slice(0, 10);
      if (dateFrom && day < dateFrom) continue;
      if (dateTo && day > dateTo) continue;
      if (counts[record.status] !== undefined) counts[record.status] += 1;
    }
  }
  return counts;
}

/**
 * Actionable Payment Verification alerts — always current-state (not
 * period-scoped: a payment stuck pending since last month is still today's
 * problem). Conflict detection reuses findPaymentConflicts exactly as-is;
 * the "missing proof" condition mirrors PaymentRecordCard's own
 * needsProofButHasNone check exactly (not a new rule).
 */
export function computePaymentAlerts(engagements) {
  let pending = 0, underReview = 0, conflicts = 0, missingProof = 0;
  for (const engagement of engagements || []) {
    for (const record of effectivePaymentRecords(engagement)) {
      if (record.status === "pending") pending += 1;
      else if (record.status === "under_review") underReview += 1;
      else continue;

      if (findPaymentConflicts(record, engagement, engagements).length > 0) conflicts += 1;
      // Mirrors PaymentRecordCard.jsx's needsProofButHasNone exactly.
      if (!record.legacy && !record.attachmentRef && (record.paymentMethod === "instapay" || record.paymentMethod === "vodafone_cash")) {
        missingProof += 1;
      }
    }
  }
  return { pending, underReview, conflicts, missingProof };
}

/**
 * Lead-status funnel using ONLY existing, live-configured status data
 * (LeadStatusContext) — never a hardcoded assumption about which specific
 * status IDs mean "contacted" or "interested". `isDefault`/`isTerminal` are
 * real, already-used fields on every status; "in progress" is simply
 * neither. Enrollment has no timestamp field (only enrollmentStatus is
 * stored, no "enrolledAt"), so — per the approved instruction to identify
 * rather than invent — enrolled counts here are current-state totals, not
 * period-scoped; that limitation is surfaced via the `allTimeOnly` flag
 * rather than silently faked.
 */
export function computeLeadFunnel(engagements, statuses) {
  const byStatus = new Map(); // statusId -> count
  let notContacted = 0, inProgress = 0, terminal = 0, enrolled = 0;
  const statusById = new Map((statuses || []).map((s) => [s.id, s]));

  for (const engagement of engagements || []) {
    if (engagement.archivedAt) continue;
    const status = engagement.statusId ? statusById.get(engagement.statusId) : null;
    byStatus.set(engagement.statusId || "__none__", (byStatus.get(engagement.statusId || "__none__") || 0) + 1);
    if (!status || status.isDefault) notContacted += 1;
    else if (status.isTerminal) terminal += 1;
    else inProgress += 1;
    if (engagement.enrollmentStatus === "enrolled") enrolled += 1;
  }

  const statusBreakdown = (statuses || [])
    .map((s) => ({ statusId: s.id, name_ar: s.name_ar, name_en: s.name_en, color: s.color, count: byStatus.get(s.id) || 0 }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);

  return { notContacted, inProgress, terminal, enrolled, statusBreakdown, enrolledIsAllTime: true };
}

/**
 * Program performance table data. Students/Paid/Remaining are current-state
 * (all-time) totals per program — same "as of now" nature as
 * confirmedAmountPaid/effectiveCoursePrice themselves, never period-filtered
 * anywhere else in this app either. Revenue is the one period-scoped column
 * (confirmed Accounting income linked to the program's engagements via
 * relatedEngagementId -> engagement.catalogNodeId — no catalogNodeId is
 * stored on the transaction itself, by design, see ACCOUNTING-03A).
 */
export function computeProgramPerformance(engagements, periodIncomeTransactions) {
  const byProgram = new Map(); // catalogNodeId -> { studentIds, paid, remaining, revenue }
  const engagementById = new Map();

  for (const engagement of engagements || []) {
    if (engagement.archivedAt || !engagement.catalogNodeId) continue;
    engagementById.set(engagement.id, engagement);
    const bucket = byProgram.get(engagement.catalogNodeId) || { studentIds: new Set(), paid: 0, remaining: 0, revenue: 0 };
    bucket.studentIds.add(engagement.customerId);
    const paid = confirmedAmountPaid(engagement);
    const price = effectiveCoursePrice(engagement) || 0;
    bucket.paid += paid;
    bucket.remaining += Math.max(0, price - paid);
    byProgram.set(engagement.catalogNodeId, bucket);
  }

  for (const t of periodIncomeTransactions || []) {
    if (t.type !== TRANSACTION_TYPES.INCOME || !t.relatedEngagementId) continue;
    const engagement = engagementById.get(t.relatedEngagementId);
    if (!engagement?.catalogNodeId) continue;
    const bucket = byProgram.get(engagement.catalogNodeId);
    if (bucket) bucket.revenue += t.amount;
  }

  return [...byProgram.entries()]
    .map(([catalogNodeId, b]) => ({ catalogNodeId, students: b.studentIds.size, revenue: b.revenue, paid: b.paid, remaining: b.remaining }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * Compact recent-activity feed merged from engagement timelines (registration/
 * enrollment) and Accounting transactions (payment/refund/expense) — no new
 * activity-log system, just a read-only merge+sort of data that already
 * exists. Registration/enrollment detection matches the exact hardcoded
 * system-message text CustomerContext.jsx already logs (addEngagement's
 * "Engagement created", changeEnrollmentStatus's "Enrollment: ... ->
 * enrolled") — the only signal available without a dedicated subtype field.
 */
export function computeRecentActivity(engagements, transactions, { limit = 10 } = {}) {
  const items = [];
  for (const engagement of engagements || []) {
    for (const t of engagement.timeline || []) {
      if (t.type !== "system" || !t.text) continue;
      if (/engagement created/i.test(t.text)) {
        items.push({ kind: "registration", at: t.at, engagementId: engagement.id, customerId: engagement.customerId });
      } else if (/enrollment:.*enrolled/i.test(t.text)) {
        items.push({ kind: "enrollment", at: t.at, engagementId: engagement.id, customerId: engagement.customerId });
      }
    }
  }
  for (const t of transactions || []) {
    if (t.type === TRANSACTION_TYPES.INCOME) items.push({ kind: "payment", at: t.createdAt, amount: t.amount, account: t.account, customerId: t.relatedCustomerId, engagementId: t.relatedEngagementId });
    else if (t.type === TRANSACTION_TYPES.REFUND) items.push({ kind: "refund", at: t.createdAt, amount: t.amount, account: t.account, customerId: t.relatedCustomerId, engagementId: t.relatedEngagementId });
    else if (t.type === TRANSACTION_TYPES.EXPENSE) items.push({ kind: "expense", at: t.createdAt, amount: t.amount, category: t.category });
  }
  return items.filter((i) => i.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
