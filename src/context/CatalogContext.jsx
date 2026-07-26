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
import { CATALOG_SEED } from "../data/catalogSeed";

const CatalogCtx = createContext(null);

const NODE_TYPES_SEED = [
  { key: "business_unit", label_ar: "وحدة عمل", label_en: "Business Unit", order: 0 },
  { key: "category", label_ar: "فئة", label_en: "Category", order: 1 },
  { key: "program", label_ar: "برنامج", label_en: "Program", order: 2 },
  { key: "batch", label_ar: "دفعة", label_en: "Batch", order: 3 },
];

export function CatalogProvider({ children }) {
  const { currentUser } = useAuth();
  const [nodes, setNodes] = useState([]);
  const [nodeTypes, setNodeTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Firestore rules restrict reads to admins — only subscribe when signed in as one.
  useEffect(() => {
    if (currentUser?.role !== "admin") { setNodes([]); setNodeTypes([]); setLoading(false); return; }
    setLoading(true);
    const unsubNodes = onSnapshot(
      collection(db, "catalogNodes"),
      (snap) => { setNodes(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    const unsubTypes = onSnapshot(
      collection(db, "catalogNodeTypes"),
      (snap) => setNodeTypes(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    return () => { unsubNodes(); unsubTypes(); };
  }, [currentUser?.id, currentUser?.role]);

  // ── SEEDING ──────────────────────────────────────────
  // Both seeds are bootstrap-only, guarded by settings/seedState flags (same
  // pattern DataContext already uses for courses) — an empty collection is
  // never treated as "safe to re-seed"; once the flag is set, Firestore is
  // the only source of truth, permanently.
  useEffect(() => {
    if (currentUser?.role !== "admin") return;
    (async () => {
      let seeded = {};
      try {
        const s = await getDoc(doc(db, "settings", "seedState"));
        if (s.exists()) seeded = s.data() || {};
      } catch (_) {}

      const markSeeded = async (patch) => {
        await setDoc(doc(db, "settings", "seedState"), { ...seeded, ...patch, updatedAt: new Date().toISOString() }, { merge: true });
        seeded = { ...seeded, ...patch };
      };

      if (seeded.catalogNodeTypesSeeded !== true) {
        const snap = await getDocs(collection(db, "catalogNodeTypes"));
        if (snap.empty) {
          const now = new Date().toISOString();
          for (const t of NODE_TYPES_SEED) {
            await addDoc(collection(db, "catalogNodeTypes"), { ...t, isActive: true, createdAt: now, updatedAt: now });
          }
        }
        await markSeeded({ catalogNodeTypesSeeded: true });
      }

      if (seeded.catalogSeeded !== true) {
        const snap = await getDocs(collection(db, "catalogNodes"));
        if (snap.empty) {
          const now = new Date().toISOString();
          for (const [buOrder, bu] of CATALOG_SEED.entries()) {
            const buRef = await addDoc(collection(db, "catalogNodes"), {
              type: "business_unit", name_ar: bu.name_ar, name_en: bu.name_en,
              code: "", icon: "", color: "", description: "",
              parentId: null, path: [], order: buOrder, isActive: true, archivedAt: null,
              createdAt: now, updatedAt: now,
            });
            for (const [childOrder, child] of bu.children.entries()) {
              await addDoc(collection(db, "catalogNodes"), {
                type: "category", name_ar: child.name_ar, name_en: child.name_en,
                code: "", icon: "", color: "", description: "",
                parentId: buRef.id, path: [buRef.id], order: childOrder, isActive: true, archivedAt: null,
                createdAt: now, updatedAt: now,
              });
            }
          }
        }
        await markSeeded({ catalogSeeded: true });
      }
    })().catch((e) => console.warn("Catalog seed failed:", e));
  }, [currentUser?.id, currentUser?.role]);

  // ── SELECTORS ────────────────────────────────────────
  const businessUnits = nodes
    .filter((n) => n.type === "business_unit" && n.isActive)
    .sort((a, b) => a.order - b.order);

  const allBusinessUnits = nodes
    .filter((n) => n.type === "business_unit")
    .sort((a, b) => a.order - b.order);

  const childrenOf = (parentId) =>
    nodes.filter((n) => n.parentId === parentId && n.isActive).sort((a, b) => a.order - b.order);

  const allChildrenOf = (parentId) =>
    nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order);

  const nodeById = (id) => nodes.find((n) => n.id === id) || null;

  // Every descendant of a node, via the materialized `path` array — no recursive queries needed.
  const descendantsOf = (nodeId) =>
    nodes.filter((n) => Array.isArray(n.path) && n.path.includes(nodeId));

  // ── NODE TYPE REGISTRY ───────────────────────────────
  const addNodeType = async (form) => {
    const now = new Date().toISOString();
    const ref = await addDoc(collection(db, "catalogNodeTypes"), {
      key: form.key, label_ar: form.label_ar || "", label_en: form.label_en || "",
      order: form.order ?? nodeTypes.length, isActive: true,
      createdAt: now, updatedAt: now,
    });
    return ref.id;
  };

  // ── CREATE ───────────────────────────────────────────
  const addNode = async (form) => {
    const parent = form.parentId ? nodeById(form.parentId) : null;
    const path = parent ? [...(parent.path || []), parent.id] : [];
    const now = new Date().toISOString();
    const nn = {
      type: form.type,
      name_ar: form.name_ar || "",
      name_en: form.name_en || "",
      code: form.code || "",
      icon: form.icon || "",
      color: form.color || "",
      description: form.description || "",
      parentId: form.parentId || null,
      path,
      order: form.order ?? 0,
      isActive: true,
      archivedAt: null,
      ...(form.extraFields || {}),
      createdAt: now,
      updatedAt: now,
    };
    const ref = await addDoc(collection(db, "catalogNodes"), nn);
    return ref.id;
  };

  // ── UPDATE (name/metadata only — parent changes must go through moveNode) ──
  const updateNode = async (id, updates) => {
    const { parentId, path, ...rest } = updates; // eslint-disable-line no-unused-vars
    await updateDoc(doc(db, "catalogNodes", id), { ...rest, updatedAt: new Date().toISOString() });
  };

  // ── MOVE (re-parent) — cycle-safe, cascades `path` to every descendant ──
  const moveNode = async (nodeId, newParentId) => {
    const node = nodeById(nodeId);
    if (!node) throw new Error("NODE_NOT_FOUND");
    if (newParentId === nodeId) throw new Error("SELF_PARENT");
    const newParent = newParentId ? nodeById(newParentId) : null;
    if (newParentId && !newParent) throw new Error("NODE_NOT_FOUND");
    if (newParent && descendantsOf(nodeId).some((d) => d.id === newParentId)) {
      throw new Error("CIRCULAR_REFERENCE");
    }
    if ((node.parentId || null) === (newParentId || null)) return; // no-op

    const oldFullPath = [...(node.path || []), node.id];
    const newPath = newParent ? [...(newParent.path || []), newParent.id] : [];
    const newFullPath = [...newPath, node.id];
    const now = new Date().toISOString();

    const batch = writeBatch(db);
    batch.update(doc(db, "catalogNodes", node.id), { parentId: newParentId || null, path: newPath, updatedAt: now });
    for (const d of descendantsOf(nodeId)) {
      const remainder = (d.path || []).slice(oldFullPath.length);
      batch.update(doc(db, "catalogNodes", d.id), { path: [...newFullPath, ...remainder], updatedAt: now });
    }
    await batch.commit();
  };

  // ── ARCHIVE (never a hard delete) ────────────────────
  // Throws "HAS_ACTIVE_CHILDREN" if the node has active descendants and the
  // caller didn't explicitly opt into cascading — the UI must show that list
  // and get confirmation before retrying with cascade:true.
  const archiveNode = async (id, { cascade = false } = {}) => {
    const activeDescendants = descendantsOf(id).filter((d) => d.isActive);
    if (activeDescendants.length > 0 && !cascade) throw new Error("HAS_ACTIVE_CHILDREN");

    const now = new Date().toISOString();
    const batch = writeBatch(db);
    batch.update(doc(db, "catalogNodes", id), { isActive: false, archivedAt: now, updatedAt: now });
    if (cascade) {
      for (const d of activeDescendants) {
        batch.update(doc(db, "catalogNodes", d.id), { isActive: false, archivedAt: now, updatedAt: now });
      }
    }
    await batch.commit();
  };

  const restoreNode = async (id) => {
    await updateDoc(doc(db, "catalogNodes", id), { isActive: true, archivedAt: null, updatedAt: new Date().toISOString() });
  };

  return (
    <CatalogCtx.Provider value={{
      nodes, nodeTypes, loading,
      businessUnits, allBusinessUnits, childrenOf, allChildrenOf, nodeById, descendantsOf,
      addNodeType, addNode, updateNode, moveNode, archiveNode, restoreNode,
    }}>
      {children}
    </CatalogCtx.Provider>
  );
}

export const useCatalog = () => useContext(CatalogCtx);
