import { useMemo, useState } from "react";
import { Card, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useCustomers } from "../../../../context/CustomerContext";
import { IconSearch, IconPhone, IconWhatsapp } from "../../../../components/Icons";
import { toE164Phone } from "../../../../utils/phoneE164";
import { customerInterestedProgramIds } from "../../../../utils/interestedPrograms";
import { InterestedProgramChips, InterestedProgramsModal, INTEREST_ONLY_NOTE_AR, INTEREST_ONLY_NOTE_EN } from "../../../../components/crm/InterestedPrograms";
import AddNewCustomerModal from "./AddNewCustomerModal";

const th = { textAlign: "start", fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: "#475569", fontWeight: 800, padding: "11px 14px", borderBottom: `1px solid ${C.border}`, background: "#F8FAFC", whiteSpace: "nowrap" };
const td = { padding: "10px 14px", fontSize: 12.5, borderBottom: "1px solid #E2E8F0", verticalAlign: "middle" };
const iconLinkSx = { display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", padding: 4, borderRadius: 6, color: C.text };

/**
 * "عملاء جدد" — customers who are not registered in any course yet (no
 * active engagement). A customer leaves this list automatically the moment
 * they get a normal engagement via the existing Add Student / enrollment
 * flow; their "Interested Programs" stay on the customer record either way
 * and are never the same thing as a registration.
 */
export default function NewCustomersPage() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { customers, engagements, customerById, loading } = useCustomers();

  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState(null);

  const rows = useMemo(() => {
    const registered = new Set(engagements.filter((e) => !e.archivedAt).map((e) => e.customerId));
    const q = search.trim().toLowerCase();
    return customers
      .filter((c) => !c.archivedAt && !registered.has(c.id))
      .filter((c) => !q || (c.fullName || "").toLowerCase().includes(q) || (c.phone || "").includes(q) || (c.email || "").toLowerCase().includes(q))
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [customers, engagements, search]);

  const editingCustomer = editingCustomerId ? customerById(editingCustomerId) : null;
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short", year: "numeric" }) : "—");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div>
          <h2 style={{ fontWeight: 900, fontSize: 18, margin: 0 }}>{tx("عملاء جدد", "New Customers")}</h2>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2, maxWidth: 640 }}>
            {tx(
              "عملاء لسه مسجّلوش في أي كورس. لما العميل يختار كورس، سجّله من صفحة الكورس (إضافة طالب بنفس رقم الهاتف) وهيتنقل من هنا تلقائيًا.",
              "Customers not registered in any course yet. When one picks a course, register them from that Program (Add Student with the same phone number) and they leave this list automatically.",
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
          <Btn v="primary" onClick={() => setAdding(true)}>+ {tx("إضافة عميل جديد", "Add New Customer")}</Btn>
        </div>
      </div>

      {loading ? (
        <Card style={{ padding: 32, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("جاري التحميل…", "Loading…")}</div></Card>
      ) : rows.length === 0 ? (
        <Card style={{ padding: 40, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("لا يوجد عملاء جدد", "No new customers")}</div></Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={th}>{tx("الاسم", "Name")}</th>
                  <th style={th}>{tx("الهاتف", "Phone")}</th>
                  <th style={th}>{tx("الكورسات المهتم بيها", "Interested Programs")}</th>
                  <th style={th}>{tx("تاريخ الإضافة", "Added")}</th>
                  <th style={th} aria-label={tx("إجراءات", "Actions")}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const e164 = toE164Phone(c.phone);
                  return (
                    <tr key={c.id} className="edu-sheet-row">
                      <td style={{ ...td, fontWeight: 800 }}>{c.fullName || "—"}</td>
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
                      <td style={{ ...td, whiteSpace: "nowrap", color: C.muted }}>{fmtDate(c.createdAt)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        <Btn sm v="ghost" onClick={() => setEditingCustomerId(c.id)}>{tx("تعديل الاهتمامات", "Edit interests")}</Btn>
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
      {editingCustomer && <InterestedProgramsModal customer={editingCustomer} onClose={() => setEditingCustomerId(null)} />}
    </div>
  );
}
