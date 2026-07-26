import { useState } from "react";
import { C } from "../../../theme";
import { useLang } from "../../../context/LangContext";
import CrmDashboardTab from "./CrmDashboardTab";
import EngagementsListTab from "./EngagementsListTab";
import PipelineTab from "./PipelineTab";
import FollowUpsTab from "./FollowUpsTab";
import CrmSettingsTab from "./CrmSettingsTab";
import ImportTab from "./import/ImportTab";

export default function CrmModule() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const [crmSubTab, setCrmSubTab] = useState("leads");

  const subTabs = [
    { key: "dashboard", ar: "نظرة عامة", en: "Dashboard" },
    { key: "leads", ar: "العملاء المحتملون", en: "Leads" },
    { key: "pipeline", ar: "خط المبيعات", en: "Pipeline" },
    { key: "followups", ar: "المتابعات", en: "Follow-ups" },
    { key: "import", ar: "الاستيراد", en: "Import" },
    { key: "settings", ar: "الإعدادات", en: "Settings" },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontWeight: 900, fontSize: 18, margin: 0 }}>{tx("إدارة المبيعات (CRM)", "CRM")}</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {subTabs.map((st) => (
            <button key={st.key} onClick={() => setCrmSubTab(st.key)} style={{
              padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
              fontWeight: 700, fontSize: 12, fontFamily: "'Cairo',sans-serif",
              background: crmSubTab === st.key ? C.purple : "rgba(255,255,255,.08)",
              color: crmSubTab === st.key ? "#fff" : C.muted,
              transition: "all .2s",
            }}>{ar ? st.ar : st.en}</button>
          ))}
        </div>
      </div>

      {crmSubTab === "dashboard" && <CrmDashboardTab />}
      {crmSubTab === "leads" && <EngagementsListTab />}
      {crmSubTab === "pipeline" && <PipelineTab />}
      {crmSubTab === "followups" && <FollowUpsTab />}
      {crmSubTab === "import" && <ImportTab />}
      {crmSubTab === "settings" && <CrmSettingsTab />}
    </div>
  );
}
