import { useMemo, useState } from "react";
import { Card, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useAuth } from "../../../../context/AuthContext";
import { useCatalog } from "../../../../context/CatalogContext";
import { useCustomers } from "../../../../context/CustomerContext";
import { useFollowUps } from "../../../../context/FollowUpContext";
import { IconSearch, IconPhone, IconWhatsapp } from "../../../../components/Icons";
import { toE164Phone } from "../../../../utils/phoneE164";
import { customerInterestedProgramIds } from "../../../../utils/interestedPrograms";
import { selectNewCustomers, REGISTRATION_STATUS_KEYS } from "../../../../utils/newCustomerWorkflow";
import { FOLLOW_UP_STATUSES } from "../../../../utils/followUps";
import { InterestedProgramChips, INTEREST_ONLY_NOTE_AR, INTEREST_ONLY_NOTE_EN } from "../../../../components/crm/InterestedPrograms";
import LeadStatusBadge from "../../../../components/crm/LeadStatusBadge";
import { useNewCustomerWorkflow } from "../../../../hooks/useNewCustomerWorkflow";
import FollowUpFormModal from "../followups/FollowUpFormModal";
import AddNewCustomerModal from "./AddNewCustomerModal";
import LeadExcelImportPanel from "./LeadExcelImportPanel";
import EditNewCustomerModal from "./EditNewCustomerModal";
import ContactOutcomeModal from "./ContactOutcomeModal";
import RegisterCustomerModal from "./RegisterCustomerModal";

const th = { textAlign: "start", fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: "#475569", fontWeight: 800, padding: "11px 14px", borderBottom: `1px solid ${C.border}`, background: "#F8FAFC", whiteSpace: "nowrap" };
const td = { padding: "10px 14px", fontSize: 12.5, borderBottom: "1px solid #E2E8F0", verticalAlign: "middle" };
const iconLinkSx = { display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", padding: 4, borderRadius: 6, color: C.text };

/**
 * "عملاء جدد" — customers who are not registered in any course yet (no
 * active engagement). This is where Sales works them: edit their details
 * (the name is optional), record the contact result (an existing lead
 * status), schedule a follow-up (the existing follow-up system), and — when
 * they decide — register them in the actual Program. That creates a normal
 * Engagement, and the customer leaves this list automatically because the list
 * simply means "no active engagement". Their "Interested Programs" stay on the
 * customer record and are never the same thing as a registration.
 */
export default function NewCustomersPage() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { users } = useAuth();
  const { nodeById } = useCatalog();
  const { customers, engagements, customerById, loading } = useCustomers();
  const { followUps } = useFollowUps();
  const { statusKeyOf, currentStatusOf } = useNewCustomerWorkflow();

  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [contactId, setContactId] = useState(null);
  const [registeringId, setRegisteringId] = useState(null);
  const [followUpId, setFollowUpId] = useState(null);

  const rows = useMemo(() => selectNewCustomers(customers, engagements, { search }), [customers, engagements, search]);

  // The soonest pending follow-up per customer (a Sales session only receives its own — see firestore.rules).
  const nextFollowUpByCustomer = useMemo(() => {
    const map = new Map();
    for (const f of followUps || []) {
      if (f.status !== FOLLOW_UP_STATUSES.PENDING || !f.customerId) continue;
      const cur = map.get(f.customerId);
      if (!cur || (f.dueAt || "") < (cur.dueAt || "")) map.set(f.customerId, f);
    }
    return map;
  }, [followUps]);

  const editing = editingId ? customerById(editingId) : null;
  const contacting = contactId ? customerById(contactId) : null;
  const registering = registeringId ? customerById(registeringId) : null;
  const followUpCustomer = followUpId ? customerById(followUpId) : null;
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const assignedLabel = (c) => c.assignedToName || (c.assignedToId ? (users || []).find((u) => u.id === c.assignedToId)?.name : null) || "—";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div>
          <h2 style={{ fontWeight: 900, fontSize: 18, margin: 0 }}>{tx("عملاء جدد", "New Customers")}</h2>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2, maxWidth: 640 }}>
            {tx(
              "عملاء لسه مسجّلوش في أي كورس. سجّل نتيجة التواصل، ولما العميل يقرر اضغط «تسجيل العميل» واختار الكورس الفعلي — هيتنقل من هنا تلقائيًا.",
              "Customers not registered in any course yet. Record the contact result, and when the customer decides press “Register customer” and pick the actual program — they leave this list automatically.",
            )}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{ar ? INTEREST_ONLY_NOTE_AR : INTEREST_ONLY_NOTE_EN}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <span style={{ position: "absolute", insetInlineStart: 12, color: C.muted, display: "flex", pointerEvents: "none" }}><IconSearch size={14} /></span>
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={tx("بحث بالاسم أو الهاتف…", "Search name or phone…")}
              style={{ background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 10, paddingBlock: 9, paddingInlineStart: 34, paddingInlineEnd: 14, fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", minWidth: 220 }}
            />
          </div>
          <Btn v="ghost" onClick={() => setImporting((v) => !v)}>{tx("رفع ملف Excel", "Upload Excel file")}</Btn>
          <Btn v="primary" onClick={() => setAdding(true)}>+ {tx("إضافة عميل جديد", "Add New Customer")}</Btn>
        </div>
      </div>

      {importing && <LeadExcelImportPanel onClose={() => setImporting(false)} />}

      {loading ? (
        <Card style={{ padding: 32, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("جاري التحميل…", "Loading…")}</div></Card>
      ) : rows.length === 0 ? (
        <Card style={{ padding: 40, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("لا يوجد عملاء جدد", "No new customers")}</div></Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={th}>{tx("الاسم", "Name")}</th>
                  <th style={th}>{tx("الهاتف", "Phone")}</th>
                  <th style={th}>{tx("الكورسات المهتم بيها", "Interested Programs")}</th>
                  <th style={th}>{tx("حالة التواصل", "Contact status")}</th>
                  <th style={th}>{tx("الموظف المسؤول", "Assigned")}</th>
                  <th style={th}>{tx("آخر تحديث", "Last update")}</th>
                  <th style={th} aria-label={tx("إجراءات", "Actions")}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const e164 = toE164Phone(c.phone);
                  const status = currentStatusOf(c);
                  const key = statusKeyOf(c);
                  const nextFollowUp = nextFollowUpByCustomer.get(c.id);
                  const plannedProgram = c.plannedProgramId ? nodeById(c.plannedProgramId) : null;
                  return (
                    <tr key={c.id} className="edu-sheet-row">
                      <td style={{ ...td, fontWeight: 800 }}>
                        {c.fullName || <span style={{ color: C.muted, fontWeight: 600 }}>{tx("بدون اسم", "No name")}</span>}
                        {c.notes && <div style={{ fontWeight: 500, fontSize: 11, color: C.muted, marginTop: 2, maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={c.notes}>{c.notes}</div>}
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span dir="ltr">{c.phone || "—"}</span>
                          {e164 && (
                            <>
                              <a href={`tel:${e164}`} title={tx("اتصال", "Call")} style={iconLinkSx}><IconPhone size={13} /></a>
                              <a href={`https://wa.me/${e164.replace("+", "")}`} target="_blank" rel="noreferrer" title="WhatsApp" style={{ ...iconLinkSx, color: "#25d366" }}><IconWhatsapp size={14} /></a>
                            </>
                          )}
                        </div>
                      </td>
                      <td style={td}><InterestedProgramChips ids={customerInterestedProgramIds(c)} tx={tx} emptyLabel="—" /></td>
                      <td style={td}>
                        <LeadStatusBadge statusId={status?.id} />
                        {plannedProgram && key === "will_book" && <div dir="ltr" style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{tx("هيحجز في: ", "Will book: ")}{plannedProgram.name_en}</div>}
                        {nextFollowUp && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{tx("متابعة: ", "Follow-up: ")}{fmtDate(nextFollowUp.dueAt)}</div>}
                      </td>
                      <td style={td}>{assignedLabel(c)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", color: C.muted }}>{fmtDate(c.updatedAt || c.createdAt)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          <Btn sm v="ghost" onClick={() => setEditingId(c.id)}>{tx("تعديل", "Edit")}</Btn>
                          <Btn sm v="ghost" onClick={() => setContactId(c.id)}>{tx("تسجيل متابعة", "Record contact")}</Btn>
                          {REGISTRATION_STATUS_KEYS.includes(key) && <Btn sm v="primary" onClick={() => setRegisteringId(c.id)}>{tx("تسجيل العميل", "Register customer")}</Btn>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {adding && <AddNewCustomerModal onClose={() => setAdding(false)} />}
      {editing && <EditNewCustomerModal customer={editing} onClose={() => setEditingId(null)} />}
      {contacting && (
        <ContactOutcomeModal
          customer={contacting}
          onClose={() => setContactId(null)}
          onRegister={(id) => setRegisteringId(id)}
          onScheduleFollowUp={(id) => setFollowUpId(id)}
        />
      )}
      {registering && <RegisterCustomerModal customer={registering} onClose={() => setRegisteringId(null)} />}
      {followUpCustomer && (
        <FollowUpFormModal
          customer={followUpCustomer}
          studentName={followUpCustomer.fullName || followUpCustomer.phone}
          studentPhone={followUpCustomer.phone}
          programLabel={null}
          ar={ar} tx={tx}
          onClose={() => setFollowUpId(null)}
        />
      )}
    </div>
  );
}
