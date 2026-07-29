import { useState } from "react";
import { Modal, Input, Select, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useCatalog } from "../../../../context/CatalogContext";
import { useLang } from "../../../../context/LangContext";

const MOVE_ERROR_MESSAGES = {
  SELF_PARENT: { ar: "لا يمكن أن يكون العنصر أباً لنفسه", en: "A node cannot be its own parent" },
  CIRCULAR_REFERENCE: { ar: "لا يمكن نقل العنصر تحت أحد عناصره الفرعية", en: "Cannot move a node under one of its own descendants" },
  NODE_NOT_FOUND: { ar: "تعذر العثور على العنصر", en: "Node not found" },
};

function nodePathLabel(node, nodeById, ar) {
  const chain = [...(node.path || []), node.id].map((id) => nodeById(id)).filter(Boolean);
  return chain.map((n) => (ar ? n.name_ar : n.name_en) || n.type).join(" > ");
}

/** Add a child node under `parentNode` (parentNode null => a root-level Business Unit),
 * or edit `editNode` if given. Re-parenting (editNode only) goes through moveNode,
 * which validates against self-parenting and circular references. */
export default function CatalogNodeModal({ parentNode, editNode, onClose }) {
  const { nodes, nodeTypes, addNodeType, addNode, updateNode, moveNode } = useCatalog();
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const isRoot = !parentNode && !editNode;

  const [nameAr, setNameAr] = useState(editNode?.name_ar || "");
  const [nameEn, setNameEn] = useState(editNode?.name_en || "");
  const [type, setType] = useState(editNode?.type || (isRoot ? "business_unit" : ""));
  const [code, setCode] = useState(editNode?.code || "");
  const [icon, setIcon] = useState(editNode?.icon || "");
  const [color, setColor] = useState(editNode?.color || "");
  const [description, setDescription] = useState(editNode?.description || "");
  const [parentId, setParentId] = useState(editNode ? (editNode.parentId || "") : "");
  const [showNewType, setShowNewType] = useState(false);
  const [newTypeAr, setNewTypeAr] = useState("");
  const [newTypeEn, setNewTypeEn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const typeOptions = nodeTypes
    .filter((t) => t.isActive && (isRoot ? t.key === "business_unit" : t.key !== "business_unit"))
    .sort((a, b) => a.order - b.order)
    .map((t) => ({ v: t.key, l: ar ? t.label_ar : t.label_en }));

  // Parent picker (edit only): every node except this one and its own descendants.
  const disallowedIds = editNode
    ? new Set([editNode.id, ...nodes.filter((n) => (n.path || []).includes(editNode.id)).map((n) => n.id)])
    : new Set();
  const parentOptions = [
    { v: "", l: tx("— بدون أب (جذر) —", "— No parent (root) —") },
    ...nodes
      .filter((n) => !disallowedIds.has(n.id))
      .map((n) => ({ v: n.id, l: nodePathLabel(n, (id) => nodes.find((x) => x.id === id), ar) })),
  ];

  const registerNewType = async () => {
    if (!newTypeAr.trim() && !newTypeEn.trim()) return;
    const key = (newTypeEn || newTypeAr).trim().toLowerCase().replace(/\s+/g, "_");
    await addNodeType({ key, label_ar: newTypeAr, label_en: newTypeEn });
    setType(key);
    setShowNewType(false);
    setNewTypeAr(""); setNewTypeEn("");
  };

  const submit = async () => {
    setError("");
    if (!nameAr.trim() && !nameEn.trim()) { setError(tx("أدخل اسماً على الأقل", "Enter at least one name")); return; }
    const finalType = isRoot ? "business_unit" : type;
    if (!finalType) { setError(tx("حدد النوع", "Choose a type")); return; }
    setSaving(true);
    try {
      if (editNode) {
        await updateNode(editNode.id, { name_ar: nameAr, name_en: nameEn, type: finalType, code, icon, color, description });
        const newParentId = parentId || null;
        if ((editNode.parentId || null) !== newParentId) {
          await moveNode(editNode.id, newParentId);
        }
      } else {
        await addNode({ name_ar: nameAr, name_en: nameEn, type: finalType, code, icon, color, description, parentId: parentNode?.id || null });
      }
      onClose();
    } catch (e) {
      const msg = MOVE_ERROR_MESSAGES[e.message];
      setError(msg ? (ar ? msg.ar : msg.en) : (e.message || tx("حدث خطأ", "Something went wrong")));
    } finally {
      setSaving(false);
    }
  };

  const title = editNode
    ? tx("تعديل عنصر", "Edit Node")
    : isRoot
      ? tx("إضافة وحدة عمل", "Add Business Unit")
      : tx("إضافة عنصر فرعي", "Add Child Node");

  return (
    <Modal title={title} onClose={onClose}>
      {parentNode && (
        <div style={{ fontSize: 12, marginBottom: 10, opacity: 0.75 }}>
          {tx("تحت:", "Under:")} {ar ? parentNode.name_ar : parentNode.name_en}
        </div>
      )}
      <Input label={tx("الاسم بالعربي", "Name (Arabic)")} value={nameAr} onChange={setNameAr} />
      <Input label={tx("الاسم بالإنجليزي", "Name (English)")} value={nameEn} onChange={setNameEn} />

      {!isRoot && !showNewType && (
        <Select
          label={tx("النوع", "Type")}
          value={type}
          onChange={(v) => (v === "__new__" ? setShowNewType(true) : setType(v))}
          options={[...typeOptions, { v: "__new__", l: tx("+ تسجيل نوع جديد...", "+ Register new type...") }]}
        />
      )}
      {!isRoot && showNewType && (
        <div style={{ background: "rgba(255,255,255,.04)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <Input label={tx("اسم النوع بالعربي", "Type name (Arabic)")} value={newTypeAr} onChange={setNewTypeAr} />
          <Input label={tx("اسم النوع بالإنجليزي", "Type name (English)")} value={newTypeEn} onChange={setNewTypeEn} />
          <div style={{ display: "flex", gap: 8 }}>
            <Btn sm v="purple" onClick={() => setShowNewType(false)}>{tx("إلغاء", "Cancel")}</Btn>
            <Btn sm v="primary" onClick={registerNewType}>{tx("تسجيل واختيار", "Register & select")}</Btn>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <Input label={tx("كود (اختياري)", "Code (optional)")} value={code} onChange={setCode} />
        <Input label={tx("أيقونة (اختياري)", "Icon (optional)")} value={icon} onChange={setIcon} placeholder="📚" />
      </div>
      <Input label={tx("لون (اختياري، مثال #7d3d9e)", "Color (optional, e.g. #7d3d9e)")} value={color} onChange={setColor} />
      <Input label={tx("وصف (اختياري)", "Description (optional)")} value={description} onChange={setDescription} rows={2} />

      {editNode && (
        <Select label={tx("الأب", "Parent")} value={parentId} onChange={setParentId} options={parentOptions} />
      )}

      {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <Btn v="purple" onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
        <Btn v="primary" disabled={saving} onClick={submit}>{tx("حفظ", "Save")}</Btn>
      </div>
    </Modal>
  );
}
