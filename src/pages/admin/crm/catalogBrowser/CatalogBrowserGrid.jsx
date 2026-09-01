import { useState } from "react";
import { Card } from "../../../../components/UI";
import { C, radius, shadow } from "../../../../theme";
import { IconChevronRight, IconLayers } from "../../../../components/Icons";
import { useCatalog } from "../../../../context/CatalogContext";
import { useCustomers } from "../../../../context/CustomerContext";

/** Counts every active engagement whose catalogNodeId is this node itself or
 * one of its descendants (so a Business Unit card shows the sum across all
 * its Programs, not zero). */
function studentCountFor(nodeId, descendantsOf, engagements) {
  const ids = new Set([nodeId, ...descendantsOf(nodeId).map((d) => d.id)]);
  return engagements.filter((e) => !e.archivedAt && e.catalogNodeId && ids.has(e.catalogNodeId)).length;
}

/** A Business Unit card: same clickable Card surface, but with a hover-
 * revealed "View Programs" affordance so it never reads as a passive tile —
 * the whole card was already clickable, this just makes that visible. */
function BusinessUnitCard({ node, count, programCount, onOpen, ar, tx }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpen(); }}
      style={{
        background: C.cardBg, borderRadius: radius.lg, cursor: "pointer",
        border: `1.5px solid ${hover ? (node.color || C.red) : C.border}`,
        borderTop: `3px solid ${node.color || C.red}`,
        boxShadow: hover ? shadow.md : shadow.sm,
        transition: "border-color .15s, box-shadow .2s",
        padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 34, height: 34, borderRadius: radius.md, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: `${node.color || C.red}1a`, fontSize: 17,
        }}>
          {node.icon || "📁"}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {ar ? node.name_ar : node.name_en}
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>
            {tx(`${programCount} برنامج · ${count} طالب`, `${programCount} program${programCount === 1 ? "" : "s"} · ${count} student${count === 1 ? "" : "s"}`)}
          </div>
        </div>
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 800,
        color: hover ? (node.color || C.red) : C.muted, transition: "color .15s",
      }}>
        {tx("عرض البرامج", "View Programs")}
        <span style={{ display: "flex", transform: hover ? (ar ? "translateX(-3px)" : "translateX(3px)") : "none", transition: "transform .15s" }}>
          <IconChevronRight size={12} />
        </span>
      </div>
    </div>
  );
}

/** A Program card: same identity as before (icon, English name, student
 * count) but reusing the shared Card so its click/hover affordance stays
 * consistent with the rest of the app. */
function ProgramCard({ node, count, onOpen, tx }) {
  return (
    <Card
      onClick={onOpen}
      style={{ padding: "14px 16px", cursor: "pointer", borderTop: `3px solid ${node.color || C.red}` }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 34, height: 34, borderRadius: radius.md, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: `${node.color || C.red}1a`, fontSize: 17,
        }}>
          {node.icon || "🎓"}
        </div>
        <div dir="ltr" style={{ fontWeight: 800, fontSize: 14, color: C.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name_en}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: C.muted }}>
        <IconLayers size={12} />
        {tx(`${count} طالب`, `${count} student${count === 1 ? "" : "s"}`)}
      </div>
    </Card>
  );
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
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))", gap: 10 }}>
      {nodes.map((n) => {
        const isProgram = n.type === "program";
        const count = studentCountFor(n.id, descendantsOf, engagements);
        return isProgram ? (
          <ProgramCard key={n.id} node={n} count={count} onOpen={() => onOpenNode(n)} tx={tx} />
        ) : (
          <BusinessUnitCard
            key={n.id} node={n} count={count} programCount={programsUnder(n.id).length}
            onOpen={() => onOpenNode(n)} ar={ar} tx={tx}
          />
        );
      })}
    </div>
  );
}
