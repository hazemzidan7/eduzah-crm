import { createContext, useContext, useState, useEffect } from "react";
import { collection, doc, addDoc, updateDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";

const TagCtx = createContext(null);

/**
 * Tags: no named examples were given anywhere in the approved spec (unlike
 * statuses/custom fields), so this collection is intentionally seeded empty —
 * admins define their own from CRM Settings, and the Import Engine will be
 * able to apply defaultTagIds from an Import Profile once some exist.
 */
export function TagProvider({ children }) {
  const { currentUser } = useAuth();
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentUser?.role !== "admin") { setTags([]); setLoading(false); return; }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "tags"),
      (snap) => { setTags(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [currentUser?.id, currentUser?.role]);

  const activeTags = tags.filter((t) => t.isActive);
  const tagById = (id) => tags.find((t) => t.id === id) || null;

  const addTag = async (form) => {
    const now = new Date().toISOString();
    const ref = await addDoc(collection(db, "tags"), {
      label_ar: form.label_ar || "", label_en: form.label_en || "",
      color: form.color || "", isActive: true, archivedAt: null,
      createdAt: now, updatedAt: now,
    });
    return ref.id;
  };

  const updateTag = async (id, updates) => {
    await updateDoc(doc(db, "tags", id), { ...updates, updatedAt: new Date().toISOString() });
  };

  const archiveTag = async (id) => {
    await updateDoc(doc(db, "tags", id), { isActive: false, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };

  const restoreTag = async (id) => {
    await updateDoc(doc(db, "tags", id), { isActive: true, archivedAt: null, updatedAt: new Date().toISOString() });
  };

  return (
    <TagCtx.Provider value={{ tags, activeTags, loading, tagById, addTag, updateTag, archiveTag, restoreTag }}>
      {children}
    </TagCtx.Provider>
  );
}

export const useTags = () => useContext(TagCtx);
