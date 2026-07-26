import { useState, useMemo } from "react";
import { Card, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useCatalog } from "../../../../context/CatalogContext";
import { useLang } from "../../../../context/LangContext";
import CatalogNodeRow from "./CatalogNodeRow";
import CatalogNodeModal from "./CatalogNodeModal";

/** A node is visible if it (or one of its descendants) matches the active
 * search/type filter; ancestors of a match stay visible too so the match
 * isn't stranded with no path down to it. Returns null (show everything)
 * when no filter is active. */
function computeVisibleIds(nodes, search, typeFilter) {
  if (!search.trim() && typeFilter === "all") return null;
  const q = search.trim().toLowerCase();
  const matches = nodes.filter((n) => {
    const matchesSearch = !q
      || (n.name_ar || "").toLowerCase().includes(q)
      || (n.name_en || "").toLowerCase().includes(q)
      || (n.code || "").toLowerCase().includes(q);
    const matchesType = typeFilter === "all" || n.type === typeFilter;
    return matchesSearch && matchesType;
  });
  const visible = new Set();
  for (const m of matches) {
    visible.add(m.id);
    for (const ancestorId of (m.path || [])) visible.add(ancestorId);
  }
  return visible;
}

export default function CatalogManager() {
  const { nodes, nodeTypes, businessUnits, allBusinessUnits, loading } = useCatalog();
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);

  const [showAddRoot, setShowAddRoot] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [expandedIds, setExpandedIds] = useState(new Set());

  const toggleExpand = (id) => setExpandedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const expandAll = () => setExpandedIds(new Set(nodes.map((n) => n.id)));
  const collapseAll = () => setExpandedIds(new Set());

  const visibleIds = useMemo(() => computeVisibleIds(nodes, search, typeFilter), [nodes, search, typeFilter]);
  const roots = showArchived ? allBusinessUnits : businessUnits;
  const visibleRoots = visibleIds ? roots.filter((r) => visibleIds.has(r.id)) : roots;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 style={{ fontWeight: 800, fontSize: 15, margin: 0 }}>{tx("شجرة الكتالوج", "Catalog Tree")}</h3>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            {tx(
              "وحدات العمل، الفئات، البرامج، والدفعات — كلها بيانات، لا يوجد أي مستوى ثابت في الكود.",
              "Business Units, Categories, Programs, Batches — all data-driven, no fixed level hardcoded in code.",
            )}
          </div>
        </div>
        <Btn v="primary" onClick={() => setShowAddRoot(true)}>{tx("+ وحدة عمل جديدة", "+ Add Business Unit")}</Btn>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tx("بحث بالاسم أو الكود…", "Search name or code…")}
          style={{ background: "rgba(255,255,255,.06)", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", color: "#fff", fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", minWidth: 200 }}
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{ background: "#2a1540", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", color: "#fff", fontFamily: "'Cairo',sans-serif", fontSize: 12.5 }}
        >
          <option value="all">{tx("كل الأنواع", "All types")}</option>
          {nodeTypes.map((t) => (
            <option key={t.key} value={t.key}>{ar ? t.label_ar : t.label_en}</option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.muted, cursor: "pointer" }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {tx("إظهار المؤرشف", "Show archived")}
        </label>
        <div style={{ marginInlineStart: "auto", display: "flex", gap: 6 }}>
          <Btn sm v="ghost" onClick={expandAll}>{tx("توسيع الكل", "Expand All")}</Btn>
          <Btn sm v="ghost" onClick={collapseAll}>{tx("طي الكل", "Collapse All")}</Btn>
        </div>
      </div>

      {loading ? (
        <Card style={{ padding: 32, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("جاري التحميل…", "Loading…")}</div></Card>
      ) : visibleRoots.length === 0 ? (
        <Card style={{ padding: 32, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("لا توجد نتائج", "No results")}</div></Card>
      ) : (
        <Card style={{ padding: 10 }}>
          {visibleRoots.map((bu) => (
            <CatalogNodeRow
              key={bu.id} node={bu} depth={0}
              expandedIds={expandedIds} onToggleExpand={toggleExpand}
              showArchived={showArchived} visibleIds={visibleIds}
            />
          ))}
        </Card>
      )}

      {showAddRoot && <CatalogNodeModal onClose={() => setShowAddRoot(false)} />}
    </div>
  );
}
