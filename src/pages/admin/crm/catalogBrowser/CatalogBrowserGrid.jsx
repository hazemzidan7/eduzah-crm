import { Card } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useCatalog } from "../../../../context/CatalogContext";
import { useCustomers } from "../../../../context/CustomerContext";

/** Counts every active engagement whose catalogNodeId is this node itself or
 * one of its descendants (so a Category card shows the sum of all its
 * Programs' students, not zero). */
function studentCountFor(nodeId, descendantsOf, engagements) {
  const ids = new Set([nodeId, ...descendantsOf(nodeId).map((d) => d.id)]);
  return engagements.filter((e) => !e.archivedAt && e.catalogNodeId && ids.has(e.catalogNodeId)).length;
}

/** Renders the current level's children as clickable cards. Business Unit
 * and Category nodes drill further in; Program nodes open the workspace.
 * Purely data-driven — a 5th hierarchy level needs no changes here. */
export default function CatalogBrowserGrid({ nodes, onOpenNode, ar, tx }) {
  const { nodeTypes, descendantsOf } = useCatalog();
  const { engagements } = useCustomers();

  if (nodes.length === 0) {
    return (
      <Card style={{ padding: 32, textAlign: "center" }}>
        <div style={{ color: C.muted }}>{tx("لا توجد عناصر هنا بعد", "Nothing here yet")}</div>
      </Card>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
      {nodes.map((n) => {
        const typeLabel = nodeTypes.find((t) => t.key === n.type);
        const isProgram = n.type === "program";
        const count = studentCountFor(n.id, descendantsOf, engagements);
        const childCount = descendantsOf(n.id).filter((d) => d.isActive).length;
        return (
          <Card
            key={n.id}
            onClick={() => onOpenNode(n)}
            style={{ padding: 16, cursor: "pointer", transition: "transform .15s", border: `1px solid ${n.color || C.border}` }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              {n.icon && <span style={{ fontSize: 18 }}>{n.icon}</span>}
              <div style={{ fontWeight: 800, fontSize: 14.5 }}>{ar ? n.name_ar : n.name_en}</div>
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, background: "rgba(255,255,255,.06)", display: "inline-block", borderRadius: 20, padding: "2px 9px", marginBottom: 8 }}>
              {typeLabel ? (ar ? typeLabel.label_ar : typeLabel.label_en) : n.type}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>
              {isProgram
                ? tx(`${count} طالب`, `${count} student${count === 1 ? "" : "s"}`)
                : tx(`${childCount} عنصر فرعي · ${count} طالب`, `${childCount} sub-item${childCount === 1 ? "" : "s"} · ${count} student${count === 1 ? "" : "s"}`)}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
