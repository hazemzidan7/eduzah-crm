import { useState } from "react";
import { Modal, Select, Input, Btn, Card } from "../../../components/UI";
import { C } from "../../../theme";
import { useLang } from "../../../context/LangContext";
import { useAuth } from "../../../context/AuthContext";
import { useCatalog } from "../../../context/CatalogContext";
import { useLeadStatus } from "../../../context/LeadStatusContext";
import { useCustomers } from "../../../context/CustomerContext";
import { useCustomFields } from "../../../context/CustomFieldContext";
import LeadStatusBadge from "../../../components/crm/LeadStatusBadge";
import { canonicalFieldLabel } from "../../../constants/importCanonicalFields";

const ACTIVITY_TYPES = [
  { v: "note", ar: "ملاحظة", en: "Note" },
  { v: "call", ar: "مكالمة", en: "Call" },
  { v: "whatsapp", ar: "واتساب", en: "WhatsApp" },
];

const PRIORITY_OPTIONS = [
  { v: "low", ar: "منخفضة", en: "Low" },
  { v: "normal", ar: "عادية", en: "Normal" },
  { v: "high", ar: "عالية", en: "High" },
];

const CONTACT_STATUS_OPTIONS = [
  { v: "not_contacted", ar: "لم يتم التواصل", en: "Not contacted" },
  { v: "contacted", ar: "تم التواصل", en: "Contacted" },
  { v: "awaiting_contact", ar: "بانتظار التواصل", en: "Awaiting contact" },
];

// Section 1 fields shown in a fixed, sensible order — hasLaptop rendered
// specially (yes/no/unknown) rather than as raw text.
const STUDENT_PROFILE_DISPLAY_ORDER = [
  "registrationDate", "governorate", "educationalLevel", "employmentStatus",
  "attendanceType", "courseLevel", "hasLaptop", "preferredContactMethod",
  "leadSource", "studentComment",
];

function StudentProfileField({ fieldKey, value, ar, tx }) {
  let display = value;
  if (fieldKey === "hasLaptop") {
    display = value === true ? tx("نعم", "Yes") : value === false ? tx("لا", "No") : "—";
  } else if (fieldKey === "registrationDate" && value) {
    display = new Date(value).toLocaleDateString(ar ? "ar-EG" : "en-US");
  } else if (!value) {
    display = "—";
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{canonicalFieldLabel(fieldKey, ar ? "ar" : "en")}</div>
      <div style={{ fontSize: 13 }}>{display}</div>
    </div>
  );
}

export default function EngagementDetailModal({ engagement, onClose }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { users } = useAuth();
  const { nodeById } = useCatalog();
  const { effectiveStatuses } = useLeadStatus();
  const { customerById, updateEngagement, changeEngagementStatus, logEngagementActivity } = useCustomers();
  const { fieldDefsForBusinessUnit } = useCustomFields();

  const customer = customerById(engagement.customerId);
  const businessUnit = nodeById(engagement.businessUnitId);
  const program = engagement.catalogNodeId ? nodeById(engagement.catalogNodeId) : null;
  const admins = users.filter((u) => u.role === "admin");
  const studentProfile = engagement.studentProfile || {};
  const customFieldDefs = fieldDefsForBusinessUnit(engagement.businessUnitId);

  const [activityType, setActivityType] = useState("note");
  const [activityText, setActivityText] = useState("");
  const [salesNotesDraft, setSalesNotesDraft] = useState(engagement.salesNotes || "");
  const [saving, setSaving] = useState(false);

  const statusOptions = effectiveStatuses(engagement.businessUnitId).map((s) => ({ v: s.id, l: ar ? s.name_ar : s.name_en }));
  const assigneeOptions = [
    { v: "", l: tx("غير معيّن", "Unassigned") },
    ...admins.map((a) => ({ v: a.id, l: a.name || a.email })),
  ];
  const priorityOptions = PRIORITY_OPTIONS.map((p) => ({ v: p.v, l: ar ? p.ar : p.en }));
  const contactStatusOptions = CONTACT_STATUS_OPTIONS.map((p) => ({ v: p.v, l: ar ? p.ar : p.en }));

  const timeline = [...(engagement.timeline || [])].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  // "Last Contact" is derived from the timeline, not stored separately — a
  // second source of truth for the same fact would just go stale.
  const lastContact = timeline.find((t) => t.type !== "system");

  const logActivity = async () => {
    if (!activityText.trim() && activityType === "note") return;
    setSaving(true);
    try {
      await logEngagementActivity(engagement.id, { type: activityType, text: activityText });
      setActivityText("");
    } finally {
      setSaving(false);
    }
  };

  const saveSalesNotes = async () => {
    if (salesNotesDraft === (engagement.salesNotes || "")) return;
    await updateEngagement(engagement.id, { salesNotes: salesNotesDraft });
  };

  const sectionTitleSx = { fontSize: 12.5, fontWeight: 800, color: "#fff", margin: "20px 0 10px", paddingBottom: 6, borderBottom: `1px solid ${C.border}` };

  return (
    <Modal title={customer?.fullName || tx("تفاصيل العميل", "Customer Details")} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <LeadStatusBadge statusId={engagement.statusId} />
        <span style={{ fontSize: 12, color: C.muted }}>
          {businessUnit ? (ar ? businessUnit.name_ar : businessUnit.name_en) : "—"}
          {program ? ` · ${ar ? program.name_ar : program.name_en}` : ""}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px", marginBottom: 4 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{tx("الهاتف", "Phone")}</div>
          <div style={{ fontSize: 13 }}>{customer?.phone || "—"}</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{tx("البريد الإلكتروني", "Email")}</div>
          <div style={{ fontSize: 13 }}>{customer?.email || "—"}</div>
        </div>
      </div>

      {/* ── Section 1: Student Profile — read-only, from registration/import ── */}
      <div style={sectionTitleSx}>{tx("بيانات الطالب (من التسجيل)", "Student Profile (from registration)")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        {STUDENT_PROFILE_DISPLAY_ORDER.map((k) => (
          <StudentProfileField key={k} fieldKey={k} value={studentProfile[k]} ar={ar} tx={tx} />
        ))}
      </div>
      {customFieldDefs.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
          {customFieldDefs.map((def) => (
            <div key={def.id} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{ar ? def.label_ar : def.label_en}</div>
              <div style={{ fontSize: 13 }}>
                {def.fieldType === "boolean"
                  ? (engagement.customFields?.[def.key] === true ? tx("نعم", "Yes") : engagement.customFields?.[def.key] === false ? tx("لا", "No") : "—")
                  : (engagement.customFields?.[def.key] || "—")}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Section 2: CRM Internal Data — owned and edited by sales staff ── */}
      <div style={sectionTitleSx}>{tx("بيانات إدارة المبيعات (داخلية)", "CRM Internal Data")}</div>
      <Select label={tx("الحالة", "Status")} value={engagement.statusId || ""} onChange={(v) => changeEngagementStatus(engagement.id, v)} options={statusOptions} />
      <Select label={tx("الموظف المسؤول", "Assigned employee")} value={engagement.ownerId || ""} onChange={(v) => updateEngagement(engagement.id, { ownerId: v || null })} options={assigneeOptions} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <Select label={tx("الأولوية", "Priority")} value={engagement.priority || "normal"} onChange={(v) => updateEngagement(engagement.id, { priority: v })} options={priorityOptions} />
        <Select label={tx("حالة التواصل", "Contact status")} value={engagement.contactStatus || "not_contacted"} onChange={(v) => updateEngagement(engagement.id, { contactStatus: v })} options={contactStatusOptions} />
      </div>
      <Input
        label={tx("تاريخ المتابعة القادم", "Next follow-up date")}
        type="date"
        value={engagement.nextFollowUpDate || ""}
        onChange={(v) => updateEngagement(engagement.id, { nextFollowUpDate: v || null })}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px", marginBottom: 4 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{tx("آخر تواصل", "Last contact")}</div>
          <div style={{ fontSize: 13 }}>{lastContact?.at ? new Date(lastContact.at).toLocaleString(ar ? "ar-EG" : "en-US") : "—"}</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{tx("آخر تحديث", "Last updated")}</div>
          <div style={{ fontSize: 13 }}>{engagement.updatedAt ? new Date(engagement.updatedAt).toLocaleString(ar ? "ar-EG" : "en-US") : "—"}</div>
        </div>
      </div>

      <Input
        label={tx("ملاحظات المبيعات", "Sales notes")}
        value={salesNotesDraft}
        onChange={setSalesNotesDraft}
        rows={3}
        placeholder={tx("ملاحظات داخلية عن هذا العميل...", "Internal notes about this lead...")}
      />
      {salesNotesDraft !== (engagement.salesNotes || "") && (
        <Btn sm v="ghost" onClick={saveSalesNotes} style={{ marginBottom: 12 }}>{tx("حفظ الملاحظات", "Save notes")}</Btn>
      )}

      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, margin: "16px 0 8px", textTransform: "uppercase" }}>{tx("إضافة نشاط", "Log activity")}</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <select value={activityType} onChange={(e) => setActivityType(e.target.value)} style={{ background: "#2a1540", border: `1px solid ${C.border}`, borderRadius: 8, color: "#fff", fontSize: 12.5, padding: "8px 10px" }}>
          {ACTIVITY_TYPES.map((t) => <option key={t.v} value={t.v}>{ar ? t.ar : t.en}</option>)}
        </select>
        <input
          value={activityText}
          onChange={(e) => setActivityText(e.target.value)}
          placeholder={tx("تفاصيل (اختياري)...", "Details (optional)...")}
          style={{ flex: 1, background: "rgba(255,255,255,.06)", border: `1.5px solid ${C.border}`, borderRadius: 8, color: "#fff", fontFamily: "'Cairo',sans-serif", fontSize: 12.5, padding: "8px 10px" }}
        />
        <Btn sm v="primary" disabled={saving} onClick={logActivity}>{tx("إضافة", "Add")}</Btn>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8, textTransform: "uppercase" }}>{tx("السجل الزمني", "Timeline")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
        {timeline.length === 0 && <div style={{ fontSize: 12, color: C.muted }}>{tx("لا يوجد نشاط بعد", "No activity yet")}</div>}
        {timeline.map((t) => (
          <Card key={t.id} style={{ padding: "8px 12px" }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>
              {t.type === "status_change" ? tx("تغيير الحالة", "Status changed") : ACTIVITY_TYPES.find((a) => a.v === t.type)?.[ar ? "ar" : "en"] || t.type}
            </div>
            {t.text && <div style={{ fontSize: 12, color: C.muted }}>{t.text}</div>}
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
              {t.byName ? `${t.byName} · ` : ""}{t.at ? new Date(t.at).toLocaleString(ar ? "ar-EG" : "en-US") : ""}
            </div>
          </Card>
        ))}
      </div>
    </Modal>
  );
}
