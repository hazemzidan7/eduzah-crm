import { createContext, useContext, useState, useEffect } from "react";
import { collection, doc, addDoc, updateDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./AuthContext";
import {
  FOLLOW_UPS_COLLECTION,
  validateFollowUpDraft,
  buildFollowUp,
  buildCompletionPatch,
  buildNextFollowUpDraft,
} from "../utils/followUps";

const FollowUpCtx = createContext(null);

// CRM-05 FINALIZATION — "admin" sees every follow-up; "sales" is the one
// other role allowed in, same shape as AccountingContext's
// canAccessAccounting. Deliberately NOT the same gate as CustomerContext
// (customers/engagements stay admin-only, untouched) — Follow-ups is the
// only CRM surface Sales gets.
export const canAccessFollowUps = (currentUser) =>
  currentUser?.role === "admin" || currentUser?.role === "sales";

/**
 * CRM-05 — Follow-up & Reminders data layer.
 *
 * Admin: unfiltered listener, sees every follow-up (firestore.rules'
 * isAdmin() clause on /followUps).
 *
 * Sales: same unfiltered `collection()` listener — no query changes needed.
 * firestore.rules' isSalesStaff() clause restricts LIST results to only
 * documents where `assignedTo == request.auth.uid`, so this listener
 * naturally receives just their own queue; there is no need (and no way,
 * since Sales has no read access to customers/engagements) for this
 * component to resolve student identity itself — buildFollowUp/
 * buildNextFollowUpDraft (utils/followUps.js) denormalize customerName/
 * customerPhone/programLabel onto the doc at creation time specifically so
 * Sales never needs that separate lookup.
 */
export function FollowUpProvider({ children }) {
  const { currentUser } = useAuth();
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canAccessFollowUps(currentUser)) { setFollowUps([]); setLoading(false); return; }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, FOLLOW_UPS_COLLECTION),
      (snap) => { setFollowUps(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [currentUser?.id, currentUser?.role]);

  const followUpById = (id) => followUps.find((f) => f.id === id) || null;
  const followUpsForEngagement = (engagementId) => followUps.filter((f) => f.engagementId === engagementId);

  const addFollowUp = async (draft) => {
    const errors = validateFollowUpDraft(draft);
    if (errors.length > 0) throw new Error(`INVALID_FOLLOW_UP: ${errors.join(", ")}`);
    const built = buildFollowUp(draft, { currentUser });
    const ref = await addDoc(collection(db, FOLLOW_UPS_COLLECTION), built);
    return ref.id;
  };

  // Edit: only dueAt/note/assignedTo are ever changed on an existing
  // follow-up — customerId/engagementId/status/completion fields are not
  // editable here (status changes go through completeFollowUp/cancelFollowUp).
  const updateFollowUp = async (id, { dueAt, note, assignedTo }) => {
    const patch = { updatedAt: new Date().toISOString() };
    if (dueAt !== undefined) patch.dueAt = dueAt;
    if (note !== undefined) patch.note = note;
    if (assignedTo !== undefined) patch.assignedTo = assignedTo || null;
    await updateDoc(doc(db, FOLLOW_UPS_COLLECTION, id), patch);
  };

  /**
   * Marks a follow-up Complete and, when `nextFollowUp` is supplied, creates
   * a brand-new follow-up doc chained to the same customer/engagement — the
   * just-completed doc is never overwritten (rule: "do not overwrite the
   * completed follow-up").
   */
  const completeFollowUp = async (id, { result, nextFollowUp = null } = {}) => {
    const current = followUpById(id);
    if (!current) return;
    const patch = buildCompletionPatch({ result, currentUser });
    await updateDoc(doc(db, FOLLOW_UPS_COLLECTION, id), patch);
    if (nextFollowUp?.dueAt) {
      await addFollowUp(buildNextFollowUpDraft(current, nextFollowUp));
    }
  };

  const cancelFollowUp = async (id) => {
    await updateDoc(doc(db, FOLLOW_UPS_COLLECTION, id), { status: "cancelled", updatedAt: new Date().toISOString() });
  };

  return (
    <FollowUpCtx.Provider value={{
      followUps, loading, followUpById, followUpsForEngagement,
      addFollowUp, updateFollowUp, completeFollowUp, cancelFollowUp,
    }}>
      {children}
    </FollowUpCtx.Provider>
  );
}

export const useFollowUps = () => useContext(FollowUpCtx);
