import { createContext, useContext, useState, useEffect } from "react";
import { collection, doc, addDoc, updateDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";
import { buildImportBatchDoc, omitUndefined } from "../utils/importBatchDoc";

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
    const ref = await addDoc(collection(db, "importBatches"), buildImportBatchDoc(form, { currentUser }));
    return ref.id;
  };

  const updateBatch = async (id, updates) => {
    await updateDoc(doc(db, "importBatches", id), { ...omitUndefined(updates), updatedAt: new Date().toISOString() });
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
