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
 *
 * SALES-PRICE-01: `originalPrice` is the ONE exception — the actual,
 * individually-agreed Course Price for THIS student, editable any time via
 * CustomerContext.setEngagementCoursePrice. It starts as a copy of the
 * catalog price at creation (so nothing needs to be typed for the common
 * case) but from then on belongs to the Engagement, not the Catalog: two
 * engagements against the same Program are free to end up with different
 * prices, and editing one never touches catalogNodes or any other
 * engagement. `depositAmount` still starts from the flat Business-Unit rule
 * (applicableDeposit) and is not re-derived from `originalPrice` — a custom
 * price does not silently change what's due at booking.
 *
 * SALES-PRICE-02: `effectiveCoursePrice()` is the ONLY authoritative Course
 * Price and is now completely independent of `paymentPlan` — it always
 * reads `originalPrice`, whether the plan is "full" (Cash) or
 * "installments". `fullPaymentPrice` is no longer read for this; it stays
 * on the snapshot only as a courtesy default for AddPaymentModal's "full
 * payment" record type (see there) and is kept mirrored to `originalPrice`
 * by setEngagementCoursePrice — never independently discounted, since a
 * manually-agreed price is already final, not a catalog list price a
 * "pay-in-full" promotion could apply to. Switching Cash <-> Installments
 * (or setting the installment count) must NEVER change what this function
 * returns for a given engagement — see CustomerContext.setEngagementPricingPlan
 * / setEngagementInstallmentCount, neither of which touches originalPrice.
 */

export const PRICING_CURRENCY = "EGP";
export const FULL_PAYMENT_DISCOUNT = 300;
export const TECHNOLOGY_DEPOSIT = 1000;
export const DEFAULT_DEPOSIT = 500;
// SALES-PRICE-01: sanity ceiling for a per-engagement agreed Course Price —
// not a business rule, just a guard against a typo (e.g. an extra zero)
// getting saved as a real price. Comfortably above any real catalog price.
export const MAX_COURSE_PRICE = 1000000;

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
 * losing the original applicable-deposit figure. Only ever touches
 * `paymentPlan`/`depositAmount`/`installmentCount` — `originalPrice`
 * (the Course Price) is never read or written here, by design
 * (SALES-PRICE-02): `depositAmount` for the "full" plan reads
 * `snapshot.originalPrice` directly (the current, authoritative price),
 * not `fullPaymentPrice` — so "amount due now" is always correct even for
 * an engagement whose `fullPaymentPrice` predates a later manual price
 * edit.
 */
export function applyPaymentPlan(snapshot, plan, businessUnitNameEn) {
  if (!snapshot) return snapshot;
  if (plan === "full") {
    return { ...snapshot, paymentPlan: "full", depositAmount: snapshot.originalPrice, installmentCount: 0 };
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
 *
 * SALES-PRICE-02: deliberately NOT branching on `paymentPlan` anymore —
 * `originalPrice` is the one manually-agreed Course Price regardless of
 * Cash vs. Installments. (It used to return `fullPaymentPrice`, a
 * discounted figure, whenever `paymentPlan === "full"` — that made the
 * displayed price change just from switching the plan, which is exactly
 * the bug this fixes.)
 */
export function effectiveCoursePrice(engagement) {
  const snap = engagement?.pricingSnapshot;
  if (snap) return snap.originalPrice;
  const legacy = engagement?.payment?.coursePrice;
  return typeof legacy === "number" ? legacy : null;
}
