import { C, gHero } from "../../theme";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../context/LangContext";
import CrmModule from "./crm/CrmModule";

export default function AdminShell() {
  const { currentUser, logout } = useAuth();
  const { lang, toggle } = useLang();
  const ar = lang === "ar";

  return (
    <div style={{ minHeight: "100vh", background: gHero, color: "#fff" }}>
      <header style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "14px 24px", borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>Eduzah CRM</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13 }}>
          <span style={{ color: C.muted }}>{currentUser?.name || currentUser?.email}</span>
          <button onClick={toggle} style={{
            background: "rgba(255,255,255,.08)", border: "none", color: "#fff",
            borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 700,
          }}>{ar ? "EN" : "AR"}</button>
          <button onClick={logout} style={{
            background: C.purple, border: "none", color: "#fff",
            borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 700,
          }}>{ar ? "خروج" : "Logout"}</button>
        </div>
      </header>
      <main style={{ padding: 24 }}>
        <CrmModule />
      </main>
    </div>
  );
}
