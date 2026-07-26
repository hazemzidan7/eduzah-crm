import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { C, gHero, font } from "../../theme";
import { Btn } from "../../components/UI";
import { auth, db } from "../../firebase";
import { courseIdsFromEnrolled } from "../../utils/enrollment";
import { useLang } from "../../context/LangContext";
import { Seo } from "../../components/Seo";

const Field = ({ label, children, error }) => (
  <div style={{ marginBottom: 12 }}>
    {label && <label style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: "block", marginBottom: 5 }}>{label}</label>}
    {children}
    {error && <div style={{ fontSize: 11, color: C.danger, marginTop: 4 }}>{error}</div>}
  </div>
);

const inputSx = (err) => ({
  width: "100%", boxSizing: "border-box",
  background: "rgba(50,29,61,.6)",
  border: `1.5px solid ${err ? C.danger : C.border}`,
  borderRadius: 10, padding: "10px 13px",
  color: "#fff", fontFamily: font, fontSize: 13, outline: "none",
});

const validatePassword = (p) => {
  const rules = [
    { ok: p.length >= 8 },
    { ok: /[A-Z]/.test(p) },
    { ok: /[a-z]/.test(p) },
    { ok: /[0-9]/.test(p) },
    { ok: /[^A-Za-z0-9]/.test(p) },
  ];
  return rules.every((r) => r.ok);
};

/**
 * One-time first admin creation. Requires Firestore document:
 *   settings/bootstrap  →  { enabled: true }
 * Create it in Firebase Console, then open /setup-admin, then delete that document.
 */
export default function BootstrapAdmin() {
  const { lang } = useLang();
  const navigate = useNavigate();
  const ar = lang === "ar";

  const [ready, setReady] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "settings", "bootstrap"));
        if (cancelled) return;
        if (!snap.exists() || snap.data().enabled !== true) setReady(false);
        else setReady(true);
      } catch {
        if (!cancelled) setReady(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const submit = async () => {
    setErr("");
    if (!name.trim() || !email.includes("@")) {
      setErr(ar ? "أدخل الاسم وبريداً صالحاً" : "Enter name and a valid email");
      return;
    }
    if (!validatePassword(pass)) {
      setErr(ar ? "كلمة المرور لا تستوفي الشروط" : "Password does not meet requirements");
      return;
    }
    if (pass !== confirm) {
      setErr(ar ? "كلمة المرور غير متطابقة" : "Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
      const enrolledCourses = [];
      await setDoc(doc(db, "users", cred.user.uid), {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: "admin",
        status: "approved",
        avatar: name.trim()[0].toUpperCase(),
        phone: "",
        enrolledCourses,
        enrolledCourseIds: courseIdsFromEnrolled(enrolledCourses),
        assignedCourses: [],
        createdAt: new Date().toISOString(),
      });
      try {
        await deleteDoc(doc(db, "settings", "bootstrap"));
      } catch {
        /* Admin can remove settings/bootstrap manually from Console */
      }
      setDone(true);
      await signOut(auth);
      setTimeout(() => navigate("/login"), 800);
    } catch (e) {
      if (e.code === "auth/email-already-in-use") {
        setErr(ar ? "هذا البريد مستخدم. أنشئ المستند users/{uid} يدوياً أو استخدم بريداً آخر." : "Email already in use. Add users/{uid} manually or use another email.");
      } else {
        setErr(e.message || (ar ? "فشل الإنشاء" : "Creation failed"));
      }
    } finally {
      setLoading(false);
    }
  };

  if (ready === null) {
    return (
      <div style={{ minHeight: "calc(100vh - 60px)", background: gHero, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: C.muted }}>…</div>
      </div>
    );
  }

  return (
    <div dir={ar ? "rtl" : "ltr"} style={{ minHeight: "calc(100vh - 60px)", background: gHero, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px" }}>
      <Seo
        title={ar ? "إعداد أول مدير — Eduzah" : "First admin setup — Eduzah"}
        description={ar ? "إنشاء حساب المدير الأول (مرة واحدة)." : "One-time first admin account."}
      />
      <div style={{ background: "rgba(50,29,61,.92)", border: `1px solid ${C.border}`, borderRadius: 22, padding: 28, width: "100%", maxWidth: 440 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>{ar ? "إعداد أول مدير" : "First admin setup"}</h1>

        {ready === false && (
          <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.7 }}>
            {ar
              ? "لم يتم تفعيل الإعداد. في Firebase Console → Firestore أنشئ مجموعة settings ومستند bootstrap بالحقول: enabled = true (boolean). ثم انشر firestore.rules وحدّث الصفحة."
              : "Setup is not enabled. In Firebase Console → Firestore, create collection settings, document bootstrap, field enabled = true (boolean). Deploy firestore.rules and refresh."}
          </div>
        )}

        {ready && !done && (
          <>
            <p style={{ color: C.orange, fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
              {ar
                ? "استخدم هذه الصفحة مرة واحدة فقط. بعد النجاح احذف مستند settings/bootstrap من الكونسول إذا لم يُحذف تلقائياً."
                : "Use this page only once. After success, delete Firestore document settings/bootstrap if it still exists."}
            </p>
            <Field label={ar ? "الاسم" : "Name"}>
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputSx(false)} autoComplete="name" />
            </Field>
            <Field label={ar ? "البريد" : "Email"}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputSx(false)} autoComplete="email" />
            </Field>
            <Field label={ar ? "كلمة المرور" : "Password"}>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} style={inputSx(false)} autoComplete="new-password" />
            </Field>
            <Field label={ar ? "تأكيد كلمة المرور" : "Confirm password"}>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inputSx(false)} autoComplete="new-password" />
            </Field>
            {err && <div role="alert" style={{ color: C.danger, fontSize: 12, marginBottom: 12 }}>{err}</div>}
            <Btn children={loading ? "…" : (ar ? "إنشاء المدير" : "Create admin")} full onClick={submit} disabled={loading} />
          </>
        )}

        {done && (
          <p style={{ color: C.success, fontSize: 14 }}>{ar ? "تم. جاري التوجيه لتسجيل الدخول…" : "Done. Redirecting to login…"}</p>
        )}

        <div style={{ marginTop: 20 }}>
          <button type="button" onClick={() => navigate("/login")} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>
            ← {ar ? "تسجيل الدخول" : "Login"}
          </button>
        </div>
      </div>
    </div>
  );
}
