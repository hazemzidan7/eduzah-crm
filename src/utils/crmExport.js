/**
 * CRM-EXPORT-01 — read-only reconciliation export. Pure data-shaping only
 * (no Firestore access, no DOM) — same split as every other utils/ module
 * in this codebase: this file only maps already-loaded context data into
 * the export shape; src/pages/admin/management/CrmDataExportView.jsx does
 * the actual browser download trigger.
 *
 * Every field list here is copied from the REAL shipped schema (verified
 * against CustomerContext.jsx's addCustomer/addEngagement and
 * utils/accounting.js/utils/paymentRecords.js), not invented. Deliberately
 * excludes internal-only fields not needed for reconciliation (timeline[],
 * salesNotes, customFields, tagIds, attachments, editHistory[]) to keep the
 * export minimal and avoid carrying free-text internal notes into a file
 * that leaves the app.
 */

import { effectivePaymentRecords } from "./paymentRecords";
import { excludeDeletedTransactions } from "./accounting";

function mapCustomer(c) {
  return {
    id: c.id,
    fullName: c.fullName || "",
    phone: c.phone || "",
    normalizedPhone: c.normalizedPhone || null,
    secondaryPhones: c.secondaryPhones || [],
    email: c.email || "",
    whatsapp: c.whatsapp || "",
    createdAt: c.createdAt || null,
    updatedAt: c.updatedAt || null,
    archivedAt: c.archivedAt || null,
  };
}

function mapEngagement(e, nodeById) {
  const node = e.catalogNodeId ? nodeById.get(e.catalogNodeId) : null;
  return {
    id: e.id,
    customerId: e.customerId,
    catalogNodeId: e.catalogNodeId || null,
    // Resolved purely for human-readability in the export — the raw
    // catalogNodeId above is still the authoritative join key.
    programName_ar: node?.name_ar || null,
    programName_en: node?.name_en || null,
    businessUnitId: e.businessUnitId || null,
    statusId: e.statusId || null,
    enrollmentStatus: e.enrollmentStatus || null,
    enrollmentSource: e.enrollmentSource || null,
    ownerId: e.ownerId || null,
    studentProfile: e.studentProfile || {},
    pricingSnapshot: e.pricingSnapshot || null,
    // Legacy flat payment fields (pre-CRM-02 engagements) — still the only
    // source of coursePrice/paymentPlan for engagements with no pricingSnapshot.
    payment: e.payment || {},
    createdAt: e.createdAt || null,
    updatedAt: e.updatedAt || null,
    archivedAt: e.archivedAt || null,
  };
}

function mapPaymentRecord(r, engagement) {
  return {
    id: r.id,
    engagementId: engagement.id,
    customerId: engagement.customerId,
    amount: r.amount ?? null,
    paymentType: r.paymentType || null,
    paymentMethod: r.paymentMethod || null,
    status: r.status || null,
    submittedAt: r.submittedAt || null,
    confirmedAt: r.confirmedAt || null,
    confirmedBy: r.confirmedBy || null,
    transactionReference: r.transactionReference || null,
    attachmentRef: r.attachmentRef || null,
    rejectionReason: r.rejectionReason || null,
    legacy: !!r.legacy,
  };
}

function mapTransaction(t) {
  return {
    id: t.id,
    type: t.type,
    amount: t.amount ?? null,
    date: t.date || null,
    account: t.account || null,
    fromAccount: t.fromAccount || null,
    toAccount: t.toAccount || null,
    category: t.category || null,
    note: t.note || "",
    relatedCustomerId: t.relatedCustomerId || null,
    relatedEngagementId: t.relatedEngagementId || null,
    relatedPaymentId: t.relatedPaymentId || null,
    isDeleted: t.isDeleted === true,
    createdAt: t.createdAt || null,
  };
}

function mapFollowUp(f) {
  return {
    id: f.id,
    customerId: f.customerId || null,
    engagementId: f.engagementId || null,
    assignedTo: f.assignedTo || null,
    dueAt: f.dueAt || null,
    status: f.status || null,
  };
}

function mapCatalogNode(n) {
  return {
    id: n.id,
    name_ar: n.name_ar || null,
    name_en: n.name_en || null,
    type: n.type || null,
    parentId: n.parentId || null,
    path: n.path || [],
    isActive: n.isActive !== false,
    archivedAt: n.archivedAt || null,
  };
}

/**
 * Builds the full reconciliation export object from already-loaded context
 * data (CustomerContext/AccountingContext/FollowUpContext/CatalogContext) —
 * no new Firestore reads happen here. `transactions` is the RAW array
 * (including soft-deleted ones, unlike every calculation consumer elsewhere
 * in the app) so it can be split into active vs. deleted sections, per the
 * approved spec.
 */
export function buildCrmExport({ customers, engagements, transactions, followUps, catalogNodes }) {
  const exportedAt = new Date().toISOString();
  const nodeById = new Map((catalogNodes || []).map((n) => [n.id, n]));

  const paymentRecordsOut = [];
  for (const e of (engagements || [])) {
    for (const r of effectivePaymentRecords(e)) {
      paymentRecordsOut.push(mapPaymentRecord(r, e));
    }
  }

  const activeTransactions = excludeDeletedTransactions(transactions);
  const deletedTransactions = (transactions || []).filter((t) => t.isDeleted === true);

  return {
    exportedAt,
    customers: (customers || []).map(mapCustomer),
    engagements: (engagements || []).map((e) => mapEngagement(e, nodeById)),
    paymentRecords: paymentRecordsOut,
    accountingTransactions: activeTransactions.map(mapTransaction),
    deletedAccountingTransactions: deletedTransactions.map(mapTransaction),
    followUps: (followUps || []).map(mapFollowUp),
    catalogNodes: (catalogNodes || []).map(mapCatalogNode),
  };
}

/**
 * Plain array-of-objects -> CSV. Nested objects/arrays (studentProfile,
 * pricingSnapshot, path, secondaryPhones) are serialized as a single
 * JSON-string cell — an accepted, honest way to keep them in a CSV without
 * inventing a flattening scheme; the JSON export is the full-fidelity one.
 */
export function toCsv(rows) {
  if (!rows || rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(","));
  return lines.join("\n");
}
