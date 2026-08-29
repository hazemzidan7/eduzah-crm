/**
 * SALES-PERF-01 — per-Sales-representative performance, computed entirely
 * from existing engagement/followUp/user data. No new collection, no new
 * Firestore listener — every input here is something CustomerContext/
 * FollowUpContext/AuthContext already loads for any admin session.
 *
 * Two SEPARATE attribution dimensions, deliberately never merged (approved
 * spec):
 *  - OWNERSHIP metrics (Assigned Leads, Confirmed Payments, Revenue, Paying
 *    Students) are attributed via engagement.ownerId — "who owns this
 *    lead/student relationship."
 *  - EXECUTION metrics (Follow-ups Assigned, Completed, Overdue) are
 *    attributed via followUp.assignedTo — "who is actually doing the
 *    outreach." A follow-up can be assigned to someone other than the
 *    engagement's own owner (e.g. Sales B covering a call for Sales A's
 *    lead) — both rows reflect exactly their own side of that, never both
 *    credited for the same thing. See computeSalesPerformance's own
 *    in-function comments for the exact critical-attribution behavior.
 *
 * Row set = every currently role==="sales" user (even with zero data, so
 * they're never silently invisible) UNION every distinct ownerId/assignedTo
 * value actually found in the data (covers a historical admin-owned
 * engagement, or an owner whose account no longer exists) UNION an
 * explicit "unassigned" bucket for engagements/follow-ups with no
 * owner/assignee at all. A user id that doesn't resolve against the live
 * `users` array is labeled "Unknown / Deleted User" — never silently
 * dropped (isUnknown on the returned row; the caller renders the localized
 * text, this module stays UI-agnostic same as every other utils/ module).
 *
 * REVENUE ATTRIBUTION — computed directly from CRM PaymentRecords
 * (utils/paymentRecords.effectivePaymentRecords), NOT the mirrored
 * Accounting Transaction. A PaymentRecord's `amount` is set once at
 * creation and never edited afterward (see paymentRecords.js — only
 * status/confirmedAt/confirmedBy/rejectionReason ever change); an
 * Accounting Transaction can be edited independently later by accounting
 * staff (see AccountingContext.updateTransaction), and its
 * relatedEngagementId is only populated when that optional CRM link
 * happens to be set. The CRM PaymentRecord is the more reliable,
 * tamper-proof "Payment -> Engagement -> ownerId" trace the approved spec
 * asks for, and it exists unconditionally for every confirmed payment.
 *
 * CONVERSION — deliberately NOT computed here. Engagements have no
 * `enrolledAt` timestamp (only current-state `enrollmentStatus`); a
 * period-scoped *count* of "engagements that transitioned to enrolled
 * during the period" is technically derivable by mining `timeline[]` for
 * the same "Enrollment: ... -> enrolled" system message
 * managementDashboard.computeRecentActivity already parses — but a
 * meaningful *rate* needs a cohort-consistent denominator (leads created
 * in month M vs. when they eventually enrolled, which is not bounded by
 * the same period window) that this data model doesn't cleanly support.
 * Reported as a known limitation rather than guessed at.
 *
 * REFUNDS — deliberately NOT netted against Revenue here. A refund is only
 * reliably attributable to an owner when it carries an explicit
 * relatedPaymentId link (optional on every refund, see
 * utils/accounting.js's ACCOUNTING-03B section) — an unlinked "independent"
 * refund has no reliable trace back to any Sales owner. Building a
 * "Net Revenue" column that would be correct for some reps and silently
 * incomplete for others (whenever an unlinked refund touches one of their
 * payments) would violate "do not invent attribution." Reported as a known
 * limitation.
 */

import { effectivePaymentRecords } from "./paymentRecords";
import { getDueBucket } from "./followUps";

export const UNASSIGNED_OWNER_KEY = "__unassigned__";
const UNKNOWN_OWNER_LABEL = "__unknown__";

function ownerKey(id) {
  return id || UNASSIGNED_OWNER_KEY;
}

/**
 * "YYYY-MM-DD" boundary comparison against a timestamp's own
 * `.slice(0, 10)` — same convention this app already uses everywhere else
 * a period filter meets a full ISO instant (see this file's own callers,
 * managementDashboard.js's newLeadsInPeriod, and utils/accounting.js's
 * filterTransactions).
 */
export function isInPeriod(iso, dateFrom, dateTo) {
  if (!iso) return false;
  const day = iso.slice(0, 10);
  if (dateFrom && day < dateFrom) return false;
  if (dateTo && day > dateTo) return false;
  return true;
}

/** Resolves a user id to a display name, or a sentinel the caller renders its own localized fallback for. Returns null for the "no owner at all" bucket (caller renders its own "Unassigned" text). */
function resolveOwnerLabel(key, users) {
  if (key === UNASSIGNED_OWNER_KEY) return null;
  const u = (users || []).find((x) => x.id === key);
  return u ? (u.name || u.email || key) : UNKNOWN_OWNER_LABEL;
}

/**
 * The full per-representative table, period-scoped exactly as documented
 * per-metric above (ownership metrics by their own event's timestamp,
 * Overdue always current-state — never silently mislabeled).
 */
export function computeSalesPerformance(engagements, followUps, users, { dateFrom, dateTo, now = new Date() } = {}) {
  const rows = new Map(); // ownerKey -> accumulator

  const getRow = (key) => {
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        assignedLeads: 0,
        confirmedPayments: 0,
        revenue: 0,
        payingCustomerIds: new Set(),
        followUpsAssigned: 0,
        followUpsCompleted: 0,
        followUpsOverdue: 0,
      };
      rows.set(key, row);
    }
    return row;
  };

  // Seed every current Sales-role user so a rep with zero data yet is still
  // a visible row, not silently absent.
  for (const u of (users || [])) {
    if (u.role === "sales") getRow(u.id);
  }

  // ── OWNERSHIP: Assigned Leads / Confirmed Payments / Revenue / Paying Students ──
  for (const engagement of (engagements || [])) {
    if (engagement.archivedAt) continue;
    const row = getRow(ownerKey(engagement.ownerId));

    // "Assigned Leads: number of engagements owned by the Sales
    // representative, created during the selected period."
    if (isInPeriod(engagement.createdAt, dateFrom, dateTo)) row.assignedLeads += 1;

    for (const record of effectivePaymentRecords(engagement)) {
      if (record.status !== "confirmed") continue;
      // Period-scoped by the PAYMENT's own confirmation timestamp, never
      // the engagement's createdAt or any other unrelated object's date.
      if (!isInPeriod(record.confirmedAt, dateFrom, dateTo)) continue;
      row.confirmedPayments += 1;
      row.revenue += record.amount || 0;
      row.payingCustomerIds.add(engagement.customerId);
    }
  }

  // ── EXECUTION: Follow-ups Assigned / Completed (period), Overdue (current-state) ──
  for (const followUp of (followUps || [])) {
    const row = getRow(ownerKey(followUp.assignedTo));

    // "Follow-ups: number of follow-ups assigned to the Sales
    // representative during the selected period" — by the follow-up's own
    // createdAt (when the assignment itself was created).
    if (isInPeriod(followUp.createdAt, dateFrom, dateTo)) row.followUpsAssigned += 1;
    // "Completed Follow-ups: number of follow-ups completed during the
    // selected period" — by completedAt, not createdAt.
    if (followUp.status === "completed" && isInPeriod(followUp.completedAt, dateFrom, dateTo)) row.followUpsCompleted += 1;
    // "Overdue: number of CURRENTLY overdue pending follow-ups assigned to
    // the Sales representative" — deliberately NOT period-scoped, same
    // "always current-state" reasoning Management Dashboard's own Alerts
    // card already uses for payment-verification alerts. A follow-up that
    // was completed after being overdue no longer satisfies status ===
    // "pending" here (getDueBucket itself checks status === "completed"
    // first), so it correctly leaves Overdue and stays in Completed only.
    if (followUp.status === "pending" && getDueBucket(followUp, now) === "overdue") row.followUpsOverdue += 1;
  }

  return [...rows.values()].map((row) => {
    const label = resolveOwnerLabel(row.key, users);
    return {
      key: row.key,
      ownerId: row.key === UNASSIGNED_OWNER_KEY ? null : row.key,
      isUnassigned: row.key === UNASSIGNED_OWNER_KEY,
      isUnknown: label === UNKNOWN_OWNER_LABEL,
      displayLabel: label === UNKNOWN_OWNER_LABEL ? null : label,
      assignedLeads: row.assignedLeads,
      confirmedPayments: row.confirmedPayments,
      revenue: row.revenue,
      payingStudents: row.payingCustomerIds.size,
      followUpsAssigned: row.followUpsAssigned,
      followUpsCompleted: row.followUpsCompleted,
      followUpsOverdue: row.followUpsOverdue,
      // Completion Rate = Completed / Assigned, both already period-scoped
      // above — null (not 0) when nothing was assigned in the period, so
      // the UI can render "—" instead of a misleading 0%.
      completionRate: row.followUpsAssigned > 0 ? row.followUpsCompleted / row.followUpsAssigned : null,
    };
  });
}

/** Aggregate summary cards — plain sums/derived-rate over the already-computed rows, no new logic. */
export function summarizeSalesPerformance(rows) {
  const reps = (rows || []).filter((r) => !r.isUnassigned);
  const totalAssignedLeads = reps.reduce((s, r) => s + r.assignedLeads, 0);
  const totalConfirmedPayments = reps.reduce((s, r) => s + r.confirmedPayments, 0);
  const totalRevenue = reps.reduce((s, r) => s + r.revenue, 0);
  const totalFollowUpsAssigned = reps.reduce((s, r) => s + r.followUpsAssigned, 0);
  const totalFollowUpsCompleted = reps.reduce((s, r) => s + r.followUpsCompleted, 0);
  return {
    totalReps: reps.length,
    totalAssignedLeads,
    totalConfirmedPayments,
    totalRevenue,
    followUpCompletionRate: totalFollowUpsAssigned > 0 ? totalFollowUpsCompleted / totalFollowUpsAssigned : null,
  };
}
