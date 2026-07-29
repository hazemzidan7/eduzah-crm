import { useState } from "react";
import { Btn, Modal } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useCatalog } from "../../../../context/CatalogContext";
import { useLang } from "../../../../context/LangContext";
import CatalogNodeModal from "./CatalogNodeModal";

/** Renders a node and recurses into its own children — no fixed depth is assumed,
 * so a future 5th/6th hierarchy level needs no changes here.
 * Expand state is controlled from CatalogManager (not local), so Expand All /
 * Collapse All and search-driven auto-expand can all share one source of truth. */
export default function CatalogNodeRow({ node, depth, expandedIds, onToggleExpand, showArchived, visibleIds }) {
  const { nodeTypes, childrenOf, allChildrenOf, archiveNode, restoreNode, deleteNode } = useCatalog();
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);

  const [modal, setModal] = useState(null); // "addChild" | "edit" | null
  const [archiveState, setArchiveState] = useState(null); // null | {activeDescendants: [...]}
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const rawKids = showArchived ? allChildrenOf(node.id) : childrenOf(node.id);
  const kids = visibleIds ? rawKids.filter((k) => visibleIds.has(k.id)) : rawKids;
  const hasAnyChildren = allChildrenOf(node.id).length > 0;
  // A search/filter in progress forces full expansion of whatever's visible.
  const expanded = visibleIds ? true : expandedIds.has(node.id);

  const typeLabel = nodeTypes.find((t) => t.key === node.type);
  const typeDisplay = typeLabel ? (ar ? typeLabel.label_ar : typeLabel.label_en) : node.type;

  const tryArchive = async () => {
    try {
      await archiveNode(node.id);
      setArchiveState(null);
    } catch (e) {
      if (e.message === "HAS_ACTIVE_CHILDREN") {
        setArchiveState({ needsCascadeConfirm: true });
      } else {
        setArchiveState({ error: e.message });
      }
    }
  };

  const tryDelete = async () => {
    try {
      await deleteNode(node.id);
      setConfirmDelete(false);
    } catch (e) {
      setDeleteError(e.message === "HAS_CHILDREN"
        ? tx("لا يمكن حذف عنصر له عناصر فرعية — احذف أو انقل الفرعية أولاً", "Cannot delete a node that has children — delete or move its children first")
        : e.message);
    }
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
        <span style={{ fontSize: 10, color: C.muted, background: "rgba(255,255,255,.08)", borderRadius: 20, padding: "2px 8px" }}>
          {typeDisplay}
        </span>
        {node.code && <span style={{ fontSize: 10, color: C.muted }}>#{node.code}</span>}
        {!node.isActive && (
          <span style={{ fontSize: 10, color: C.danger, fontWeight: 700 }}>{tx("مؤرشف", "Archived")}</span>
        )}
        <div style={{ marginInlineStart: "auto", display: "flex", gap: 6 }}>
          {node.isActive ? (
            <>
              <Btn sm v="ghost" onClick={() => setModal("addChild")}>{tx("+ فرعي", "+ Child")}</Btn>
              <Btn sm v="ghost" onClick={() => setModal("edit")}>{tx("تعديل", "Edit")}</Btn>
              <Btn sm v="danger" onClick={tryArchive}>{tx("أرشفة", "Archive")}</Btn>
            </>
          ) : (
            <Btn sm v="success" onClick={() => restoreNode(node.id)}>{tx("استعادة", "Restore")}</Btn>
          )}
          {!hasAnyChildren && (
            <Btn sm v="danger" onClick={() => { setDeleteError(""); setConfirmDelete(true); }}>{tx("حذف", "Delete")}</Btn>
          )}
        </div>
      </div>

      {expanded && kids.map((child) => (
        <CatalogNodeRow
          key={child.id} node={child} depth={depth + 1}
          expandedIds={expandedIds} onToggleExpand={onToggleExpand}
          showArchived={showArchived} visibleIds={visibleIds}
        />
      ))}

      {modal === "addChild" && <CatalogNodeModal parentNode={node} onClose={() => setModal(null)} />}
      {modal === "edit" && <CatalogNodeModal editNode={node} onClose={() => setModal(null)} />}

      {archiveState?.needsCascadeConfirm && (
        <Modal title={tx("هذا العنصر له عناصر فرعية نشطة", "This node has active child nodes")} onClose={() => setArchiveState(null)}>
          <p style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
            {tx(
              `أرشفة "${node.name_ar || node.name_en}" ستؤدي أيضاً لأرشفة كل عناصره الفرعية النشطة. هل تريد المتابعة؟`,
              `Archiving "${node.name_en || node.name_ar}" will also archive all of its active child nodes. Continue?`,
            )}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn v="purple" onClick={() => setArchiveState(null)}>{tx("إلغاء", "Cancel")}</Btn>
            <Btn v="danger" onClick={async () => { await archiveNode(node.id, { cascade: true }); setArchiveState(null); }}>
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

      {confirmDelete && (
        <Modal title={tx("حذف نهائي", "Permanent Delete")} onClose={() => setConfirmDelete(false)}>
          <p style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
            {tx(
              `سيتم حذف "${node.name_ar || node.name_en}" نهائياً ولا يمكن التراجع عن ذلك. للاحتفاظ بالسجل، استخدم "أرشفة" بدلاً من ذلك.`,
              `"${node.name_en || node.name_ar}" will be permanently deleted — this cannot be undone. To keep a record, use Archive instead.`,
            )}
          </p>
          {deleteError && <p style={{ fontSize: 12, color: "#f87171", marginBottom: 12 }}>{deleteError}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn v="purple" onClick={() => setConfirmDelete(false)}>{tx("إلغاء", "Cancel")}</Btn>
            <Btn v="danger" onClick={tryDelete}>{tx("حذف نهائي", "Delete permanently")}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
