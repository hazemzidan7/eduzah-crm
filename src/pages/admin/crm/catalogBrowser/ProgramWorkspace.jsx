import { useMemo } from "react";
import { Card } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useCatalog } from "../../../../context/CatalogContext";
import { useLeadStatus } from "../../../../context/LeadStatusContext";
import { useCustomers } from "../../../../context/CustomerContext";
import { useCrmNav } from "../../../../context/CrmNavContext";
import { IconPeople, IconSend, IconThinking, IconCalendarCheck, IconMoney, IconPhone, IconBell } from "../../../../components/Icons";
import ProgramSalesSheet from "./ProgramSalesSheet";
import ProgramPipelineView from "./ProgramPipelineView";
import ProgramRemindersView from "./ProgramRemindersView";
import ImportWizard from "../import/ImportWizard";
import ImportHistoryList from "../import/ImportHistoryList";

const STATUS_ICONS = {
  new: IconSend, thinking: IconThinking, booked: IconCalendarCheck, paid: IconMoney,
  interested: IconPhone, follow_up: IconBell,
};

/**
 * Everything about running ONE Program lives here: the same component for
 * every Program in the catalog (no per-course pages). Scopes engagements to
 * this program and its descendants (future "batch" nodes included for free).
 * Which sub-view shows (Leads/Pipeline/Reminders/Import.../Import History)
 * comes from CrmNavContext — the sidebar (and this page's own toolbar
 * shortcuts) drive that, not local state.
 */
export default function ProgramWorkspace() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { nodeById, descendantsOf } = useCatalog();
  const { effectiveStatuses } = useLeadStatus();
  const { engagements, loading } = useCustomers();
  const { programId, section } = useCrmNav();

  const program = nodeById(programId);
  const businessUnitId = program?.path?.[0] || null;

  const scopedEngagements = useMemo(() => {
    if (!program) return [];
    const ids = new Set([programId, ...descendantsOf(programId).map((d) => d.id)]);
    return engagements.filter((e) => !e.archivedAt && e.catalogNodeId && ids.has(e.catalogNodeId));
  }, [engagements, program, programId, descendantsOf]);

  const statuses = effectiveStatuses(businessUnitId);
  const statusCounts = useMemo(() => {
    const counts = new Map();
    for (const e of scopedEngagements) counts.set(e.statusId, (counts.get(e.statusId) || 0) + 1);
    return counts;
  }, [scopedEngagements]);

  const remindersDue = scopedEngagements.filter((e) => e.nextFollowUpDate).length;

  if (!program) {
    return (
      <Card style={{ padding: 32, textAlign: "center" }}>
        <div style={{ color: C.muted }}>{tx("لم يتم العثور على البرنامج", "Program not found")}</div>
      </Card>
    );
  }

  return (
    <div>
      {/* ── Stats ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <StatCard label={tx("إجمالي الطلاب", "Total Students")} value={scopedEngagements.length} color={C.purple} Icon={IconPeople} />
        {statuses.filter((s) => statusCounts.get(s.id) > 0).map((s) => (
          <StatCard key={s.id} label={ar ? s.name_ar : s.name_en} value={statusCounts.get(s.id) || 0} color={s.color || C.muted} Icon={STATUS_ICONS[s.key] || null} />
        ))}
        <StatCard label={tx("متابعات مجدولة", "Follow-ups scheduled")} value={remindersDue} color={C.orange} Icon={IconBell} />
      </div>

      {loading ? (
        <Card style={{ padding: 32, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("جاري التحميل…", "Loading…")}</div></Card>
      ) : (
        <>
          {section === "leads" && <ProgramSalesSheet engagements={scopedEngagements} program={program} businessUnitId={businessUnitId} ar={ar} tx={tx} />}
          {section === "pipeline" && <ProgramPipelineView engagements={scopedEngagements} statuses={statuses} ar={ar} tx={tx} />}
          {section === "reminders" && <ProgramRemindersView engagements={scopedEngagements} ar={ar} tx={tx} />}
          {section === "import" && <ImportWizard key={program.id} program={program} />}
          {section === "importHistory" && <ImportHistoryList programId={program.id} />}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color, Icon }) {
  return (
    <Card style={{ padding: "14px 18px", minWidth: 150, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10, background: `${color}26`, border: `1px solid ${color}55`,
        display: "flex", alignItems: "center", justifyContent: "center", color, flexShrink: 0,
      }}>
        {Icon ? <Icon size={19} /> : <div style={{ width: 8, height: 8, borderRadius: 4, background: color }} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 21, fontWeight: 900, color: "#fff", lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" }}>{label}</div>
      </div>
    </Card>
  );
}
