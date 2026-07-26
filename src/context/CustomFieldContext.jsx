import { createContext, useContext, useState, useEffect } from "react";
import { collection, doc, addDoc, updateDoc, setDoc, getDoc, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";

const CustomFieldCtx = createContext(null);

// Seeded per Business Unit, matched by name_en at seed time — real catalogNodes
// ids are looked up dynamically, never hardcoded. Management is deliberately
// left out: the spec says it "may contain different fields in the future" —
// inventing fields for it now would be a guess, not a seed.
const CUSTOM_FIELD_SEED = {
  Technology: [
    { key: "university", label_ar: "الجامعة", label_en: "University", fieldType: "text" },
    { key: "faculty", label_ar: "الكلية", label_en: "Faculty", fieldType: "text" },
    { key: "graduationYear", label_ar: "سنة التخرج", label_en: "Graduation Year", fieldType: "number" },
  ],
  Language: [
    { key: "currentLevel", label_ar: "المستوى الحالي", label_en: "Current Level", fieldType: "text" },
    { key: "placementTestCompleted", label_ar: "تم اختبار تحديد المستوى", label_en: "Placement Test Completed", fieldType: "boolean" },
    { key: "speakingLevel", label_ar: "مستوى المحادثة", label_en: "Speaking Level", fieldType: "text" },
  ],
  Juniors: [
    { key: "parentName", label_ar: "اسم ولي الأمر", label_en: "Parent Name", fieldType: "text" },
    { key: "parentPhone", label_ar: "هاتف ولي الأمر", label_en: "Parent Phone", fieldType: "text" },
    { key: "parentOccupation", label_ar: "مهنة ولي الأمر", label_en: "Parent Occupation", fieldType: "text" },
    { key: "school", label_ar: "المدرسة", label_en: "School", fieldType: "text" },
    { key: "age", label_ar: "العمر", label_en: "Age", fieldType: "number" },
  ],
  Corporate: [
    { key: "organization", label_ar: "المؤسسة", label_en: "Organization", fieldType: "text" },
    { key: "contactPerson", label_ar: "الشخص المسؤول", label_en: "Contact Person", fieldType: "text" },
    { key: "department", label_ar: "القسم", label_en: "Department", fieldType: "text" },
    { key: "companySize", label_ar: "حجم الشركة", label_en: "Company Size", fieldType: "number" },
  ],
};

export function CustomFieldProvider({ children }) {
  const { currentUser } = useAuth();
  const [fieldDefs, setFieldDefs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentUser?.role !== "admin") { setFieldDefs([]); setLoading(false); return; }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "customFieldDefinitions"),
      (snap) => { setFieldDefs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [currentUser?.id, currentUser?.role]);

  // Bootstrap-once, guarded by settings/seedState.customFieldDefinitionsSeeded.
  // Depends on catalogNodes already being seeded (needs real Business Unit ids) —
  // if that hasn't finished yet, this defers WITHOUT marking itself seeded, so
  // it safely retries on the next admin page load rather than silently
  // seeding a partial/empty set and never trying again.
  useEffect(() => {
    if (currentUser?.role !== "admin") return;
    (async () => {
      let seeded = {};
      try {
        const s = await getDoc(doc(db, "settings", "seedState"));
        if (s.exists()) seeded = s.data() || {};
      } catch (_) {}
      if (seeded.customFieldDefinitionsSeeded === true) return;
      if (seeded.catalogSeeded !== true) return; // dependency not ready — retry later, don't mark seeded

      const snap = await getDocs(collection(db, "customFieldDefinitions"));
      if (snap.empty) {
        const catalogSnap = await getDocs(collection(db, "catalogNodes"));
        const businessUnitsByName = {};
        catalogSnap.docs.forEach((d) => {
          const data = d.data();
          if (data.type === "business_unit") businessUnitsByName[data.name_en] = d.id;
        });

        const now = new Date().toISOString();
        for (const [buName, fields] of Object.entries(CUSTOM_FIELD_SEED)) {
          const businessUnitId = businessUnitsByName[buName];
          if (!businessUnitId) continue; // that Business Unit isn't in the catalog yet — skip, not fatal
          for (const [i, f] of fields.entries()) {
            await addDoc(collection(db, "customFieldDefinitions"), {
              key: f.key, label_ar: f.label_ar, label_en: f.label_en, fieldType: f.fieldType,
              options: [], appliesTo: [businessUnitId], order: i,
              isActive: true, archivedAt: null, createdAt: now, updatedAt: now,
            });
          }
        }
      }
      await setDoc(doc(db, "settings", "seedState"), { ...seeded, customFieldDefinitionsSeeded: true, updatedAt: new Date().toISOString() }, { merge: true });
    })().catch((e) => console.warn("Custom field seed failed:", e));
  }, [currentUser?.id, currentUser?.role]);

  const activeFieldDefs = fieldDefs.filter((f) => f.isActive);
  const fieldDefById = (id) => fieldDefs.find((f) => f.id === id) || null;
  const fieldDefsForBusinessUnit = (businessUnitId) =>
    activeFieldDefs.filter((f) => !f.appliesTo?.length || f.appliesTo.includes(businessUnitId)).sort((a, b) => a.order - b.order);

  const addFieldDef = async (form) => {
    const now = new Date().toISOString();
    const ref = await addDoc(collection(db, "customFieldDefinitions"), {
      key: form.key, label_ar: form.label_ar || "", label_en: form.label_en || "",
      fieldType: form.fieldType || "text", options: form.options || [],
      appliesTo: form.appliesTo || [], order: form.order ?? fieldDefs.length,
      isActive: true, archivedAt: null, createdAt: now, updatedAt: now,
    });
    return ref.id;
  };

  const updateFieldDef = async (id, updates) => {
    await updateDoc(doc(db, "customFieldDefinitions", id), { ...updates, updatedAt: new Date().toISOString() });
  };

  const archiveFieldDef = async (id) => {
    await updateDoc(doc(db, "customFieldDefinitions", id), { isActive: false, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };

  const restoreFieldDef = async (id) => {
    await updateDoc(doc(db, "customFieldDefinitions", id), { isActive: true, archivedAt: null, updatedAt: new Date().toISOString() });
  };

  return (
    <CustomFieldCtx.Provider value={{
      fieldDefs, activeFieldDefs, loading,
      fieldDefById, fieldDefsForBusinessUnit,
      addFieldDef, updateFieldDef, archiveFieldDef, restoreFieldDef,
    }}>
      {children}
    </CustomFieldCtx.Provider>
  );
}

export const useCustomFields = () => useContext(CustomFieldCtx);
