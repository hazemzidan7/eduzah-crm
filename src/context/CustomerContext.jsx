import { createContext, useContext, useState, useEffect } from "react";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  arrayUnion,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";
import { normalizePhone, normalizeEmail } from "../utils/leadDedupe";

const CustomerCtx = createContext(null);

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * The Unified Customer Model: `customers` holds identity only (one doc per
 * real human, ever — deduped globally by phone/email, independent of
 * Business Unit). `engagements` holds the many relationships a person can
 * have over their lifetime (one per Business Unit pursuit) — stage, status,
 * owner, tags, custom fields, and its own timeline all live there, not on
 * the person record. See the approved v2 architecture for the full reasoning.
 */
export function CustomerProvider({ children }) {
  const { currentUser } = useAuth();
  const [customers, setCustomers] = useState([]);
  const [engagements, setEngagements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentUser?.role !== "admin") { setCustomers([]); setEngagements([]); setLoading(false); return; }
    setLoading(true);
    const unsubCustomers = onSnapshot(
      collection(db, "customers"),
      (snap) => { setCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    const unsubEngagements = onSnapshot(
      collection(db, "engagements"),
      (snap) => setEngagements(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {},
    );
    return () => { unsubCustomers(); unsubEngagements(); };
  }, [currentUser?.id, currentUser?.role]);

  // ── PERSON-LEVEL DEDUP (global, across every Business Unit) ──────────
  const findCustomerByPhone = (phone) => {
    const np = normalizePhone(phone);
    if (!np) return null;
    return customers.find((c) => c.normalizedPhone === np || (c.secondaryPhones || []).some((p) => normalizePhone(p) === np)) || null;
  };
  const findCustomerByEmail = (email) => {
    const ne = email ? normalizeEmail(email) : null;
    if (!ne) return null;
    return customers.find((c) => c.normalizedEmail === ne) || null;
  };
  const customerById = (id) => customers.find((c) => c.id === id) || null;

  const addCustomer = async (form) => {
    const now = new Date().toISOString();
    const nc = {
      fullName: form.fullName || "",
      phone: form.phone || "",
      normalizedPhone: normalizePhone(form.phone),
      secondaryPhones: form.secondaryPhones || [],
      email: form.email || "",
      normalizedEmail: form.email ? normalizeEmail(form.email) : null,
      whatsapp: form.whatsapp || "",
      authUid: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await addDoc(collection(db, "customers"), nc);
    return ref.id;
  };

  // Find-or-create by phone (primary) then email (fallback) — never creates
  // a second customer doc for a person we already have a phone/email match for.
  const resolveOrCreateCustomer = async (form) => {
    const existing = findCustomerByPhone(form.phone) || findCustomerByEmail(form.email);
    if (existing) return existing.id;
    return addCustomer(form);
  };

  const updateCustomer = async (id, updates) => {
    const patch = { ...updates, updatedAt: new Date().toISOString() };
    if (updates.phone !== undefined) patch.normalizedPhone = normalizePhone(updates.phone);
    if (updates.email !== undefined) patch.normalizedEmail = updates.email ? normalizeEmail(updates.email) : null;
    await updateDoc(doc(db, "customers", id), patch);
  };

  const archiveCustomer = async (id) => {
    await updateDoc(doc(db, "customers", id), { archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };
  const restoreCustomer = async (id) => {
    await updateDoc(doc(db, "customers", id), { archivedAt: null, updatedAt: new Date().toISOString() });
  };

  // ── ENGAGEMENT-LEVEL DEDUP (does this person already have a relationship with this Business Unit?) ──
  const findEngagement = (customerId, businessUnitId) =>
    engagements.find((e) => e.customerId === customerId && e.businessUnitId === businessUnitId) || null;

  const engagementById = (id) => engagements.find((e) => e.id === id) || null;
  const engagementsForCustomer = (customerId) => engagements.filter((e) => e.customerId === customerId);
  const engagementsForBusinessUnit = (businessUnitId) => engagements.filter((e) => e.businessUnitId === businessUnitId);

  const addEngagement = async (customerId, form) => {
    const now = new Date().toISOString();
    const ne = {
      customerId,
      businessUnitId: form.businessUnitId,
      catalogNodeId: form.catalogNodeId || null,
      stage: form.stage || "lead",
      statusId: form.statusId || null,
      contactStatus: form.contactStatus || "not_contacted",
      ownerId: form.ownerId || null,
      tagIds: form.tagIds || [],
      customFields: form.customFields || {},
      timeline: [{
        id: genId(), type: "system",
        text: form.creationNote || "Engagement created",
        byUid: currentUser?.id || null, byName: currentUser?.name || null, at: now,
      }],
      attachments: [],
      sourceImportBatchIds: form.sourceImportBatchIds || [],
      mergedRecordCount: form.mergedRecordCount || 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await addDoc(collection(db, "engagements"), ne);
    return ref.id;
  };

  // Find-or-create: never creates a second engagement for the same
  // (customer, Business Unit) pair — callers (like the Import Engine) should
  // check findEngagement() first if they need to distinguish merge-vs-create.
  const resolveOrCreateEngagement = async (customerId, businessUnitId, form) => {
    const existing = findEngagement(customerId, businessUnitId);
    if (existing) return existing.id;
    return addEngagement(customerId, { ...form, businessUnitId });
  };

  const updateEngagement = async (id, updates) => {
    await updateDoc(doc(db, "engagements", id), { ...updates, updatedAt: new Date().toISOString() });
  };

  const changeEngagementStatus = async (id, newStatusId) => {
    const engagement = engagementById(id);
    const now = new Date().toISOString();
    await updateDoc(doc(db, "engagements", id), {
      statusId: newStatusId,
      updatedAt: now,
      timeline: arrayUnion({
        id: genId(), type: "status_change",
        statusFrom: engagement?.statusId || null, statusTo: newStatusId,
        byUid: currentUser?.id || null, byName: currentUser?.name || null, at: now,
      }),
    });
  };

  const logEngagementActivity = async (id, { type = "note", text = "" }) => {
    const now = new Date().toISOString();
    await updateDoc(doc(db, "engagements", id), {
      updatedAt: now,
      timeline: arrayUnion({
        id: genId(), type, text,
        byUid: currentUser?.id || null, byName: currentUser?.name || null, at: now,
      }),
    });
  };

  const archiveEngagement = async (id) => {
    await updateDoc(doc(db, "engagements", id), { archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };
  const restoreEngagement = async (id) => {
    await updateDoc(doc(db, "engagements", id), { archivedAt: null, updatedAt: new Date().toISOString() });
  };

  return (
    <CustomerCtx.Provider value={{
      customers, engagements, loading,
      findCustomerByPhone, findCustomerByEmail, customerById,
      addCustomer, resolveOrCreateCustomer, updateCustomer, archiveCustomer, restoreCustomer,
      findEngagement, engagementById, engagementsForCustomer, engagementsForBusinessUnit,
      addEngagement, resolveOrCreateEngagement, updateEngagement,
      changeEngagementStatus, logEngagementActivity, archiveEngagement, restoreEngagement,
    }}>
      {children}
    </CustomerCtx.Provider>
  );
}

export const useCustomers = () => useContext(CustomerCtx);
