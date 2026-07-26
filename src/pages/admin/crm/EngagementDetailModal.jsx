import { useState } from "react";
import { Modal, Select, Input, Btn, Card } from "../../../components/UI";
import { C } from "../../../theme";
import { useLang } from "../../../context/LangContext";
import { useAuth } from "../../../context/AuthContext";
import { useCatalog } from "../../../context/CatalogContext";
import { useLeadStatus } from "../../../context/LeadStatusContext";
import { useCustomers } from "../../../context/CustomerContext";
import LeadStatusBadge from "../../../components/crm/LeadStatusBadge";

const ACTIVITY_TYPES = [
  { v: "note", ar: "ملاحظة", en: "Note" },
  { v: "call", ar: "مكالمة", en: "Call" },
  { v: "whatsapp", ar: "واتساب", en: "WhatsApp" },
];

export default function EngagementDetailModal({ engagement, onClose }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { users } = useAuth();
  const { nodeById } = useCatalog();
  const { effectiveStatuses } = useLeadStatus();
  const { customerById, updateEngagement, changeEngagementStatus, logEngagementActivity } = useCustomers();

  const customer = customerById(engagement.customerId);
  const businessUnit = nodeById(engagement.businessUnitId);
  const program = engagement.catalogNodeId ? nodeById(engagement.catalogNodeId) : null;
  const admins = users.filter((u) => u.role === "admin");

  const [activityType, setActivityType] = useState("note");
  const [activityText, setActivityText] = useState("");
  const [saving, setSaving] = useState(false);

  const statusOptions = effectiveStatuses(engagement.businessUnitId).map((s) => ({ v: s.id, l: ar ? s.name_ar : s.name_en }));
  const assigneeOptions = [
    { v: "", l: tx("غير معيّن", "Unassigned") },
    ...admins.map((a) => ({ v: a.id, l: a.name || a.email })),
  ];

  const timeline = [...(engagement.timeline || [])].sort((a, b) => (b.at || "").localeCompare(a.at || ""));

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

      <Select label={tx("الحالة", "Status")} value={engagement.statusId || ""} onChange={(v) => changeEngagementStatus(engagement.id, v)} options={statusOptions} />
      <Select label={tx("الموظف المسؤول", "Assigned employee")} value={engagement.ownerId || ""} onChange={(v) => updateEngagement(engagement.id, { ownerId: v || null })} options={assigneeOptions} />

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
