import { useState } from "react";
import { Modal, Input, Select, Btn } from "../../../../components/UI";
import { useLeadStatus } from "../../../../context/LeadStatusContext";
import { useCatalog } from "../../../../context/CatalogContext";
import { useLang } from "../../../../context/LangContext";

const ERROR_MESSAGES = {
  DUPLICATE_KEY: { ar: "هذا المفتاح مستخدم بالفعل", en: "This key is already in use" },
  DUPLICATE_NAME_IN_SCOPE: { ar: "يوجد بالفعل حالة بنفس الاسم في هذا النطاق", en: "A status with this name already exists in this scope" },
  SELF_PARENT: { ar: "لا يمكن أن تكون الحالة أباً لنفسها", en: "A status cannot be its own parent" },
  CIRCULAR_REFERENCE: { ar: "لا يمكن نقل الحالة تحت أحد عناصرها الفرعية", en: "Cannot move a status under one of its own descendants" },
  SCOPE_MISMATCH_PARENT: { ar: "لا يمكن اختيار أب من نطاق مختلف", en: "The parent must be compatible with this status's scope" },
  STATUS_NOT_FOUND: { ar: "لم يتم العثور على الحالة", en: "Status not found" },
};

/** Add a status (parentNode passed when adding a child of a specific status),
 * or edit `editStatus`. Re-parenting on edit goes through moveStatus. */
export default function StatusModal({ parentStatus, editStatus, onClose }) {
  const { statuses, addStatus, updateStatus, moveStatus } = useLeadStatus();
  const { businessUnits } = useCatalog();
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);

  const [nameAr, setNameAr] = useState(editStatus?.name_ar || "");
  const [nameEn, setNameEn] = useState(editStatus?.name_en || "");
  const [key, setKey] = useState(editStatus?.key || "");
  const [description, setDescription] = useState(editStatus?.description || "");
  const [color, setColor] = useState(editStatus?.color || "");
  const [icon, setIcon] = useState(editStatus?.icon || "");
  const [scope, setScope] = useState(editStatus?.scope || parentStatus?.scope || "global");
  const [businessUnitId, setBusinessUnitId] = useState(editStatus?.businessUnitId || parentStatus?.businessUnitId || "");
  const [parentId, setParentId] = useState(editStatus ? (editStatus.parentId || "") : (parentStatus?.id || ""));
  const [isDefault, setIsDefault] = useState(!!editStatus?.isDefault);
  const [isTerminal, setIsTerminal] = useState(!!editStatus?.isTerminal);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const scopeOptions = [
    { v: "global", l: tx("عام (لكل الوحدات)", "Global (all Business Units)") },
    { v: "business_unit", l: tx("خاص بوحدة عمل", "Business Unit specific") },
  ];
  const buOptions = businessUnits.map((b) => ({ v: b.id, l: ar ? b.name_ar : b.name_en }));

  // Parent picker: statuses compatible with the chosen scope, excluding self/descendants.
  const disallowedIds = editStatus
    ? new Set([editStatus.id, ...statuses.filter((s) => (s.path || []).includes(editStatus.id)).map((s) => s.id)])
    : new Set();
  const parentOptions = [
    { v: "", l: tx("— بدون أب (مستوى أعلى) —", "— No parent (top level) —") },
    ...statuses
      .filter((s) => !disallowedIds.has(s.id) && (s.scope === "global" || (scope === "business_unit" && s.businessUnitId === businessUnitId)))
      .map((s) => ({ v: s.id, l: ar ? s.name_ar : s.name_en })),
  ];

  const submit = async () => {
    setError("");
    if (!nameAr.trim() && !nameEn.trim()) { setError(tx("أدخل اسماً على الأقل", "Enter at least one name")); return; }
    if (!key.trim()) { setError(tx("أدخل مفتاحاً داخلياً", "Enter an internal key")); return; }
    if (scope === "business_unit" && !businessUnitId) { setError(tx("اختر وحدة العمل", "Choose a Business Unit")); return; }
    setSaving(true);
    try {
      if (editStatus) {
        await updateStatus(editStatus.id, {
          name_ar: nameAr, name_en: nameEn, key, description, color, icon, isDefault, isTerminal,
        });
        const newParentId = parentId || null;
        if ((editStatus.parentId || null) !== newParentId) await moveStatus(editStatus.id, newParentId);
      } else {
        await addStatus({
          name_ar: nameAr, name_en: nameEn, key, description, color, icon,
          scope, businessUnitId: scope === "business_unit" ? businessUnitId : null,
          parentId: parentId || null, isDefault, isTerminal,
        });
      }
      onClose();
    } catch (e) {
      const msg = ERROR_MESSAGES[e.message];
      setError(msg ? (ar ? msg.ar : msg.en) : (e.message || tx("حدث خطأ", "Something went wrong")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={editStatus ? tx("تعديل حالة", "Edit Status") : tx("إضافة حالة", "Add Status")} onClose={onClose}>
      <Input label={tx("الاسم بالعربي", "Name (Arabic)")} value={nameAr} onChange={setNameAr} />
      <Input label={tx("الاسم بالإنجليزي", "Name (English)")} value={nameEn} onChange={setNameEn} />
      <Input label={tx("المفتاح الداخلي", "Internal Key")} value={key} onChange={setKey} />
      <Input label={tx("الوصف (اختياري)", "Description (optional)")} value={description} onChange={setDescription} rows={2} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <Input label={tx("لون (اختياري)", "Color (optional)")} value={color} onChange={setColor} placeholder="#7d3d9e" />
        <Input label={tx("أيقونة (اختياري)", "Icon (optional)")} value={icon} onChange={setIcon} placeholder="📌" />
      </div>

      {!editStatus && (
        <>
          <Select label={tx("النطاق", "Scope")} value={scope} onChange={(v) => { setScope(v); setParentId(""); }} options={scopeOptions} />
          {scope === "business_unit" && (
            <Select label={tx("وحدة العمل", "Business Unit")} value={businessUnitId} onChange={setBusinessUnitId} options={buOptions} />
          )}
        </>
      )}

      <Select label={tx("الحالة الأب (اختياري)", "Parent Status (optional)")} value={parentId} onChange={setParentId} options={parentOptions} />

      <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          {tx("افتراضية لهذا النطاق", "Default for this scope")}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={isTerminal} onChange={(e) => setIsTerminal(e.target.checked)} />
          {tx("حالة نهائية", "Terminal status")}
        </label>
      </div>

      {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <Btn v="ghost" onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
        <Btn v="primary" disabled={saving} onClick={submit}>{tx("حفظ", "Save")}</Btn>
      </div>
    </Modal>
  );
}
