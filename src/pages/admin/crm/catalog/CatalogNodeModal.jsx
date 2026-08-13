import { useState } from "react";
import { Modal, Input, Select, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useCatalog } from "../../../../context/CatalogContext";
import { useLang } from "../../../../context/LangContext";
import { DEFAULT_INSTALLMENT_COUNT, CURRENCY, computeFullPaymentPrice } from "../../../../data/catalogPricingPlan";

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
  // Pricing (CRM-CATALOG-01) — program nodes only. slug is immutable once
  // set: the field is locked (read-only) as soon as editNode already has one.
  const [slug, setSlug] = useState(editNode?.slug || "");
  const [originalPrice, setOriginalPrice] = useState(editNode?.originalPrice ?? "");
  const [depositAmount, setDepositAmount] = useState(editNode?.depositAmount ?? "");
  const [installmentCount, setInstallmentCount] = useState(editNode?.installmentCount || DEFAULT_INSTALLMENT_COUNT);
  const [priceUnit, setPriceUnit] = useState(editNode?.priceUnit || "program");
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
    const isProgram = finalType === "program";
    if (isProgram && originalPrice !== "" && ![2, 3].includes(Number(installmentCount))) {
      setError(tx("عدد الأقساط يجب أن يكون 2 أو 3", "Installment count must be 2 or 3"));
      return;
    }
    const pricingFields = isProgram
      ? {
          slug: slug.trim() || null,
          ...(originalPrice !== "" ? {
            originalPrice: Number(originalPrice),
            fullPaymentPrice: computeFullPaymentPrice(Number(originalPrice)),
            installmentPrice: Number(originalPrice),
            depositAmount: depositAmount === "" ? null : Number(depositAmount),
            installmentCount: Number(installmentCount),
            currency: CURRENCY,
            priceUnit,
          } : {}),
        }
      : {};
    setSaving(true);
    try {
      if (editNode) {
        // slug is immutable once set — never send a changed value for an
        // already-slugged node, even if the (disabled) field somehow changed.
        const patch = { name_ar: nameAr, name_en: nameEn, type: finalType, code, icon, color, description, ...pricingFields };
        if (editNode.slug) delete patch.slug;
        await updateNode(editNode.id, patch);
        const newParentId = parentId || null;
        if ((editNode.parentId || null) !== newParentId) {
          await moveNode(editNode.id, newParentId);
        }
      } else {
        await addNode({ name_ar: nameAr, name_en: nameEn, type: finalType, code, icon, color, description, parentId: parentNode?.id || null, extraFields: pricingFields });
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

      {type === "program" && (
        <div style={{ background: "rgba(255,255,255,.04)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>{tx("التسعير (CRM-CATALOG-01)", "Pricing (CRM-CATALOG-01)")}</div>
          {editNode?.slug ? (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 4 }}>{tx("المعرف (slug) — لا يتغيّر بعد الحفظ", "Slug — immutable once saved")}</label>
              <div dir="ltr" style={{ background: "rgba(255,255,255,.04)", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "9px 13px", fontSize: 13, color: C.muted }}>
                {editNode.slug}
              </div>
            </div>
          ) : (
            <Input
              label={tx("المعرف (slug)", "Slug")}
              value={slug} onChange={setSlug} dir="ltr"
              placeholder="e.g. frontend-web-development"
            />
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            <Input label={tx(`السعر الأصلي (${CURRENCY})`, `Original Price (${CURRENCY})`)} type="number" value={originalPrice} onChange={setOriginalPrice} dir="ltr" />
            <Input label={tx(`العربون (${CURRENCY})`, `Deposit (${CURRENCY})`)} type="number" value={depositAmount} onChange={setDepositAmount} dir="ltr" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            <Select
              label={tx("عدد الأقساط", "Installment Count")}
              value={String(installmentCount)}
              onChange={(v) => setInstallmentCount(Number(v))}
              options={[{ v: "2", l: "2" }, { v: "3", l: "3" }]}
            />
            <Select
              label={tx("وحدة السعر", "Price Unit")}
              value={priceUnit}
              onChange={setPriceUnit}
              options={[{ v: "program", l: tx("للبرنامج كاملاً", "Whole program") }, { v: "per_level", l: tx("لكل مستوى", "Per level") }]}
            />
          </div>
          {originalPrice !== "" && !isNaN(Number(originalPrice)) && (
            <div style={{ fontSize: 11.5, color: C.muted }}>
              {tx("سعر الدفع الكامل (محسوب)", "Full-payment price (computed)")}: {computeFullPaymentPrice(Number(originalPrice)).toLocaleString()} {CURRENCY}
            </div>
          )}
        </div>
      )}

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
