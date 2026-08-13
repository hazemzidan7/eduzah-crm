/**
 * CRM-04 — Accounting integration contract (outbox pattern only).
 *
 * This is NOT the Accounting module. It's a one-way, append-only record of
 * "a payment became confirmed" that a future, independent Accounting system
 * can poll/consume. No revenue/account/expense entities, no external API
 * call, are created here — see CustomerContext.emitAccountingEvent for the
 * only place this DTO is ever written, and CRM-04's own scope notes.
 */

export const ACCOUNTING_EVENTS_COLLECTION = "accountingEvents";

export const ACCOUNTING_EVENT_STATUS = {
  PENDING: "pending",
  SENT: "sent",
  FAILED: "failed",
};

/**
 * Builds the normalized DTO for one confirmed Payment Record. `eventId` is
 * the event's own identity (generated fresh); the *document* is always
 * stored at accountingEvents/{paymentId} — paymentId, not eventId, is the
 * idempotency key, per CRM-04 requirement 3: writing this twice for the
 * same payment must never produce two documents.
 */
export function buildConfirmedPaymentEvent({ eventId, record, engagement }) {
  return {
    eventId,
    paymentId: record.id,
    customerId: engagement.customerId || null,
    engagementId: engagement.id,
    programId: engagement.catalogNodeId || null,
    amount: record.amount,
    paymentMethod: record.paymentMethod || null,
    paymentType: record.paymentType || null,
    transactionReference: record.transactionReference || null,
    confirmedAt: record.confirmedAt || null,
    confirmedBy: record.confirmedBy || null,
    status: ACCOUNTING_EVENT_STATUS.PENDING,
    createdAt: new Date().toISOString(),
    sentAt: null,
    failedAt: null,
    errorMessage: null,
  };
}
