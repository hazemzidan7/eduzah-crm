import { createContext, useContext, useState, useEffect } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { initializeApp, deleteApp } from "firebase/app";
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, where, limit, onSnapshot,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth, db, app, firebaseConfig } from "../firebase";
import { courseIdsFromEnrolled } from "../utils/enrollment";
import {
  appendPlainNotification,
  patchAfterEnroll,
  patchAfterLesson,
  patchCourseComplete,
} from "../utils/gamification";
import { PHONE_PENDING_KEY } from "../utils/phoneE164";

const AuthCtx = createContext(null);

export { courseIdsFromEnrolled };

export function AuthProvider({ children }) {
  const [currentUser, setCU]  = useState(null);
  const [users,       setUsers] = useState([]);
  const [loading,   setLoading] = useState(true);

  useEffect(() => {
    // Safety net: if Firebase doesn't respond in 8 s, unblock the UI
    const timer = setTimeout(() => setLoading(false), 8000);

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      clearTimeout(timer);
      try {
        if (firebaseUser) {
          const snap = await getDoc(doc(db, "users", firebaseUser.uid));
          if (snap.exists()) {
            const data = snap.data();
            const merged = {
              ...data,
              xp: data.xp ?? 0,
              level: data.level ?? 1,
              badges: Array.isArray(data.badges) ? data.badges : [],
              userNotifications: Array.isArray(data.userNotifications) ? data.userNotifications : [],
              courseActivity: data.courseActivity && typeof data.courseActivity === "object" ? data.courseActivity : {},
            };
            setCU({ id: firebaseUser.uid, ...merged });
            const persist = {};
            if (data.xp == null) persist.xp = 0;
            if (data.level == null) persist.level = 1;
            if (!Array.isArray(data.badges)) persist.badges = [];
            if (!Array.isArray(data.userNotifications)) persist.userNotifications = [];
            if (data.courseActivity == null) persist.courseActivity = {};
            if (Object.keys(persist).length) {
              updateDoc(doc(db, "users", firebaseUser.uid), persist).catch(() => {});
            }
          } else {
            try {
              if (
                firebaseUser.phoneNumber
                && typeof sessionStorage !== "undefined"
                && sessionStorage.getItem(PHONE_PENDING_KEY) === "1"
              ) {
                setCU(null);
                setLoading(false);
                return;
              }
            } catch (_) { /* ignore */ }
            await signOut(auth);
            setCU(null);
          }
        } else {
          setCU(null);
        }
      } catch (err) {
        console.error("Auth state error:", err);
        setCU(null);
      } finally {
        setLoading(false);
      }
    });
    return () => { clearTimeout(timer); unsub(); };
  }, []);

  /* Live-sync profile when admins grant course access or update the user document. */
  useEffect(() => {
    if (!currentUser?.id) return undefined;
    const uid = currentUser.id;
    const unsub = onSnapshot(doc(db, "users", uid), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setCU((prev) => {
        if (!prev || prev.id !== uid) return prev;
        return {
          ...prev,
          ...data,
          id: uid,
          xp: data.xp ?? 0,
          level: data.level ?? 1,
          badges: Array.isArray(data.badges) ? data.badges : [],
          userNotifications: Array.isArray(data.userNotifications) ? data.userNotifications : [],
          courseActivity: data.courseActivity && typeof data.courseActivity === "object" ? data.courseActivity : {},
        };
      });
    });
    return () => unsub();
  }, [currentUser?.id]);

  /* One-time backfill of enrolledCourseIds for profiles created before this field existed. */
  useEffect(() => {
    if (!currentUser?.id) return;
    const ec = currentUser.enrolledCourses;
    if (!ec?.length || (currentUser.enrolledCourseIds && currentUser.enrolledCourseIds.length > 0)) return;
    const ids = courseIdsFromEnrolled(ec);
    if (ids.length) updateDoc(doc(db, "users", currentUser.id), { enrolledCourseIds: ids }).catch(() => {});
  }, [currentUser?.id, currentUser?.enrolledCourses, currentUser?.enrolledCourseIds]);

  /* Load directory users for admin (all) or instructor (students only). */
  useEffect(() => {
    if (!currentUser) {
      setUsers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (currentUser.role === "admin") {
          const snap = await getDocs(collection(db, "users"));
          if (!cancelled) setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        } else if (currentUser.role === "instructor") {
          const q = query(collection(db, "users"), where("role", "in", ["student", "user"]));
          const snap = await getDocs(q);
          if (!cancelled) setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        } else {
          setUsers([]);
        }
      } catch (e) {
        console.error("Users list load failed:", e);
        if (!cancelled) setUsers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id, currentUser?.role]);

  const fetchUsers = async () => {
    const snap = await getDocs(collection(db, "users"));
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setUsers(list);
    return list;
  };

  /**
   * Public registration — account is active immediately (no admin approval).
   */
  const register = async (d) => {
    const email = d.email.trim().toLowerCase();
    try {
      const methods = await fetchSignInMethodsForEmail(auth, email);
      if (methods.length > 0) {
        // Email exists in Auth — check if Firestore profile also exists
        const profileSnap = await getDocs(
          query(collection(db, "users"), where("email", "==", email), limit(1))
        );
        if (!profileSnap.empty) {
          // Real duplicate — profile exists
          return { ok: false, code: "EMAIL_EXISTS" };
        }
        // Orphaned Auth account (e.g. previously deleted by admin) —
        // try to sign in with the provided password and recreate Firestore profile
        try {
          const orphanCred = await signInWithEmailAndPassword(auth, email, d.pass);
          const uid = orphanCred.user.uid;
          const enrolledCourses = [];
          const welcomeMsg =
            "تم إنشاء حسابك بنجاح — يمكنك الآن استكشاف المنصة والتقديم على الكورسات. | "
            + "Your account is ready — explore the platform and apply for courses.";
          const userNotifications = appendPlainNotification({ userNotifications: [] }, welcomeMsg);
          await setDoc(doc(db, "users", uid), {
            name: d.name, email,
            role: d.role || "user",
            status: "approved",
            avatar: (d.name && d.name[0]) ? d.name[0].toUpperCase() : "?",
            phone: d.phone || "",
            enrolledCourses,
            enrolledCourseIds: courseIdsFromEnrolled(enrolledCourses),
            assignedCourses: [],
            xp: 0, level: 1, badges: [],
            userNotifications,
            lastViewedCourseId: null, lastViewedAt: null, courseActivity: {},
            createdAt: new Date().toISOString(),
          });
          return { ok: true, uid };
        } catch (orphanErr) {
          // Password doesn't match old account — tell user to use forgot-password
          if (["auth/wrong-password", "auth/invalid-credential"].includes(orphanErr.code)) {
            return { ok: false, code: "EMAIL_EXISTS_RESET_NEEDED" };
          }
          return { ok: false, code: orphanErr.code || "EMAIL_EXISTS" };
        }
      }
    } catch {
      /* If enumeration protection blocks this, we still rely on createUser below. */
    }
    let cred = null;
    try {
      cred = await createUserWithEmailAndPassword(auth, email, d.pass);
      const enrolledCourses = [];
      const welcomeMsg =
        "تم إنشاء حسابك بنجاح — يمكنك الآن استكشاف المنصة والتقديم على الكورسات. | "
        + "Your account is ready — explore the platform and apply for courses.";
      const userNotifications = appendPlainNotification({ userNotifications: [] }, welcomeMsg);
      await setDoc(doc(db, "users", cred.user.uid), {
        name: d.name,
        email,
        role: "user",
        status: "approved",
        avatar: (d.name && d.name[0]) ? d.name[0].toUpperCase() : "?",
        phone: d.phone || "",
        enrolledCourses,
        enrolledCourseIds: courseIdsFromEnrolled(enrolledCourses),
        assignedCourses: [],
        xp: 0,
        level: 1,
        badges: [],
        userNotifications,
        lastViewedCourseId: null,
        lastViewedAt: null,
        courseActivity: {},
        createdAt: new Date().toISOString(),
      });
      return { ok: true, uid: cred.user.uid };
    } catch (err) {
      // If Auth account was created but Firestore write failed, delete the orphaned Auth account
      // so the user can retry registration cleanly next time.
      if (cred?.user && err.code !== "auth/email-already-in-use") {
        try { await cred.user.delete(); } catch (_) {}
        await signOut(auth).catch(() => {});
      }
      if (err.code === "auth/email-already-in-use") return { ok: false, code: "EMAIL_EXISTS" };
      return { ok: false, code: err.message };
    }
  };

  const login = async (email, pass) => {
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), pass);
      const snap = await getDoc(doc(db, "users", cred.user.uid));
      if (!snap.exists()) {
        // Orphaned Auth account — sign out and tell them to re-register
        await signOut(auth);
        return { ok: false, code: "NO_PROFILE" };
      }
      const u = snap.data();
      if (u.status === "rejected") { await signOut(auth); return { ok: false, code: "REJECTED" }; }
      setCU({ id: cred.user.uid, ...u });
      return { ok: true, role: u.role };
    } catch (err) {
      if (["auth/invalid-credential","auth/wrong-password","auth/user-not-found"].includes(err.code))
        return { ok: false, code: "BAD_CREDENTIALS" };
      return { ok: false, code: "FIREBASE_ERROR", msg: err.message };
    }
  };

  const logout = () => signOut(auth).then(() => setCU(null));

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      const profileRef = doc(db, "users", user.uid);
      const profileSnap = await getDoc(profileRef);
      if (!profileSnap.exists()) {
        const welcomeMsg =
          "تم إنشاء حسابك بنجاح — يمكنك الآن استكشاف المنصة. | "
          + "Your account is ready — start exploring the platform.";
        const userNotifications = appendPlainNotification({ userNotifications: [] }, welcomeMsg);
        const enrolledCourses = [];
        await setDoc(profileRef, {
          name: user.displayName ?? "",
          email: user.email ?? "",
          phone: "",
          role: "user",
          status: "approved",
          avatar: (user.displayName?.[0] || "?").toUpperCase(),
          avatarImg: user.photoURL || null,
          enrolledCourses,
          enrolledCourseIds: courseIdsFromEnrolled(enrolledCourses),
          assignedCourses: [],
          xp: 0, level: 1, badges: [],
          userNotifications,
          lastViewedCourseId: null, lastViewedAt: null, courseActivity: {},
          provider: "google",
          createdAt: new Date().toISOString(),
        });
      } else {
        const data = profileSnap.data();
        if (data.status === "rejected") { await signOut(auth); return { ok: false, code: "REJECTED" }; }
      }
      return { ok: true };
    } catch (err) {
      if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request")
        return { ok: false, code: "CANCELLED" };
      return { ok: false, code: err.code || "GOOGLE_ERROR" };
    }
  };

  /**
   * After Firebase Phone Auth `confirm()`, create or load Firestore profile.
   * For register flow, set sessionStorage PHONE_PENDING_KEY before sending SMS (see Auth.jsx).
   */
  const finalizePhoneSignIn = async (firebaseUser, { mode, name, phoneDisplay }) => {
    const uid = firebaseUser.uid;
    const phone = firebaseUser.phoneNumber || "";
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const data = snap.data();
      if (data.status === "rejected") {
        await signOut(auth);
        try { sessionStorage.removeItem(PHONE_PENDING_KEY); } catch (_) {}
        return { ok: false, code: "REJECTED" };
      }
      const merged = {
        ...data,
        xp: data.xp ?? 0,
        level: data.level ?? 1,
        badges: Array.isArray(data.badges) ? data.badges : [],
        userNotifications: Array.isArray(data.userNotifications) ? data.userNotifications : [],
        courseActivity: data.courseActivity && typeof data.courseActivity === "object" ? data.courseActivity : {},
      };
      setCU({ id: uid, ...merged });
      try { sessionStorage.removeItem(PHONE_PENDING_KEY); } catch (_) {}
      return { ok: true, role: data.role };
    }
    if (mode === "register" && name?.trim()) {
      const enrolledCourses = [];
      const welcomeMsg =
        "تم إنشاء حسابك بنجاح — يمكنك الآن استكشاف المنصة والتقديم على الكورسات. | "
        + "Your account is ready — explore the platform and apply for courses.";
      const userNotifications = appendPlainNotification({ userNotifications: [] }, welcomeMsg);
      const displayPhone = phoneDisplay || phone.replace(/^\+/, "") || "";
      await setDoc(doc(db, "users", uid), {
        name: name.trim(),
        email: "",
        phone: displayPhone,
        role: "user",
        status: "approved",
        avatar: (name.trim()[0] || "?").toUpperCase(),
        enrolledCourses,
        enrolledCourseIds: courseIdsFromEnrolled(enrolledCourses),
        assignedCourses: [],
        xp: 0,
        level: 1,
        badges: [],
        userNotifications,
        lastViewedCourseId: null,
        lastViewedAt: null,
        courseActivity: {},
        createdAt: new Date().toISOString(),
      });
      try { sessionStorage.removeItem(PHONE_PENDING_KEY); } catch (_) {}
      await refreshUserProfileAfterPhone(uid);
      return { ok: true };
    }
    await signOut(auth);
    try { sessionStorage.removeItem(PHONE_PENDING_KEY); } catch (_) {}
    return { ok: false, code: "NO_PROFILE" };
  };

  async function refreshUserProfileAfterPhone(uid) {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return;
    const data = snap.data();
    setCU({
      id: uid,
      ...data,
      xp: data.xp ?? 0,
      level: data.level ?? 1,
      badges: Array.isArray(data.badges) ? data.badges : [],
      userNotifications: Array.isArray(data.userNotifications) ? data.userNotifications : [],
      courseActivity: data.courseActivity && typeof data.courseActivity === "object" ? data.courseActivity : {},
    });
  }

  /** Re-load Firestore profile for the signed-in user (e.g. after notification writes). */
  const refreshUserProfile = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return;
    const data = snap.data();
    setCU({
      id: uid,
      ...data,
      xp: data.xp ?? 0,
      level: data.level ?? 1,
      badges: Array.isArray(data.badges) ? data.badges : [],
      userNotifications: Array.isArray(data.userNotifications) ? data.userNotifications : [],
      courseActivity: data.courseActivity && typeof data.courseActivity === "object" ? data.courseActivity : {},
    });
  };

  /** Legacy / admin: unblock user account only (course access is via enrollment requests). */
  const approveUser = async (id) => {
    await updateDoc(doc(db, "users", id), { status: "approved", pendingEnrollmentCourseId: null });
    setUsers((p) => p.map((usr) => (usr.id === id ? { ...usr, status: "approved", pendingEnrollmentCourseId: null } : usr)));
    if (currentUser?.id === id) {
      setCU((prev) => (prev ? { ...prev, status: "approved", pendingEnrollmentCourseId: null } : prev));
    }
  };

  const rejectUser = async (id) => {
    await updateDoc(doc(db, "users", id), { status: "rejected" });
    setUsers((p) => p.map((u) => (u.id === id ? { ...u, status: "rejected" } : u)));
  };

  /**
   * Permanently remove a user's Firestore profile + cascade cleanup.
   * - Instructor: clears instructorId on all assigned courses.
   * - Student/User: their enrolledCourses are gone with the doc.
   * Firebase Auth account is preserved (can't delete from client SDK),
   * but register() detects the orphaned account and allows re-registration.
   */
  const deleteUser = async (id) => {
    if (!id || id === currentUser?.id) return { ok: false, code: "SELF_DELETE" };
    const snap = await getDoc(doc(db, "users", id));
    if (!snap.exists()) return { ok: false, code: "NOT_FOUND" };
    const userData = snap.data();
    if (userData.role === "admin") return { ok: false, code: "CANNOT_DELETE_ADMIN" };

    // Cascade: if instructor, unset instructorId on all their courses
    if (userData.role === "instructor") {
      try {
        const coursesSnap = await getDocs(
          query(collection(db, "courses"), where("instructorId", "==", id))
        );
        await Promise.all(
          coursesSnap.docs.map((cd) => updateDoc(cd.ref, { instructorId: null }))
        );
      } catch (e) {
        console.warn("[deleteUser] course cascade failed:", e?.code);
      }
    }

    await deleteDoc(doc(db, "users", id));
    setUsers((p) => p.filter((u) => u.id !== id));
    return { ok: true };
  };

  const adminUpdateUser = async (id, patch) => {
    const allowedRoles = ["user", "student", "instructor", "admin"];
    const roleNext = patch.role != null && allowedRoles.includes(patch.role) ? patch.role : null;
    const clean = {
      ...(patch.name  != null && { name:  String(patch.name).trim()  }),
      ...(patch.email != null && { email: String(patch.email).trim().toLowerCase() }),
      ...(patch.phone != null && { phone: String(patch.phone).trim() }),
      ...(roleNext != null && { role: roleNext }),
      ...(roleNext === "admin" && { status: "approved" }),
    };
    await updateDoc(doc(db, "users", id), clean);
    setUsers((p) => p.map((u) => (u.id === id ? { ...u, ...clean } : u)));
    if (currentUser?.id === id) setCU((prev) => ({ ...prev, ...clean }));
  };

  /** Guest requests may omit userId; resolve platform uid by profile email (admin approve / notify). */
  const resolveUserIdForEnrollmentRequest = async (r) => {
    if (r.userId) return r.userId;
    const em = String(r.studentEmail || "").trim().toLowerCase();
    if (!em.includes("@")) return null;
    try {
      const qs = await getDocs(query(collection(db, "users"), where("email", "==", em), limit(1)));
      if (qs.empty) return null;
      return qs.docs[0].id;
    } catch (_) {
      return null;
    }
  };

  const normalizeContactStatus = (v) => {
    const s = String(v || "").trim();
    if (!s) return "no_response";
    if (s === "not_contacted") return "no_response";
    if (s === "contacted") return "confirmed_will_pay";
    return s;
  };

  const enrollUser = async (uid, cid, opts = null) => {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return;
    const u = snap.data();
    if ((u.enrolledCourses || []).find((e) => e.courseId === cid)) return;
    const updated = [...(u.enrolledCourses || []), {
      courseId: cid, progress: 0, completedLessons: [],
      enrollDate: new Date().toLocaleDateString("ar-EG"),
      // Admin dashboard uses this for follow-up tracking per course enrollment
      contactStatus: normalizeContactStatus(opts?.contactStatus),
      contactUpdatedAt: null,
    }];
    const enrolledCourseIds = courseIdsFromEnrolled(updated);
    const roleNext = u.role === "user" ? "student" : u.role;
    let courseTitle = "";
    try {
      const cs = await getDoc(doc(db, "courses", cid));
      if (cs.exists()) courseTitle = cs.data().title || "";
    } catch (_) {}
    const gam = patchAfterEnroll(u, courseTitle);
    await updateDoc(doc(db, "users", uid), {
      enrolledCourses: updated,
      enrolledCourseIds,
      ...(roleNext !== u.role ? { role: roleNext } : {}),
      xp: gam.xp,
      level: gam.level,
      badges: gam.badges,
      userNotifications: gam.userNotifications,
    });
    setUsers((p) => p.map((usr) => (usr.id === uid ? {
      ...usr,
      enrolledCourses: updated,
      enrolledCourseIds,
      role: roleNext,
      xp: gam.xp,
      level: gam.level,
      badges: gam.badges,
      userNotifications: gam.userNotifications,
    } : usr)));
    if (currentUser?.id === uid) {
      setCU((prev) => ({
        ...prev,
        enrolledCourses: updated,
        enrolledCourseIds,
        role: roleNext,
        xp: gam.xp,
        level: gam.level,
        badges: gam.badges,
        userNotifications: gam.userNotifications,
      }));
    }
  };

  const approveEnrollmentRequest = async (requestId) => {
    const refReq = doc(db, "enrollmentRequests", requestId);
    const snap = await getDoc(refReq);
    if (!snap.exists()) return { ok: false, code: "NOT_FOUND" };
    const r = snap.data();
    const st = r.enrollmentStatus ?? "pending";
    if (st === "approved") return { ok: true };
    if (st === "rejected") return { ok: false, code: "ALREADY_REJECTED" };

    const uid = await resolveUserIdForEnrollmentRequest(r);
    if (uid) {
      await enrollUser(uid, r.courseId, { contactStatus: r.contactStatus || r.enrollmentContactStatus || null });
      const uRef = doc(db, "users", uid);
      const uSnap = await getDoc(uRef);
      if (uSnap.exists()) {
        const u = uSnap.data();
        const msg =
          "تمت الموافقة على طلبك — يمكنك الآن البدء في الكورس من «كورساتي». | "
          + "Your enrollment was approved — open My Courses to start learning.";
        const userNotifications = appendPlainNotification(u, msg);
        await updateDoc(uRef, { userNotifications });
        if (currentUser?.id === uid) setCU((prev) => (prev ? { ...prev, userNotifications } : prev));
      }
    }

    await updateDoc(refReq, {
      status: "approved",
      enrollmentStatus: "approved",
      reviewedAt: new Date().toISOString(),
      ...(currentUser?.id ? { reviewedBy: currentUser.id } : {}),
      ...(!r.userId && uid ? { userId: uid } : {}),
    });
    return { ok: true };
  };

  const rejectEnrollmentRequest = async (requestId, reason = "") => {
    const refReq = doc(db, "enrollmentRequests", requestId);
    const snap = await getDoc(refReq);
    if (!snap.exists()) return { ok: false, code: "NOT_FOUND" };
    const r = snap.data();
    await updateDoc(refReq, {
      status: "rejected",
      enrollmentStatus: "rejected",
      rejectReason: String(reason || "").trim(),
      reviewedAt: new Date().toISOString(),
      ...(currentUser?.id ? { reviewedBy: currentUser.id } : {}),
    });
    const uid = await resolveUserIdForEnrollmentRequest(r);
    if (uid) {
      const uRef = doc(db, "users", uid);
      const uSnap = await getDoc(uRef);
      if (uSnap.exists()) {
        const u = uSnap.data();
        const base =
          "لم تتم الموافقة على طلب التسجيل في الكورس. | Your course enrollment request was not approved.";
        const msg = reason?.trim()
          ? `${base} (${reason.trim()})`
          : `${base}`;
        const userNotifications = appendPlainNotification(u, msg);
        await updateDoc(uRef, { userNotifications });
        if (currentUser?.id === uid) setCU((prev) => (prev ? { ...prev, userNotifications } : prev));
      }
    }
    return { ok: true };
  };

  const removeEnroll = async (uid, cid) => {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return;
    const updated = (snap.data().enrolledCourses || []).filter((e) => e.courseId !== cid);
    const enrolledCourseIds = courseIdsFromEnrolled(updated);
    await updateDoc(doc(db, "users", uid), { enrolledCourses: updated, enrolledCourseIds });
    setUsers((p) => p.map((u) => (u.id === uid ? { ...u, enrolledCourses: updated, enrolledCourseIds } : u)));
    if (currentUser?.id === uid) setCU((prev) => ({ ...prev, enrolledCourses: updated, enrolledCourseIds }));
  };

  const assignInstructor = async (uid, cid) => {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (!userSnap.exists()) return;
    const courseRef = doc(db, "courses", cid);
    const courseSnap = await getDoc(courseRef);
    if (!courseSnap.exists()) return;
    const prevId = courseSnap.data().instructorId || null;

    if (prevId && prevId !== uid) {
      const prevSnap = await getDoc(doc(db, "users", prevId));
      if (prevSnap.exists()) {
        const ac = (prevSnap.data().assignedCourses || []).filter((x) => x !== cid);
        await updateDoc(doc(db, "users", prevId), { assignedCourses: ac });
        setUsers((p) => p.map((u) => (u.id === prevId ? { ...u, assignedCourses: ac } : u)));
      }
    }

    const assigned = [...new Set([...(userSnap.data().assignedCourses || []), cid])];
    await updateDoc(doc(db, "users", uid), { assignedCourses: assigned });
    await updateDoc(courseRef, { instructorId: uid });
    setUsers((p) => p.map((u) => (u.id === uid ? { ...u, assignedCourses: assigned } : u)));
  };

  const unassignInstructorFromCourse = async (cid) => {
    const courseRef = doc(db, "courses", cid);
    const courseSnap = await getDoc(courseRef);
    if (!courseSnap.exists()) return;
    const prevId = courseSnap.data().instructorId || null;
    if (!prevId) return;
    const prevSnap = await getDoc(doc(db, "users", prevId));
    if (prevSnap.exists()) {
      const ac = (prevSnap.data().assignedCourses || []).filter((x) => x !== cid);
      await updateDoc(doc(db, "users", prevId), { assignedCourses: ac });
      setUsers((p) => p.map((u) => (u.id === prevId ? { ...u, assignedCourses: ac } : u)));
    }
    await updateDoc(courseRef, { instructorId: null });
  };

  const updateProfile = async (updates) => {
    if (!currentUser) return;
    const allowed = ["name", "phone", "avatar", "avatarImg"];
    const patch = {};
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(updates, k)) patch[k] = updates[k];
    }
    if (Object.keys(patch).length === 0) return;
    await updateDoc(doc(db, "users", currentUser.id), patch);
    setCU((prev) => ({ ...prev, ...patch }));
  };

  const markLesson = async (cid, idx, total, courseTitle = "") => {
    if (!currentUser) return;
    const ref = doc(db, "users", currentUser.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const u = snap.data();
    const entryBefore = (u.enrolledCourses || []).find((e) => e.courseId === cid);
    const wasDone = entryBefore?.completedLessons?.includes(idx);
    const prevProg = entryBefore?.progress || 0;

    const ec = (u.enrolledCourses || []).map((e) => {
      if (e.courseId !== cid) return e;
      const done = e.completedLessons.includes(idx) ? e.completedLessons : [...e.completedLessons, idx];
      return { ...e, completedLessons: done, progress: Math.round((done.length / total) * 100) };
    });
    const entryAfter = ec.find((e) => e.courseId === cid);
    const newProg = entryAfter?.progress || 0;
    const enrolledCourseIds = courseIdsFromEnrolled(ec);

    let patch = { enrolledCourses: ec, enrolledCourseIds };
    let base = { ...u, ...patch };

    if (!wasDone) {
      const totalLessonsDone = ec.reduce((sum, e) => sum + (e.completedLessons?.length || 0), 0);
      const pl = patchAfterLesson(u, totalLessonsDone);
      patch = { ...patch, xp: pl.xp, level: pl.level, badges: pl.badges, userNotifications: pl.userNotifications };
      base = { ...base, ...pl };
    }
    if (newProg === 100 && prevProg < 100) {
      const pc = patchCourseComplete(base, courseTitle);
      patch = { ...patch, xp: pc.xp, level: pc.level, badges: pc.badges, userNotifications: pc.userNotifications };
    }

    await updateDoc(ref, patch);
    setCU((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const recordCourseView = async (courseId) => {
    if (!currentUser?.id || !courseId) return;
    const ref = doc(db, "users", currentUser.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const u = snap.data();
    const activity = { ...(u.courseActivity || {}) };
    const cur = activity[courseId] || { views: 0 };
    activity[courseId] = { views: (cur.views || 0) + 1, lastAt: new Date().toISOString() };
    const patch = {
      lastViewedCourseId: courseId,
      lastViewedAt: new Date().toISOString(),
      courseActivity: activity,
    };
    await updateDoc(ref, patch);
    setCU((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const toggleWishlist = async (courseId) => {
    if (!currentUser?.id || !courseId) return;
    const current = currentUser.wishlist || [];
    const next = current.includes(courseId)
      ? current.filter((id) => id !== courseId)
      : [...current, courseId];
    const patch = { wishlist: next };
    await updateDoc(doc(db, "users", currentUser.id), patch);
    setCU((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  /**
   * Try 8-digit email code (Cloud Function + Resend). If unavailable, falls back to Firebase reset link.
   * Returns { ok, mode: 'otp'|'link', sent?: boolean, usedDefaultEmailLink?: boolean } or { ok: false, code }.
   */
  const startPasswordReset = async (email) => {
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) return { ok: false, code: "invalid-email" };
    try {
      const functions = getFunctions(app, "us-central1");
      const callable = httpsCallable(functions, "requestPasswordResetOtp");
      const { data } = await callable({ email: e });
      if (data?.ok === true) {
        return { ok: true, mode: "otp", sent: data.sent !== false };
      }
    } catch (err) {
      const code = String(err.code || "");
      if (code.includes("resource-exhausted")) {
        return { ok: false, code: "rate-limit" };
      }
    }
    const r = await requestPasswordReset(email);
    if (r.ok) return { ok: true, mode: "link", usedDefaultEmailLink: r.usedDefaultEmailLink };
    return { ok: false, code: r.code };
  };

  const confirmPasswordResetOtp = async ({ email, code, newPassword }) => {
    try {
      const functions = getFunctions(app, "us-central1");
      const callable = httpsCallable(functions, "confirmPasswordResetOtp");
      await callable({
        email: email.trim().toLowerCase(),
        code: String(code || "").replace(/\D/g, ""),
        newPassword,
      });
      return { ok: true };
    } catch (err) {
      const code = String(err.code || "");
      if (code === "functions/not-found") return { ok: false, code: "NOT_DEPLOYED" };
      if (code.includes("permission-denied")) return { ok: false, code: "BAD_CODE" };
      if (code.includes("deadline-exceeded")) return { ok: false, code: "EXPIRED" };
      if (code.includes("resource-exhausted")) return { ok: false, code: "TOO_MANY_ATTEMPTS" };
      if (code.includes("not-found")) return { ok: false, code: "NO_CODE" };
      if (code.includes("invalid-argument")) return { ok: false, code: "INVALID_PASSWORD" };
      return { ok: false, code: err.code || "unknown" };
    }
  };

  const requestPasswordReset = async (email) => {
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) return { ok: false, code: "invalid-email" };
    const withContinueUrl = () => {
      if (typeof window === "undefined") return undefined;
      return {
        url: `${window.location.origin}/reset-password`,
        /* Web: true breaks the flow; false keeps the link opening our SPA with oobCode. */
        handleCodeInApp: false,
      };
    };
    const send = (settings) => sendPasswordResetEmail(auth, e, settings);
    try {
      await send(withContinueUrl());
      return { ok: true };
    } catch (err) {
      if (err.code === "auth/user-not-found") return { ok: true };
      if (err.code === "auth/invalid-email") return { ok: false, code: "invalid-email" };
      if (["auth/unauthorized-continue-uri", "auth/invalid-continue-uri"].includes(err.code)) {
        try {
          await send(undefined);
          return { ok: true, usedDefaultEmailLink: true };
        } catch (err2) {
          if (err2.code === "auth/user-not-found") return { ok: true };
          return { ok: false, code: err2.code || err.code };
        }
      }
      return { ok: false, code: err.code || "unknown" };
    }
  };

  const changePassword = async (newPassword) => {
    try {
      await updatePassword(auth.currentUser, newPassword);
      return { ok: true };
    } catch (err) {
      return { ok: false, code: err.message };
    }
  };

  /**
   * Create an instructor account from the admin panel without affecting the admin's session.
   * Uses a secondary Firebase app instance so the admin stays signed in.
   */
  const createInstructorAccount = async ({ name, email, password, phone = "" }) => {
    const e = email.trim().toLowerCase();
    if (!name.trim() || !e.includes("@") || password.length < 6) {
      return { ok: false, code: "INVALID_INPUT" };
    }
    // Check if email already taken
    try {
      const methods = await fetchSignInMethodsForEmail(auth, e);
      if (methods.length > 0) return { ok: false, code: "EMAIL_EXISTS" };
    } catch (_) {}

    let secondaryApp = null;
    try {
      // Create a secondary app instance — doesn't affect the admin's auth session
      secondaryApp = initializeApp(firebaseConfig, `instructor-create-${Date.now()}`);
      const secondaryAuth = getAuth(secondaryApp);
      const cred = await createUserWithEmailAndPassword(secondaryAuth, e, password);
      const uid = cred.user.uid;
      await signOut(secondaryAuth);

      const welcomeMsg =
        "تم إنشاء حسابك كمدرب — يمكنك الآن تسجيل الدخول والبدء. | "
        + "Your instructor account is ready — you can now sign in and get started.";
      const userNotifications = appendPlainNotification({ userNotifications: [] }, welcomeMsg);
      await setDoc(doc(db, "users", uid), {
        name: name.trim(),
        email: e,
        role: "instructor",
        status: "approved",
        avatar: name.trim()[0]?.toUpperCase() || "I",
        phone: phone.trim(),
        enrolledCourses: [],
        enrolledCourseIds: [],
        assignedCourses: [],
        xp: 0, level: 1, badges: [],
        userNotifications,
        lastViewedCourseId: null,
        lastViewedAt: null,
        courseActivity: {},
        createdAt: new Date().toISOString(),
      });
      await fetchUsers();
      return { ok: true, uid };
    } catch (err) {
      if (err.code === "auth/email-already-in-use") return { ok: false, code: "EMAIL_EXISTS" };
      return { ok: false, code: err.code || err.message };
    } finally {
      if (secondaryApp) deleteApp(secondaryApp).catch(() => {});
    }
  };

  /** Any signed-in admin — requires deployed Cloud Function `createAdminAccount`. */
  const createAdminAccount = async ({ name, email, password }) => {
    if (currentUser?.role !== "admin") {
      return { ok: false, code: "FORBIDDEN" };
    }
    try {
      const functions = getFunctions(app, "us-central1");
      const callable = httpsCallable(functions, "createAdminAccount");
      await callable({ name: String(name).trim(), email: String(email).trim().toLowerCase(), password: String(password) });
      await fetchUsers();
      return { ok: true };
    } catch (err) {
      const code = err.code || err.message;
      return { ok: false, code: code === "functions/not-found" ? "NOT_DEPLOYED" : code };
    }
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--page-bg, #1a0f24)", color: "var(--page-text, #f8fafc)" }}>
      <div style={{ width: 36, height: 36, border: "3px solid rgba(217,27,91,.3)", borderTopColor: "#d91b5b", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <AuthCtx.Provider value={{
      users, currentUser, loading,
      fetchUsers, login, logout, register, signInWithGoogle, refreshUserProfile,
      approveUser, rejectUser, deleteUser, approveEnrollmentRequest, rejectEnrollmentRequest,
      enrollUser, removeEnroll,
      assignInstructor, unassignInstructorFromCourse, markLesson, recordCourseView, toggleWishlist, updateProfile, adminUpdateUser,
      requestPasswordReset, startPasswordReset, confirmPasswordResetOtp, changePassword,
      createAdminAccount, createInstructorAccount,
      finalizePhoneSignIn,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
