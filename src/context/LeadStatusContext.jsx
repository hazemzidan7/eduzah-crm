import { createContext, useContext, useState, useEffect } from "react";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";

const LeadStatusCtx = createContext(null);

// Global statuses, seeded once — a flat pipeline, no sub-statuses. Doubles
// as "Contact Status" in the Sheet: contact-attempt outcomes (Not Contacted
// through WhatsApp Sent) and pipeline stages (Thinking through Lost) share
// one vocabulary/one field, there's no separate contactStatus concept anymore.
const GLOBAL_STATUS_SEED = [
  { key: "new", name_ar: "جديد", name_en: "New", color: "#94a3b8", isDefault: true },
  { key: "not_contacted", name_ar: "لم يتم التواصل", name_en: "Not Contacted", color: "#9ca3af" },
  { key: "called", name_ar: "تم الاتصال", name_en: "Called", color: "#60a5fa" },
  { key: "no_answer", name_ar: "لا يوجد رد", name_en: "No Answer", color: "#fbbf24" },
  { key: "wrong_number", name_ar: "رقم خاطئ", name_en: "Wrong Number", color: "#fb7185" },
  { key: "whatsapp_sent", name_ar: "تم إرسال واتساب", name_en: "WhatsApp Sent", color: "#25d366" },
  { key: "thinking", name_ar: "بيفكر", name_en: "Thinking", color: "#a78bfa" },
  { key: "interested", name_ar: "مهتم", name_en: "Interested", color: "#ffb84d" },
  { key: "follow_up", name_ar: "متابعة", name_en: "Follow-up", color: "#22d3ee" },
  { key: "booked", name_ar: "تم الحجز", name_en: "Booked", color: "#34d399", isTerminal: true },
  { key: "paid", name_ar: "تم الدفع", name_en: "Paid", color: "#059669", isTerminal: true },
  { key: "lost", name_ar: "ضائع", name_en: "Lost", color: "#f87171", isTerminal: true },
];

// Business-Unit-specific statuses, seeded once, matched to real catalogNodes
// business_unit docs by name_en at seed time (ids are Firestore-generated,
// never hardcoded). A unit not found in the catalog yet is skipped, not fatal.
const BUSINESS_UNIT_STATUS_SEED = {
  Language: [
    { key: "placement_test", name_ar: "اختبار تحديد المستوى", name_en: "Placement Test" },
    { key: "waiting_level_assessment", name_ar: "بانتظار تقييم المستوى", name_en: "Waiting Level Assessment" },
  ],
  Corporate: [
    { key: "waiting_contract", name_ar: "بانتظار العقد", name_en: "Waiting Contract" },
    { key: "meeting_scheduled", name_ar: "تم تحديد موعد اجتماع", name_en: "Meeting Scheduled" },
  ],
  Technology: [
    { key: "technical_interview", name_ar: "مقابلة تقنية", name_en: "Technical Interview" },
    { key: "waiting_batch", name_ar: "بانتظار الدفعة", name_en: "Waiting Batch" },
  ],
};

export function LeadStatusProvider({ children }) {
  const { currentUser } = useAuth();
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentUser?.role !== "admin") { setStatuses([]); setLoading(false); return; }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "leadStatuses"),
      (snap) => { setStatuses(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [currentUser?.id, currentUser?.role]);

  // Bootstrap-only, guarded by settings/seedState.leadStatusesSeeded — same
  // pattern as the catalog seeds. Once set, this never runs again, so
  // archiving every status later can't cause a silent re-seed.
  useEffect(() => {
    if (currentUser?.role !== "admin") return;
    (async () => {
      let seeded = {};
      try {
        const s = await getDoc(doc(db, "settings", "seedState"));
        if (s.exists()) seeded = s.data() || {};
      } catch (_) {}
      if (seeded.leadStatusesSeeded === true) return;

      const snap = await getDocs(collection(db, "leadStatuses"));
      if (snap.empty) {
        const now = new Date().toISOString();
        for (const [i, g] of GLOBAL_STATUS_SEED.entries()) {
          const ref = await addDoc(collection(db, "leadStatuses"), {
            name_ar: g.name_ar, name_en: g.name_en, key: g.key,
            description: "", color: g.color || "", icon: "",
            order: i, parentId: null, path: [],
            scope: "global", businessUnitId: null,
            isDefault: !!g.isDefault, isTerminal: !!g.isTerminal,
            isActive: true, archivedAt: null,
            createdAt: now, updatedAt: now,
          });
          for (const [ci, c] of (g.children || []).entries()) {
            await addDoc(collection(db, "leadStatuses"), {
              name_ar: c.name_ar, name_en: c.name_en, key: c.key,
              description: "", color: "", icon: "",
              order: ci, parentId: ref.id, path: [ref.id],
              scope: "global", businessUnitId: null,
              isDefault: false, isTerminal: false,
              isActive: true, archivedAt: null,
              createdAt: now, updatedAt: now,
            });
          }
        }

        // Business-Unit-specific statuses — look up real catalogNodes ids by name.
        const catalogSnap = await getDocs(collection(db, "catalogNodes"));
        const businessUnitsByName = {};
        catalogSnap.docs.forEach((d) => {
          const data = d.data();
          if (data.type === "business_unit") businessUnitsByName[data.name_en] = d.id;
        });
        for (const [buName, buStatuses] of Object.entries(BUSINESS_UNIT_STATUS_SEED)) {
          const businessUnitId = businessUnitsByName[buName];
          if (!businessUnitId) continue; // that Business Unit isn't in the catalog yet - skip, not fatal
          for (const [i, s] of buStatuses.entries()) {
            await addDoc(collection(db, "leadStatuses"), {
              name_ar: s.name_ar, name_en: s.name_en, key: s.key,
              description: "", color: "", icon: "",
              order: i, parentId: null, path: [],
              scope: "business_unit", businessUnitId,
              isDefault: false, isTerminal: false,
              isActive: true, archivedAt: null,
              createdAt: now, updatedAt: now,
            });
          }
        }
      }
      await setDoc(doc(db, "settings", "seedState"), { ...seeded, leadStatusesSeeded: true, updatedAt: new Date().toISOString() }, { merge: true });
    })().catch((e) => console.warn("Lead status seed failed:", e));
  }, [currentUser?.id, currentUser?.role]);

  // ── SELECTORS ────────────────────────────────────────
  const statusById = (id) => statuses.find((s) => s.id === id) || null;

  const globalStatuses = statuses
    .filter((s) => s.scope === "global" && s.isActive)
    .sort((a, b) => a.order - b.order);

  const statusesForBusinessUnit = (businessUnitId) => statuses
    .filter((s) => s.scope === "business_unit" && s.businessUnitId === businessUnitId && s.isActive)
    .sort((a, b) => a.order - b.order);

  // The only status list any engagement should ever be built from: global + this Business Unit's own.
  const effectiveStatuses = (businessUnitId) => [
    ...globalStatuses,
    ...(businessUnitId ? statusesForBusinessUnit(businessUnitId) : []),
  ];

  const childrenOfStatus = (parentId) =>
    statuses.filter((s) => s.parentId === parentId && s.isActive).sort((a, b) => a.order - b.order);

  const allChildrenOfStatus = (parentId) =>
    statuses.filter((s) => s.parentId === parentId).sort((a, b) => a.order - b.order);

  const descendantsOfStatus = (id) =>
    statuses.filter((s) => Array.isArray(s.path) && s.path.includes(id));

  // The top-level ancestor a status reports under — reporting dashboards group by this.
  const reportingRootOf = (id) => {
    const s = statusById(id);
    if (!s) return null;
    return s.path && s.path.length > 0 ? statusById(s.path[0]) : s;
  };

  const topLevelStatuses = (includeArchived = false) =>
    statuses.filter((s) => !s.parentId && (includeArchived || s.isActive)).sort((a, b) => a.order - b.order);

  // ── VALIDATION HELPERS ───────────────────────────────
  const bucketOf = (s) => `${s.scope}:${s.businessUnitId || ""}`;

  const assertUniqueKey = (key, excludeId) => {
    if (statuses.some((s) => s.key === key && s.id !== excludeId)) throw new Error("DUPLICATE_KEY");
  };
  const assertUniqueNameInScope = (scope, businessUnitId, name_ar, name_en, excludeId) => {
    const clash = statuses.some((s) =>
      s.id !== excludeId && s.scope === scope && (s.businessUnitId || null) === (businessUnitId || null)
      && ((name_ar && s.name_ar === name_ar) || (name_en && s.name_en === name_en)));
    if (clash) throw new Error("DUPLICATE_NAME_IN_SCOPE");
  };
  const assertParentScopeCompatible = (scope, businessUnitId, parentId) => {
    if (!parentId) return;
    const parent = statusById(parentId);
    if (!parent) throw new Error("STATUS_NOT_FOUND");
    if (scope === "global" && parent.scope !== "global") throw new Error("SCOPE_MISMATCH_PARENT");
    if (scope === "business_unit" && parent.scope === "business_unit" && parent.businessUnitId !== businessUnitId) {
      throw new Error("SCOPE_MISMATCH_PARENT");
    }
  };

  // Only one isDefault per (scope, businessUnitId) bucket — unset any other default there.
  const enforceSingleDefault = async (batch, scope, businessUnitId, exceptId) => {
    const clashing = statuses.filter((s) =>
      s.id !== exceptId && s.isDefault && s.scope === scope && (s.businessUnitId || null) === (businessUnitId || null));
    for (const c of clashing) {
      batch.update(doc(db, "leadStatuses", c.id), { isDefault: false, updatedAt: new Date().toISOString() });
    }
  };

  // ── CREATE ───────────────────────────────────────────
  const addStatus = async (form) => {
    const scope = form.scope || "global";
    const businessUnitId = scope === "business_unit" ? (form.businessUnitId || null) : null;
    assertUniqueKey(form.key);
    assertUniqueNameInScope(scope, businessUnitId, form.name_ar, form.name_en);
    assertParentScopeCompatible(scope, businessUnitId, form.parentId || null);

    const parent = form.parentId ? statusById(form.parentId) : null;
    const path = parent ? [...(parent.path || []), parent.id] : [];
    const now = new Date().toISOString();

    const batch = writeBatch(db);
    if (form.isDefault) await enforceSingleDefault(batch, scope, businessUnitId, null);
    const ref = doc(collection(db, "leadStatuses"));
    batch.set(ref, {
      name_ar: form.name_ar || "", name_en: form.name_en || "", key: form.key,
      description: form.description || "", color: form.color || "", icon: form.icon || "",
      order: form.order ?? 0, parentId: form.parentId || null, path,
      scope, businessUnitId,
      isDefault: !!form.isDefault, isTerminal: !!form.isTerminal,
      isActive: true, archivedAt: null,
      createdAt: now, updatedAt: now,
    });
    await batch.commit();
    return ref.id;
  };

  // ── UPDATE (name/metadata only — parent changes go through moveStatus) ──
  const updateStatus = async (id, updates) => {
    const current = statusById(id);
    if (!current) throw new Error("STATUS_NOT_FOUND");
    const { parentId, path, scope: _s, businessUnitId: _b, ...rest } = updates; // eslint-disable-line no-unused-vars

    if (rest.key && rest.key !== current.key) assertUniqueKey(rest.key, id);
    if (rest.name_ar !== undefined || rest.name_en !== undefined) {
      assertUniqueNameInScope(
        current.scope, current.businessUnitId,
        rest.name_ar !== undefined ? rest.name_ar : current.name_ar,
        rest.name_en !== undefined ? rest.name_en : current.name_en,
        id,
      );
    }

    const now = new Date().toISOString();
    const batch = writeBatch(db);
    if (rest.isDefault) await enforceSingleDefault(batch, current.scope, current.businessUnitId, id);
    batch.update(doc(db, "leadStatuses", id), { ...rest, updatedAt: now });
    await batch.commit();
  };

  // ── MOVE (re-parent) — cycle-safe + scope-compatible, cascades path ──
  const moveStatus = async (id, newParentId) => {
    const status = statusById(id);
    if (!status) throw new Error("STATUS_NOT_FOUND");
    if (newParentId === id) throw new Error("SELF_PARENT");
    const newParent = newParentId ? statusById(newParentId) : null;
    if (newParentId && !newParent) throw new Error("STATUS_NOT_FOUND");
    if (newParent && descendantsOfStatus(id).some((d) => d.id === newParentId)) throw new Error("CIRCULAR_REFERENCE");
    assertParentScopeCompatible(status.scope, status.businessUnitId, newParentId || null);
    if ((status.parentId || null) === (newParentId || null)) return;

    const oldFullPath = [...(status.path || []), status.id];
    const newPath = newParent ? [...(newParent.path || []), newParent.id] : [];
    const newFullPath = [...newPath, status.id];
    const now = new Date().toISOString();

    const batch = writeBatch(db);
    batch.update(doc(db, "leadStatuses", status.id), { parentId: newParentId || null, path: newPath, updatedAt: now });
    for (const d of descendantsOfStatus(id)) {
      const remainder = (d.path || []).slice(oldFullPath.length);
      batch.update(doc(db, "leadStatuses", d.id), { path: [...newFullPath, ...remainder], updatedAt: now });
    }
    await batch.commit();
  };

  // ── ARCHIVE (never a hard delete) ────────────────────
  const archiveStatus = async (id, { cascade = false } = {}) => {
    const activeDescendants = descendantsOfStatus(id).filter((d) => d.isActive);
    if (activeDescendants.length > 0 && !cascade) throw new Error("HAS_ACTIVE_CHILDREN");
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    batch.update(doc(db, "leadStatuses", id), { isActive: false, archivedAt: now, updatedAt: now });
    if (cascade) {
      for (const d of activeDescendants) {
        batch.update(doc(db, "leadStatuses", d.id), { isActive: false, archivedAt: now, updatedAt: now });
      }
    }
    await batch.commit();
  };

  const restoreStatus = async (id) => {
    await updateDoc(doc(db, "leadStatuses", id), { isActive: true, archivedAt: null, updatedAt: new Date().toISOString() });
  };

  // ── DUPLICATE ────────────────────────────────────────
  const duplicateStatus = async (id) => {
    const source = statusById(id);
    if (!source) throw new Error("STATUS_NOT_FOUND");
    let key = `${source.key}_copy`;
    let n = 2;
    while (statuses.some((s) => s.key === key)) { key = `${source.key}_copy${n}`; n += 1; }
    return addStatus({
      name_ar: `${source.name_ar} (نسخة)`, name_en: `${source.name_en} (copy)`, key,
      description: source.description, color: source.color, icon: source.icon,
      order: source.order, parentId: source.parentId, scope: source.scope,
      businessUnitId: source.businessUnitId, isDefault: false, isTerminal: source.isTerminal,
    });
  };

  return (
    <LeadStatusCtx.Provider value={{
      statuses, loading,
      statusById, globalStatuses, statusesForBusinessUnit, effectiveStatuses,
      childrenOfStatus, allChildrenOfStatus, descendantsOfStatus, reportingRootOf, topLevelStatuses,
      addStatus, updateStatus, moveStatus, archiveStatus, restoreStatus, duplicateStatus,
    }}>
      {children}
    </LeadStatusCtx.Provider>
  );
}

export const useLeadStatus = () => useContext(LeadStatusCtx);
