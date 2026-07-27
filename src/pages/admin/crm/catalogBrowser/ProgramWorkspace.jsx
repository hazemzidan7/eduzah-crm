import { useMemo, useState } from "react";
import { Card, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useCatalog } from "../../../../context/CatalogContext";
import { useLeadStatus } from "../../../../context/LeadStatusContext";
import { useCustomers } from "../../../../context/CustomerContext";
import ProgramSalesSheet from "./ProgramSalesSheet";
import ProgramPipelineView from "./ProgramPipelineView";
import ProgramRemindersView from "./ProgramRemindersView";

const VIEWS = [
  { v: "students", ar: "الجدول", en: "Sheet" },
  { v: "pipeline", ar: "خط المبيعات", en: "Pipeline" },
  { v: "reminders", ar: "المتابعات", en: "Reminders" },
];

/**
 * Everything about running ONE Program lives here: the same component for
 * every Program in the catalog (no per-course pages). Scopes engagements to
 * this program and its descendants (future "batch" nodes included for free).
 */
export default function ProgramWorkspace({ programId, onBack }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { nodeById, descendantsOf } = useCatalog();
  const { effectiveStatuses } = useLeadStatus();
  const { engagements, loading } = useCustomers();

  const [view, setView] = useState("students");

  const program = nodeById(programId);
  const businessUnitId = program?.path?.[0] || null;
  const businessUnit = businessUnitId ? nodeById(businessUnitId) : null;

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
        <Btn v="ghost" onClick={onBack} style={{ marginTop: 12 }}>{tx("رجوع", "Back")}</Btn>
      </Card>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12.5, padding: "5px 10px" }}>
          ← {tx("الكتالوج", "Catalog")}
        </button>
        <span style={{ color: C.muted, fontSize: 12.5 }}>
          {businessUnit ? (ar ? businessUnit.name_ar : businessUnit.name_en) : ""} › {program.name_en}
        </span>
      </div>
      <h2 style={{ fontWeight: 900, fontSize: 18, margin: "4px 0 14px" }}>{program.name_en}</h2>

      {/* ── Stats ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <StatCard label={tx("إجمالي الطلاب", "Total Students")} value={scopedEngagements.length} color={C.purple} />
        {statuses.filter((s) => statusCounts.get(s.id) > 0).map((s) => (
          <StatCard key={s.id} label={ar ? s.name_ar : s.name_en} value={statusCounts.get(s.id) || 0} color={s.color || C.muted} />
        ))}
        <StatCard label={tx("متابعات مجدولة", "Follow-ups scheduled")} value={remindersDue} color={C.orange} />
      </div>

      {/* ── View toggle ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {VIEWS.map((v) => (
          <button key={v.v} onClick={() => setView(v.v)} style={{
            padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer",
            fontWeight: 700, fontSize: 12.5, fontFamily: "'Cairo',sans-serif",
            background: view === v.v ? C.purple : "rgba(255,255,255,.08)",
            color: view === v.v ? "#fff" : C.muted,
          }}>{ar ? v.ar : v.en}</button>
        ))}
      </div>

      {loading ? (
        <Card style={{ padding: 32, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("جاري التحميل…", "Loading…")}</div></Card>
      ) : (
        <>
          {view === "students" && <ProgramSalesSheet engagements={scopedEngagements} businessUnitId={businessUnitId} ar={ar} tx={tx} />}
          {view === "pipeline" && <ProgramPipelineView engagements={scopedEngagements} statuses={statuses} ar={ar} tx={tx} />}
          {view === "reminders" && <ProgramRemindersView engagements={scopedEngagements} ar={ar} tx={tx} />}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <Card style={{ padding: "10px 16px", minWidth: 110 }}>
      <div style={{ fontSize: 20, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
    </Card>
  );
}
