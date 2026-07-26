import { createContext, useContext, useState, useEffect } from "react";
import { collection, doc, addDoc, updateDoc, setDoc, getDoc, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";

const DictionaryCtx = createContext(null);

export function normalizeForDictionary(text) {
  return String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// The exact column/value synonym examples given in the original spec — seeded
// once so Column/Value Recognition has a working baseline on day one, rather
// than returning "unknown" for literally every file until an admin manually
// re-teaches the system things the requirements already spelled out. Every
// other synonym is learned from real usage, never guessed at beyond this.
const COLUMN_SYNONYM_SEED = {
  fullName: ["اسم", "اسم الطالب", "Student Name", "Full Name", "الاسم الكامل", "اسم العميل"],
  phone: ["Phone", "Mobile", "رقم الهاتف", "الموبايل"],
};
const STATUS_SYNONYM_SEED = {
  booked: ["تم الدفع", "حجز", "Booked"],
  thinking: ["هيرد", "بيفكر", "راجع بعدين", "Thinking"],
  confirmed: ["أكد", "موافق", "Confirmed"],
};

/**
 * Learning Dictionaries: beyond the small literal seed above, no data is
 * invented — every other entry here is either learned from an admin
 * resolving an unknown value during import, or a correction to a prior
 * wrong suggestion. This context only provides storage, exact-match lookup,
 * and reuse tracking; the fuzzy/heuristic matching that decides what counts
 * as "close enough to suggest" lives in utils/importEngine, not here.
 */
export function DictionaryProvider({ children }) {
  const { currentUser } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentUser?.role !== "admin") { setEntries([]); setLoading(false); return; }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "dictionaries"),
      (snap) => { setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [currentUser?.id, currentUser?.role]);

  // Bootstrap-once, guarded by settings/seedState.dictionariesSeeded. Column
  // synonyms have no upstream dependency; status synonyms need real
  // leadStatuses ids, so this defers (without marking itself seeded) until
  // leadStatusesSeeded is true, same pattern as every other cross-collection seed.
  useEffect(() => {
    if (currentUser?.role !== "admin") return;
    (async () => {
      let seeded = {};
      try {
        const s = await getDoc(doc(db, "settings", "seedState"));
        if (s.exists()) seeded = s.data() || {};
      } catch (_) {}
      if (seeded.dictionariesSeeded === true) return;
      if (seeded.leadStatusesSeeded !== true) return;

      const snap = await getDocs(collection(db, "dictionaries"));
      if (snap.empty) {
        const now = new Date().toISOString();
        for (const [fieldKey, synonyms] of Object.entries(COLUMN_SYNONYM_SEED)) {
          for (const syn of synonyms) {
            await addDoc(collection(db, "dictionaries"), {
              dictionaryType: "column",
              synonymNormalized: normalizeForDictionary(syn),
              synonymDisplay: syn,
              targetType: "canonicalField", targetId: fieldKey,
              canonicalText: null, businessUnitId: null,
              isActive: true, createdBy: null, createdAt: now, timesReused: 0, lastUsedAt: now,
            });
          }
        }

        const statusSnap = await getDocs(collection(db, "leadStatuses"));
        const statusIdByKey = {};
        statusSnap.docs.forEach((d) => { statusIdByKey[d.data().key] = d.id; });
        for (const [statusKey, synonyms] of Object.entries(STATUS_SYNONYM_SEED)) {
          const targetId = statusIdByKey[statusKey];
          if (!targetId) continue; // that status doesn't exist yet — skip, not fatal
          for (const syn of synonyms) {
            await addDoc(collection(db, "dictionaries"), {
              dictionaryType: "status",
              synonymNormalized: normalizeForDictionary(syn),
              synonymDisplay: syn,
              targetType: "leadStatusId", targetId,
              canonicalText: null, businessUnitId: null,
              isActive: true, createdBy: null, createdAt: now, timesReused: 0, lastUsedAt: now,
            });
          }
        }
      }
      await setDoc(doc(db, "settings", "seedState"), { ...seeded, dictionariesSeeded: true, updatedAt: new Date().toISOString() }, { merge: true });
    })().catch((e) => console.warn("Dictionary seed failed:", e));
  }, [currentUser?.id, currentUser?.role]);

  const activeEntries = entries.filter((e) => e.isActive);

  // Exact-match lookup (after normalization) — the only kind this context
  // performs. `businessUnitId` matters only for scoped types like "status".
  const findMapping = (dictionaryType, rawValue, businessUnitId = null) => {
    const norm = normalizeForDictionary(rawValue);
    if (!norm) return null;
    return activeEntries.find((e) =>
      e.dictionaryType === dictionaryType && e.synonymNormalized === norm
      && (e.businessUnitId == null || e.businessUnitId === businessUnitId)) || null;
  };

  const entriesForType = (dictionaryType) => activeEntries.filter((e) => e.dictionaryType === dictionaryType);

  // The "ask once, remember" write — called after an admin resolves an
  // unknown value (or corrects a wrong suggestion) during import review.
  const recordMapping = async (form) => {
    const now = new Date().toISOString();
    const ref = await addDoc(collection(db, "dictionaries"), {
      dictionaryType: form.dictionaryType,
      synonymNormalized: normalizeForDictionary(form.rawValue),
      synonymDisplay: form.rawValue,
      targetType: form.targetType || null,
      targetId: form.targetId || null,
      canonicalText: form.canonicalText || null,
      businessUnitId: form.businessUnitId || null,
      isActive: true,
      createdBy: currentUser?.id || null,
      createdAt: now,
      timesReused: 0,
      lastUsedAt: now,
    });
    return ref.id;
  };

  const recordReuse = async (id) => {
    const entry = entries.find((e) => e.id === id);
    await updateDoc(doc(db, "dictionaries", id), {
      timesReused: (entry?.timesReused || 0) + 1,
      lastUsedAt: new Date().toISOString(),
    });
  };

  // A correction: the old suggestion was wrong, so deactivate it rather than
  // delete it (still archive-based) and record what the admin picked instead.
  const deactivateMapping = async (id) => {
    await updateDoc(doc(db, "dictionaries", id), { isActive: false });
  };

  return (
    <DictionaryCtx.Provider value={{
      entries, activeEntries, loading,
      findMapping, entriesForType, recordMapping, recordReuse, deactivateMapping,
    }}>
      {children}
    </DictionaryCtx.Provider>
  );
}

export const useDictionary = () => useContext(DictionaryCtx);
