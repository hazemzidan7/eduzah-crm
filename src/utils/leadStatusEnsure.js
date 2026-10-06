/**
 * Decides what (if anything) must be done so ONE global lead status with a
 * given `key` is available in the pickers. Pure — LeadStatusContext does the
 * single write it asks for.
 *
 *  - an ACTIVE global status with that key already exists -> nothing;
 *  - docs with that key exist but none is active (archived / deactivated, e.g.
 *    by an earlier duplicate cleanup) -> RESTORE the oldest one (the original,
 *    never a second copy);
 *  - no doc has that key at all -> create it.
 * Business-unit-scoped statuses that happen to share the key don't count: the
 * "عملاء جدد" workflow only ever reads the global list.
 */
export function planEnsureGlobalStatus(allDocs, key) {
  const same = (allDocs || []).filter((d) => d?.key === key && d.scope !== "business_unit");
  if (same.some((d) => d.isActive && !d.archivedAt)) return { action: "none" };
  if (same.length === 0) return { action: "create" };
  const oldest = [...same].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id).localeCompare(String(b.id)))[0];
  return { action: "restore", id: oldest.id };
}
