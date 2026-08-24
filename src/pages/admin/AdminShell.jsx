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
import FollowUpsPage from "./crm/followups/FollowUpsPage";
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

// CRM-05 FINALIZATION — the only section a "sales" role user is ever allowed
// to render. Everything else (Catalog/Sales Sheet/Reminders/Import History/
// Payment Verification/Accounting/Management/Settings/Reports/Users) stays
// admin-only. This is a client-side UX guard, not the real security boundary
// (that's firestore.rules — sales has no read access to customers/
// engagements/accountingTransactions regardless of what section renders) —
// but Step 3 of this finalization explicitly asks for real enforcement here
// too, not just a hidden Sidebar button, so a sales session is hard-redirected
// rather than silently rendering an empty admin page.
const SALES_ALLOWED_SECTIONS = new Set(["followups"]);

function AdminContent() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const { currentUser } = useAuth();
  const { programId, section, setSection, goToCatalog } = useCrmNav();
  const strandedOnProgramSection = PROGRAM_SECTIONS.has(section) && !programId;
  // ACCOUNTING-05 — Management Dashboard reads AccountingContext's
  // transactions directly, which "accounting"-role staff CAN legitimately
  // read (unlike customers/engagements, which their own client-side context
  // gate already empties out) — so unlike every other section here, this
  // one needs its own explicit check, not just the Sidebar hiding the
  // button, or Accounting-only figures (revenue/expenses) could leak to
  // that role even though the CRM figures around them would show empty.
  const strandedOnManagement = section === "management" && currentUser?.role !== "admin";
  const strandedOffSales = currentUser?.role === "sales" && !SALES_ALLOWED_SECTIONS.has(section);

  // Defensive guard only — the sidebar disables these items without a
  // Program selected, so this shouldn't normally trigger. Runs as an effect
  // (not during render) since it updates a different component's state.
  useEffect(() => {
    if (strandedOffSales) { setSection("followups"); return; }
    if (strandedOnProgramSection || strandedOnManagement) goToCatalog();
  }, [strandedOnProgramSection, strandedOnManagement, strandedOffSales, goToCatalog, setSection]);

  if (strandedOnManagement || strandedOffSales) return null;
  if (section === "management") return <ManagementDashboard />;
  if (section === "accounting") return <AccountingPage />;
  if (section === "payments") return <PaymentVerificationQueue />;
  if (section === "followups") return <FollowUpsPage />;
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
      <div style={{ minHeight: "100vh", background: C.bg, color: C.text, display: "flex" }}>
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
