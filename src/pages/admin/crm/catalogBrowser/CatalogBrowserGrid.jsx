import { Card } from "../../../../components/UI";
import { C, radius } from "../../../../theme";
import { useCatalog } from "../../../../context/CatalogContext";
import { useCustomers } from "../../../../context/CustomerContext";

/** Counts every active engagement whose catalogNodeId is this node itself or
 * one of its descendants (so a Business Unit card shows the sum across all
 * its Programs, not zero). */
function studentCountFor(nodeId, descendantsOf, engagements) {
  const ids = new Set([nodeId, ...descendantsOf(nodeId).map((d) => d.id)]);
  return engagements.filter((e) => !e.archivedAt && e.catalogNodeId && ids.has(e.catalogNodeId)).length;
}

/** Renders the current level's cards. Business Unit cards drill in; Program
 * cards open the workspace. Program names always show in English, regardless
 * of interface language — the rest of the CRM stays bilingual as usual. */
export default function CatalogBrowserGrid({ nodes, onOpenNode, ar, tx }) {
  const { descendantsOf, programsUnder } = useCatalog();
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
        const isProgram = n.type === "program";
        const count = studentCountFor(n.id, descendantsOf, engagements);
        const programCount = isProgram ? null : programsUnder(n.id).length;
        return (
          <Card
            key={n.id}
            onClick={() => onOpenNode(n)}
            style={{ padding: 16, cursor: "pointer", transition: "transform .15s, box-shadow .15s", borderTop: `3px solid ${n.color || C.red}` }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: radius.md, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: `${n.color || C.red}1a`, fontSize: 18,
              }}>
                {n.icon || (isProgram ? "🎓" : "📁")}
              </div>
              <div dir={isProgram ? "ltr" : undefined} style={{ fontWeight: 800, fontSize: 14.5, color: C.text }}>{isProgram ? n.name_en : (ar ? n.name_ar : n.name_en)}</div>
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>
              {isProgram
                ? tx(`${count} طالب`, `${count} student${count === 1 ? "" : "s"}`)
                : tx(`${programCount} برنامج · ${count} طالب`, `${programCount} program${programCount === 1 ? "" : "s"} · ${count} student${count === 1 ? "" : "s"}`)}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
