import { useState, useMemo } from "react";
import { Card, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useAuth } from "../../../../context/AuthContext";
import { useLeadStatus } from "../../../../context/LeadStatusContext";
import { useCustomers } from "../../../../context/CustomerContext";
import { toE164Phone } from "../../../../utils/phoneE164";
import {
  CONTACT_STATUS_OPTIONS, ATTENDANCE_TYPE_OPTIONS, PAYMENT_PLAN_OPTIONS,
} from "../../../../constants/crmOptions";
import { InlineText, InlineNumber, InlineDate, InlineSelect, ComputedMoney } from "./InlineCells";
import EngagementDetailModal from "../EngagementDetailModal";

const th = { textAlign: "start", fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase", color: C.muted, fontWeight: 700, padding: "10px 8px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", background: "#241536" };
const td = { padding: "4px 6px", fontSize: 12.5, borderBottom: "1px solid rgba(255,255,255,.06)", verticalAlign: "middle" };
const stickyTh = { ...th, position: "sticky", insetInlineStart: 0, zIndex: 2 };
const stickyTd = { ...td, position: "sticky", insetInlineStart: 0, background: "#2a1540", zIndex: 1 };

function amountPaidOf(payment) {
  const p = payment || {};
  return (p.reservationDeposit || 0) + (p.installment1 || 0) + (p.installment2 || 0) + (p.installment3 || 0);
}

/**
 * The sales team's default daily-work view for a Program: one row per
 * student, everything editable in place, nothing requires opening the full
 * profile. Same component for every Program in the catalog — the workspace
 * just hands it a pre-scoped engagement list.
 */
export default function ProgramSalesSheet({ engagements, businessUnitId, ar, tx }) {
  const { users } = useAuth();
  const { effectiveStatuses } = useLeadStatus();
  const { customerById, updateCustomer, updateEngagement, changeEngagementStatus, logEngagementActivity } = useCustomers();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [profileEngagementId, setProfileEngagementId] = useState(null);

  const admins = users.filter((u) => u.role === "admin");
  const assigneeOptions = [
    { v: "", l: tx("غير معيّن", "Unassigned") },
    ...admins.map((a) => ({ v: a.id, l: a.name || a.email })),
  ];
  const statusOptions = effectiveStatuses(businessUnitId).map((s) => ({ v: s.id, l: ar ? s.name_ar : s.name_en }));
  const contactStatusOptions = CONTACT_STATUS_OPTIONS.map((o) => ({ v: o.v, l: ar ? o.ar : o.en }));
  const attendanceOptions = ATTENDANCE_TYPE_OPTIONS.map((o) => ({ v: o.v, l: ar ? o.ar : o.en }));
  const paymentPlanOptions = PAYMENT_PLAN_OPTIONS.map((o) => ({ v: o.v, l: ar ? o.ar : o.en }));

  const filtered = useMemo(() => {
    let rows = engagements;
    if (statusFilter !== "all") rows = rows.filter((e) => e.statusId === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((e) => {
        const c = customerById(e.customerId);
        return (c?.fullName || "").toLowerCase().includes(q) || (c?.phone || "").includes(q) || (c?.email || "").toLowerCase().includes(q);
      });
    }
    return [...rows].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [engagements, statusFilter, search, customerById]);

  const patchStudentProfile = (engagement, key, val) =>
    updateEngagement(engagement.id, { studentProfile: { ...(engagement.studentProfile || {}), [key]: val } });
  const patchPayment = (engagement, key, val) =>
    updateEngagement(engagement.id, { payment: { ...(engagement.payment || {}), [key]: val } });

  const confirmPayment = async (engagement) => {
    await updateEngagement(engagement.id, { payment: { ...(engagement.payment || {}), confirmed: true, confirmedAt: new Date().toISOString() } });
    await logEngagementActivity(engagement.id, { type: "system", text: "Payment confirmed" });
  };

  // Quick one-click default (3 days out); the Next Follow-up cell itself
  // stays editable for picking an exact date.
  const scheduleFollowUp = (engagement) => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    updateEngagement(engagement.id, { nextFollowUpDate: d.toISOString().slice(0, 10) });
  };

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short" }) : "—";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tx("بحث بالاسم أو الهاتف أو البريد…", "Search name, phone, email…")}
          style={{ background: "rgba(255,255,255,.06)", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "9px 13px", color: "#fff", fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", minWidth: 220 }}
        />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setStatusFilter("all")} style={pillStyle(statusFilter === "all", C.purple)}>
          {tx("الكل", "All")} <span style={{ opacity: 0.7 }}>({engagements.length})</span>
        </button>
        {statusOptions.map((s) => (
          <button key={s.v} onClick={() => setStatusFilter(s.v)} style={pillStyle(statusFilter === s.v, C.purple)}>
            {s.l} <span style={{ opacity: 0.7 }}>({engagements.filter((e) => e.statusId === s.v).length})</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card style={{ padding: 32, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("لا يوجد طلاب بعد", "No students yet")}</div></Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", maxWidth: "100%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={stickyTh}>{tx("الاسم", "Name")}</th>
                  <th style={th}>{tx("تاريخ التسجيل", "Registration Date")}</th>
                  <th style={th}>{tx("الهاتف", "Phone")}</th>
                  <th style={th}>{tx("البريد", "Email")}</th>
                  <th style={th}>{tx("نوع الحضور", "Attendance")}</th>
                  <th style={th}>{tx("مصدر العميل", "Lead Source")}</th>
                  <th style={th}>{tx("حالة العميل", "Lead Status")}</th>
                  <th style={th}>{tx("حالة التواصل", "Contact Status")}</th>
                  <th style={th}>{tx("ملاحظات المبيعات", "Sales Notes")}</th>
                  <th style={th}>{tx("سعر الكورس", "Course Price")}</th>
                  <th style={th}>{tx("خطة الدفع", "Payment Plan")}</th>
                  <th style={th}>{tx("عربون الحجز", "Deposit")}</th>
                  <th style={th}>{tx("قسط 1", "Installment 1")}</th>
                  <th style={th}>{tx("قسط 2", "Installment 2")}</th>
                  <th style={th}>{tx("قسط 3", "Installment 3")}</th>
                  <th style={th}>{tx("المبلغ المدفوع", "Amount Paid")}</th>
                  <th style={th}>{tx("المتبقي", "Remaining")}</th>
                  <th style={th}>{tx("تأكيد الدفع", "Payment Confirmation")}</th>
                  <th style={th}>{tx("آخر تواصل", "Last Contact")}</th>
                  <th style={th}>{tx("المتابعة القادمة", "Next Follow-up")}</th>
                  <th style={th}>{tx("الموظف المسؤول", "Assigned")}</th>
                  <th style={th}>{tx("إجراءات", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((e) => {
                  const customer = customerById(e.customerId);
                  const sp = e.studentProfile || {};
                  const payment = e.payment || {};
                  const amountPaid = amountPaidOf(payment);
                  const remaining = (payment.coursePrice || 0) - amountPaid;
                  const timeline = [...(e.timeline || [])].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
                  const lastContact = timeline.find((t) => t.type !== "system");
                  const e164 = toE164Phone(customer?.phone);

                  return (
                    <tr key={e.id}>
                      <td style={stickyTd}>
                        <InlineText value={customer?.fullName} onSave={(v) => updateCustomer(customer.id, { fullName: v })} minWidth={140} />
                      </td>
                      <td style={td}>
                        <InlineDate value={sp.registrationDate} onSave={(v) => patchStudentProfile(e, "registrationDate", v)} />
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <InlineText value={customer?.phone} onSave={(v) => updateCustomer(customer.id, { phone: v })} minWidth={110} />
                          {e164 && (
                            <>
                              <a href={`tel:${e164}`} title={tx("اتصال", "Call")} style={iconLinkSx}>📞</a>
                              <a href={`https://wa.me/${e164.replace("+", "")}`} target="_blank" rel="noreferrer" title="WhatsApp" style={iconLinkSx}>💬</a>
                            </>
                          )}
                        </div>
                      </td>
                      <td style={td}>
                        <InlineText value={customer?.email} onSave={(v) => updateCustomer(customer.id, { email: v })} minWidth={150} />
                      </td>
                      <td style={td}>
                        <InlineSelect value={sp.attendanceType} onSave={(v) => patchStudentProfile(e, "attendanceType", v)} options={[{ v: "", l: "—" }, ...attendanceOptions]} />
                      </td>
                      <td style={td}>
                        <InlineText value={sp.leadSource} onSave={(v) => patchStudentProfile(e, "leadSource", v)} minWidth={110} />
                      </td>
                      <td style={td}>
                        <InlineSelect value={e.statusId} onSave={(v) => changeEngagementStatus(e.id, v)} options={[{ v: "", l: "—" }, ...statusOptions]} />
                      </td>
                      <td style={td}>
                        <InlineSelect value={e.contactStatus} onSave={(v) => updateEngagement(e.id, { contactStatus: v })} options={contactStatusOptions} />
                      </td>
                      <td style={td}>
                        <InlineText value={e.salesNotes} onSave={(v) => updateEngagement(e.id, { salesNotes: v })} placeholder={tx("ملاحظة...", "Note...")} minWidth={160} />
                      </td>
                      <td style={td}>
                        <InlineNumber value={payment.coursePrice} onSave={(v) => patchPayment(e, "coursePrice", v)} />
                      </td>
                      <td style={td}>
                        <InlineSelect value={payment.paymentPlan} onSave={(v) => patchPayment(e, "paymentPlan", v)} options={[{ v: "", l: "—" }, ...paymentPlanOptions]} />
                      </td>
                      <td style={td}>
                        <InlineNumber value={payment.reservationDeposit} onSave={(v) => patchPayment(e, "reservationDeposit", v)} />
                      </td>
                      <td style={td}>
                        <InlineNumber value={payment.installment1} onSave={(v) => patchPayment(e, "installment1", v)} />
                      </td>
                      <td style={td}>
                        <InlineNumber value={payment.installment2} onSave={(v) => patchPayment(e, "installment2", v)} />
                      </td>
                      <td style={td}>
                        <InlineNumber value={payment.installment3} onSave={(v) => patchPayment(e, "installment3", v)} />
                      </td>
                      <td style={td}><ComputedMoney value={amountPaid} color={C.success} /></td>
                      <td style={td}><ComputedMoney value={remaining} color={remaining > 0 ? C.orange : C.muted} /></td>
                      <td style={td}>
                        {payment.confirmed
                          ? <span style={{ fontSize: 11, fontWeight: 800, color: C.success }}>{tx("مؤكد", "Confirmed")}</span>
                          : <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{tx("معلّق", "Pending")}</span>}
                      </td>
                      <td style={td}>{lastContact?.at ? fmtDate(lastContact.at) : "—"}</td>
                      <td style={td}>
                        <InlineDate value={e.nextFollowUpDate} onSave={(v) => updateEngagement(e.id, { nextFollowUpDate: v })} />
                      </td>
                      <td style={td}>
                        <InlineSelect value={e.ownerId} onSave={(v) => updateEngagement(e.id, { ownerId: v })} options={assigneeOptions} />
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 4 }}>
                          {!payment.confirmed && (
                            <Btn sm v="success" onClick={() => confirmPayment(e)} title={tx("تأكيد الدفع", "Confirm Payment")}>✓</Btn>
                          )}
                          <Btn sm v="ghost" onClick={() => scheduleFollowUp(e)} title={tx("جدولة متابعة", "Schedule Follow-up")}>📅</Btn>
                          <Btn sm v="ghost" onClick={() => setProfileEngagementId(e.id)} title={tx("عرض الملف", "View Profile")}>👁</Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 300 && (
            <div style={{ fontSize: 11.5, color: C.muted, padding: "8px 14px" }}>
              {tx(`+ ${filtered.length - 300} طالب إضافي (استخدم البحث)`, `+ ${filtered.length - 300} more (use search to narrow)`)}
            </div>
          )}
        </Card>
      )}

      {profileEngagementId && (
        <EngagementDetailModal
          engagement={engagements.find((e) => e.id === profileEngagementId)}
          onClose={() => setProfileEngagementId(null)}
        />
      )}
    </div>
  );
}

const iconLinkSx = { textDecoration: "none", fontSize: 14, padding: "2px 4px", borderRadius: 6, background: "rgba(255,255,255,.06)" };

function pillStyle(active, color) {
  return {
    padding: "6px 13px", borderRadius: 99, border: "none", cursor: "pointer",
    fontWeight: 800, fontSize: 11.5, fontFamily: "'Cairo',sans-serif",
    background: active ? color : "rgba(255,255,255,.06)",
    color: active ? "#fff" : C.muted,
    transition: "all .2s",
  };
}
