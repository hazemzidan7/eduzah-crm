import { createContext, useContext, useState, useEffect } from "react";
import { collection, doc, addDoc, updateDoc, setDoc, getDoc, getDocs, onSnapshot, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";

const ImportProfileCtx = createContext(null);

// One starter profile per Business Unit, seeded once real catalog/custom-field/
// status ids exist. Management is seeded too (with no custom fields, per the
// spec's own "may contain different fields in the future") since a Business
// Unit without an Import Profile at all would be a silent gap, not a feature.
const PROFILE_SEED_BUSINESS_UNITS = ["Technology", "Language", "Juniors", "Corporate", "Management"];

export function ImportProfileProvider({ children }) {
  const { currentUser } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentUser?.role !== "admin") { setProfiles([]); setVersions([]); setLoading(false); return; }
    setLoading(true);
    const unsubProfiles = onSnapshot(
      collection(db, "importProfiles"),
      (snap) => { setProfiles(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    const unsubVersions = onSnapshot(
      collection(db, "importProfileVersions"),
      (snap) => setVersions(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    return () => { unsubProfiles(); unsubVersions(); };
  }, [currentUser?.id, currentUser?.role]);

  // Bootstrap-once, guarded by settings/seedState.importProfilesSeeded.
  // Has THREE upstream dependencies (catalog, custom fields, lead statuses) —
  // defers without marking itself seeded until all three have finished,
  // so it safely retries on a later admin page load rather than seeding a
  // partial profile (e.g. with no defaultLeadStatusId) and never revisiting it.
  useEffect(() => {
    if (currentUser?.role !== "admin") return;
    (async () => {
      let seeded = {};
      try {
        const s = await getDoc(doc(db, "settings", "seedState"));
        if (s.exists()) seeded = s.data() || {};
      } catch (_) {}
      if (seeded.importProfilesSeeded === true) return;
      if (seeded.catalogSeeded !== true || seeded.customFieldDefinitionsSeeded !== true || seeded.leadStatusesSeeded !== true) return;

      const snap = await getDocs(collection(db, "importProfiles"));
      if (snap.empty) {
        const [catalogSnap, fieldDefSnap, statusSnap] = await Promise.all([
          getDocs(collection(db, "catalogNodes")),
          getDocs(collection(db, "customFieldDefinitions")),
          getDocs(collection(db, "leadStatuses")),
        ]);
        const businessUnitsByName = {};
        catalogSnap.docs.forEach((d) => {
          const data = d.data();
          if (data.type === "business_unit") businessUnitsByName[data.name_en] = d.id;
        });
        const defaultStatusDoc = statusSnap.docs.find((d) => d.data().scope === "global" && d.data().isDefault);
        const defaultStatusId = defaultStatusDoc ? defaultStatusDoc.id : null;

        const now = new Date().toISOString();
        for (const buName of PROFILE_SEED_BUSINESS_UNITS) {
          const businessUnitId = businessUnitsByName[buName];
          if (!businessUnitId) continue; // that Business Unit isn't in the catalog yet — skip, not fatal
          const fieldDefIds = fieldDefSnap.docs
            .filter((d) => (d.data().appliesTo || []).includes(businessUnitId))
            .map((d) => d.id);

          const profileRef = await addDoc(collection(db, "importProfiles"), {
            name: buName, businessUnitId, currentVersionNumber: 1,
            isActive: true, archivedAt: null, createdAt: now, updatedAt: now,
          });
          await addDoc(collection(db, "importProfileVersions"), {
            profileId: profileRef.id, version: 1,
            // Kept deliberately minimal: Full Name + Phone (required) and
            // Email + Attendance Type (optional) is the whole expected import
            // file. Everything else in the Student Profile is filled in by
            // sales after contacting the student, via predefined dropdowns
            // in the profile UI, not typed into the spreadsheet.
            requiredFields: ["fullName", "phone"],
            optionalFields: ["email", "attendanceType"],
            customFieldDefIds: fieldDefIds,
            validationRules: [],
            defaultLeadStatusId: defaultStatusId,
            defaultTagIds: [],
            isCurrent: true,
            createdBy: currentUser?.id || null,
            createdAt: now,
          });
        }
      }
      await setDoc(doc(db, "settings", "seedState"), { ...seeded, importProfilesSeeded: true, updatedAt: new Date().toISOString() }, { merge: true });
    })().catch((e) => console.warn("Import profile seed failed:", e));
  }, [currentUser?.id, currentUser?.role]);

  // ── SELECTORS ────────────────────────────────────────
  const activeProfiles = profiles.filter((p) => p.isActive);
  const profileById = (id) => profiles.find((p) => p.id === id) || null;
  const versionsOf = (profileId) => versions.filter((v) => v.profileId === profileId).sort((a, b) => b.version - a.version);
  const currentVersionOf = (profileId) => versions.find((v) => v.profileId === profileId && v.isCurrent) || null;

  // ── CREATE ───────────────────────────────────────────
  const createImportProfile = async (form) => {
    const now = new Date().toISOString();
    const profileRef = await addDoc(collection(db, "importProfiles"), {
      name: form.name, businessUnitId: form.businessUnitId, currentVersionNumber: 1,
      isActive: true, archivedAt: null, createdAt: now, updatedAt: now,
    });
    await addDoc(collection(db, "importProfileVersions"), {
      profileId: profileRef.id, version: 1,
      requiredFields: form.requiredFields || [],
      optionalFields: form.optionalFields || [],
      customFieldDefIds: form.customFieldDefIds || [],
      validationRules: form.validationRules || [],
      defaultLeadStatusId: form.defaultLeadStatusId || null,
      defaultTagIds: form.defaultTagIds || [],
      isCurrent: true,
      createdBy: currentUser?.id || null,
      createdAt: now,
    });
    return profileRef.id;
  };

  // ── EDIT — creates a new version, never rewrites an existing one ────
  const updateImportProfile = async (profileId, versionFields) => {
    const profile = profileById(profileId);
    if (!profile) throw new Error("PROFILE_NOT_FOUND");
    const current = currentVersionOf(profileId);
    const nextVersion = (profile.currentVersionNumber || 0) + 1;
    const now = new Date().toISOString();

    const batch = writeBatch(db);
    if (current) batch.update(doc(db, "importProfileVersions", current.id), { isCurrent: false });
    const newVersionRef = doc(collection(db, "importProfileVersions"));
    batch.set(newVersionRef, {
      profileId, version: nextVersion,
      requiredFields: versionFields.requiredFields ?? current?.requiredFields ?? [],
      optionalFields: versionFields.optionalFields ?? current?.optionalFields ?? [],
      customFieldDefIds: versionFields.customFieldDefIds ?? current?.customFieldDefIds ?? [],
      validationRules: versionFields.validationRules ?? current?.validationRules ?? [],
      defaultLeadStatusId: versionFields.defaultLeadStatusId ?? current?.defaultLeadStatusId ?? null,
      defaultTagIds: versionFields.defaultTagIds ?? current?.defaultTagIds ?? [],
      isCurrent: true,
      createdBy: currentUser?.id || null,
      createdAt: now,
    });
    batch.update(doc(db, "importProfiles", profileId), { currentVersionNumber: nextVersion, updatedAt: now });
    await batch.commit();
    return newVersionRef.id;
  };

  // ── DUPLICATE — a whole new, independent profile family ─────────────
  const duplicateImportProfile = async (sourceProfileId, newName) => {
    const source = profileById(sourceProfileId);
    const sourceVersion = currentVersionOf(sourceProfileId);
    if (!source || !sourceVersion) throw new Error("PROFILE_NOT_FOUND");
    return createImportProfile({
      name: newName, businessUnitId: source.businessUnitId,
      requiredFields: sourceVersion.requiredFields, optionalFields: sourceVersion.optionalFields,
      customFieldDefIds: sourceVersion.customFieldDefIds, validationRules: sourceVersion.validationRules,
      defaultLeadStatusId: sourceVersion.defaultLeadStatusId, defaultTagIds: sourceVersion.defaultTagIds,
    });
  };

  const activateImportProfile = async (profileId) => {
    await updateDoc(doc(db, "importProfiles", profileId), { isActive: true, archivedAt: null, updatedAt: new Date().toISOString() });
  };
  const deactivateImportProfile = async (profileId) => {
    await updateDoc(doc(db, "importProfiles", profileId), { isActive: false, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };

  return (
    <ImportProfileCtx.Provider value={{
      profiles, versions, activeProfiles, loading,
      profileById, versionsOf, currentVersionOf,
      createImportProfile, updateImportProfile, duplicateImportProfile,
      activateImportProfile, deactivateImportProfile,
    }}>
      {children}
    </ImportProfileCtx.Provider>
  );
}

export const useImportProfiles = () => useContext(ImportProfileCtx);
