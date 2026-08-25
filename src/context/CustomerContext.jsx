import { createContext, useContext, useState, useEffect } from "react";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  setDoc,
  getDoc,
  onSnapshot,
  arrayUnion,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";
import { useCatalog } from "./CatalogContext";
import { normalizePhone, normalizeEmail } from "../utils/leadDedupe";
import { effectivePaymentRecords, findPaymentConflicts, hasBlockingConflict } from "../utils/paymentRecords";
import { ACCOUNTING_EVENTS_COLLECTION, buildConfirmedPaymentEvent } from "../utils/accountingEvents";
import { buildPricingSnapshot, applyPaymentPlan } from "../utils/pricingSnapshot";
import { ACCOUNTING_TRANSACTIONS_COLLECTION, buildTransaction, buildIncomeDraftFromConfirmedPayment } from "../utils/accounting";
import { buildCustomerDeletionSet, chunkDeletionOps } from "../utils/deleteCustomer";

const CustomerCtx = createContext(null);

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * The Unified Customer Model: `customers` holds identity only (one doc per
 * real human, ever — deduped globally by phone/email, independent of
 * Business Unit). `engagements` holds the many relationships a person can
 * have over their lifetime (one per Business Unit pursuit) — stage, status,
 * owner, tags, custom fields, and its own timeline all live there, not on
 * the person record. See the approved v2 architecture for the full reasoning.
 */
export function CustomerProvider({ children }) {
  const { currentUser } = useAuth();
  const { nodeById: catalogNodeById } = useCatalog();
  const [customers, setCustomers] = useState([]);
  const [engagements, setEngagements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentUser?.role !== "admin") { setCustomers([]); setEngagements([]); setLoading(false); return; }
    setLoading(true);
    const unsubCustomers = onSnapshot(
      collection(db, "customers"),
      (snap) => { setCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    const unsubEngagements = onSnapshot(
      collection(db, "engagements"),
      (snap) => setEngagements(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    return () => { unsubCustomers(); unsubEngagements(); };
  }, [currentUser?.id, currentUser?.role]);

  // ── PERSON-LEVEL DEDUP (global, across every Business Unit) ──────────
  const findCustomerByPhone = (phone) => {
    const np = normalizePhone(phone);
    if (!np) return null;
    return customers.find((c) => c.normalizedPhone === np || (c.secondaryPhones || []).some((p) => normalizePhone(p) === np)) || null;
  };
  const findCustomerByEmail = (email) => {
    const ne = email ? normalizeEmail(email) : null;
    if (!ne) return null;
    return customers.find((c) => c.normalizedEmail === ne) || null;
  };
  const customerById = (id) => customers.find((c) => c.id === id) || null;

  const addCustomer = async (form) => {
    const now = new Date().toISOString();
    const nc = {
      fullName: form.fullName || "",
      phone: form.phone || "",
      normalizedPhone: normalizePhone(form.phone),
      secondaryPhones: form.secondaryPhones || [],
      email: form.email || "",
      normalizedEmail: form.email ? normalizeEmail(form.email) : null,
      whatsapp: form.whatsapp || "",
      authUid: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await addDoc(collection(db, "customers"), nc);
    return ref.id;
  };

  // Find-or-create by phone (primary) then email (fallback) — never creates
  // a second customer doc for a person we already have a phone/email match for.
  const resolveOrCreateCustomer = async (form) => {
    const existing = findCustomerByPhone(form.phone) || findCustomerByEmail(form.email);
    if (existing) return existing.id;
    return addCustomer(form);
  };

  const updateCustomer = async (id, updates) => {
    const patch = { ...updates, updatedAt: new Date().toISOString() };
    if (updates.phone !== undefined) patch.normalizedPhone = normalizePhone(updates.phone);
    if (updates.email !== undefined) patch.normalizedEmail = updates.email ? normalizeEmail(updates.email) : null;
    await updateDoc(doc(db, "customers", id), patch);
  };

  const archiveCustomer = async (id) => {
    await updateDoc(doc(db, "customers", id), { archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };
  const restoreCustomer = async (id) => {
    await updateDoc(doc(db, "customers", id), { archivedAt: null, updatedAt: new Date().toISOString() });
  };

  // ADMIN-DELETE-STUDENT — permanently deletes one customer and every record
  // that actually belongs to them, matched by ID only (utils/deleteCustomer's
  // buildCustomerDeletionSet — never by name/amount/date similarity). Reaches
  // into accountingTransactions/accountingEvents directly, same as
  // createAccountingIncomeFromPayment/emitAccountingEvent above already do —
  // not a new pattern. followUps/transactions live in other contexts, so the
  // caller (the delete-confirmation UI, which already holds both via
  // useFollowUps()/useAccounting()) passes their current arrays in.
  //
  // Admin-only at the real Firestore boundary already: customers/engagements/
  // accountingEvents are isAdmin()-only write, accountingTransactions is
  // isAdmin()-or-accounting, and followUps' delete rule is explicitly
  // isAdmin()-only — no firestore.rules change needed for this feature.
  //
  // The deletion set is rebuilt fresh from whatever `engagements` this
  // provider holds right now (not a snapshot passed in), so a retry after a
  // partial failure — or after the customer is already gone — only ever
  // touches what's still actually left; nothing unrelated can be reached.
  // Batched at Firestore's 500-op limit (chunkDeletionOps), chunks committed
  // sequentially; the customer doc is always the last op in the last chunk.
  const deleteCustomerCascade = async (customerId, { followUps, transactions } = {}) => {
    const deletionSet = buildCustomerDeletionSet(customerId, { engagements, followUps, transactions });
    const chunks = chunkDeletionOps(deletionSet);
    for (const chunk of chunks) {
      if (chunk.length === 0) continue;
      const batch = writeBatch(db);
      for (const op of chunk) batch.delete(doc(db, op.collection, op.id));
      await batch.commit();
    }
    return deletionSet;
  };

  // ── ENGAGEMENT-LEVEL DEDUP (does this person already have a relationship with this Program?) ──
  // Scoped to Program, not Business Unit — one customer can independently
  // enroll in several Programs of the same Business Unit (e.g. Programming
  // Fundamentals, then later Front-End), each with its own Contact Status,
  // Sales Notes, Payment, Follow-ups and Timeline.
  const findEngagement = (customerId, catalogNodeId) =>
    engagements.find((e) => e.customerId === customerId && e.catalogNodeId === catalogNodeId) || null;

  const engagementById = (id) => engagements.find((e) => e.id === id) || null;
  const engagementsForCustomer = (customerId) => engagements.filter((e) => e.customerId === customerId);
  const engagementsForBusinessUnit = (businessUnitId) => engagements.filter((e) => e.businessUnitId === businessUnitId);

  const addEngagement = async (customerId, form) => {
    const now = new Date().toISOString();
    // CRM-PRICING-01: a frozen snapshot of the Program's current catalog
    // pricing, taken once at creation — never re-derived later, even if the
    // Program's own price changes afterward. See utils/pricingSnapshot.js.
    const program = form.catalogNodeId ? catalogNodeById(form.catalogNodeId) : null;
    const businessUnit = form.businessUnitId ? catalogNodeById(form.businessUnitId) : null;
    const pricingSnapshot = buildPricingSnapshot({ program, businessUnit });
    const ne = {
      customerId,
      businessUnitId: form.businessUnitId,
      catalogNodeId: form.catalogNodeId || null,
      stage: form.stage || "lead",
      // ── Section 1: Student Profile — registration data, never hand-typed by
      // sales staff. Comes from an import or (eventually) a form webhook only.
      studentProfile: {
        registrationDate: form.studentProfile?.registrationDate || null,
        governorate: form.studentProfile?.governorate || "",
        educationalLevel: form.studentProfile?.educationalLevel || "",
        employmentStatus: form.studentProfile?.employmentStatus || "",
        attendanceType: form.studentProfile?.attendanceType || "",
        courseLevel: form.studentProfile?.courseLevel || "",
        hasLaptop: form.studentProfile?.hasLaptop ?? null,
        preferredContactMethod: form.studentProfile?.preferredContactMethod || "",
        leadSource: form.studentProfile?.leadSource || "",
        studentComment: form.studentProfile?.studentComment || "",
      },
      // ── Section 2: CRM Internal Data — owned and edited by sales staff only.
      statusId: form.statusId || null,
      contactStatus: form.contactStatus || "not_contacted",
      // Enrollment is independent of Contact Status (sales lifecycle) and of
      // the payment numbers themselves — see changeEnrollmentStatus below.
      enrollmentStatus: form.enrollmentStatus || "not_enrolled",
      ownerId: form.ownerId || null,
      priority: form.priority || "normal",
      nextFollowUpDate: form.nextFollowUpDate || null,
      salesNotes: form.salesNotes || "",
      // Course Price/Amount Paid/Remaining Balance are never stored directly —
      // Amount Paid and Remaining Balance are always derived from these at
      // display time, so there's exactly one source of truth for each.
      payment: {
        coursePrice: form.payment?.coursePrice ?? null,
        paymentPlan: form.payment?.paymentPlan || "",
        reservationDeposit: form.payment?.reservationDeposit ?? null,
        installment1: form.payment?.installment1 ?? null,
        installment2: form.payment?.installment2 ?? null,
        installment3: form.payment?.installment3 ?? null,
        confirmed: form.payment?.confirmed ?? false,
        confirmedAt: form.payment?.confirmedAt || null,
      },
      // CRM-02: Payment Records are the only source of truth for money
      // actually received — see utils/paymentRecords.js. `payment.*` above
      // stays limited to coursePrice/paymentPlan (program economics, not
      // transactions); reservationDeposit/installment*/confirmed* are kept
      // only so existing documents written before this change still read
      // correctly through effectivePaymentRecords().
      paymentRecords: form.paymentRecords || [],
      pricingSnapshot,
      tagIds: form.tagIds || [],
      customFields: form.customFields || {},
      timeline: [{
        id: genId(), type: "system",
        text: form.creationNote || "Engagement created",
        byUid: currentUser?.id || null, byName: currentUser?.name || null, at: now,
      }],
      attachments: [],
      sourceImportBatchIds: form.sourceImportBatchIds || [],
      mergedRecordCount: form.mergedRecordCount || 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await addDoc(collection(db, "engagements"), ne);
    return ref.id;
  };

  // Non-destructive: only fills studentProfile fields that are currently
  // empty. A re-import must never overwrite a value sales already corrected,
  // and must never touch Section 2 (CRM Internal Data) at all.
  const mergeStudentProfile = async (engagementId, incoming) => {
    const current = engagementById(engagementId);
    if (!current) return;
    const merged = { ...(current.studentProfile || {}) };
    let changed = false;
    for (const [k, v] of Object.entries(incoming || {})) {
      const empty = merged[k] === "" || merged[k] === null || merged[k] === undefined;
      if (empty && v !== "" && v !== null && v !== undefined) {
        merged[k] = v;
        changed = true;
      }
    }
    if (changed) {
      await updateDoc(doc(db, "engagements", engagementId), { studentProfile: merged, updatedAt: new Date().toISOString() });
    }
  };

  // Find-or-create: never creates a second engagement for the same
  // (customer, Program) pair — callers (like the Import Engine) should
  // check findEngagement() first if they need to distinguish merge-vs-create.
  const resolveOrCreateEngagement = async (customerId, catalogNodeId, form) => {
    const existing = findEngagement(customerId, catalogNodeId);
    if (existing) return existing.id;
    return addEngagement(customerId, { ...form, catalogNodeId });
  };

  const updateEngagement = async (id, updates) => {
    await updateDoc(doc(db, "engagements", id), { ...updates, updatedAt: new Date().toISOString() });
  };

  const changeEngagementStatus = async (id, newStatusId) => {
    const engagement = engagementById(id);
    const now = new Date().toISOString();
    await updateDoc(doc(db, "engagements", id), {
      statusId: newStatusId,
      updatedAt: now,
      timeline: arrayUnion({
        id: genId(), type: "status_change",
        statusFrom: engagement?.statusId || null, statusTo: newStatusId,
        byUid: currentUser?.id || null, byName: currentUser?.name || null, at: now,
      }),
    });
  };

  // Enrollment is a distinct lifecycle from Contact Status/Payment — see
  // confirmPaymentRecord below (confirming a deposit/full record
  // auto-triggers "enrolled") and EngagementDetailModal (manual override,
  // e.g. Cancelled).
  //
  // `source` ("payment_confirmation" | "manual") is provenance only — a
  // production investigation found the green "auto-confirmed by payment"
  // caption was shown unconditionally whenever enrollmentStatus === "enrolled",
  // even when a CRM user had set it manually via this same function with no
  // confirmed payment at all. `enrollmentSource` records which path actually
  // set the current value so the UI can tell them apart. Defaults to
  // "manual" since every call site except the automatic payment-confirmation
  // trigger below is a human-initiated UI action.
  const changeEnrollmentStatus = async (id, newEnrollmentStatus, source = "manual") => {
    const engagement = engagementById(id);
    const now = new Date().toISOString();
    await updateDoc(doc(db, "engagements", id), {
      enrollmentStatus: newEnrollmentStatus,
      enrollmentSource: source,
      updatedAt: now,
      timeline: arrayUnion({
        id: genId(), type: "system",
        text: `Enrollment: ${engagement?.enrollmentStatus || "not_enrolled"} → ${newEnrollmentStatus}`,
        byUid: currentUser?.id || null, byName: currentUser?.name || null, at: now,
      }),
    });
  };

  // ── CRM-PRICING-01: sales sets the payment plan (and, for installments,
  // the installment count) after creation — everything else on the snapshot
  // stays frozen. Legacy engagements (no pricingSnapshot) fall back to the
  // old payment.paymentPlan-only behavior, unchanged.
  const setEngagementPricingPlan = async (engagementId, plan) => {
    const engagement = engagementById(engagementId);
    if (!engagement) return;
    const now = new Date().toISOString();
    const patch = { payment: { ...(engagement.payment || {}), paymentPlan: plan }, updatedAt: now };
    if (engagement.pricingSnapshot) {
      const bu = engagement.businessUnitId ? catalogNodeById(engagement.businessUnitId) : null;
      patch.pricingSnapshot = applyPaymentPlan(engagement.pricingSnapshot, plan, bu?.name_en);
    }
    await updateDoc(doc(db, "engagements", engagementId), patch);
  };

  const setEngagementInstallmentCount = async (engagementId, count) => {
    if (![2, 3].includes(Number(count))) throw new Error("INVALID_INSTALLMENT_COUNT");
    const engagement = engagementById(engagementId);
    if (!engagement?.pricingSnapshot) return;
    await updateDoc(doc(db, "engagements", engagementId), {
      pricingSnapshot: { ...engagement.pricingSnapshot, installmentCount: Number(count) },
      updatedAt: new Date().toISOString(),
    });
  };

  // ── CRM-02/CRM-03: Payment Records — the only source of truth for Amount
  // Paid. Flow: pending -> under_review -> confirmed/rejected; never edited
  // in place once created (status changes go through setPaymentRecordStatus).
  const addPaymentRecord = async (engagementId, form) => {
    const now = new Date().toISOString();
    const record = {
      id: genId(),
      engagementId,
      amount: Number(form.amount) || 0,
      paymentMethod: form.paymentMethod || null,
      paymentType: form.paymentType || "installment",
      status: "pending",
      // Optional caller-supplied submission date (same pass-through pattern
      // as addEngagement's studentProfile.registrationDate) — lets the Sales
      // Sheet's payment entry record the date the payment actually happened,
      // not just "now". Defaults to now, unchanged for every existing caller
      // that doesn't pass it (EngagementDetailModal, PaymentVerificationQueue).
      submittedAt: form.submittedAt || now,
      confirmedAt: null,
      confirmedBy: null,
      transactionReference: form.transactionReference || null,
      // Proof/attachment reference (CRM-03) — a free-text reference for now;
      // no Firebase Storage upload exists yet, this just keeps the field ready.
      attachmentRef: form.attachmentRef || null,
      rejectionReason: null,
    };
    await updateDoc(doc(db, "engagements", engagementId), {
      paymentRecords: arrayUnion(record),
      updatedAt: now,
    });
    await logEngagementActivity(engagementId, { type: "system", text: `Payment submitted: ${record.amount} (${record.paymentType})` });
    return record.id;
  };

  // Records live in a plain array (not a subcollection), so changing one
  // record's status means rewriting the whole array — arrayUnion can't
  // patch an element in place.
  const setPaymentRecordStatus = async (engagementId, paymentId, status, { rejectionReason = null } = {}) => {
    const engagement = engagementById(engagementId);
    if (!engagement) return;
    const now = new Date().toISOString();
    let changedRecord = null;
    const records = (engagement.paymentRecords || []).map((r) => {
      if (r.id !== paymentId) return r;
      changedRecord = {
        ...r, status,
        confirmedAt: status === "confirmed" ? now : r.confirmedAt,
        confirmedBy: status === "confirmed" ? (currentUser?.id || null) : r.confirmedBy,
        rejectionReason: status === "rejected" ? (rejectionReason || null) : r.rejectionReason,
      };
      return changedRecord;
    });
    await updateDoc(doc(db, "engagements", engagementId), { paymentRecords: records, updatedAt: now });
    await logEngagementActivity(engagementId, {
      type: "system",
      text: `Payment ${status}${changedRecord ? `: ${changedRecord.amount} (${changedRecord.paymentType})` : ""}${status === "rejected" && rejectionReason ? ` — ${rejectionReason}` : ""}`,
    });

    // Confirming the deposit (or a full payment) is what triggers Enrolled —
    // installments alone don't, since enrollment is assumed to have already
    // happened via the deposit/full payment that came before them. Trigger
    // conditions are unchanged; only the recorded provenance is new.
    if (status === "confirmed" && changedRecord && (changedRecord.paymentType === "deposit" || changedRecord.paymentType === "full") && engagement.enrollmentStatus !== "enrolled") {
      await changeEnrollmentStatus(engagementId, "enrolled", "payment_confirmation");
    }

    // CRM-04: a payment becoming confirmed — and only that — is what hands
    // it off to the future Accounting system, via an outbox record. This
    // never touches Amount Paid or any confirmation logic above; it's a
    // side effect of confirmation, not part of it. Unchanged by
    // ACCOUNTING-03A — the two integrations below run independently, this
    // outbox is never read from or written to as part of the new hook.
    if (status === "confirmed" && changedRecord) {
      await emitAccountingEvent(engagement, changedRecord);
    }

    // ACCOUNTING-03A: the actual CRM -> Accounting integration — exactly one
    // Accounting Income Transaction per confirmed PaymentRecord. Runs after
    // the confirmation write above has already succeeded (rule 11). A
    // failure here must never be mistaken for "confirmation failed" and
    // must never undo the already-confirmed payment (rule 12) — caught and
    // logged here, not rethrown, so the caller's success path is untouched.
    // Safe to retry: createAccountingIncomeFromPayment is idempotent by
    // construction (doc id = paymentId, existence-checked before writing),
    // so calling it again after a failed attempt can only ever create the
    // one transaction, never a duplicate.
    if (status === "confirmed" && changedRecord) {
      try {
        await createAccountingIncomeFromPayment(engagement, changedRecord);
      } catch (err) {
        console.error("[ACCOUNTING-03A] Failed to create Accounting income transaction for confirmed payment — payment stays confirmed, retry is safe.", { engagementId, paymentId, error: err });
      }
    }
  };

  // Idempotent by construction: the document ID is the paymentId itself
  // (not the generated eventId), so writing this twice for the same
  // payment can only ever touch one document, never create a second one.
  // The existence check below additionally makes it "create once" — a
  // stray re-confirmation can't reset a dispatcher-managed sent/failed
  // status back to pending.
  const emitAccountingEvent = async (engagement, record) => {
    const ref = doc(db, ACCOUNTING_EVENTS_COLLECTION, record.id);
    const existing = await getDoc(ref);
    if (existing.exists()) return;
    await setDoc(ref, buildConfirmedPaymentEvent({ eventId: genId(), record, engagement }));
  };

  // ACCOUNTING-03A — CRM Payment -> Accounting Income integration.
  // Deliberately independent of accountingEvents/emitAccountingEvent above
  // (not consumed as a data source, not touched). Draft-building is in
  // utils/accounting.buildIncomeDraftFromConfirmedPayment (pure, testable,
  // holds the payment-method -> account mapping and the "amount is always
  // this one record's amount" rule); this function is just the idempotent
  // Firestore write — same "doc id = source id" pattern emitAccountingEvent
  // already uses for accountingEvents, applied here to accountingTransactions
  // with the PaymentRecord's own id.
  const createAccountingIncomeFromPayment = async (engagement, record) => {
    const ref = doc(db, ACCOUNTING_TRANSACTIONS_COLLECTION, record.id);
    const existing = await getDoc(ref);
    if (existing.exists()) return;
    // buildTransaction runs the real ACCOUNTING-01 validateTransaction and
    // throws on anything invalid (e.g. INVALID_ACCOUNT for an unmapped
    // paymentMethod) — never writes a malformed transaction.
    await setDoc(ref, buildTransaction(buildIncomeDraftFromConfirmedPayment(engagement, record), { currentUser }));
  };

  // pending -> under_review: marks that someone has actually started looking
  // at this payment, distinct from just sitting in the inbox untouched.
  const startPaymentReview = (engagementId, paymentId) => setPaymentRecordStatus(engagementId, paymentId, "under_review");

  // CRM-03: refuses to confirm over a "blocking" duplicate — another record
  // ALREADY confirmed with the same transactionReference/proof somewhere in
  // the system. Anything less certain (another pending/under_review record,
  // or a same-engagement lookalike) is a warning the UI must show, not a
  // hard stop, since it could be a legitimate concurrent submission.
  const confirmPaymentRecord = (engagementId, paymentId) => {
    const engagement = engagementById(engagementId);
    const record = (engagement?.paymentRecords || []).find((r) => r.id === paymentId);
    if (record && engagement) {
      const conflicts = findPaymentConflicts(record, engagement, engagements);
      if (hasBlockingConflict(conflicts)) {
        throw new Error("DUPLICATE_PAYMENT_CONFLICT");
      }
    }
    return setPaymentRecordStatus(engagementId, paymentId, "confirmed");
  };
  const rejectPaymentRecord = (engagementId, paymentId, rejectionReason) =>
    setPaymentRecordStatus(engagementId, paymentId, "rejected", { rejectionReason });

  // One-time, explicitly admin-triggered write that turns an engagement's
  // synthesized legacy amounts (see utils/paymentRecords.effectivePaymentRecords)
  // into real Payment Records. Never runs automatically — old data is safe
  // and keeps reading correctly through the shim either way.
  const migrateLegacyPayments = async (engagementId) => {
    const engagement = engagementById(engagementId);
    if (!engagement || (engagement.paymentRecords || []).length > 0) return;
    const legacy = effectivePaymentRecords(engagement);
    if (legacy.length === 0) return;
    const now = new Date().toISOString();
    const records = legacy.map(({ legacy: _legacy, id: _id, ...r }) => ({ ...r, id: genId() }));
    await updateDoc(doc(db, "engagements", engagementId), { paymentRecords: records, updatedAt: now });
    await logEngagementActivity(engagementId, { type: "system", text: `Migrated ${records.length} legacy payment field(s) to Payment Records` });
    // A migrated record that was already (legacy-)confirmed is still a
    // confirmed payment — it should reach Accounting same as any other.
    for (const r of records) {
      if (r.status === "confirmed") await emitAccountingEvent(engagement, r);
    }
  };

  const logEngagementActivity = async (id, { type = "note", text = "" }) => {
    const now = new Date().toISOString();
    await updateDoc(doc(db, "engagements", id), {
      updatedAt: now,
      timeline: arrayUnion({
        id: genId(), type, text,
        byUid: currentUser?.id || null, byName: currentUser?.name || null, at: now,
      }),
    });
  };

  const archiveEngagement = async (id) => {
    await updateDoc(doc(db, "engagements", id), { archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };
  const restoreEngagement = async (id) => {
    await updateDoc(doc(db, "engagements", id), { archivedAt: null, updatedAt: new Date().toISOString() });
  };

  return (
    <CustomerCtx.Provider value={{
      customers, engagements, loading,
      findCustomerByPhone, findCustomerByEmail, customerById,
      addCustomer, resolveOrCreateCustomer, updateCustomer, archiveCustomer, restoreCustomer, deleteCustomerCascade,
      findEngagement, engagementById, engagementsForCustomer, engagementsForBusinessUnit,
      addEngagement, mergeStudentProfile, resolveOrCreateEngagement, updateEngagement,
      changeEngagementStatus, changeEnrollmentStatus, logEngagementActivity, archiveEngagement, restoreEngagement,
      setEngagementPricingPlan, setEngagementInstallmentCount,
      addPaymentRecord, setPaymentRecordStatus, startPaymentReview, confirmPaymentRecord, rejectPaymentRecord, migrateLegacyPayments,
    }}>
      {children}
    </CustomerCtx.Provider>
  );
}

export const useCustomers = () => useContext(CustomerCtx);
