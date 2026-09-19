/**
 * Firestore rejects `undefined` field values outright ("Unsupported field
 * value: undefined"), so any optional field must be OMITTED, never written as
 * undefined. Program imports always carry an Import Profile (id + version);
 * customer-lead imports ("عملاء جدد" Excel upload) have none — they must not
 * need one, invent one, or write `importProfileId: undefined`.
 */

/** Returns a copy without `undefined` values, recursively through plain objects and arrays (null is a valid Firestore value and is kept). */
export function omitUndefined(value) {
  if (Array.isArray(value)) return value.filter((v) => v !== undefined).map(omitUndefined);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = omitUndefined(v);
    return out;
  }
  return value;
}

/**
 * The `importBatches/{id}` document created up-front (status "committing") by
 * ImportBatchContext.createBatch. Shape for Program imports is unchanged
 * (importProfileId/importProfileVersion present); for lead imports those two
 * fields are simply absent.
 */
export function buildImportBatchDoc(form, { currentUser, now = new Date().toISOString() } = {}) {
  return omitUndefined({
    fileName: form.fileName,
    ...(form.importProfileId != null ? { importProfileId: form.importProfileId } : {}),
    ...(form.importProfileVersion != null ? { importProfileVersion: form.importProfileVersion } : {}),
    // Which Program this run targeted — lets Import History scope itself
    // to "just this Program's imports" from inside the Program workspace.
    programId: form.programId || null,
    // LEAD-IMPORT-01: bulk customer/lead imports from "عملاء جدد" are tagged
    // so they're distinguishable from Program imports (which carry no kind).
    ...(form.kind ? { kind: form.kind } : {}),
    importedBy: currentUser?.id || null,
    importedByName: currentUser?.name || null,
    status: "committing",
    createdCount: 0, updatedCount: 0, skippedCount: 0, errorCount: 0,
    createdCustomerIds: [], createdEngagementIds: [],
    rolledBackAt: null,
    createdAt: now, updatedAt: now,
  });
}
