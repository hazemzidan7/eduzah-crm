import { useState, useMemo } from "react";
import { Card, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLeadStatus } from "../../../../context/LeadStatusContext";
import { useCatalog } from "../../../../context/CatalogContext";
import { useLang } from "../../../../context/LangContext";
import StatusRow from "./StatusRow";
import StatusModal from "./StatusModal";

function computeVisibleIds(statuses, search) {
  if (!search.trim()) return null;
  const q = search.trim().toLowerCase();
  const matches = statuses.filter((s) =>
    (s.name_ar || "").toLowerCase().includes(q)
    || (s.name_en || "").toLowerCase().includes(q)
    || (s.key || "").toLowerCase().includes(q));
  const visible = new Set();
  for (const m of matches) {
    visible.add(m.id);
    for (const ancestorId of (m.path || [])) visible.add(ancestorId);
  }
  return visible;
}

export default function StatusManager() {
  const { statuses, loading } = useLeadStatus();
  const { businessUnits } = useCatalog();
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);

  const [showAdd, setShowAdd] = useState(null); // "global" | businessUnitId | null
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState("all"); // "all" | "global" | businessUnitId
  const [showArchived, setShowArchived] = useState(false);
  const [expandedIds, setExpandedIds] = useState(new Set());

  const toggleExpand = (id) => setExpandedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const expandAll = () => setExpandedIds(new Set(statuses.map((s) => s.id)));
  const collapseAll = () => setExpandedIds(new Set());

  const visibleIds = useMemo(() => computeVisibleIds(statuses, search), [statuses, search]);

  const topLevel = (scope, businessUnitId) => {
    const list = statuses.filter((s) =>
      !s.parentId && (showArchived || s.isActive) && s.scope === scope
      && (scope === "global" || s.businessUnitId === businessUnitId));
    const filtered = visibleIds ? list.filter((s) => visibleIds.has(s.id)) : list;
    return filtered.sort((a, b) => a.order - b.order);
  };

  const showGlobal = scopeFilter === "all" || scopeFilter === "global";
  const visibleBUs = businessUnits.filter((bu) => scopeFilter === "all" || scopeFilter === bu.id);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 style={{ fontWeight: 800, fontSize: 15, margin: 0 }}>{tx("إدارة حالات العملاء", "Lead Status Management")}</h3>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            {tx(
              "الحالات العامة تظهر لكل الوحدات، وحالات الوحدة تظهر لهذه الوحدة فقط.",
              "Global statuses apply everywhere; Business Unit statuses only apply within that unit.",
            )}
          </div>
        </div>
        <Btn v="primary" onClick={() => setShowAdd("global")}>{tx("+ إضافة حالة", "+ Add Status")}</Btn>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tx("بحث بالاسم أو المفتاح…", "Search name or key…")}
          style={{ background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", color: C.text, fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", minWidth: 200 }}
        />
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value)}
          style={{ background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", color: C.text, fontFamily: "'Cairo',sans-serif", fontSize: 12.5 }}
        >
          <option value="all">{tx("الكل", "All")}</option>
          <option value="global">{tx("عام فقط", "Global only")}</option>
          {businessUnits.map((bu) => <option key={bu.id} value={bu.id}>{ar ? bu.name_ar : bu.name_en}</option>)}
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
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {showGlobal && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {tx("عام", "Global")}
              </div>
              <Card style={{ padding: 10 }}>
                {topLevel("global", null).length === 0 ? (
                  <div style={{ padding: 16, textAlign: "center", color: C.muted, fontSize: 12.5 }}>{tx("لا توجد نتائج", "No results")}</div>
                ) : (
                  topLevel("global", null).map((s, i, arr) => (
                    <StatusRow
                      key={s.id} node={s} depth={0}
                      expandedIds={expandedIds} onToggleExpand={toggleExpand}
                      showArchived={showArchived} visibleIds={visibleIds}
                      siblings={arr} siblingIndex={i}
                    />
                  ))
                )}
              </Card>
            </div>
          )}

          {visibleBUs.map((bu) => (
            <div key={bu.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {ar ? bu.name_ar : bu.name_en}
                </div>
                <Btn sm v="ghost" onClick={() => setShowAdd(bu.id)}>{tx("+ حالة خاصة", "+ Unit Status")}</Btn>
              </div>
              <Card style={{ padding: 10 }}>
                {topLevel("business_unit", bu.id).length === 0 ? (
                  <div style={{ padding: 16, textAlign: "center", color: C.muted, fontSize: 12.5 }}>{tx("لا توجد حالات خاصة بهذه الوحدة", "No Business Unit statuses yet")}</div>
                ) : (
                  topLevel("business_unit", bu.id).map((s, i, arr) => (
                    <StatusRow
                      key={s.id} node={s} depth={0}
                      expandedIds={expandedIds} onToggleExpand={toggleExpand}
                      showArchived={showArchived} visibleIds={visibleIds}
                      siblings={arr} siblingIndex={i}
                    />
                  ))
                )}
              </Card>
            </div>
          ))}
        </div>
      )}

      {showAdd === "global" && <StatusModal onClose={() => setShowAdd(null)} />}
      {showAdd && showAdd !== "global" && (
        <StatusModal
          parentStatus={{ id: null, scope: "business_unit", businessUnitId: showAdd }}
          onClose={() => setShowAdd(null)}
        />
      )}
    </div>
  );
}
