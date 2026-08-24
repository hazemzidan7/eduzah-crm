import { useState } from "react";
import { C } from "../../theme";
import { useLang } from "../../context/LangContext";
import { useCatalog } from "../../context/CatalogContext";
import { useCrmNav } from "../../context/CrmNavContext";
import { IconChevronDown } from "../Icons";

const SECTION_LABELS = {
  catalog: { ar: "الكتالوج", en: "Catalog" },
  leads: { ar: "العملاء", en: "Customers" },
  pipeline: { ar: "خط المبيعات", en: "Sales Sheet" },
  reminders: { ar: "المتابعات", en: "Reminders" },
  importHistory: { ar: "سجل الاستيراد", en: "Import History" },
  import: { ar: "استيراد طلاب", en: "Import Students" },
  settings: { ar: "الإعدادات", en: "Settings" },
  reports: { ar: "التقارير", en: "Reports" },
  users: { ar: "المستخدمون", en: "Users" },
};

export default function TopBar() {
  const { lang, toggle } = useLang();
  const ar = lang === "ar";
  const { nodeById, programsUnder } = useCatalog();
  const { businessUnitId, programId, section, selectProgram } = useCrmNav();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const program = programId ? nodeById(programId) : null;
  const businessUnit = businessUnitId ? nodeById(businessUnitId) : null;
  const siblings = businessUnitId ? programsUnder(businessUnitId) : [];
  const sectionLabel = SECTION_LABELS[section];

  return (
    <header style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "13px 22px", borderBottom: `1px solid ${C.border}`, position: "relative",
      background: "#fff",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, flexWrap: "wrap" }}>
        {program && (
          <div style={{ position: "relative" }}>
            <button
              onClick={() => siblings.length > 1 && setSwitcherOpen((o) => !o)}
              style={{
                display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none",
                color: C.text, fontFamily: "'Cairo',sans-serif", fontSize: 13, fontWeight: 800,
                cursor: siblings.length > 1 ? "pointer" : "default", padding: "4px 6px", borderRadius: 6,
              }}
            >
              <span dir="ltr">{program.name_en}</span>
              {siblings.length > 1 && <IconChevronDown size={13} />}
            </button>
            {switcherOpen && (
              <>
                <div onClick={() => setSwitcherOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1400 }} />
                <div style={{
                  position: "absolute", top: "100%", insetInlineStart: 0, marginTop: 4, zIndex: 1401,
                  background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10,
                  minWidth: 180, padding: 6, boxShadow: "0 12px 32px rgba(15,23,42,.14)",
                }}>
                  {siblings.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { selectProgram(p.id, businessUnitId); setSwitcherOpen(false); }}
                      dir="ltr"
                      style={{
                        display: "block", width: "100%", textAlign: "start", background: p.id === programId ? C.sidebarActiveBg : "transparent",
                        border: "none", color: p.id === programId ? C.red : C.text, padding: "7px 10px", borderRadius: 6, cursor: "pointer",
                        fontFamily: "'Cairo',sans-serif", fontSize: 12.5, fontWeight: p.id === programId ? 800 : 600,
                      }}
                    >
                      {p.name_en}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {businessUnit && <span style={{ color: C.muted, opacity: 0.5 }}>{ar ? "‹" : "›"}</span>}
        {businessUnit && <span style={{ color: C.muted }}>{ar ? businessUnit.name_ar : businessUnit.name_en}</span>}
        {(program || businessUnit) && <span style={{ color: C.muted, opacity: 0.5 }}>{ar ? "‹" : "›"}</span>}
        <span style={{ color: C.text }}>{sectionLabel ? (ar ? sectionLabel.ar : sectionLabel.en) : ""}</span>
      </div>

      <button onClick={toggle} style={{
        background: C.sidebarActiveBg, border: "none", color: C.red,
        borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontWeight: 700, fontSize: 12.5,
      }}>{ar ? "EN" : "AR"}</button>
    </header>
  );
}
