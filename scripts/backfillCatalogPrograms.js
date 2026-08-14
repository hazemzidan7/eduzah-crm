/**
 * One-off migration helper for LEADS-02 (v2 — no Cloud Functions involved).
 * Run locally with a service account's credentials in the environment:
 *
 *   FIREBASE_PROJECT_ID=eduzah-crm
 *   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@eduzah-crm.iam.gserviceaccount.com
 *   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
 *
 * Usage:
 *   node scripts/backfillCatalogPrograms.js --list     # dump real Program docs (id, name_en, path, slug, pricing)
 *   node scripts/backfillCatalogPrograms.js --apply     # write slug/pricing from catalog-backfill-mapping.json (skips docs that already have a slug, unless --force)
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function initAdmin() {
  if (getApps().length > 0) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    console.error("Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in the environment.");
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

async function list(db) {
  const snap = await db.collection("catalogNodes").where("type", "==", "program").get();
  const programs = snap.docs.map((d) => ({
    id: d.id,
    name_en: d.data().name_en,
    name_ar: d.data().name_ar,
    path: d.data().path || [],
    slug: d.data().slug || null,
    pricing: d.data().pricing || null,
  }));
  console.log(JSON.stringify(programs, null, 2));
}

async function apply(db, { force }) {
  const mapping = JSON.parse(readFileSync(path.join(__dirname, "catalog-backfill-mapping.json"), "utf8"));
  const results = [];
  for (const item of mapping.items) {
    if (!item.id) {
      results.push({ landingCourseId: item.landingCourseId, ok: false, reason: "id not filled in (run --list first)" });
      continue;
    }
    const ref = db.collection("catalogNodes").doc(item.id);
    const snap = await ref.get();
    if (!snap.exists) {
      results.push({ landingCourseId: item.landingCourseId, id: item.id, ok: false, reason: "doc not found" });
      continue;
    }
    if (snap.data().slug && !force) {
      results.push({ landingCourseId: item.landingCourseId, id: item.id, ok: false, reason: "already has a slug (use --force to overwrite)" });
      continue;
    }
    await ref.update({ slug: item.slug, pricing: item.pricing, updatedAt: new Date().toISOString() });
    results.push({ landingCourseId: item.landingCourseId, id: item.id, ok: true, slug: item.slug });
  }
  console.log(JSON.stringify(results, null, 2));
}

async function main() {
  initAdmin();
  const db = getFirestore();
  const args = process.argv.slice(2);
  if (args.includes("--list")) return list(db);
  if (args.includes("--apply")) return apply(db, { force: args.includes("--force") });
  console.log("Usage: node scripts/backfillCatalogPrograms.js --list | --apply [--force]");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
