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
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontWeight: 900, fontSize: 18, margin: 0 }}>{tx("الكتالوج", "Catalog")}</h2>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
          {tx("وحدة العمل ← البرنامج", "Business Unit → Program")}
        </div>
      </div>

      <div className="edu-crumb-bar">
        <button onClick={() => setBusinessUnitId(null)} className="edu-crumb-back" disabled={!businessUnit} style={!businessUnit ? { opacity: .5, cursor: "default" } : undefined}>
          <span className="edu-crumb-arrow" aria-hidden>🏠</span>
          {tx("الرئيسية", "Home")}
        </button>
        {businessUnit && (
          <div className="edu-crumb-trail">
            <span className="edu-crumb-sep">›</span>
            <span className="edu-crumb-node is-current">{ar ? businessUnit.name_ar : businessUnit.name_en}</span>
          </div>
        )}
      </div>

      <CatalogBrowserGrid nodes={nodes} onOpenNode={openNode} ar={ar} tx={tx} />
    </div>
  );
}
