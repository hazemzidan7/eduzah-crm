import { useEffect } from "react";
import { C } from "../../theme";
import { useLang } from "../../context/LangContext";
import { useAuth } from "../../context/AuthContext";
import { CrmNavProvider, useCrmNav } from "../../context/CrmNavContext";
import { Card } from "../../components/UI";
import Sidebar from "../../components/layout/Sidebar";
import TopBar from "../../components/layout/TopBar";
import CrmCatalogTab from "./crm/catalogBrowser/CrmCatalogTab";
import ProgramWorkspace from "./crm/catalogBrowser/ProgramWorkspace";
import CrmSettingsTab from "./crm/CrmSettingsTab";
import PaymentVerificationQueue from "./crm/PaymentVerificationQueue";
import AccountingPage from "./accounting/AccountingPage";
import ManagementDashboard from "./management/ManagementDashboard";

function ComingSoon({ label }) {
  return (
    <Card style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{label}</div>
      <div style={{ color: C.muted, fontSize: 12.5 }}>Coming soon</div>
    </Card>
  );
}

const PROGRAM_SECTIONS = new Set(["leads", "pipeline", "reminders", "importHistory", "import"]);

function AdminContent() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const { currentUser } = useAuth();
  const { programId, section, goToCatalog } = useCrmNav();
  const strandedOnProgramSection = PROGRAM_SECTIONS.has(section) && !programId;
  // ACCOUNTING-05 — Management Dashboard reads AccountingContext's
  // transactions directly, which "accounting"-role staff CAN legitimately
  // read (unlike customers/engagements, which their own client-side context
  // gate already empties out) — so unlike every other section here, this
  // one needs its own explicit check, not just the Sidebar hiding the
  // button, or Accounting-only figures (revenue/expenses) could leak to
  // that role even though the CRM figures around them would show empty.
  const strandedOnManagement = section === "management" && currentUser?.role !== "admin";

  // Defensive guard only — the sidebar disables these items without a
  // Program selected, so this shouldn't normally trigger. Runs as an effect
  // (not during render) since it updates a different component's state.
  useEffect(() => {
    if (strandedOnProgramSection || strandedOnManagement) goToCatalog();
  }, [strandedOnProgramSection, strandedOnManagement, goToCatalog]);

  if (strandedOnManagement) return null;
  if (section === "management") return <ManagementDashboard />;
  if (section === "accounting") return <AccountingPage />;
  if (section === "payments") return <PaymentVerificationQueue />;
  if (section === "settings") return <CrmSettingsTab />;
  if (section === "reports") return <ComingSoon label={ar ? "التقارير" : "Reports"} />;
  if (section === "users") return <ComingSoon label={ar ? "المستخدمون" : "Users"} />;
  if (strandedOnProgramSection) return null;
  if (PROGRAM_SECTIONS.has(section)) return <ProgramWorkspace />;

  return <CrmCatalogTab />;
}

export default function AdminShell() {
  return (
    <CrmNavProvider>
      <div style={{ minHeight: "100vh", background: "#241531", color: "#fff", display: "flex" }}>
        <Sidebar />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <TopBar />
          <main style={{ padding: 24, flex: 1, minWidth: 0 }}>
            <AdminContent />
          </main>
        </div>
      </div>
    </CrmNavProvider>
  );
}
