import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}

const LoginPage          = lazy(() => import("./pages/public/Auth").then(m => ({ default: m.LoginPage })));
const ForgotPasswordPage = lazy(() => import("./pages/public/Auth").then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage  = lazy(() => import("./pages/public/Auth").then(m => ({ default: m.ResetPasswordPage })));
const BootstrapAdmin     = lazy(() => import("./pages/setup/BootstrapAdmin"));
const AdminShell         = lazy(() => import("./pages/admin/AdminShell"));

const Loader = () => (
  <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <div style={{ width: 36, height: 36, border: "3px solid rgba(37,99,235,.25)", borderTopColor: "#2563EB", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

function RequireAuth({ children, roles }) {
  const { currentUser } = useAuth();
  if (!currentUser) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(currentUser.role)) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* Gated by the settings/bootstrap Firestore flag (see SETUP_ADMIN.txt) — safe to leave routable. */}
          <Route path="/setup-admin" element={<BootstrapAdmin />} />

          {/* ACCOUNTING-02: "accounting" role can also reach AdminShell — the
              Sidebar/AdminContent gate which sections each role actually sees.
              CRM-05 FINALIZATION: "sales" added the same way — Sidebar only
              shows them Follow-ups, and AdminShell hard-redirects them away
              from any other section (see AdminShell.jsx). */}
          <Route path="/admin/*" element={<RequireAuth roles={["admin", "accounting", "sales"]}><AdminShell /></RequireAuth>} />

          <Route path="/" element={<Navigate to="/admin" replace />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
