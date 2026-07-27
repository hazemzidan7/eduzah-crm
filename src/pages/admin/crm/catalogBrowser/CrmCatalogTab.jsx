import { useState } from "react";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useCatalog } from "../../../../context/CatalogContext";
import CatalogBrowserGrid from "./CatalogBrowserGrid";
import ProgramWorkspace from "./ProgramWorkspace";

/**
 * The CRM's main entry point: Business Unit -> Category (optional) -> Program.
 * Purely local drill-down state (no routing) — `parentId` is the node whose
 * children are currently shown (null = root, i.e. Business Units); `programId`
 * switches into the per-program workspace. Nothing here is per-course: every
 * Program in the catalog gets this same workflow automatically.
 */
export default function CrmCatalogTab() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { businessUnits, childrenOf, nodeById } = useCatalog();

  const [parentId, setParentId] = useState(null);
  const [programId, setProgramId] = useState(null);

  if (programId) {
    return <ProgramWorkspace programId={programId} onBack={() => setProgramId(null)} />;
  }

  const currentNode = parentId ? nodeById(parentId) : null;
  const nodes = parentId ? childrenOf(parentId) : businessUnits;
  const breadcrumbChain = currentNode ? [...(currentNode.path || []), currentNode.id].map(nodeById).filter(Boolean) : [];

  const openNode = (node) => {
    if (node.type === "program") setProgramId(node.id);
    else setParentId(node.id);
  };

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ fontWeight: 900, fontSize: 18, margin: 0 }}>{tx("الكتالوج", "Catalog")}</h2>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
          {tx("وحدة العمل ← الفئة (اختياري) ← البرنامج", "Business Unit → Category (optional) → Program")}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "14px 0" }}>
        <button onClick={() => setParentId(null)} style={crumbSx(!currentNode)}>
          {tx("الرئيسية", "Home")}
        </button>
        {breadcrumbChain.map((n) => (
          <span key={n.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: C.muted }}>›</span>
            <button onClick={() => setParentId(n.id)} style={crumbSx(n.id === currentNode?.id)}>
              {ar ? n.name_ar : n.name_en}
            </button>
          </span>
        ))}
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
