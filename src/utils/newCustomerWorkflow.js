/**
 * NEW-CUSTOMER-WORKFLOW-01 — the Sales workflow inside "عملاء جدد":
 *
 *   New Customer -> Sales contacts them -> records the outcome ->
 *   (if they will register) picks the ACTUAL Program -> a normal Engagement is
 *   created and the customer leaves "عملاء جدد".
 *
 * Pure module (no React, no Firestore): every rule lives here so it can be
 * tested; hooks/useNewCustomerWorkflow.js wires it to the contexts. There is
 * deliberately NO parallel lead system — this only reads/writes the existing
 * `customers`, `leadStatuses`, `engagements`, `catalogNodes` and `followUps`.
 *
 * WHERE THINGS LIVE
 *  - Contact status:   customers/{id}.contactStatusId  -> a leadStatuses doc id
 *                      (engagements keep their own `statusId`; a customer who
 *                      has no engagement yet had nowhere to hold one).
 *  - Planned Program:  customers/{id}.plannedProgramId -> catalog Program id.
 *                      Intent only ("هيحجز"); it becomes the engagement's
 *                      catalogNodeId at registration and is then cleared.
 *  - Interests:        customers/{id}.interestedProgramIds (unchanged). An
 *                      interest is NEVER a registration and is never removed
 *                      or altered by registering.
 *  - Real registration: an Engagement, built by the same builder as Add Student.
 *  - Leaving the list: the list is "customers with no active Engagement", so
 *                      the customer leaves the moment the Engagement exists.
 */
import { normalizePhone } from "./leadDedupe";
import { cleanWhitespace } from "./importEngine/dataCleaning";
import { normalizeImportPhone } from "./leadImport";
import { normalizeInterestedProgramIds, validateInterestedProgramIds } from "./interestedPrograms";

// ───────────────────────── contact statuses ─────────────────────────

/** The outcomes Sales can record, in workflow order, mapped onto EXISTING lead statuses by `key` (see LeadStatusContext's seed). */
export const WORKFLOW_STATUS_KEYS = ["not_contacted", "no_answer", "thinking", "interested", "not_interested", "will_book", "booked"];

/**
 * The two outcomes the seeded lead statuses did not have. Everything else in
 * WORKFLOW_STATUS_KEYS already exists and is reused as-is:
 *   لم يتم التواصل = not_contacted   لم يرد = no_answer (لا يرد)   هيفكر = thinking (بيفكر)
 *   مش مهتم = not_interested (غير مهتم)   حجز بالفعل = booked (تم الحجز)
 */
export const NEW_CUSTOMER_REQUIRED_STATUSES = [
  { key: "interested", name_ar: "مهتم", name_en: "Interested", color: "#7c3aed", order: 7 },
  { key: "will_book", name_ar: "هيحجز", name_en: "Will Book", color: "#16a34a", order: 8 },
];

/** Outcomes after which a follow-up makes sense. */
export const FOLLOW_UP_STATUS_KEYS = ["no_answer", "thinking", "interested"];
/** Outcome that must name the ACTUAL Program the customer will register in. */
export const PROGRAM_REQUIRED_STATUS_KEY = "will_book";
/** Outcome that only ever results from a real registration (it can't be set on a customer without an Engagement). */
export const REGISTERED_STATUS_KEY = "booked";
/** Where the "تسجيل العميل" action is offered. */
export const REGISTRATION_STATUS_KEYS = ["will_book", "booked"];

/** Options for the status picker: each workflow outcome with the matching ACTIVE status doc (or null when it doesn't exist yet). */
export function workflowStatusOptions(activeGlobalStatuses) {
  const byKey = new Map((activeGlobalStatuses || []).map((s) => [s.key, s]));
  return WORKFLOW_STATUS_KEYS.map((key) => ({ key, status: byKey.get(key) || null }));
}

/** The workflow key of a customer's current contact status; a customer with none recorded is "not_contacted" (display default — nothing is written for it). */
export function contactStatusKey(customer, statusById) {
  const s = customer?.contactStatusId ? statusById?.(customer.contactStatusId) : null;
  return s?.key || "not_contacted";
}

const isActiveProgram = (n) => !!n && n.type === "program" && n.isActive !== false && !n.archivedAt;
export const isActiveProgramNode = isActiveProgram;

/** Business Unit of a Program (catalog nodes carry their ancestors in `path`, Business Unit first). */
export function businessUnitIdOfProgram(program, nodeById) {
  if (!program) return null;
  if (Array.isArray(program.path) && program.path.length > 0) return program.path[0];
  let node = program;
  for (let i = 0; i < 10 && node; i++) {
    if (node.type === "business_unit") return node.id;
    node = node.parentId ? nodeById?.(node.parentId) : null;
  }
  return null;
}

/**
 * Validates recording an outcome. Returns error codes (empty = valid):
 *  STATUS_REQUIRED     no status chosen / the status doc doesn't exist yet
 *  PROGRAM_REQUIRED    "هيحجز" without the actual Program
 *  PROGRAM_INVALID     the Program isn't an existing ACTIVE catalog Program (no free text, no fake ids)
 *  USE_REGISTRATION    "حجز بالفعل" can only come from registering the customer in a Program
 */
export function validateContactOutcome({ statusKey, statusDoc, plannedProgramId, nodeById }) {
  const errors = [];
  if (!statusKey || !statusDoc) { errors.push("STATUS_REQUIRED"); return errors; }
  if (statusKey === REGISTERED_STATUS_KEY) errors.push("USE_REGISTRATION");
  if (statusKey === PROGRAM_REQUIRED_STATUS_KEY) {
    if (!plannedProgramId) errors.push("PROGRAM_REQUIRED");
    else if (!isActiveProgram(nodeById?.(plannedProgramId))) errors.push("PROGRAM_INVALID");
  }
  return errors;
}

const stamp = (iso) => String(iso || "").slice(0, 10);

/**
 * The customer patch for a recorded outcome. Touches only lead-workflow
 * fields — never `interestedProgramIds`, never an engagement. The planned
 * Program is kept only while the status is "هيحجز" (any other outcome clears
 * it so it can't go stale). An unassigned customer is claimed by the Sales
 * user who records the contact.
 */
export function buildContactPatch({ statusDoc, statusKey, plannedProgramId, note, customer, currentUser, now = new Date().toISOString() }) {
  const patch = {
    contactStatusId: statusDoc.id,
    contactStatusUpdatedAt: now,
    contactStatusUpdatedBy: currentUser?.id || null,
    plannedProgramId: statusKey === PROGRAM_REQUIRED_STATUS_KEY ? (plannedProgramId || null) : null,
    updatedAt: now,
  };
  const text = cleanWhitespace(note);
  if (text) {
    const line = `[${stamp(now)}${currentUser?.name ? ` · ${currentUser.name}` : ""}] ${text}`;
    patch.notes = customer?.notes ? `${customer.notes}\n${line}` : line;
  }
  if (!customer?.assignedToId && currentUser?.role === "sales" && currentUser?.id) {
    patch.assignedToId = currentUser.id;
    patch.assignedToName = currentUser.name || currentUser.email || null;
  }
  return patch;
}

// ───────────────────────── editing a customer ─────────────────────────

/** The complete set of customer fields the workflow ever writes — this must stay inside firestore.rules' Sales allow-list for /customers. */
export const WORKFLOW_CUSTOMER_FIELDS = [
  "fullName", "phone", "normalizedPhone", "notes", "interestedProgramIds",
  "contactStatusId", "contactStatusUpdatedAt", "contactStatusUpdatedBy", "plannedProgramId",
  "assignedToId", "assignedToName", "updatedAt",
];

/**
 * Builds the patch for the "تعديل" form. The NAME IS OPTIONAL — it may be
 * empty when the phone is all Sales has, and can be filled in (or corrected)
 * any time; only the PHONE can never be emptied. A changed phone is validated
 * like the import (any country) and may not belong to a different customer.
 * Interest changes follow validateInterestedProgramIds (ids already stored are
 * kept; NEW ids must be active catalog Programs).
 * Returns { patch, errors, changed }.
 */
export function buildCustomerEditPatch({ customer, edits, otherCustomers = [], nodeById, canAssign = false, now = new Date().toISOString() }) {
  const errors = [];
  const patch = {};

  if (edits.fullName !== undefined) {
    const next = cleanWhitespace(edits.fullName);
    if (next !== (customer.fullName || "")) patch.fullName = next;
  }

  if (edits.phone !== undefined && cleanWhitespace(edits.phone) !== cleanWhitespace(customer.phone)) {
    const raw = cleanWhitespace(edits.phone);
    if (!raw) errors.push({ code: "PHONE_REQUIRED" });
    else {
      const n = normalizeImportPhone(raw);
      if (!n.valid) errors.push({ code: "PHONE_INVALID", why: n.why });
      else {
        const clash = otherCustomers.find((c) => c.id !== customer.id && (c.normalizedPhone === n.normalized || (c.secondaryPhones || []).some((p) => normalizePhone(p) === n.normalized)));
        if (clash) errors.push({ code: "PHONE_DUPLICATE", customerId: clash.id });
        else if (n.display !== customer.phone) { patch.phone = n.display; patch.normalizedPhone = normalizePhone(n.display); }
      }
    }
  }

  if (edits.notes !== undefined && (edits.notes || "") !== (customer.notes || "")) patch.notes = edits.notes || "";

  if (edits.interestedProgramIds !== undefined) {
    const next = normalizeInterestedProgramIds(edits.interestedProgramIds);
    const current = normalizeInterestedProgramIds(customer.interestedProgramIds);
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      const { invalid } = validateInterestedProgramIds(next, { existingIds: current, nodeById });
      if (invalid.length > 0) errors.push({ code: "INVALID_INTERESTED_PROGRAMS", ids: invalid });
      else patch.interestedProgramIds = next;
    }
  }

  if (canAssign && edits.assignedToId !== undefined && (edits.assignedToId || null) !== (customer.assignedToId || null)) {
    patch.assignedToId = edits.assignedToId || null;
    patch.assignedToName = edits.assignedToId ? (edits.assignedToName || null) : null;
  }

  const changed = Object.keys(patch).length > 0;
  if (changed) patch.updatedAt = now;
  return { patch, errors, changed };
}

// ───────────────────────── who is a "new customer" ─────────────────────────

/**
 * The "عملاء جدد" list: customers that are not archived and have no ACTIVE
 * Engagement. Registering creates an Engagement, so the customer drops out of
 * this list on its own — nothing is deleted or archived.
 */
export function selectNewCustomers(customers, engagements, { search = "" } = {}) {
  const registered = new Set((engagements || []).filter((e) => !e.archivedAt).map((e) => e.customerId));
  const q = String(search || "").trim().toLowerCase();
  return (customers || [])
    .filter((c) => !c.archivedAt && !registered.has(c.id))
    .filter((c) => !q || (c.fullName || "").toLowerCase().includes(q) || (c.phone || "").includes(q) || (c.email || "").toLowerCase().includes(q))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

// ───────────────────────── registration ─────────────────────────

/**
 * One customer + one Program = one engagement id. Creating it inside a
 * Firestore transaction that first checks the document doesn't exist makes a
 * double-click, a retry, or two tabs racing all resolve to the SAME single
 * engagement.
 */
export const registrationEngagementId = (customerId, programId) => `reg_${customerId}_${programId}`;

/** The engagement form for a registration — same shape Add Student passes to addEngagement (statusId, studentProfile, creationNote), plus the sales context we already know. */
export function buildRegistrationForm({ customer, program, businessUnitId, bookedStatusId, defaultStatusId, attendanceType = "", registrationDate = null, currentUser }) {
  return {
    businessUnitId,
    catalogNodeId: program.id,
    // Confirming the registration IS the "حجز بالفعل" outcome. Falls back to the default status if that status isn't there.
    statusId: bookedStatusId || defaultStatusId || null,
    studentProfile: { attendanceType, registrationDate: registrationDate || null },
    // Whoever owns the lead owns the registration; notes taken before registering carry over to the Sales Sheet.
    ownerId: customer.assignedToId || (currentUser?.role === "sales" ? currentUser.id : null) || null,
    salesNotes: customer.notes || "",
    creationNote: "Registered from New Customers",
  };
}

/**
 * Registers an existing customer in ONE existing active Program by creating
 * the normal Engagement. The Firestore touch points are injected so the
 * whole flow — including the double-submit guarantee — is testable:
 *   listCustomerEngagements(customerId) -> live engagements of that customer
 *   buildEngagementDoc(customerId, form) -> the SAME builder addEngagement uses
 *   createEngagementIfAbsent(id, doc)     -> transactional create-if-missing; resolves true only for the caller that created it
 *   patchCustomer(customerId, patch)
 * It never creates a customer, never edits/removes `interestedProgramIds`,
 * and never creates payments or accounting records (an Engagement starts with
 * no payment records, exactly like Add Student).
 *
 * Returns { status: "registered" | "already_registered", engagementId, archivedExisting?, customerPatchError? }.
 * Throws Error(code): CUSTOMER_NOT_FOUND, CUSTOMER_ARCHIVED, PROGRAM_REQUIRED, PROGRAM_INVALID.
 */
export async function runRegistration({
  customer, programId, name, attendanceType, registrationDate, currentUser, nodeById, activeGlobalStatuses = [],
  listCustomerEngagements, buildEngagementDoc, createEngagementIfAbsent, patchCustomer, now = new Date().toISOString(),
}) {
  if (!customer?.id) throw new Error("CUSTOMER_NOT_FOUND");
  if (customer.archivedAt) throw new Error("CUSTOMER_ARCHIVED");
  if (!programId) throw new Error("PROGRAM_REQUIRED");
  const program = nodeById?.(programId);
  if (!isActiveProgram(program)) throw new Error("PROGRAM_INVALID");
  const businessUnitId = businessUnitIdOfProgram(program, nodeById);
  if (!businessUnitId) throw new Error("PROGRAM_INVALID");

  // Same duplicate rule as Add Student: one relationship per customer + Program.
  const existing = (await listCustomerEngagements(customer.id)).find((e) => e.catalogNodeId === programId);
  if (existing) return { status: "already_registered", engagementId: existing.id, archivedExisting: !!existing.archivedAt };

  const byKey = new Map(activeGlobalStatuses.map((s) => [s.key, s]));
  const form = buildRegistrationForm({
    customer, program, businessUnitId, currentUser, attendanceType, registrationDate,
    bookedStatusId: byKey.get(REGISTERED_STATUS_KEY)?.id,
    defaultStatusId: activeGlobalStatuses.find((s) => s.isDefault)?.id,
  });
  const id = registrationEngagementId(customer.id, programId);
  const created = await createEngagementIfAbsent(id, buildEngagementDoc(customer.id, form));
  if (!created) return { status: "already_registered", engagementId: id };

  // The engagement exists — that alone moves the customer out of "عملاء جدد". Bring the customer record in line (status, name); a failure here must not undo or hide the registration.
  const patch = { contactStatusUpdatedAt: now, contactStatusUpdatedBy: currentUser?.id || null, plannedProgramId: null, updatedAt: now };
  if (form.statusId && byKey.get(REGISTERED_STATUS_KEY)) patch.contactStatusId = byKey.get(REGISTERED_STATUS_KEY).id;
  const cleanName = name === undefined ? undefined : cleanWhitespace(name);
  if (cleanName !== undefined && cleanName !== (customer.fullName || "") && cleanName) patch.fullName = cleanName; // never blanks an existing name
  if (!customer.assignedToId && form.ownerId && currentUser?.role === "sales") { patch.assignedToId = currentUser.id; patch.assignedToName = currentUser.name || currentUser.email || null; }
  try { await patchCustomer(customer.id, patch); } catch (e) { return { status: "registered", engagementId: id, customerPatchError: e?.message || String(e) }; }
  return { status: "registered", engagementId: id };
}
