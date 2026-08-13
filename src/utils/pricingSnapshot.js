/**
 * CRM-PRICING-01 — Enrollment Pricing Snapshot.
 *
 * When an Engagement is created, a snapshot of the Program's catalog
 * pricing (CRM-CATALOG-01's catalogNodes.originalPrice/priceUnit) is copied
 * onto the Engagement once and never re-derived from live Catalog data
 * again — editing a Program's price later must not change what an already-
 * enrolled student owes. `paymentPlan` and `installmentCount` are the two
 * fields sales sets *after* creation (see applyPaymentPlan /
 * CustomerContext.setEngagementInstallmentCount) — everything else here is
 * permanently fixed from the moment of creation.
 */

export const PRICING_CURRENCY = "EGP";
export const FULL_PAYMENT_DISCOUNT = 300;
export const TECHNOLOGY_DEPOSIT = 1000;
export const DEFAULT_DEPOSIT = 500;

export function computeFullPaymentPrice(originalPrice) {
  return typeof originalPrice === "number" ? originalPrice - FULL_PAYMENT_DISCOUNT : null;
}

// Rules 4/5: a flat, explicit rule by Business Unit — deliberately NOT read
// from catalogNodes.depositAmount, so this doesn't depend on whether
// CRM-CATALOG-01's catalog pricing has been applied to a given Program yet.
export function applicableDeposit(businessUnitNameEn) {
  return businessUnitNameEn === "Technology" ? TECHNOLOGY_DEPOSIT : DEFAULT_DEPOSIT;
}

/** Built once, at Engagement creation — see CustomerContext.addEngagement. */
export function buildPricingSnapshot({ program, businessUnit }) {
  const originalPrice = typeof program?.originalPrice === "number" ? program.originalPrice : null;
  return {
    originalPrice,
    fullPaymentPrice: computeFullPaymentPrice(originalPrice),
    paymentPlan: null, // "full" | "installments" — chosen later by sales
    depositAmount: applicableDeposit(businessUnit?.name_en),
    installmentCount: null, // null on initial registration (rule 7)
    currency: PRICING_CURRENCY,
    priceUnit: program?.priceUnit || "program",
  };
}

/**
 * Rules 6/7 — what changes when sales sets (or changes) the payment plan.
 * `businessUnitNameEn` is looked up fresh each call (not stored on the
 * snapshot) so switching plans back and forth is always reversible without
 * losing the original applicable-deposit figure.
 */
export function applyPaymentPlan(snapshot, plan, businessUnitNameEn) {
  if (!snapshot) return snapshot;
  if (plan === "full") {
    return { ...snapshot, paymentPlan: "full", depositAmount: snapshot.fullPaymentPrice, installmentCount: 0 };
  }
  if (plan === "installments") {
    return { ...snapshot, paymentPlan: "installments", depositAmount: applicableDeposit(businessUnitNameEn), installmentCount: null };
  }
  return { ...snapshot, paymentPlan: plan || null };
}

/**
 * Rule 8 — Amount Paid / Remaining must read the frozen snapshot, not live
 * Catalog pricing. Falls back to the legacy `payment.coursePrice` for
 * engagements created before this feature shipped (no snapshot), so those
 * keep working exactly as before (rule 9/10).
 */
export function effectiveCoursePrice(engagement) {
  const snap = engagement?.pricingSnapshot;
  if (snap) {
    if (snap.paymentPlan === "full") return snap.fullPaymentPrice;
    return snap.originalPrice; // installments, or no plan chosen yet
  }
  const legacy = engagement?.payment?.coursePrice;
  return typeof legacy === "number" ? legacy : null;
}
