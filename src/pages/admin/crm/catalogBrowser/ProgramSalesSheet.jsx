import { useState, useMemo, useRef, useEffect } from "react";
import { Card, Btn } from "../../../../components/UI";
import { C, radius, shadow } from "../../../../theme";
import { useAuth } from "../../../../context/AuthContext";
import { useLeadStatus } from "../../../../context/LeadStatusContext";
import { useCustomers } from "../../../../context/CustomerContext";
import { toE164Phone } from "../../../../utils/phoneE164";
import { ATTENDANCE_TYPE_OPTIONS, PAYMENT_PLAN_OPTIONS } from "../../../../constants/crmOptions";
import { InlineText, InlineNumber, InlineDate, InlineSelect, InlineStatusSelect, ComputedMoney } from "./InlineCells";
import EngagementDetailModal from "../EngagementDetailModal";
import AddStudentModal from "./AddStudentModal";

const th = { textAlign: "center", fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase", color: "rgba(255,255,255,.88)", fontWeight: 800, padding: "11px 12px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", background: "#2c1a3a", position: "sticky", top: 0, zIndex: 2, boxShadow: "0 2px 6px rgba(0,0,0,.25)" };
const td = { padding: "8px 10px", fontSize: 12.5, textAlign: "center", borderBottom: "1px solid rgba(255,255,255,.09)", verticalAlign: "middle", whiteSpace: "nowrap" };

// Name + Phone are pinned while scrolling horizontally so a rep never loses
// track of who they're looking at — they must be adjacent columns (nothing
// unpinned in between) for their sticky offsets to stack correctly.
const NAME_COL_W = 170;
const PHONE_COL_W = 168;
const stickyTh1 = { ...th, insetInlineStart: 0, zIndex: 3, width: NAME_COL_W, minWidth: NAME_COL_W };
const stickyTd1 = { ...td, position: "sticky", insetInlineStart: 0, background: "#331f42", zIndex: 1, width: NAME_COL_W, minWidth: NAME_COL_W };
const pinnedEdgeShadow = "4px 0 8px -2px rgba(0,0,0,.4)";
const stickyTh2 = { ...th, insetInlineStart: NAME_COL_W, zIndex: 3, width: PHONE_COL_W, minWidth: PHONE_COL_W, boxShadow: `0 2px 6px rgba(0,0,0,.25), ${pinnedEdgeShadow}` };
const stickyTd2 = { ...td, position: "sticky", insetInlineStart: NAME_COL_W, background: "#331f42", zIndex: 1, width: PHONE_COL_W, minWidth: PHONE_COL_W, boxShadow: pinnedEdgeShadow };
/* Marks where the payment/financial column group begins, so Price→Confirmation
   reads as one visually grouped block instead of just more columns. */
const thGroupStart = { ...th, borderInlineStart: "1px solid rgba(250,166,51,.35)" };
const tdGroupStart = { ...td, borderInlineStart: "1px solid rgba(250,166,51,.18)" };

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
export default function ProgramSalesSheet({ engagements, program, businessUnitId, ar, tx }) {
  const { users } = useAuth();
  const { effectiveStatuses, statusById } = useLeadStatus();
  const { customerById, updateCustomer, updateEngagement, changeEngagementStatus, logEngagementActivity } = useCustomers();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [profileEngagementId, setProfileEngagementId] = useState(null);
  const [addingStudent, setAddingStudent] = useState(false);
  // Compact overflow menu for the row's less-frequent actions (confirm
  // payment, schedule follow-up) — only View Profile stays always visible.
  const [rowMenu, setRowMenu] = useState(null); // { id, top, left }
  const openRowMenu = (ev, id) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const menuWidth = 190;
    const left = ar ? r.left : Math.max(8, r.right - menuWidth);
    setRowMenu({ id, top: r.bottom + 4, left });
  };
  const closeRowMenu = () => setRowMenu(null);

  // Shift+wheel already pans horizontally in most browsers, but not all
  // mice/trackpads send it consistently — handle it explicitly so it always
  // works. React's synthetic onWheel is registered passive (preventDefault
  // is a no-op there), so this needs a real addEventListener with
  // { passive: false } to actually stop the native vertical scroll.
  const scrollRef = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (ev) => {
      if (!ev.shiftKey) return;
      el.scrollLeft += ev.deltaY;
      ev.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const admins = users.filter((u) => u.role === "admin");
  const assigneeOptions = [
    { v: "", l: tx("غير معيّن", "Unassigned") },
    ...admins.map((a) => ({ v: a.id, l: a.name || a.email })),
  ];
  const statusOptions = effectiveStatuses(businessUnitId).map((s) => ({ v: s.id, l: ar ? s.name_ar : s.name_en }));
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tx("بحث بالاسم أو الهاتف أو البريد…", "Search name, phone, email…")}
          style={{ background: "rgba(255,255,255,.06)", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "9px 14px", color: "#fff", fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", minWidth: 240, transition: "border-color .15s" }}
        />
        <Btn v="primary" onClick={() => setAddingStudent(true)}>+ {tx("إضافة طالب", "Add Student")}</Btn>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={() => setStatusFilter("all")} style={pillStyle(statusFilter === "all")}>
          {tx("الكل", "All")} <span style={{ opacity: 0.7 }}>({engagements.length})</span>
        </button>
        {statusOptions.map((s) => (
          <button key={s.v} onClick={() => setStatusFilter(s.v)} style={pillStyle(statusFilter === s.v)}>
            {s.l} <span style={{ opacity: 0.7 }}>({engagements.filter((e) => e.statusId === s.v).length})</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card style={{ padding: 40, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("لا يوجد طلاب بعد", "No students yet")}</div></Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div
            ref={scrollRef}
            className="edu-sheet-scroll"
            style={{ overflowX: "scroll", maxWidth: "100%", maxHeight: "72vh", overflowY: "auto", scrollBehavior: "smooth" }}
          >
            <table style={{ width: "auto", minWidth: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={stickyTh1}>{tx("الاسم", "Name")}</th>
                  <th style={stickyTh2}>{tx("الهاتف", "Phone")}</th>
                  <th style={th}>{tx("تاريخ التسجيل", "Reg. Date")}</th>
                  <th style={th}>{tx("البريد", "Email")}</th>
                  <th style={th}>{tx("نوع الحضور", "Attendance")}</th>
                  <th style={th}>{tx("مصدر العميل", "Lead Source")}</th>
                  <th style={th}>{tx("حالة التواصل", "Contact Status")}</th>
                  <th style={th}>{tx("ملاحظات المبيعات", "Sales Notes")}</th>
                  <th style={thGroupStart}>{tx("سعر الكورس", "Price")}</th>
                  <th style={th}>{tx("خطة الدفع", "Plan")}</th>
                  <th style={th}>{tx("العربون", "Deposit")}</th>
                  <th style={th}>{tx("قسط 1", "Inst. 1")}</th>
                  <th style={th}>{tx("قسط 2", "Inst. 2")}</th>
                  <th style={th}>{tx("قسط 3", "Inst. 3")}</th>
                  <th style={th}>{tx("المدفوع", "Paid")}</th>
                  <th style={th}>{tx("المتبقي", "Remaining")}</th>
                  <th style={th}>{tx("تأكيد الدفع", "Confirmation")}</th>
                  <th style={th}>{tx("آخر تواصل", "Last Contact")}</th>
                  <th style={th}>{tx("المتابعة القادمة", "Next Follow-up")}</th>
                  <th style={th}>{tx("الموظف المسؤول", "Assigned")}</th>
                  <th style={{ ...th, width: 76, minWidth: 76 }} aria-label={tx("إجراءات", "Actions")}></th>
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
                  const status = statusById(e.statusId);

                  return (
                    <tr key={e.id} className={`edu-sheet-row${profileEngagementId === e.id ? " is-selected" : ""}`}>
                      <td style={stickyTd1}>
                        <InlineText value={customer?.fullName} onSave={(v) => updateCustomer(customer.id, { fullName: v })} minWidth={130} size={16} />
                      </td>
                      <td style={stickyTd2}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                          <InlineText value={customer?.phone} onSave={(v) => updateCustomer(customer.id, { phone: v })} minWidth={100} size={12} />
                          {e164 && (
                            <>
                              <a href={`tel:${e164}`} title={tx("اتصال", "Call")} style={iconLinkSx}>📞</a>
                              <a href={`https://wa.me/${e164.replace("+", "")}`} target="_blank" rel="noreferrer" title="WhatsApp" style={iconLinkSx}>💬</a>
                            </>
                          )}
                        </div>
                      </td>
                      <td style={td}>
                        <InlineDate value={sp.registrationDate} onSave={(v) => patchStudentProfile(e, "registrationDate", v)} />
                      </td>
                      <td style={td}>
                        <InlineText value={customer?.email} onSave={(v) => updateCustomer(customer.id, { email: v })} minWidth={90} size={16} />
                      </td>
                      <td style={td}>
                        <InlineSelect value={sp.attendanceType} onSave={(v) => patchStudentProfile(e, "attendanceType", v)} options={[{ v: "", l: "—" }, ...attendanceOptions]} minWidth={80} />
                      </td>
                      <td style={td}>
                        <InlineText value={sp.leadSource} onSave={(v) => patchStudentProfile(e, "leadSource", v)} minWidth={80} size={10} />
                      </td>
                      <td style={td}>
                        <InlineStatusSelect value={e.statusId} onSave={(v) => changeEngagementStatus(e.id, v)} options={statusOptions} color={status?.color} />
                      </td>
                      <td style={td}>
                        <InlineText value={e.salesNotes} onSave={(v) => updateEngagement(e.id, { salesNotes: v })} placeholder={tx("ملاحظة...", "Note...")} minWidth={130} size={16} />
                      </td>
                      <td style={tdGroupStart}>
                        <InlineNumber value={payment.coursePrice} onSave={(v) => patchPayment(e, "coursePrice", v)} />
                      </td>
                      <td style={td}>
                        <InlineSelect value={payment.paymentPlan} onSave={(v) => patchPayment(e, "paymentPlan", v)} options={[{ v: "", l: "—" }, ...paymentPlanOptions]} minWidth={80} />
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
                        <InlineSelect value={e.ownerId} onSave={(v) => updateEngagement(e.id, { ownerId: v })} options={assigneeOptions} minWidth={90} />
                      </td>
                      <td style={{ ...td, width: 76, minWidth: 76 }}>
                        <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                          <Btn sm v="ghost" onClick={() => setProfileEngagementId(e.id)} title={tx("عرض الملف", "View Profile")}>👁</Btn>
                          <Btn sm v="ghost" onClick={(ev) => openRowMenu(ev, e.id)} title={tx("المزيد", "More")}>⋮</Btn>
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
      {addingStudent && (
        <AddStudentModal program={program} businessUnitId={businessUnitId} onClose={() => setAddingStudent(false)} />
      )}
      {rowMenu && (() => {
        const eng = filtered.find((x) => x.id === rowMenu.id);
        if (!eng) return null;
        return (
          <>
            <div onClick={closeRowMenu} style={{ position: "fixed", inset: 0, zIndex: 1400 }} />
            <div style={{
              position: "fixed", top: rowMenu.top, left: rowMenu.left, zIndex: 1401,
              background: "#331f42", border: `1px solid ${C.border}`, borderRadius: radius.md,
              boxShadow: shadow.lg, minWidth: 190, padding: 6, display: "flex", flexDirection: "column", gap: 2,
            }}>
              {!eng.payment?.confirmed && (
                <button className="edu-row-menu-item" onClick={() => { confirmPayment(eng); closeRowMenu(); }}>
                  ✓ {tx("تأكيد الدفع", "Confirm Payment")}
                </button>
              )}
              <button className="edu-row-menu-item" onClick={() => { scheduleFollowUp(eng); closeRowMenu(); }}>
                📅 {tx("جدولة متابعة (3 أيام)", "Schedule Follow-up (3 days)")}
              </button>
            </div>
          </>
        );
      })()}
    </div>
  );
}

const iconLinkSx = { textDecoration: "none", fontSize: 14, padding: "3px 5px", borderRadius: 6, background: "rgba(255,255,255,.06)", transition: "background .15s" };

// Active filter = Red (the brand's "selected state" color); inactive stays a
// quiet Purple-tinted surface so the pill bar itself still reads as Eduzah.
function pillStyle(active) {
  return {
    padding: "6px 13px", borderRadius: 99, border: "none", cursor: "pointer",
    fontWeight: 800, fontSize: 11.5, fontFamily: "'Cairo',sans-serif",
    background: active ? C.red : `${C.purple}26`,
    color: active ? "#fff" : C.muted,
    transition: "all .2s",
  };
}
