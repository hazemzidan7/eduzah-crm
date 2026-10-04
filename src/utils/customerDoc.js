import { normalizePhone, normalizeEmail } from "./leadDedupe";
import { normalizeWhatsappUsername } from "./whatsappContact";

/**
 * The one place a NEW `customers/{id}` document's shape is defined — used by
 * CustomerContext.addCustomer (single create) and by the bulk lead import
 * (batched creates), so the two can never drift apart.
 *
 * Identity only: no engagement, payment, or accounting data ever lives here.
 * `fullName` may be an empty string — a customer is identified by phone, and
 * the name is optional (an empty name is the schema's own safe "unknown", so
 * nothing ever invents a placeholder person name).
 */
export function buildCustomerDoc(form, { now = new Date().toISOString(), interestedProgramIds = [] } = {}) {
  return {
    fullName: form.fullName || "",
    phone: form.phone || "",
    normalizedPhone: normalizePhone(form.phone),
    secondaryPhones: form.secondaryPhones || [],
    email: form.email || "",
    normalizedEmail: form.email ? normalizeEmail(form.email) : null,
    whatsapp: form.whatsapp || "",
    interestedProgramIds,
    // The customer-level notes field (edited in "عملاء جدد"). Written only when there is one, so every existing
    // caller keeps producing exactly the document it did before.
    ...(form.notes ? { notes: form.notes } : {}),
    // WHATSAPP-USERNAME-01: optional, its own field next to `phone` (never merged into it). Written only when there
    // is one, in its normalized form, so every customer without a username keeps exactly the document it always had.
    ...(normalizeWhatsappUsername(form.whatsappUsername) ? { whatsappUsername: normalizeWhatsappUsername(form.whatsappUsername) } : {}),
    authUid: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
