import { useState } from "react";
import { Btn, Modal } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLeadStatus } from "../../../../context/LeadStatusContext";
import { useLang } from "../../../../context/LangContext";
import StatusModal from "./StatusModal";

/** Renders a status and recurses into its children. `siblings`/`siblingIndex`
 * are passed down so Up/Down reordering only ever swaps order within the
 * same (parent, scope, businessUnit) bucket, never across groups. */
export default function StatusRow({ node, depth, expandedIds, onToggleExpand, showArchived, visibleIds, siblings, siblingIndex }) {
  const { childrenOfStatus, allChildrenOfStatus, archiveStatus, restoreStatus, duplicateStatus, updateStatus } = useLeadStatus();
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);

  const [modal, setModal] = useState(null); // "addChild" | "edit" | null
  const [archiveState, setArchiveState] = useState(null);

  const rawKids = showArchived ? allChildrenOfStatus(node.id) : childrenOfStatus(node.id);
  const kids = visibleIds ? rawKids.filter((k) => visibleIds.has(k.id)) : rawKids;
  const expanded = visibleIds ? true : expandedIds.has(node.id);

  const tryArchive = async () => {
    try {
      await archiveStatus(node.id);
      setArchiveState(null);
    } catch (e) {
      setArchiveState(e.message === "HAS_ACTIVE_CHILDREN" ? { needsCascadeConfirm: true } : { error: e.message });
    }
  };

  const swapWith = async (otherIdx) => {
    if (otherIdx < 0 || otherIdx >= siblings.length) return;
    const other = siblings[otherIdx];
    await Promise.all([
      updateStatus(node.id, { order: other.order }),
      updateStatus(other.id, { order: node.order }),
    ]);
  };

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 10px", borderRadius: 8,
        marginInlineStart: depth * 22,
        background: depth === 0 ? "rgba(255,255,255,.04)" : "transparent",
        borderBottom: `1px solid ${C.border}`,
        opacity: node.isActive ? 1 : 0.5,
      }}>
        <button
          onClick={() => onToggleExpand(node.id)}
          disabled={kids.length === 0 || !!visibleIds}
          style={{ background: "none", border: "none", color: C.muted, cursor: kids.length ? "pointer" : "default", width: 16, fontSize: 11 }}
        >
          {kids.length ? (expanded ? "▾" : "▸") : ""}
        </button>
        {node.icon && <span>{node.icon}</span>}
        <span style={{
          fontWeight: depth === 0 ? 800 : 600, fontSize: depth === 0 ? 14 : 13,
          textDecoration: node.isActive ? "none" : "line-through",
          color: node.color || undefined,
        }}>
          {ar ? node.name_ar : node.name_en}
        </span>
        {node.isDefault && <span style={{ fontSize: 10, color: C.success, fontWeight: 700 }}>{tx("افتراضية", "Default")}</span>}
        {node.isTerminal && <span style={{ fontSize: 10, color: C.orange, fontWeight: 700 }}>{tx("نهائية", "Terminal")}</span>}
        {!node.isActive && <span style={{ fontSize: 10, color: C.danger, fontWeight: 700 }}>{tx("مؤرشفة", "Archived")}</span>}
        <div style={{ marginInlineStart: "auto", display: "flex", gap: 4 }}>
          {siblings && !visibleIds && node.isActive && (
            <>
              <Btn sm v="ghost" onClick={() => swapWith(siblingIndex - 1)} disabled={siblingIndex === 0}>{tx("↑", "↑")}</Btn>
              <Btn sm v="ghost" onClick={() => swapWith(siblingIndex + 1)} disabled={siblingIndex === siblings.length - 1}>{tx("↓", "↓")}</Btn>
            </>
          )}
          {node.isActive ? (
            <>
              <Btn sm v="ghost" onClick={() => setModal("addChild")}>{tx("+ فرعي", "+ Child")}</Btn>
              <Btn sm v="ghost" onClick={() => setModal("edit")}>{tx("تعديل", "Edit")}</Btn>
              <Btn sm v="outline" onClick={() => duplicateStatus(node.id)}>{tx("نسخ", "Duplicate")}</Btn>
              <Btn sm v="danger" onClick={tryArchive}>{tx("أرشفة", "Archive")}</Btn>
            </>
          ) : (
            <Btn sm v="success" onClick={() => restoreStatus(node.id)}>{tx("استعادة", "Restore")}</Btn>
          )}
        </div>
      </div>

      {expanded && kids.map((child, i) => (
        <StatusRow
          key={child.id} node={child} depth={depth + 1}
          expandedIds={expandedIds} onToggleExpand={onToggleExpand}
          showArchived={showArchived} visibleIds={visibleIds}
          siblings={kids} siblingIndex={i}
        />
      ))}

      {modal === "addChild" && <StatusModal parentStatus={node} onClose={() => setModal(null)} />}
      {modal === "edit" && <StatusModal editStatus={node} onClose={() => setModal(null)} />}

      {archiveState?.needsCascadeConfirm && (
        <Modal title={tx("هذه الحالة لها عناصر فرعية نشطة", "This status has active child statuses")} onClose={() => setArchiveState(null)}>
          <p style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
            {tx(
              `أرشفة "${node.name_ar || node.name_en}" ستؤدي أيضاً لأرشفة كل حالاتها الفرعية النشطة. هل تريد المتابعة؟`,
              `Archiving "${node.name_en || node.name_ar}" will also archive all of its active child statuses. Continue?`,
            )}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn v="purple" onClick={() => setArchiveState(null)}>{tx("إلغاء", "Cancel")}</Btn>
            <Btn v="danger" onClick={async () => { await archiveStatus(node.id, { cascade: true }); setArchiveState(null); }}>
              {tx("أرشفة الكل", "Archive all")}
            </Btn>
          </div>
        </Modal>
      )}
      {archiveState?.error && (
        <Modal title={tx("خطأ", "Error")} onClose={() => setArchiveState(null)}>
          <p style={{ fontSize: 13, color: "#f87171" }}>{archiveState.error}</p>
        </Modal>
      )}
    </div>
  );
}
