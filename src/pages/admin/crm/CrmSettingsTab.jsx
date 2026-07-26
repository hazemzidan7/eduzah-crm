import { useState } from "react";
import { C } from "../../../theme";
import { useLang } from "../../../context/LangContext";
import CatalogManager from "./catalog/CatalogManager";
import StatusManager from "./settings/StatusManager";

/**
 * Home for every CRM configuration screen — Catalog and Lead Statuses now,
 * Tags/Dictionaries/Import Profiles in later milestones — each its own
 * section here rather than a new top-level tab per config type.
 */
export default function CrmSettingsTab() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const [section, setSection] = useState("catalog");

  const sections = [
    { key: "catalog", ar: "الكتالوج", en: "Catalog" },
    { key: "statuses", ar: "حالات العملاء", en: "Lead Statuses" },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {sections.map((s) => (
          <button key={s.key} onClick={() => setSection(s.key)} style={{
            padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
            fontWeight: 700, fontSize: 12, fontFamily: "'Cairo',sans-serif",
            background: section === s.key ? C.red : "rgba(255,255,255,.08)",
            color: section === s.key ? "#fff" : C.muted,
            transition: "all .2s",
          }}>{ar ? s.ar : s.en}</button>
        ))}
      </div>

      {section === "catalog" && <CatalogManager />}
      {section === "statuses" && <StatusManager />}
    </div>
  );
}
