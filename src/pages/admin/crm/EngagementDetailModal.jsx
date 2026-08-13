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
import {
  EDUCATIONAL_LEVEL_OPTIONS, EMPLOYMENT_STATUS_OPTIONS,
  GOVERNORATE_OPTIONS, PROGRAMMING_LEVEL_OPTIONS, PREFERRED_CONTACT_METHOD_OPTIONS,
  ATTENDANCE_TYPE_OPTIONS, PAYMENT_PLAN_OPTIONS, ENROLLMENT_STATUS_OPTIONS, optionLabel,
} from "../../../constants/crmOptions";
import {
  PAYMENT_METHOD_OPTIONS, PAYMENT_TYPE_OPTIONS, PAYMENT_RECORD_STATUS_OPTIONS, paymentOptionLabel,
  effectivePaymentRecords, confirmedAmountPaid, hasUnmigratedLegacyPayments,
  findPaymentConflicts, hasBlockingConflict,
} from "../../../utils/paymentRecords";

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

// Section 1 fields shown in a fixed, sensible order. Fields with a
// predefined vocabulary resolve code -> label via `options`; hasLaptop is
// tri-state; the rest (registrationDate, leadSource, studentComment) render
// as plain text/date.
const STUDENT_PROFILE_DISPLAY_ORDER = [
  { key: "registrationDate" },
  { key: "governorate", options: GOVERNORATE_OPTIONS },
  { key: "educationalLevel", options: EDUCATIONAL_LEVEL_OPTIONS },
  { key: "employmentStatus", options: EMPLOYMENT_STATUS_OPTIONS },
  { key: "attendanceType", options: ATTENDANCE_TYPE_OPTIONS },
  { key: "courseLevel", options: PROGRAMMING_LEVEL_OPTIONS },
  { key: "hasLaptop" },
  { key: "preferredContactMethod", options: PREFERRED_CONTACT_METHOD_OPTIONS },
  { key: "leadSource" },
  { key: "studentComment" },
];

function StudentProfileField({ fieldKey, value, options, ar, tx }) {
  let display = value;
  if (fieldKey === "hasLaptop") {
    display = value === true ? tx("نعم", "Yes") : value === false ? tx("لا", "No") : "—";
  } else if (fieldKey === "registrationDate" && value) {
    display = new Date(value).toLocaleDateString(ar ? "ar-EG" : "en-US");
  } else if (options) {
    display = optionLabel(options, value, ar) || "—";
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

// A predefined-vocabulary field as a Select, with a blank "not set" option.
function CodeSelect({ label, value, onChange, options, ar }) {
  return (
    <Select
      label={label}
      value={value || ""}
      onChange={(v) => onChange(v || null)}
      options={[{ v: "", l: "—" }, ...options.map((o) => ({ v: o.v, l: ar ? o.ar : o.en }))]}
    />
  );
}

function PaymentField({ label, value, bold, ar }) {
  const isNumeric = typeof value === "number";
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
      <div
        dir={isNumeric ? "ltr" : undefined}
        style={{ fontSize: 13, fontWeight: bold ? 800 : 400, textAlign: isNumeric && ar ? "end" : "start" }}
      >
        {value || value === 0 ? (isNumeric ? value.toLocaleString() : value) : "—"}
      </div>
    </div>
  );
}

const PAYMENT_STATUS_COLOR = { pending: C.muted, under_review: C.orange, confirmed: C.success, rejected: C.danger };
const PAYMENT_STATUS_LABEL = {
  pending: ["قيد الانتظار", "Pending"],
  under_review: ["قيد المراجعة", "Under Review"],
  confirmed: ["مؤكد", "Confirmed"],
  rejected: ["مرفوض", "Rejected"],
};

/** One Payment Record. Flow: pending -> under_review -> confirmed/rejected —
 * Confirm/Reject only appear once review has actually started; Confirm is
 * disabled outright when a blocking duplicate exists elsewhere (see
 * CustomerContext.confirmPaymentRecord, which re-checks this server-side too). */
function PaymentRecordRow({ record, conflicts, ar, tx, onStartReview, onConfirm, onReject }) {
  const color = PAYMENT_STATUS_COLOR[record.status] || C.muted;
  const [statusAr, statusEn] = PAYMENT_STATUS_LABEL[record.status] || [record.status, record.status];
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const blocked = hasBlockingConflict(conflicts);

  return (
    <Card style={{ padding: "10px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div>
          <span dir="ltr" style={{ fontSize: 14, fontWeight: 800 }}>{(record.amount || 0).toLocaleString()}</span>
          <span style={{ fontSize: 11.5, color: C.muted, marginInlineStart: 8 }}>
            {paymentOptionLabel(PAYMENT_TYPE_OPTIONS, record.paymentType, ar)}
            {record.paymentMethod ? ` · ${paymentOptionLabel(PAYMENT_METHOD_OPTIONS, record.paymentMethod, ar)}` : ""}
            {record.legacy ? ` · ${tx("قديم", "legacy")}` : ""}
          </span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color }}>{ar ? statusAr : statusEn}</span>
      </div>
      {(record.transactionReference || record.attachmentRef || record.submittedAt) && (
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>
          {record.transactionReference ? `${tx("رقم العملية", "Ref")}: ${record.transactionReference} · ` : ""}
          {record.attachmentRef ? `${tx("إثبات", "Proof")}: ${record.attachmentRef} · ` : ""}
          {record.submittedAt ? new Date(record.submittedAt).toLocaleDateString(ar ? "ar-EG" : "en-US") : ""}
        </div>
      )}
      {record.status === "rejected" && record.rejectionReason && (
        <div style={{ fontSize: 11.5, color: C.danger, marginTop: 4 }}>{tx("سبب الرفض", "Rejection reason")}: {record.rejectionReason}</div>
      )}

      {conflicts.length > 0 && (record.status === "pending" || record.status === "under_review") && (
        <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8, background: `${blocked ? C.danger : C.orange}22`, border: `1px solid ${blocked ? C.danger : C.orange}66` }}>
          {conflicts.map((c, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 700, color: blocked ? C.danger : C.orange }}>
              ⚠ {tx(
                c.type === "reference" ? "نفس رقم العملية مستخدم في دفعة أخرى" : c.type === "proof" ? "نفس إثبات الدفع مستخدم في دفعة أخرى" : "دفعة مشابهة (نفس المبلغ والطريقة والنوع) لنفس العميل",
                c.type === "reference" ? "Same transaction reference used by another payment" : c.type === "proof" ? "Same proof reference used by another payment" : "Similar payment (same amount/method/type) for this customer",
              )} — {paymentOptionLabel(PAYMENT_RECORD_STATUS_OPTIONS, c.record.status, ar)}
            </div>
          ))}
        </div>
      )}

      {record.status === "pending" && !record.legacy && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <Btn sm v="purple" onClick={onStartReview}>{tx("بدء المراجعة", "Start Review")}</Btn>
        </div>
      )}
      {record.status === "under_review" && !record.legacy && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <Btn sm v="primary" disabled={blocked} title={blocked ? tx("محظور بسبب تعارض مؤكد", "Blocked by a confirmed duplicate") : undefined} onClick={onConfirm}>{tx("تأكيد", "Confirm")}</Btn>
            <Btn sm v="ghost" onClick={() => setRejecting((v) => !v)}>{tx("رفض", "Reject")}</Btn>
          </div>
          {rejecting && (
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={tx("سبب الرفض...", "Rejection reason...")}
                style={{ flex: 1, background: "rgba(255,255,255,.06)", border: `1.5px solid ${C.border}`, borderRadius: 8, color: "#fff", fontFamily: "'Cairo',sans-serif", fontSize: 12, padding: "6px 10px" }}
              />
              <Btn sm v="primary" disabled={!reason.trim()} onClick={() => { onReject(reason.trim()); setRejecting(false); setReason(""); }}>{tx("تأكيد الرفض", "Confirm Reject")}</Btn>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// hasLaptop is tri-state (true/false/unknown) — a plain checkbox can't
// represent "not answered", which is the common case for older imports.
function HasLaptopEditor({ value, onChange, label }) {
  const v = value === true ? "yes" : value === false ? "no" : "";
  return (
    <Select
      label={label}
      value={v}
      onChange={(nv) => onChange(nv === "yes" ? true : nv === "no" ? false : null)}
      options={[{ v: "", l: "—" }, { v: "yes", l: "Yes" }, { v: "no", l: "No" }]}
    />
  );
}

export default function EngagementDetailModal({ engagement, onClose }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { users } = useAuth();
  const { nodeById } = useCatalog();
  const { effectiveStatuses } = useLeadStatus();
  const {
    engagements, customerById, updateCustomer, updateEngagement, changeEngagementStatus, changeEnrollmentStatus, logEngagementActivity,
    addPaymentRecord, startPaymentReview, confirmPaymentRecord, rejectPaymentRecord, migrateLegacyPayments,
  } = useCustomers();
  const { fieldDefsForBusinessUnit } = useCustomFields();

  const customer = customerById(engagement.customerId);
  const businessUnit = nodeById(engagement.businessUnitId);
  const program = engagement.catalogNodeId ? nodeById(engagement.catalogNodeId) : null;
  const admins = users.filter((u) => u.role === "admin");
  const studentProfile = engagement.studentProfile || {};
  const customFieldDefs = fieldDefsForBusinessUnit(engagement.businessUnitId);
  const payment = engagement.payment || {};
  // Amount Paid / Remaining Balance are never stored — always derived from
  // confirmed Payment Records only, same helper the Program sheet uses, so
  // the two views can't disagree.
  const amountPaid = confirmedAmountPaid(engagement);
  const remainingBalance = (payment.coursePrice || 0) - amountPaid;
  const paymentRecords = effectivePaymentRecords(engagement);

  const EMPTY_PAYMENT_DRAFT = { amount: "", paymentMethod: "cash", paymentType: "installment", transactionReference: "", attachmentRef: "" };
  const [paymentDraft, setPaymentDraft] = useState(EMPTY_PAYMENT_DRAFT);
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  // Live duplicate check on the draft, before it's even submitted — same
  // conflict detector used against real records (see PaymentRecordRow).
  const draftConflicts = (paymentDraft.transactionReference || paymentDraft.attachmentRef)
    ? findPaymentConflicts({ ...paymentDraft, id: "__draft__", amount: Number(paymentDraft.amount) || 0 }, engagement, engagements)
    : [];
  const submitPayment = async () => {
    const amount = Number(paymentDraft.amount);
    if (!amount || amount <= 0) return;
    setSavingPayment(true);
    setPaymentError("");
    try {
      await addPaymentRecord(engagement.id, { ...paymentDraft, amount });
      setPaymentDraft(EMPTY_PAYMENT_DRAFT);
    } finally {
      setSavingPayment(false);
    }
  };
  const handleConfirmRecord = async (paymentId) => {
    try {
      setPaymentError("");
      await confirmPaymentRecord(engagement.id, paymentId);
    } catch {
      setPaymentError(tx("تعذّر التأكيد: يوجد تعارض دفع مؤكد بنفس البيانات", "Couldn't confirm: a confirmed duplicate payment conflict exists"));
    }
  };

  const [activityType, setActivityType] = useState("note");
  const [activityText, setActivityText] = useState("");
  const [salesNotesDraft, setSalesNotesDraft] = useState(engagement.salesNotes || "");
  const [saving, setSaving] = useState(false);

  // Editing Section 1 is a deliberate correction, not routine data entry —
  // it stays import-driven by default, this is just an escape hatch for typos.
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState(null);

  const startEditProfile = () => {
    setProfileDraft({
      fullName: customer?.fullName || "", phone: customer?.phone || "",
      email: customer?.email || "", whatsapp: customer?.whatsapp || "",
      ...studentProfile,
    });
    setEditingProfile(true);
  };
  const cancelEditProfile = () => { setEditingProfile(false); setProfileDraft(null); };
  const saveEditProfile = async () => {
    setSaving(true);
    try {
      const { fullName, phone, email, whatsapp, ...sp } = profileDraft;
      await updateCustomer(customer.id, { fullName, phone, email, whatsapp });
      await updateEngagement(engagement.id, { studentProfile: sp });
      setEditingProfile(false);
      setProfileDraft(null);
    } finally {
      setSaving(false);
    }
  };
  const setDraft = (key, value) => setProfileDraft((p) => ({ ...p, [key]: value }));

  const statusOptions = effectiveStatuses(engagement.businessUnitId).map((s) => ({ v: s.id, l: ar ? s.name_ar : s.name_en }));
  const assigneeOptions = [
    { v: "", l: tx("غير معيّن", "Unassigned") },
    ...admins.map((a) => ({ v: a.id, l: a.name || a.email })),
  ];
  const priorityOptions = PRIORITY_OPTIONS.map((p) => ({ v: p.v, l: ar ? p.ar : p.en }));
  const enrollmentOptions = ENROLLMENT_STATUS_OPTIONS.map((o) => ({ v: o.v, l: ar ? o.ar : o.en }));

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
          {program ? <> · <span dir="ltr">{program.name_en}</span></> : ""}
        </span>
      </div>

      {!editingProfile && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px", marginBottom: 4 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{tx("الهاتف", "Phone")}</div>
            <div dir="ltr" style={{ fontSize: 13, textAlign: ar ? "end" : "start" }}>{customer?.phone || "—"}</div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{tx("البريد الإلكتروني", "Email")}</div>
            <div dir="ltr" style={{ fontSize: 13, textAlign: ar ? "end" : "start" }}>{customer?.email || "—"}</div>
          </div>
        </div>
      )}

      {/* ── Section 1: Student Profile — from registration/import; edit is a
          deliberate correction escape hatch, not the normal way to fill this in ── */}
      <div style={{ ...sectionTitleSx, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{tx("بيانات الطالب (من التسجيل)", "Student Profile (from registration)")}</span>
        {!editingProfile && <Btn sm v="ghost" onClick={startEditProfile}>{tx("تعديل", "Edit")}</Btn>}
      </div>

      {editingProfile ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            <Input label={tx("الاسم الكامل", "Full Name")} value={profileDraft.fullName} onChange={(v) => setDraft("fullName", v)} />
            <Input label={tx("الهاتف", "Phone")} value={profileDraft.phone} onChange={(v) => setDraft("phone", v)} dir="ltr" />
            <Input label={tx("البريد الإلكتروني", "Email")} value={profileDraft.email} onChange={(v) => setDraft("email", v)} dir="ltr" />
            <Input label={tx("واتساب", "WhatsApp")} value={profileDraft.whatsapp} onChange={(v) => setDraft("whatsapp", v)} dir="ltr" />
            <Input label={canonicalFieldLabel("registrationDate", ar ? "ar" : "en")} type="date" value={profileDraft.registrationDate || ""} onChange={(v) => setDraft("registrationDate", v || null)} />
            <CodeSelect ar={ar} label={canonicalFieldLabel("governorate", ar ? "ar" : "en")} value={profileDraft.governorate} onChange={(v) => setDraft("governorate", v)} options={GOVERNORATE_OPTIONS} />
            <CodeSelect ar={ar} label={canonicalFieldLabel("educationalLevel", ar ? "ar" : "en")} value={profileDraft.educationalLevel} onChange={(v) => setDraft("educationalLevel", v)} options={EDUCATIONAL_LEVEL_OPTIONS} />
            <CodeSelect ar={ar} label={canonicalFieldLabel("employmentStatus", ar ? "ar" : "en")} value={profileDraft.employmentStatus} onChange={(v) => setDraft("employmentStatus", v)} options={EMPLOYMENT_STATUS_OPTIONS} />
            <CodeSelect ar={ar} label={canonicalFieldLabel("attendanceType", ar ? "ar" : "en")} value={profileDraft.attendanceType} onChange={(v) => setDraft("attendanceType", v)} options={ATTENDANCE_TYPE_OPTIONS} />
            <CodeSelect ar={ar} label={canonicalFieldLabel("courseLevel", ar ? "ar" : "en")} value={profileDraft.courseLevel} onChange={(v) => setDraft("courseLevel", v)} options={PROGRAMMING_LEVEL_OPTIONS} />
            <HasLaptopEditor label={canonicalFieldLabel("hasLaptop", ar ? "ar" : "en")} value={profileDraft.hasLaptop} onChange={(v) => setDraft("hasLaptop", v)} />
            <CodeSelect ar={ar} label={canonicalFieldLabel("preferredContactMethod", ar ? "ar" : "en")} value={profileDraft.preferredContactMethod} onChange={(v) => setDraft("preferredContactMethod", v)} options={PREFERRED_CONTACT_METHOD_OPTIONS} />
            <Input label={canonicalFieldLabel("leadSource", ar ? "ar" : "en")} value={profileDraft.leadSource || ""} onChange={(v) => setDraft("leadSource", v)} />
          </div>
          <Input label={canonicalFieldLabel("studentComment", ar ? "ar" : "en")} value={profileDraft.studentComment || ""} onChange={(v) => setDraft("studentComment", v)} rows={2} />
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <Btn sm v="purple" onClick={cancelEditProfile}>{tx("إلغاء", "Cancel")}</Btn>
            <Btn sm v="primary" disabled={saving} onClick={saveEditProfile}>{tx("حفظ", "Save")}</Btn>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
          {STUDENT_PROFILE_DISPLAY_ORDER.map(({ key, options }) => (
            <StudentProfileField key={key} fieldKey={key} value={studentProfile[key]} options={options} ar={ar} tx={tx} />
          ))}
        </div>
      )}
      {!editingProfile && customFieldDefs.length > 0 && (
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <Select label={tx("حالة التواصل", "Contact Status")} value={engagement.statusId || ""} onChange={(v) => changeEngagementStatus(engagement.id, v)} options={statusOptions} />
        <div>
          <Select label={tx("التسجيل", "Enrollment")} value={engagement.enrollmentStatus || "not_enrolled"} onChange={(v) => changeEnrollmentStatus(engagement.id, v)} options={enrollmentOptions} />
          {engagement.enrollmentStatus === "enrolled" && (
            <div style={{ fontSize: 10.5, color: C.success, fontWeight: 700, marginTop: -10, marginBottom: 16 }}>
              ✓ {tx("مُفعّل تلقائيًا بتأكيد العربون/الدفع الكامل", "Auto-set by a confirmed deposit/full payment")}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <Select label={tx("الموظف المسؤول", "Assigned employee")} value={engagement.ownerId || ""} onChange={(v) => updateEngagement(engagement.id, { ownerId: v || null })} options={assigneeOptions} />
        <Select label={tx("الأولوية", "Priority")} value={engagement.priority || "normal"} onChange={(v) => updateEngagement(engagement.id, { priority: v })} options={priorityOptions} />
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

      {/* ── Payment — Course Price/Plan edited inline in the Program sheet;
          Payment Records (the only source of truth for Amount Paid) are
          managed here. ── */}
      <div style={sectionTitleSx}>{tx("الدفع", "Payment")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <PaymentField ar={ar} label={tx("سعر الكورس", "Course Price")} value={payment.coursePrice} />
        <PaymentField ar={ar} label={tx("خطة الدفع", "Payment Plan")} value={optionLabel(PAYMENT_PLAN_OPTIONS, payment.paymentPlan, ar)} />
        <PaymentField ar={ar} label={tx("المدفوع (مؤكد فقط)", "Amount Paid (confirmed only)")} value={amountPaid} bold />
        <PaymentField ar={ar} label={tx("المتبقي", "Remaining Balance")} value={remainingBalance} bold />
      </div>

      <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>{tx("سجل الدفعات", "Payment Records")}</div>
      {paymentRecords.length === 0 && <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{tx("لا توجد دفعات بعد", "No payments yet")}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {paymentRecords.map((r) => (
          <PaymentRecordRow key={r.id} record={r} conflicts={findPaymentConflicts(r, engagement, engagements)} ar={ar} tx={tx}
            onStartReview={() => startPaymentReview(engagement.id, r.id)}
            onConfirm={() => handleConfirmRecord(r.id)}
            onReject={(reason) => rejectPaymentRecord(engagement.id, r.id, reason)}
          />
        ))}
      </div>
      {paymentError && <div style={{ fontSize: 12, color: C.danger, marginBottom: 12 }}>{paymentError}</div>}
      {hasUnmigratedLegacyPayments(engagement) && (
        <Btn sm v="ghost" onClick={() => migrateLegacyPayments(engagement.id)} style={{ marginBottom: 12 }}>
          {tx("ترحيل الدفعات القديمة إلى السجل", "Migrate legacy payments to records")}
        </Btn>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ width: 100 }}>
          <Input label={tx("المبلغ", "Amount")} type="number" value={paymentDraft.amount} onChange={(v) => setPaymentDraft((d) => ({ ...d, amount: v }))} dir="ltr" />
        </div>
        <div style={{ width: 140 }}>
          <Select label={tx("الطريقة", "Method")} value={paymentDraft.paymentMethod} onChange={(v) => setPaymentDraft((d) => ({ ...d, paymentMethod: v }))}
            options={PAYMENT_METHOD_OPTIONS.map((o) => ({ v: o.v, l: ar ? o.ar : o.en }))} />
        </div>
        <div style={{ width: 130 }}>
          <Select label={tx("النوع", "Type")} value={paymentDraft.paymentType} onChange={(v) => setPaymentDraft((d) => ({ ...d, paymentType: v }))}
            options={PAYMENT_TYPE_OPTIONS.map((o) => ({ v: o.v, l: ar ? o.ar : o.en }))} />
        </div>
        <div style={{ width: 140 }}>
          <Input label={tx("رقم العملية (اختياري)", "Reference (optional)")} value={paymentDraft.transactionReference} onChange={(v) => setPaymentDraft((d) => ({ ...d, transactionReference: v }))} dir="ltr" />
        </div>
        <div style={{ width: 160 }}>
          <Input label={tx("مرجع إثبات الدفع (اختياري)", "Proof reference (optional)")} value={paymentDraft.attachmentRef} onChange={(v) => setPaymentDraft((d) => ({ ...d, attachmentRef: v }))} dir="ltr" placeholder={tx("رابط/رقم إيصال...", "URL / receipt id...")} />
        </div>
        <Btn sm v="primary" disabled={savingPayment || !paymentDraft.amount} onClick={submitPayment} style={{ marginBottom: 16 }}>{tx("إضافة دفعة", "Add Payment")}</Btn>
      </div>
      {draftConflicts.length > 0 && (
        <div style={{ marginTop: -8, marginBottom: 16, fontSize: 11.5, fontWeight: 700, color: C.orange }}>
          ⚠ {tx("تحذير: نفس رقم العملية أو الإثبات مستخدم بالفعل في دفعة أخرى", "Warning: this reference/proof is already used by another payment")}
        </div>
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
