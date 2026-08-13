import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { normalizePhone, normalizeEmail } from "./lib/normalize.js";
import { GOVERNORATE_CODES } from "./lib/governorates.js";

initializeApp();
const db = getFirestore();

const REGION = "us-central1";

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function validationError(res, fieldErrors) {
  sendJson(res, 400, {
    success: false,
    code: "VALIDATION_ERROR",
    message: "One or more fields are invalid.",
    fieldErrors,
  });
}

/**
 * LEADS-01/02: public entry point from the Landing Pages. CRM Firestore
 * stays admin-only (see firestore.rules) — this function writes with the
 * Admin SDK, which bypasses those rules by design. Flow: validate -> resolve
 * Program by slug -> resolve/create Customer (phone, then email) ->
 * resolve/merge Engagement -> resolve authoritative price server-side ->
 * store tracking -> return ids.
 */
export const submitLandingLead = onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    if (req.method !== "POST") {
      return sendJson(res, 405, { success: false, code: "METHOD_NOT_ALLOWED", message: "Use POST." });
    }

    const body = req.body || {};
    const fieldErrors = {};

    const programSlug = typeof body.programSlug === "string" ? body.programSlug.trim() : "";
    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
    const attendanceType = body.attendanceType;
    const governorate = body.governorate;
    const paymentPlan = body.paymentPlan;
    const tracking = body.tracking && typeof body.tracking === "object" ? body.tracking : {};
    const submissionId = typeof body.submissionId === "string" && body.submissionId.trim()
      ? body.submissionId.trim()
      : null;

    if (!programSlug) fieldErrors.programSlug = "required";
    if (!fullName) fieldErrors.fullName = "required";
    if (!phone) fieldErrors.phone = "required";
    if (!normalizePhone(phone)) fieldErrors.phone = "invalid";
    if (attendanceType !== "online" && attendanceType !== "offline") fieldErrors.attendanceType = "must be 'online' or 'offline'";
    if (!governorate || !GOVERNORATE_CODES.has(governorate)) fieldErrors.governorate = "must be a known governorate code";
    if (paymentPlan !== "full" && paymentPlan !== "installments") fieldErrors.paymentPlan = "must be 'full' or 'installments'";

    if (Object.keys(fieldErrors).length > 0) {
      return validationError(res, fieldErrors);
    }

    try {
      // ── Idempotency: a resubmission carrying the same submissionId (double
      // click, network retry) must never create/merge a second time. ──
      if (submissionId) {
        const existingBySubmission = await db
          .collection("engagements")
          .where("sourceLandingSubmissionId", "==", submissionId)
          .limit(1)
          .get();
        if (!existingBySubmission.empty) {
          const doc = existingBySubmission.docs[0];
          return sendJson(res, 200, {
            success: true,
            customerId: doc.data().customerId,
            engagementId: doc.id,
            isNewCustomer: false,
            isNewEngagement: false,
          });
        }
      }

      // ── Resolve Program by slug (single-field query — no composite index
      // needed; slug is unique across the whole catalogNodes collection). ──
      const programSnap = await db
        .collection("catalogNodes")
        .where("slug", "==", programSlug)
        .limit(1)
        .get();
      if (programSnap.empty || programSnap.docs[0].data().type !== "program") {
        return sendJson(res, 404, {
          success: false,
          code: "PROGRAM_NOT_FOUND",
          message: `No Program found for slug "${programSlug}".`,
        });
      }
      const programDoc = programSnap.docs[0];
      const program = programDoc.data();
      const catalogNodeId = programDoc.id;
      const businessUnitId = Array.isArray(program.path) && program.path.length > 0 ? program.path[0] : null;
      const pricing = program.pricing || null;
      const coursePrice = pricing && typeof pricing.fullPrice === "number" ? pricing.fullPrice : null;

      const now = new Date().toISOString();

      // ── Resolve Customer: normalized phone first, then email. ──
      const normalizedPhone = normalizePhone(phone);
      const normalizedEmail = email ? normalizeEmail(email) : null;

      let customerId = null;
      let isNewCustomer = false;

      const byPhone = await db.collection("customers").where("normalizedPhone", "==", normalizedPhone).limit(1).get();
      if (!byPhone.empty) {
        customerId = byPhone.docs[0].id;
      } else if (normalizedEmail) {
        const byEmail = await db.collection("customers").where("normalizedEmail", "==", normalizedEmail).limit(1).get();
        if (!byEmail.empty) customerId = byEmail.docs[0].id;
      }

      if (!customerId) {
        const customerRef = await db.collection("customers").add({
          fullName,
          phone,
          normalizedPhone,
          secondaryPhones: [],
          email: email || "",
          normalizedEmail,
          whatsapp: "",
          authUid: null,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        customerId = customerRef.id;
        isNewCustomer = true;
      }

      // ── Resolve/merge Engagement for (customer, Program). ──
      const existingEngagementSnap = await db
        .collection("engagements")
        .where("customerId", "==", customerId)
        .where("catalogNodeId", "==", catalogNodeId)
        .limit(1)
        .get();

      let engagementId;
      let isNewEngagement;

      if (!existingEngagementSnap.empty) {
        // Same Customer + same Program = reuse/merge. Never touches CRM
        // Internal Data (contactStatus/ownerId/salesNotes/payment/tracking
        // already set) — only logs that a duplicate registration came in.
        const existingDoc = existingEngagementSnap.docs[0];
        engagementId = existingDoc.id;
        isNewEngagement = false;
        await db.collection("engagements").doc(engagementId).update({
          updatedAt: now,
          timeline: [
            ...(existingDoc.data().timeline || []),
            {
              id: genId(),
              type: "system",
              text: `Duplicate registration received via Landing Page for "${program.name_en || programSlug}" (no fields overwritten)`,
              byUid: null,
              byName: "Landing Page",
              at: now,
            },
          ],
        });
      } else {
        // Same Customer + different Program (or brand-new Customer) = new Engagement.
        const defaultStatusSnap = await db
          .collection("leadStatuses")
          .where("scope", "==", "global")
          .where("isDefault", "==", true)
          .limit(1)
          .get();
        const statusId = defaultStatusSnap.empty ? null : defaultStatusSnap.docs[0].id;

        const engagementRef = await db.collection("engagements").add({
          customerId,
          businessUnitId,
          catalogNodeId,
          stage: "lead",
          studentProfile: {
            registrationDate: now,
            governorate,
            educationalLevel: "",
            employmentStatus: "",
            attendanceType,
            courseLevel: "",
            hasLaptop: null,
            preferredContactMethod: "",
            leadSource: tracking.source || "",
            studentComment: "",
          },
          statusId,
          contactStatus: "not_contacted",
          enrollmentStatus: "not_enrolled",
          ownerId: null,
          priority: "normal",
          nextFollowUpDate: null,
          salesNotes: "",
          payment: {
            coursePrice,
            paymentPlan,
            reservationDeposit: null,
            installment1: null,
            installment2: null,
            installment3: null,
            confirmed: false,
            confirmedAt: null,
          },
          paymentRecords: [],
          tagIds: [],
          customFields: {},
          timeline: [
            {
              id: genId(),
              type: "system",
              text: `Engagement created via Landing Page ("${program.name_en || programSlug}")`,
              byUid: null,
              byName: "Landing Page",
              at: now,
            },
          ],
          attachments: [],
          sourceImportBatchIds: [],
          mergedRecordCount: 1,
          sourceLandingSubmissionId: submissionId,
          tracking: {
            source: tracking.source || null,
            utmSource: tracking.utmSource || null,
            utmMedium: tracking.utmMedium || null,
            utmCampaign: tracking.utmCampaign || null,
            utmContent: tracking.utmContent || null,
            landingPageUrl: tracking.landingPageUrl || null,
            receivedAt: now,
          },
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        engagementId = engagementRef.id;
        isNewEngagement = true;
      }

      return sendJson(res, 200, {
        success: true,
        customerId,
        engagementId,
        isNewCustomer,
        isNewEngagement,
      });
    } catch (err) {
      console.error("[submitLandingLead] failed:", err);
      return sendJson(res, 500, {
        success: false,
        code: "INTERNAL_ERROR",
        message: "Something went wrong while saving the registration.",
      });
    }
  },
);

/**
 * TEMPORARY, one-time migration helper for LEADS-02 — not part of the
 * finalized contract. Lets the catalog be listed (?action=list) and then
 * backfilled (?action=backfill) with slug/pricing against the real, live
 * catalogNodes docs instead of guessing from the seed file. Guarded by a
 * secret env var so it isn't a public write endpoint. Remove this export
 * (and functions/.env) once the backfill is done and verified.
 */
export const adminCatalogBackfill = onRequest({ region: REGION, cors: false }, async (req, res) => {
  const secret = req.get("x-admin-secret");
  if (!secret || secret !== process.env.ADMIN_BACKFILL_SECRET) {
    return sendJson(res, 403, { success: false, code: "FORBIDDEN" });
  }

  const action = req.query.action || (req.body && req.body.action);

  if (action === "list") {
    const snap = await db.collection("catalogNodes").where("type", "==", "program").get();
    const programs = snap.docs.map((d) => ({
      id: d.id,
      name_en: d.data().name_en,
      name_ar: d.data().name_ar,
      path: d.data().path || [],
      slug: d.data().slug || null,
      pricing: d.data().pricing || null,
    }));
    return sendJson(res, 200, { success: true, programs });
  }

  if (action === "backfill" && req.method === "POST") {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const results = [];
    for (const item of items) {
      if (!item.id || !item.slug || !item.pricing) {
        results.push({ id: item.id || null, ok: false, reason: "missing id/slug/pricing" });
        continue;
      }
      const ref = db.collection("catalogNodes").doc(item.id);
      const snap = await ref.get();
      if (!snap.exists) {
        results.push({ id: item.id, ok: false, reason: "not found" });
        continue;
      }
      await ref.update({
        slug: item.slug,
        pricing: item.pricing,
        updatedAt: new Date().toISOString(),
      });
      results.push({ id: item.id, ok: true, slug: item.slug });
    }
    return sendJson(res, 200, { success: true, results });
  }

  return sendJson(res, 400, { success: false, code: "BAD_ACTION", message: "action must be 'list' or 'backfill'" });
});
