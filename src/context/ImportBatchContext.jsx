import { createContext, useContext, useState, useEffect } from "react";
import { collection, doc, addDoc, updateDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";

const ImportBatchCtx = createContext(null);

export function ImportBatchProvider({ children }) {
  const { currentUser } = useAuth();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentUser?.role !== "admin") { setBatches([]); setLoading(false); return; }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "importBatches"),
      (snap) => { setBatches(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [currentUser?.id, currentUser?.role]);

  const sorted = [...batches].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const batchById = (id) => batches.find((b) => b.id === id) || null;

  // Created up-front (status "committing") so every engagement created during
  // the commit loop can reference a real batchId, then finalized via updateBatch.
  const createBatch = async (form) => {
    const now = new Date().toISOString();
    const ref = await addDoc(collection(db, "importBatches"), {
      fileName: form.fileName,
      importProfileId: form.importProfileId,
      importProfileVersion: form.importProfileVersion,
      // Which Program this run targeted — lets Import History scope itself
      // to "just this Program's imports" from inside the Program workspace.
      programId: form.programId || null,
      importedBy: currentUser?.id || null,
      importedByName: currentUser?.name || null,
      status: "committing",
      createdCount: 0, updatedCount: 0, skippedCount: 0, errorCount: 0,
      createdCustomerIds: [], createdEngagementIds: [],
      rolledBackAt: null,
      createdAt: now, updatedAt: now,
    });
    return ref.id;
  };

  const updateBatch = async (id, updates) => {
    await updateDoc(doc(db, "importBatches", id), { ...updates, updatedAt: new Date().toISOString() });
  };

  const markRolledBack = async (id) => {
    await updateDoc(doc(db, "importBatches", id), { rolledBackAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };

  return (
    <ImportBatchCtx.Provider value={{ batches: sorted, loading, batchById, createBatch, updateBatch, markRolledBack }}>
      {children}
    </ImportBatchCtx.Provider>
  );
}

export const useImportBatches = () => useContext(ImportBatchCtx);
