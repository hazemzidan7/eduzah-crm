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

// SALES-CRM-01 — the sections a "sales" role user is allowed to render, now
// widened from Follow-ups-only to the full Lead → Booking → Payment-
// submission workflow: browsing the Catalog to pick a Program ("catalog"),
// that Program's Sales Sheet/Pipeline/Reminders ("leads"/"pipeline"/
// "reminders"), plus the pre-existing global Follow-ups queue. Still
// excluded: Import/Import History (bulk data-entry tooling, not part of the
// required workflow), Payment Verification (that's Accounting's confirm/
// reject authority — Sales only ever creates "pending" records, via the
// Sales Sheet/Engagement modal, never this queue), Accounting, Management,
// Settings, Reports, Users. This is a client-side UX guard, not the real
// security boundary (that's firestore.rules — e.g. Sales still cannot write
// accountingTransactions or confirm a PaymentRecord regardless of what
// section renders) — but a sales session is still hard-redirected away from
// anything not in this set, rather than silently rendering an empty page.
const SALES_ALLOWED_SECTIONS = new Set(["followups", "catalog", "leads", "pipeline", "reminders"]);

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
