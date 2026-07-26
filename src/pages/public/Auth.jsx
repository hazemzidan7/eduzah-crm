import { useState, useMemo, useRef, useEffect } from "react";
import { confirmPasswordReset, signInWithPhoneNumber, RecaptchaVerifier } from "firebase/auth";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { auth } from "../../firebase";
import { toE164Phone, PHONE_PENDING_KEY } from "../../utils/phoneE164";
import { C, gHero, font } from "../../theme";
import { Btn } from "../../components/UI";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../context/LangContext";
import { Seo } from "../../components/Seo";

/* ── Eye icon ── */
const EyeIcon = ({ off }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    {off ? (
      <>
        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </>
    ) : (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </>
    )}
  </svg>
);

/* ── Field wrapper ── */
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

/* ── Password strength ── */
const validatePassword = (p) => {
  const rules = [
    { ok: p.length >= 8,         ar: "8 أحرف على الأقل",       en: "At least 8 characters" },
    { ok: /[A-Z]/.test(p),       ar: "حرف كبير واحد",           en: "One uppercase letter" },
    { ok: /[a-z]/.test(p),       ar: "حرف صغير واحد",           en: "One lowercase letter" },
    { ok: /[0-9]/.test(p),       ar: "رقم واحد",                en: "One number" },
    { ok: /[^A-Za-z0-9]/.test(p),ar: "رمز خاص (!@#$...)",       en: "One special character" },
  ];
  return rules;
};

/** Firebase Phone Auth (SMS). Enable Phone in Console → Authentication → Sign-in method. */
function PhoneAuthBlock({ mode, lang, name = "", onSuccess }) {
  const { finalizePhoneSignIn } = useAuth();
  const ar = lang === "ar";
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState("phone");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const confRef = useRef(null);
  const verifierRef = useRef(null);
  const capId = mode === "login" ? "recaptcha-phone-login" : "recaptcha-phone-register";

  useEffect(() => () => {
    try { verifierRef.current?.clear(); } catch (_) {}
    verifierRef.current = null;
  }, []);

  const phoneErr = (e) => {
    const c = String(e?.code || e?.message || "");
    if (c.includes("invalid-phone-number")) return ar ? "رقم غير صالح. جرّب 01… أو +20…" : "Invalid number. Try 01… or +20…";
    if (c.includes("too-many-requests")) return ar ? "محاولات كثيرة. حاول لاحقاً." : "Too many attempts. Try later.";
    if (c.includes("invalid-verification-code")) return ar ? "الكود غير صحيح" : "Invalid code";
    if (c.includes("session-expired")) return ar ? "انتهت الجلسة. اطلب كوداً جديداً." : "Session expired. Request a new code.";
    return ar ? "تعذر إكمال التحقق بالهاتف" : "Could not complete phone verification";
  };

  const sendCode = async () => {
    setErr("");
    if (mode === "register" && !String(name).trim()) {
      setErr(ar ? "اكتب الاسم في الحقل أعلاه أولاً." : "Enter your name in the field above first.");
      return;
    }
    const e164 = toE164Phone(phone);
    if (!e164) {
      setErr(ar ? "أدخل رقماً صالحاً (مثال: 01012345678)" : "Enter a valid number (e.g. 01012345678)");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register" && typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(PHONE_PENDING_KEY, "1");
      }
      try { verifierRef.current?.clear(); } catch (_) {}
      verifierRef.current = new RecaptchaVerifier(auth, capId, { size: "invisible" });
      const cr = await signInWithPhoneNumber(auth, e164, verifierRef.current);
      confRef.current = cr;
      setStep("code");
      setCode("");
    } catch (e) {
      try { sessionStorage.removeItem(PHONE_PENDING_KEY); } catch (_) {}
      setErr(phoneErr(e));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setErr("");
    const digits = code.replace(/\D/g, "");
    if (digits.length < 6) {
      setErr(ar ? "أدخل الكود المرسل في الرسالة" : "Enter the code from the SMS");
      return;
    }
    if (!confRef.current) {
      setErr(ar ? "اطلب كوداً جديداً" : "Request a new code first");
      return;
    }
    setBusy(true);
    try {
      const cred = await confRef.current.confirm(digits);
      const r = await finalizePhoneSignIn(cred.user, {
        mode,
        name: mode === "register" ? String(name).trim() : undefined,
        phoneDisplay: phone.replace(/\s/g, ""),
      });
      if (!r.ok) {
        if (r.code === "NO_PROFILE") {
          setErr(ar
            ? (mode === "login"
              ? "لا يوجد حساب بهذا الرقم. أنشئ حساباً من صفحة التسجيل (التحقق بالهاتف)."
              : "تعذر إنشاء الحساب. حاول مرة أخرى.")
            : (mode === "login"
              ? "No account for this number. Create one on the Register page (phone sign-up)."
              : "Could not create account. Try again."));
        } else if (r.code === "REJECTED") {
          setErr(ar ? "تم رفض الحساب." : "Account rejected.");
        } else {
          setErr(ar ? "تعذر الإكمال" : "Could not complete");
        }
        return;
      }
      onSuccess?.(r);
    } catch (e) {
      try { sessionStorage.removeItem(PHONE_PENDING_KEY); } catch (_) {}
      setErr(phoneErr(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setErr(""); }}
        style={{
          background: "none",
          border: "none",
          color: C.orange,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 700,
          width: "100%",
          textAlign: "center",
        }}
      >
        {open ? (ar ? "▼ إخفاء التحقق بالهاتف" : "▼ Hide phone sign-in") : (ar ? "الدخول برمز SMS على الهاتف" : "Or sign in with phone (SMS)")}
      </button>
      {open && (
        <>
          <div id={capId} style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", overflow: "hidden" }} aria-hidden="true" />
          <p style={{ fontSize: 11, color: C.muted, marginTop: 10, lineHeight: 1.65 }}>
            {ar
              ? "فعّل مزود «Phone» من لوحة Firebase: Authentication → Sign-in method. الإنتاج قد يحتاج خطة Blaze."
              : "Enable the Phone provider: Firebase → Authentication → Sign-in method. Production SMS may require the Blaze plan."}
          </p>
          {step === "phone" && (
            <>
              <Field label={ar ? "رقم الهاتف" : "Phone number"}>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={ar ? "01012345678" : "01012345678"}
                  style={inputSx(false)}
                  type="tel"
                  disabled={busy}
                  autoComplete="tel"
                />
              </Field>
              {err && <div role="alert" style={{ color: C.danger, fontSize: 12, marginBottom: 8 }}>{err}</div>}
              <Btn
                children={busy ? "…" : (ar ? "إرسال رمز SMS" : "Send SMS code")}
                full
                onClick={sendCode}
                v="outline"
                style={{ marginTop: 4 }}
              />
            </>
          )}
          {step === "code" && (
            <>
              <Field label={ar ? "رمز التحقق (SMS)" : "SMS verification code"}>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  inputMode="numeric"
                  style={inputSx(false)}
                  disabled={busy}
                  placeholder="••••••"
                  autoComplete="one-time-code"
                />
              </Field>
              {err && <div role="alert" style={{ color: C.danger, fontSize: 12, marginBottom: 8 }}>{err}</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                <Btn
                  children={ar ? "← رجوع" : "← Back"}
                  v="outline"
                  sm
                  onClick={() => {
                    setStep("phone");
                    setErr("");
                    try { sessionStorage.removeItem(PHONE_PENDING_KEY); } catch (_) {}
                  }}
                  disabled={busy}
                />
                <Btn children={busy ? "…" : (ar ? "تأكيد" : "Verify")} onClick={verifyCode} style={{ flex: 1, minWidth: 120 }} disabled={busy} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const PassRules = ({ pass, lang }) => {
  if (!pass) return null;
  const rules = validatePassword(pass);
  return (
    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
      {rules.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
          <span style={{ color: r.ok ? C.success : C.danger, fontWeight: 800 }}>{r.ok ? "✓" : "✗"}</span>
          <span style={{ color: r.ok ? C.success : C.muted }}>{lang === "ar" ? r.ar : r.en}</span>
        </div>
      ))}
    </div>
  );
};

/* ── Password field with toggle ── */
const PassField = ({ label, value, onChange, error, placeholder, lang }) => {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} error={error}>
      <div style={{ position: "relative" }}>
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={e => { const v = e.target.value; onChange(v); }}
          placeholder={placeholder}
          style={{ ...inputSx(error), paddingLeft: lang === "ar" ? 13 : 40, paddingRight: lang === "ar" ? 40 : 13 }}
        />
        <button type="button" onClick={() => setShow(s => !s)}
          aria-label={lang === "ar" ? (show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور") : (show ? "Hide password" : "Show password")}
          style={{
            position: "absolute", top: "50%", transform: "translateY(-50%)",
            [lang === "ar" ? "right" : "left"]: 0,
            background: "none", border: "none", color: C.muted,
            cursor: "pointer", padding: "0 12px", display: "flex", alignItems: "center",
          }}>
          <EyeIcon off={!show} />
        </button>
      </div>
    </Field>
  );
};

/* ══════════════════════════════════════════
   LOGIN PAGE
══════════════════════════════════════════ */
const loginErr = (code, lang, msg) => {
  if (code === "BAD_CREDENTIALS") return lang === "ar" ? "البريد الإلكتروني أو كلمة المرور غير صحيحة" : "Invalid email or password";
  if (code === "REJECTED")        return lang === "ar" ? "تم رفض حسابك. تواصل مع الإدارة." : "Your account was rejected. Contact support";
  if (code === "NO_PROFILE")      return lang === "ar" ? "الحساب موجود لكن بياناتك غير مكتملة. تواصل مع الإدارة." : "Account exists but profile missing. Contact support";
  if (code === "FIREBASE_ERROR")  return lang === "ar" ? `خطأ في الاتصال: ${msg}` : `Connection error: ${msg}`;
  return lang === "ar" ? "تعذر تسجيل الدخول، حاول مرة أخرى" : "Login failed, please try again";
};

export function LoginPage() {
  const { login, signInWithGoogle } = useAuth();
  const { lang }   = useLang();
  const navigate   = useNavigate();
  const ar = lang === "ar";
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");
  const [err,   setErr]   = useState("");
  const [noProfile, setNoProfile] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleGoogle = async () => {
    setErr(""); setGoogleBusy(true);
    const r = await signInWithGoogle();
    setGoogleBusy(false);
    if (!r.ok && r.code !== "CANCELLED") {
      setErr(ar ? "تعذر تسجيل الدخول بـ Google" : "Google sign-in failed");
      return;
    }
    if (r.ok) navigate("/dashboard");
  };

  const submit = async () => {
    setNoProfile(false);
    if (!email || !pass) { setErr(ar ? "أدخل البريد وكلمة المرور" : "Enter email and password"); return; }
    const r = await login(email, pass);
    if (!r.ok) {
      if (r.code === "NO_PROFILE") { setNoProfile(true); setErr(""); return; }
      setErr(loginErr(r.code, lang, r.msg));
      return;
    }
    navigate("/dashboard");
  };

  return (
    <div dir={ar ? "rtl" : "ltr"} style={{ minHeight: "calc(100vh - 60px)", background: gHero, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px" }}>
      <Seo
        title={ar ? "تسجيل الدخول — Eduzah" : "Login — Eduzah"}
        description={ar ? "سجّل دخولك إلى منصة Eduzah للتدريب المهني." : "Sign in to the Eduzah professional training platform."}
      />
      <div role="form" aria-label={ar ? "تسجيل الدخول" : "Login"}
        style={{ background: "rgba(50,29,61,.92)", backdropFilter: "blur(24px)", border: `1px solid ${C.border}`, borderRadius: 22, padding: 28, width: "100%", maxWidth: 380 }}>

        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ display:"inline-block", background:"#fff", borderRadius:14, padding:"10px 20px", marginBottom:8 }}>
            <img src="/logo-en.png" alt="Eduzah" style={{ height: 52, width: "auto", maxWidth: 200, objectFit: "contain", display:"block" }} />
          </div>
          <div style={{ color: C.muted, fontSize: 13 }}>
            {ar ? "مرحباً بعودتك" : "Welcome back"}
          </div>
        </div>

        {/* Google sign-in */}
        <button type="button" className="btn-google" onClick={handleGoogle} disabled={googleBusy}
          style={{ marginBottom: 16, opacity: googleBusy ? 0.65 : 1 }}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.16C6.51 42.62 14.62 48 24 48z"/>
            <path fill="#FBBC05" d="M10.53 28.58A14.9 14.9 0 0 1 9.6 24c0-1.58.27-3.11.93-4.58l-7.98-6.16A23.93 23.93 0 0 0 0 24c0 3.77.9 7.34 2.55 10.74l7.98-6.16z"/>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.55 13.26l7.98 6.16C12.43 13.72 17.74 9.5 24 9.5z"/>
          </svg>
          {googleBusy ? "…" : (ar ? "الدخول بـ Google" : "Continue with Google")}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,.12)" }} />
          <span style={{ color: "rgba(248,250,252,.4)", fontSize: 11 }}>{ar ? "أو بالبريد" : "or with email"}</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,.12)" }} />
        </div>

        <Field label={ar ? "البريد الإلكتروني" : "Email"}>
          <input type="email" value={email} onChange={e => { setEmail(e.target.value); setNoProfile(false); }}
            placeholder="email@example.com" style={inputSx(false)}
            aria-label="Email" />
        </Field>

        <PassField
          label={ar ? "كلمة المرور" : "Password"}
          value={pass} onChange={v => { setPass(v); setNoProfile(false); }}
          placeholder="••••••••" lang={lang}
        />

        <div style={{ textAlign: ar ? "right" : "left", marginBottom: 12 }}>
          <Link to="/forgot-password" style={{ color: C.orange, fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
            {ar ? "نسيت كلمة المرور؟" : "Forgot password?"}
          </Link>
        </div>

        {err && (
          <div role="alert" style={{ background: `${C.danger}18`, border: `1px solid ${C.danger}44`, borderRadius: 9, padding: "9px 12px", fontSize: 12, color: C.danger, marginBottom: 12 }}>
            {err}
          </div>
        )}

        {/* NO_PROFILE: orphaned auth account — offer re-register or WhatsApp */}
        {noProfile && (
          <div role="alert" style={{ background: "rgba(250,166,51,.1)", border: `1px solid rgba(250,166,51,.4)`, borderRadius: 11, padding: "12px 14px", fontSize: 12, marginBottom: 14, lineHeight: 1.8 }}>
            <div style={{ fontWeight: 700, color: C.orange, marginBottom: 4 }}>
              {ar ? "البيانات غير مكتملة" : "Incomplete profile"}
            </div>
            <div style={{ color: C.muted }}>
              {ar
                ? "الإيميل ده موجود لكن البروفايل مش مكتمل. سجّل من جديد بنفس الإيميل أو تواصل معنا."
                : "This email exists but your profile is incomplete. Re-register with the same email or contact us."}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <span style={{ color: C.orange, fontWeight: 700, cursor: "pointer", fontSize: 12 }}
                onClick={() => navigate("/register")}>
                {ar ? "تسجيل من جديد ←" : "Re-register →"}
              </span>
              <a href="https://wa.me/201044222881" target="_blank" rel="noreferrer"
                style={{ color: "#25d366", fontWeight: 700, fontSize: 12, textDecoration: "none" }}>
                {ar ? "تواصل على واتساب" : "WhatsApp support"}
              </a>
            </div>
          </div>
        )}

        <Btn children={ar ? "تسجيل الدخول" : "Login"} full onClick={submit}
          style={{ padding: "12px", fontSize: 14, boxShadow: `0 8px 25px rgba(217,27,91,.4)` }} />

        <PhoneAuthBlock mode="login" lang={lang} onSuccess={() => navigate("/dashboard")} />

        <div style={{ textAlign: "center", marginTop: 14, fontSize: 12, color: C.muted }}>
          {ar ? "مش عندك حساب؟" : "Don't have an account?"}{" "}
          <span style={{ color: C.orange, cursor: "pointer", fontWeight: 700 }} onClick={() => navigate("/register")}>
            {ar ? "سجّل دلوقتي" : "Register now"}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   REGISTER PAGE
══════════════════════════════════════════ */
const MSG_EMAIL_TAKEN_AR = "البريد الإلكتروني مسجّل بالفعل.";
const MSG_EMAIL_TAKEN_EN = "This email is already registered.";

export function RegisterPage() {
  const { register, signInWithGoogle } = useAuth();
  const { lang }     = useLang();
  const navigate     = useNavigate();

  const [f,    setF]    = useState({ name: "", email: "", pass: "", confirm: "", phone: "" });
  const [errs, setErrs] = useState({});
  const [emailTaken, setEmailTaken] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleGoogle = async () => {
    setGoogleBusy(true);
    const r = await signInWithGoogle();
    setGoogleBusy(false);
    if (r.ok) navigate("/dashboard", { state: { accountCreated: true } });
  };

  const set = (k, v) => {
    if (k === "email") setEmailTaken(false);
    setF((p) => ({ ...p, [k]: v }));
  };

  const validate = () => {
    const e = {};
    if (!f.name.trim())  e.name  = lang === "ar" ? "الاسم مطلوب" : "Name required";
    if (!f.phone.trim()) e.phone = lang === "ar" ? "الهاتف مطلوب" : "Phone required";
    if (!f.email.includes("@")) e.email = lang === "ar" ? "بريد غير صحيح" : "Invalid email";

    const rules = validatePassword(f.pass);
    if (rules.some(r => !r.ok)) e.pass = lang === "ar" ? "كلمة المرور لا تستوفي الشروط" : "Password doesn't meet requirements";
    if (f.pass !== f.confirm) e.confirm = lang === "ar" ? "كلمة المرور غير متطابقة" : "Passwords don't match";
    return e;
  };

  const submit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrs(e); return; }
    setErrs({});
    const r = await register(f);
    if (!r.ok) {
      if (r.code === "EMAIL_EXISTS") {
        setEmailTaken(true);
        setErrs({ email: lang === "ar" ? MSG_EMAIL_TAKEN_AR : MSG_EMAIL_TAKEN_EN });
      } else if (r.code === "EMAIL_EXISTS_RESET_NEEDED") {
        setEmailTaken(true);
        setErrs({ email: lang === "ar"
          ? "الإيميل ده كان مسجّل قبل كده — استخدم «نسيت كلمة المرور» لإعادة تعيينها ثم سجّل دخولك."
          : "This email was registered before — use «Forgot password» to reset it then sign in."
        });
      } else {
        setEmailTaken(false);
        setErrs({ email: lang === "ar" ? "تعذر إنشاء الحساب" : "Registration failed" });
      }
      return;
    }
    navigate("/dashboard", { state: { accountCreated: true } });
  };


  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} style={{ minHeight: "calc(100vh - 60px)", background: gHero, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px" }}>
      <Seo
        title={lang === "ar" ? "إنشاء حساب — Eduzah" : "Register — Eduzah"}
        description={lang === "ar" ? "أنشئ حساباً على Eduzah للتدريب المهني والكورسات." : "Create your Eduzah account for professional training and courses."}
      />
      <div role="form" aria-label={lang === "ar" ? "إنشاء حساب" : "Register"}
        style={{ background: "rgba(50,29,61,.92)", backdropFilter: "blur(24px)", border: `1px solid ${C.border}`, borderRadius: 22, padding: 28, width: "100%", maxWidth: 440 }}>

        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ display:"inline-block", background:"#fff", borderRadius:14, padding:"10px 20px", marginBottom:8 }}>
              <img src="/logo-en.png" alt="Eduzah" style={{ height: 52, width: "auto", maxWidth: 200, objectFit: "contain", display:"block" }} />
            </div>
          <div style={{ color: C.muted, fontSize: 13 }}>
            {lang === "ar" ? "انضم لـ Eduzah" : "Join Eduzah"}
          </div>
        </div>

        {/* Google sign-up */}
        <button type="button" className="btn-google" onClick={handleGoogle} disabled={googleBusy}
          style={{ marginBottom: 16, opacity: googleBusy ? 0.65 : 1 }}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.16C6.51 42.62 14.62 48 24 48z"/>
            <path fill="#FBBC05" d="M10.53 28.58A14.9 14.9 0 0 1 9.6 24c0-1.58.27-3.11.93-4.58l-7.98-6.16A23.93 23.93 0 0 0 0 24c0 3.77.9 7.34 2.55 10.74l7.98-6.16z"/>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.55 13.26l7.98 6.16C12.43 13.72 17.74 9.5 24 9.5z"/>
          </svg>
          {googleBusy ? "…" : (lang === "ar" ? "التسجيل بـ Google" : "Sign up with Google")}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,.12)" }} />
          <span style={{ color: "rgba(248,250,252,.4)", fontSize: 11 }}>{lang === "ar" ? "أو بالبريد" : "or with email"}</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,.12)" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={lang === "ar" ? "الاسم *" : "Name *"} error={errs.name}>
            <input value={f.name} onChange={e => set("name", e.target.value)}
              placeholder={lang === "ar" ? "أحمد محمد" : "Ahmed Mohamed"} style={inputSx(errs.name)} />
          </Field>
          <Field label={lang === "ar" ? "الهاتف *" : "Phone *"} error={errs.phone}>
            <input value={f.phone} onChange={e => set("phone", e.target.value)}
              type="tel" placeholder="+201..." style={inputSx(errs.phone)} />
          </Field>
        </div>

        <Field label={lang === "ar" ? "البريد الإلكتروني *" : "Email *"} error={errs.email}>
          <input value={f.email} onChange={e => set("email", e.target.value)}
            type="email" placeholder="email@example.com" style={inputSx(!!errs.email)} autoComplete="email" />
        </Field>

        {emailTaken && (
          <div style={{ background: "rgba(250,166,51,.12)", border: `1px solid ${C.orange}40`, borderRadius: 10, padding: "12px 14px", fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.7 }}>
            {lang === "ar"
              ? "استخدم تسجيل الدخول إن كان عندك حساب، أو «نسيت كلمة المرور» لاستلام رابط في البريد وتعيين كلمة مرور جديدة."
              : "Sign in if you already have an account, or use “Forgot password” to get an email link and set a new password."}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
              <Link to="/login" style={{ color: C.orange, fontWeight: 800, textDecoration: "none" }}>{lang === "ar" ? "تسجيل الدخول" : "Sign in"}</Link>
              <span style={{ color: C.border }}>|</span>
              <Link to="/forgot-password" style={{ color: C.orange, fontWeight: 800, textDecoration: "none" }}>{lang === "ar" ? "نسيت كلمة المرور" : "Forgot password"}</Link>
            </div>
          </div>
        )}

        <PassField label={lang === "ar" ? "كلمة المرور *" : "Password *"}
          value={f.pass} onChange={v => set("pass", v)}
          placeholder="••••••••" error={errs.pass} lang={lang} />
        <PassRules pass={f.pass} lang={lang} />

        <div style={{ marginTop: 10 }}>
          <PassField label={lang === "ar" ? "تأكيد كلمة المرور *" : "Confirm Password *"}
            value={f.confirm} onChange={v => set("confirm", v)}
            placeholder="••••••••" error={errs.confirm} lang={lang} />
        </div>

        <Btn children={lang === "ar" ? "إنشاء الحساب" : "Create Account"} full onClick={submit}
          style={{ padding: "12px", fontSize: 14, boxShadow: `0 8px 25px rgba(217,27,91,.4)` }} />

        <PhoneAuthBlock
          mode="register"
          lang={lang}
          name={f.name}
          onSuccess={() => navigate("/dashboard", { state: { accountCreated: true } })}
        />

        <div style={{ textAlign: "center", marginTop: 12, fontSize: 12, color: C.muted }}>
          {lang === "ar" ? "عندك حساب؟" : "Already have an account?"}{" "}
          <span style={{ color: C.orange, cursor: "pointer", fontWeight: 700 }} onClick={() => navigate("/login")}>
            {lang === "ar" ? "سجّل دخولك" : "Login"}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   FORGOT / RESET PASSWORD (Firebase)
   Configure Firebase Console → Auth → Templates → Action URL to:
   https://YOUR_DOMAIN/reset-password
══════════════════════════════════════════ */
export function ForgotPasswordPage() {
  const { startPasswordReset, confirmPasswordResetOtp } = useAuth();
  const { lang } = useLang();
  const navigate = useNavigate();
  const ar = lang === "ar";
  const dir = ar ? "rtl" : "ltr";
  const [view, setView] = useState("formEmail");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [pass, setPass] = useState("");
  const [confirm, setConfirmP] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const cardSx = {
    background: "rgba(50,29,61,.92)",
    backdropFilter: "blur(24px)",
    border: `1px solid ${C.border}`,
    borderRadius: 22,
    padding: 28,
    width: "100%",
    maxWidth: 440,
    boxShadow: "0 24px 60px rgba(0,0,0,.35)",
  };

  const submitEmail = async () => {
    setErr("");
    if (!email.trim() || !email.includes("@")) {
      setErr(ar ? "أدخل بريداً صالحاً" : "Enter a valid email");
      return;
    }
    setLoading(true);
    const r = await startPasswordReset(email);
    setLoading(false);
    if (!r.ok) {
      const code = r.code || "";
      if (code === "invalid-email") setErr(ar ? "صيغة البريد غير صحيحة" : "Invalid email format");
      else if (code === "rate-limit") setErr(ar ? "انتظر دقيقة ثم أعد المحاولة." : "Please wait a minute before trying again.");
      else if (code === "auth/operation-not-allowed") {
        setErr(ar
          ? "تسجيل الدخول بالبريد معطّل في Firebase. فعّل Email/Password من لوحة المشروع."
          : "Email sign-in is disabled in Firebase. Enable Email/Password in the console.");
      } else if (code === "auth/network-request-failed") {
        setErr(ar ? "لا يوجد اتصال أو تم حظر الطلب." : "No connection or the request was blocked.");
      } else if (["auth/unauthorized-continue-uri", "auth/invalid-continue-uri"].includes(code)) {
        setErr(ar
          ? "أضف نطاق الموقع في Firebase → Authentication → Authorized domains."
          : "Add your site domain in Firebase → Authentication → Authorized domains.");
      } else {
        setErr(ar
          ? `تعذر إكمال الطلب (${code || "—"}). تحقق من الإنترنت وإعدادات Firebase.`
          : `Could not continue (${code || "—"}). Check connection and Firebase settings.`);
      }
      return;
    }
    if (r.mode === "otp" && r.sent) {
      setOtp("");
      setPass("");
      setConfirmP("");
      setView("formOtp");
      return;
    }
    if (r.mode === "otp" && !r.sent) {
      setView("msgNoUser");
      return;
    }
    setView("msgLink");
  };

  const submitOtp = async () => {
    setErr("");
    const digits = otp.replace(/\D/g, "");
    if (digits.length !== 8) {
      setErr(ar ? "أدخل الـ 8 أرقام المرسلة للبريد" : "Enter the 8 digits sent to your email");
      return;
    }
    const rules = validatePassword(pass);
    if (rules.some((x) => !x.ok)) {
      setErr(ar ? "كلمة المرور لا تستوفي الشروط أدناه" : "Password does not meet the requirements below");
      return;
    }
    if (pass !== confirm) {
      setErr(ar ? "تأكيد كلمة المرور غير متطابق" : "Password confirmation does not match");
      return;
    }
    setLoading(true);
    const r = await confirmPasswordResetOtp({ email, code: digits, newPassword: pass });
    setLoading(false);
    if (!r.ok) {
      if (r.code === "BAD_CODE") setErr(ar ? "الرمز غير صحيح" : "Invalid code");
      else if (r.code === "EXPIRED") setErr(ar ? "انتهت صلاحية الرمز. ابدأ من جديد لطلب رمز جديد." : "Code expired. Start over to request a new code.");
      else if (r.code === "TOO_MANY_ATTEMPTS") setErr(ar ? "تجاوزت عدد المحاولات. اطلب رمزاً جديداً." : "Too many attempts. Request a new code.");
      else if (r.code === "INVALID_PASSWORD") setErr(ar ? "كلمة المرور ضعيفة" : "Password too weak");
      else if (r.code === "NOT_DEPLOYED") {
        setErr(ar ? "ميزة الرمز غير مفعّلة على السيرفر. استخدم الرابط في البريد." : "Code reset is not deployed. Use the link in your email.");
      } else setErr(ar ? "تعذر التحديث. حاول مرة أخرى." : "Could not update. Try again.");
      return;
    }
    setView("msgSuccess");
  };

  const iconCircle = (child) => (
    <div style={{
      width: 56, height: 56, borderRadius: "50%", background: "rgba(16,185,129,.15)",
      border: "2px solid rgba(16,185,129,.4)", display: "flex", alignItems: "center", justifyContent: "center",
      margin: "0 auto 16px", fontSize: 22, fontWeight: 900, color: "#10b981",
    }}>{child}</div>
  );

  return (
    <div dir={dir} style={{ minHeight: "calc(100vh - 60px)", background: gHero, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px" }}>
      <Seo
        title={ar ? "استعادة كلمة المرور — Eduzah" : "Forgot password — Eduzah"}
        description={ar ? "استعد الوصول إلى حسابك على Eduzah." : "Recover access to your Eduzah account."}
      />
      <div style={cardSx}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ display: "inline-block", background: "#fff", borderRadius: 14, padding: "10px 20px", marginBottom: 8 }}>
            <img src="/logo-en.png" alt="Eduzah" style={{ height: 48, width: "auto", maxWidth: 180, objectFit: "contain", display: "block" }} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.red, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
            {ar ? "أمان الحساب" : "Account security"}
          </div>
          <h1 style={{ fontSize: "clamp(1.15rem, 3vw, 1.45rem)", fontWeight: 900, margin: 0, lineHeight: 1.35 }}>
            {view === "formOtp"
              ? (ar ? "أدخل الرمز وكلمة المرور الجديدة" : "Enter code and new password")
              : (ar ? "نسيت كلمة المرور؟" : "Forgot password?")}
          </h1>
        </div>

        {view === "formEmail" && (
          <>
            <p style={{ color: C.muted, fontSize: 13, marginBottom: 18, lineHeight: 1.75 }}>
              {ar
                ? "أدخل بريدك المسجّل. إن وُجدت إعدادات الإيميل على السيرفر، يُرسل لك رمز من 8 أرقام؛ وإلا يُرسل رابط لتعيين كلمة المرور. تحقق من البريد غير المرغوب."
                : "Enter your registered email. If email is configured on the server, you will get an 8-digit code; otherwise a reset link. Check spam."}
            </p>
            <Field label={ar ? "البريد الإلكتروني" : "Email"}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputSx(!!err)} disabled={loading} autoComplete="email" />
            </Field>
            {err && <div role="alert" style={{ color: C.danger, fontSize: 12, marginBottom: 12 }}>{err}</div>}
            <Btn children={loading ? "…" : (ar ? "إرسال رمز التحقق" : "Send verification code")} full onClick={submitEmail} style={{ boxShadow: "0 8px 25px rgba(217,27,91,.35)" }} />
          </>
        )}

        {view === "formOtp" && (
          <>
            <p style={{ color: C.muted, fontSize: 13, marginBottom: 14, lineHeight: 1.7 }}>
              {ar
                ? `تم إرسال رمز مكوّن من 8 أرقام إلى ${email}. أدخل الرمز ثم اختر كلمة مرور جديدة.`
                : `We sent an 8-digit code to ${email}. Enter it and choose a new password.`}
            </p>
            <Field label={ar ? "رمز التحقق (8 أرقام)" : "Verification code (8 digits)"}>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="••••••••"
                style={{
                  ...inputSx(!!err),
                  textAlign: "center",
                  fontSize: 22,
                  letterSpacing: "0.4em",
                  fontVariantNumeric: "tabular-nums",
                  paddingTop: 12,
                  paddingBottom: 12,
                }}
                disabled={loading}
              />
            </Field>
            <PassField label={ar ? "كلمة المرور الجديدة" : "New password"} value={pass} onChange={setPass} error={undefined} placeholder="••••••••" lang={lang} />
            <PassRules pass={pass} lang={lang} />
            <div style={{ marginTop: 10 }}>
              <PassField label={ar ? "تأكيد كلمة المرور" : "Confirm password"} value={confirm} onChange={setConfirmP} error={undefined} placeholder="••••••••" lang={lang} />
            </div>
            {err && <div role="alert" style={{ color: C.danger, fontSize: 12, margin: "12px 0" }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <Btn children={ar ? "← تغيير البريد" : "← Change email"} v="outline" onClick={() => { setView("formEmail"); setErr(""); }} style={{ flex: "0 1 auto", padding: "11px 16px" }} />
              <Btn children={loading ? "…" : (ar ? "حفظ كلمة المرور" : "Save password")} onClick={submitOtp} style={{ flex: 1, minWidth: 160, boxShadow: "0 8px 25px rgba(217,27,91,.35)" }} disabled={loading} />
            </div>
          </>
        )}

        {view === "msgLink" && (
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            {iconCircle("✓")}
            <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.8, marginBottom: 16 }}>
              {ar
                ? "تحقق من بريدك وافتح رابط إعادة التعيين. لعرض صفحة بتصميم المنصة: من Firebase → Authentication → Templates اضبط رابط الإجراء إلى موقعك ثم /reset-password"
                : "Check your email and open the reset link. For our branded page: Firebase → Authentication → Templates → set the action URL to your site + /reset-password"}
            </p>
            <Btn children={ar ? "تسجيل الدخول" : "Sign in"} full onClick={() => navigate("/login")} />
          </div>
        )}

        {view === "msgNoUser" && (
          <div style={{ textAlign: "center" }}>
            <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.8 }}>
              {ar
                ? "إذا كان هذا البريد مسجّلاً لدينا، ستصلك رسالة قريباً. إن لم يكن مسجّلاً، أنشئ حساباً من صفحة التسجيل."
                : "If this email is registered, you will receive a message shortly. If not, create an account from the register page."}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
              <Btn children={ar ? "تسجيل الدخول" : "Login"} onClick={() => navigate("/login")} />
              <Btn children={ar ? "إنشاء حساب" : "Register"} v="outline" onClick={() => navigate("/register")} />
            </div>
          </div>
        )}

        {view === "msgSuccess" && (
          <div style={{ textAlign: "center" }}>
            {iconCircle("✓")}
            <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.8, marginBottom: 16 }}>
              {ar ? "تم تحديث كلمة المرور. يمكنك تسجيل الدخول الآن." : "Your password was updated. You can sign in now."}
            </p>
            <Btn children={ar ? "تسجيل الدخول" : "Login"} full onClick={() => navigate("/login")} style={{ boxShadow: "0 8px 25px rgba(217,27,91,.35)" }} />
          </div>
        )}

        {view !== "msgSuccess" && (
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <button type="button" onClick={() => navigate("/login")} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>
              ← {ar ? "العودة لتسجيل الدخول" : "Back to login"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ResetPasswordPage() {
  const { lang } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oobCode = useMemo(() => {
    const q = searchParams.get("oobCode");
    if (q) return q;
    if (typeof window === "undefined") return "";
    const { hash, search } = window.location;
    const fromSearch = new URLSearchParams(search).get("oobCode");
    if (fromSearch) return fromSearch;
    const h = hash.includes("?") ? hash.slice(hash.indexOf("?")) : hash;
    return new URLSearchParams(h.replace(/^\?/, "")).get("oobCode") || "";
  }, [searchParams]);

  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errs, setErrs] = useState({});
  const [ok, setOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const e = {};
    const rules = validatePassword(pass);
    if (rules.some(r => !r.ok)) e.pass = lang === "ar" ? "كلمة المرور لا تستوفي الشروط" : "Password doesn't meet requirements";
    if (pass !== confirm) e.confirm = lang === "ar" ? "غير متطابقة" : "Passwords don't match";
    if (Object.keys(e).length) { setErrs(e); return; }
    if (!oobCode) {
      setErrs({ pass: lang === "ar" ? "رابط غير صالح" : "Invalid link" });
      return;
    }
    setSubmitting(true);
    try {
      await confirmPasswordReset(auth, oobCode, pass);
      setOk(true);
    } catch {
      setErrs({ pass: lang === "ar" ? "الرابط منتهي أو غير صالح" : "Invalid or expired link" });
    } finally {
      setSubmitting(false);
    }
  };

  const ar = lang === "ar";
  const cardSx = {
    background: "rgba(50,29,61,.92)",
    backdropFilter: "blur(24px)",
    border: `1px solid ${C.border}`,
    borderRadius: 22,
    padding: 28,
    width: "100%",
    maxWidth: 420,
    boxShadow: "0 24px 60px rgba(0,0,0,.35)",
  };

  return (
    <div dir={ar ? "rtl" : "ltr"} style={{ minHeight: "calc(100vh - 60px)", background: gHero, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px" }}>
      <Seo
        title={ar ? "إعادة تعيين كلمة المرور — Eduzah" : "Reset password — Eduzah"}
        description={ar ? "عيّن كلمة مرور جديدة لحساب Eduzah." : "Set a new password for your Eduzah account."}
      />
      <div style={cardSx}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ display: "inline-block", background: "#fff", borderRadius: 14, padding: "10px 20px", marginBottom: 8 }}>
            <img src="/logo-en.png" alt="Eduzah" style={{ height: 48, width: "auto", maxWidth: 180, objectFit: "contain", display: "block" }} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.red, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
            {ar ? "أمان الحساب" : "Account security"}
          </div>
        </div>
        {!oobCode ? (
          <p style={{ color: C.danger, textAlign: "center", lineHeight: 1.7 }}>{ar ? "رابط غير صالح. افتح الرابط من البريد الإلكتروني." : "Invalid link. Open the link from your email."}</p>
        ) : ok ? (
          <>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(16,185,129,.15)", border: "2px solid rgba(16,185,129,.4)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 24, color: "#10b981", fontWeight: 900 }}>✓</div>
            <h1 style={{ fontSize: 20, marginBottom: 12, textAlign: "center" }}>{ar ? "تم التحديث" : "Password updated"}</h1>
            <Btn children={ar ? "تسجيل الدخول" : "Login"} full onClick={() => navigate("/login")} style={{ boxShadow: "0 8px 25px rgba(217,27,91,.35)" }} />
          </>
        ) : (
          <>
            <h1 style={{ fontSize: "clamp(1.1rem, 3vw, 1.35rem)", fontWeight: 900, marginBottom: 16, textAlign: "center" }}>{ar ? "كلمة مرور جديدة" : "New password"}</h1>
            <p style={{ color: C.muted, fontSize: 12, marginBottom: 14, textAlign: "center", lineHeight: 1.65 }}>
              {ar ? "اختر كلمة مرور قوية تطابق الشروط أدناه." : "Choose a strong password that meets the rules below."}
            </p>
            <PassField label={ar ? "كلمة المرور" : "Password"} value={pass} onChange={setPass} error={errs.pass} placeholder="••••••••" lang={lang} />
            <PassRules pass={pass} lang={lang} />
            <div style={{ marginTop: 10 }}>
              <PassField label={ar ? "تأكيد" : "Confirm"} value={confirm} onChange={setConfirm} error={errs.confirm} placeholder="••••••••" lang={lang} />
            </div>
            <Btn children={submitting ? "…" : (ar ? "حفظ" : "Save")} full onClick={submit} style={{ marginTop: 16, boxShadow: "0 8px 25px rgba(217,27,91,.35)" }} disabled={submitting} />
          </>
        )}
      </div>
    </div>
  );
}
