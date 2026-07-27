import { useState } from "react";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useCatalog } from "../../../../context/CatalogContext";
import CatalogBrowserGrid from "./CatalogBrowserGrid";
import ProgramWorkspace from "./ProgramWorkspace";

/**
 * The CRM's main entry point: Business Unit -> Program -> Students. Category
 * is an optional organizational field in the data (still fully editable in
 * Settings > Catalog) but is never a navigation step here — opening a
 * Business Unit shows every Program under it, flattened, regardless of how
 * many Category levels deep any of them sit.
 */
export default function CrmCatalogTab() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { businessUnits, programsUnder, nodeById } = useCatalog();

  const [businessUnitId, setBusinessUnitId] = useState(null);
  const [programId, setProgramId] = useState(null);

  if (programId) {
    return <ProgramWorkspace programId={programId} onBack={() => setProgramId(null)} />;
  }

  const businessUnit = businessUnitId ? nodeById(businessUnitId) : null;
  const nodes = businessUnit ? programsUnder(businessUnitId) : businessUnits;

  const openNode = (node) => {
    if (node.type === "program") setProgramId(node.id);
    else setBusinessUnitId(node.id);
  };

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ fontWeight: 900, fontSize: 18, margin: 0 }}>{tx("الكتالوج", "Catalog")}</h2>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
          {tx("وحدة العمل ← البرنامج", "Business Unit → Program")}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "14px 0" }}>
        <button onClick={() => setBusinessUnitId(null)} style={crumbSx(!businessUnit)}>
          {tx("الرئيسية", "Home")}
        </button>
        {businessUnit && (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: C.muted }}>›</span>
            <button style={crumbSx(true)}>{ar ? businessUnit.name_ar : businessUnit.name_en}</button>
          </span>
        )}
      </div>

      <CatalogBrowserGrid nodes={nodes} onOpenNode={openNode} ar={ar} tx={tx} />
    </div>
  );
}

function crumbSx(active) {
  return {
    background: active ? "rgba(255,255,255,.1)" : "none",
    border: "none", cursor: "pointer",
    color: active ? "#fff" : C.muted,
    fontWeight: active ? 800 : 600, fontSize: 12.5,
    fontFamily: "'Cairo',sans-serif",
    padding: "5px 10px", borderRadius: 8,
  };
}
