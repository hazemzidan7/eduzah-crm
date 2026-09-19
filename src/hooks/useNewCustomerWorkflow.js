import { useCustomers } from "../context/CustomerContext";
import { useLeadStatus } from "../context/LeadStatusContext";
import { useCatalog } from "../context/CatalogContext";
import { useAuth } from "../context/AuthContext";
import {
  workflowStatusOptions, contactStatusKey, validateContactOutcome, buildContactPatch,
  buildCustomerEditPatch, runRegistration,
} from "../utils/newCustomerWorkflow";

/** Error carrying the machine-readable codes the modals translate into messages. */
const failWith = (codes) => Object.assign(new Error(codes.map((c) => c.code || c).join(", ")), { codes });

/**
 * NEW-CUSTOMER-WORKFLOW-01 — wires the pure "عملاء جدد" Sales workflow
 * (utils/newCustomerWorkflow.js) to the real contexts. Nothing here talks to
 * Firestore directly: customer patches go through CustomerContext.patchCustomer,
 * the registration through CustomerContext's Engagement builder + transactional
 * create, follow-ups through the existing FollowUpFormModal/FollowUpContext.
 */
export function useNewCustomerWorkflow() {
  const { currentUser } = useAuth();
  const { customers, patchCustomer, listCustomerEngagements, buildEngagementDoc, createEngagementIfAbsent } = useCustomers();
  const { globalStatuses, statusById } = useLeadStatus();
  const { nodeById } = useCatalog();

  const statusOptions = workflowStatusOptions(globalStatuses);
  const statusKeyOf = (customer) => contactStatusKey(customer, statusById);
  const currentStatusOf = (customer) => (customer?.contactStatusId ? statusById(customer.contactStatusId) : null) || globalStatuses.find((s) => s.key === "not_contacted") || null;

  /** "تعديل": name (optional), phone, interested Programs, notes, and (admin only) the assigned employee. */
  const saveCustomerEdits = async (customer, edits) => {
    const { patch, errors, changed } = buildCustomerEditPatch({
      customer, edits, otherCustomers: customers, nodeById,
      canAssign: currentUser?.role === "admin",
    });
    if (errors.length > 0) throw failWith(errors);
    if (changed) await patchCustomer(customer.id, patch);
    return { changed };
  };

  /** "تسجيل متابعة": records the contact outcome on the customer. Never creates an Engagement, whatever the status. */
  const recordContactOutcome = async (customer, { statusKey, plannedProgramId, note }) => {
    const statusDoc = statusOptions.find((o) => o.key === statusKey)?.status || null;
    const errors = validateContactOutcome({ statusKey, statusDoc, plannedProgramId, nodeById });
    if (errors.length > 0) throw failWith(errors);
    await patchCustomer(customer.id, buildContactPatch({ statusDoc, statusKey, plannedProgramId, note, customer, currentUser }));
  };

  /** "تسجيل العميل": creates the ONE normal Engagement for the chosen Program (safe against double submit). */
  const registerCustomer = (customer, { programId, name, attendanceType, registrationDate }) =>
    runRegistration({
      customer, programId, name, attendanceType, registrationDate, currentUser, nodeById, activeGlobalStatuses: globalStatuses,
      listCustomerEngagements, buildEngagementDoc, createEngagementIfAbsent, patchCustomer,
    });

  return { statusOptions, statusKeyOf, currentStatusOf, saveCustomerEdits, recordContactOutcome, registerCustomer };
}
