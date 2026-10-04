import { useMemo, useState } from "react";
import { Card, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useAuth } from "../../../../context/AuthContext";
import { useCatalog } from "../../../../context/CatalogContext";
import { useCustomers } from "../../../../context/CustomerContext";
import { useFollowUps } from "../../../../context/FollowUpContext";
import { useImportBatches } from "../../../../context/ImportBatchContext";
import { IconSearch, IconPhone, IconWhatsapp } from "../../../../components/Icons";
import { customerContactTargets } from "../../../../utils/whatsappContact";
import { customerInterestedProgramIds } from "../../../../utils/interestedPrograms";
import { selectNewCustomers, REGISTRATION_STATUS_KEYS, WORKFLOW_STATUS_KEYS } from "../../../../utils/newCustomerWorkflow";
import { FOLLOW_UP_STATUSES } from "../../../../utils/followUps";
import { selectActiveSalesUsers, selectUnassignedLeads, computeDistributionStats } from "../../../../utils/leadDistribution";
import { InterestedProgramChips, INTEREST_ONLY_NOTE_AR, INTEREST_ONLY_NOTE_EN } from "../../../../components/crm/InterestedPrograms";
import LeadStatusBadge from "../../../../components/crm/LeadStatusBadge";
import { useNewCustomerWorkflow } from "../../../../hooks/useNewCustomerWorkflow";
import FollowUpFormModal from "../followups/FollowUpFormModal";
import AddNewCustomerModal from "./AddNewCustomerModal";
import LeadExcelImportPanel from "./LeadExcelImportPanel";
import EditNewCustomerModal from "./EditNewCustomerModal";
import ContactOutcomeModal from "./ContactOutcomeModal";
import RegisterCustomerModal from "./RegisterCustomerModal";
import DistributeLeadsPanel from "./DistributeLeadsPanel";

function Stat({ label, value, tone }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", background: "#fff" }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: tone || C.text }}>{value}</div>
    </div>
  );
}

const th = { textAlign: "start", fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: "#475569", fontWeight: 800, padding: "11px 14px", borderBottom: `1px solid ${C.border}`, background: "#F8FAFC", whiteSpace: "nowrap" };
const td = { padding: "10px 14px", fontSize: 12.5, borderBottom: "1px solid #E2E8F0", verticalAlign: "middle" };
const iconLinkSx = { display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", padding: 4, borderRadius: 6, color: C.text };
const filterSx = { background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "8px 10px", fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", cursor: "pointer" };

/**
 * "عملاء جدد" — customers who are not registered in any course yet (no
 * active engagement). This is where Sales works them: edit their details
 * (the name is optional), record the contact result (an existing lead
 * status), schedule a follow-up (the existing follow-up system), and — when
 * they decide — register them in the actual Program. That creates a normal
 * Engagement, and the customer leaves this list automatically because the list
 * simply means "no active engagement". Their "Interested Programs" stay on the
 * customer record and are never the same thing as a registration.
 *
 * LEAD-DISTRIBUTION-01: every customer here is either "موزع" (has an
 * assignedToId) or "غير موزع" (doesn't) — the admin is never required to
 * distribute the whole pool in one go, so an unassigned customer is a normal,
 * expected, permanent state, not a transient one.
 */
export default function NewCustomersPage() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { users, currentUser } = useAuth();
  const { nodeById } = useCatalog();
  const { customers, engagements, customerById, loading } = useCustomers();
  const { followUps } = useFollowUps();
  const { batches } = useImportBatches();
  const { statusKeyOf, currentStatusOf } = useNewCustomerWorkflow();
  const isAdmin = currentUser?.role === "admin";
  const activeSalesUsers = useMemo(() => selectActiveSalesUsers(users), [users]);

  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [contactId, setContactId] = useState(null);
  const [registeringId, setRegisteringId] = useState(null);
  const [followUpId, setFollowUpId] = useState(null);
  const [ownerFilter, setOwnerFilter] = useState("all"); // "all" | "unassigned" | "mine" | <salesId>
  const [statusFilter, setStatusFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [reassigning, setReassigning] = useState(false);
  const [distributing, setDistributing] = useState(false);

  const allRows = useMemo(() => selectNewCustomers(customers, engagements, { search }), [customers, engagements, search]);
  const distributionStats = useMemo(() => computeDistributionStats(allRows), [allRows]);
  // Every "عملاء جدد" customer (assigned or not) — the universe the distribution panel's Source filter lists sources from.
  const allRowIds = useMemo(() => allRows.map((c) => c.id), [allRows]);

  const rows = useMemo(() => {
    let out = allRows;
    if (ownerFilter === "unassigned") out = out.filter((c) => !c.assignedToId);
    else if (ownerFilter === "mine") out = out.filter((c) => c.assignedToId === currentUser?.id);
    else if (ownerFilter !== "all") out = out.filter((c) => c.assignedToId === ownerFilter);
    if (statusFilter) out = out.filter((c) => statusKeyOf(c) === statusFilter);
    if (batchFilter) out = out.filter((c) => c.importBatchId === batchFilter);
    return out;
  }, [allRows, ownerFilter, statusFilter, batchFilter, currentUser?.id, statusKeyOf]);

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

  // "عملائي" mini-dashboard — reuses the EXISTING Lead Status workflow keys and the follow-up/engagement data
  // already loaded on this page; no new status system, no separate collection.
  const myStats = useMemo(() => {
    if (!currentUser?.id) return null;
    const mine = allRows.filter((c) => c.assignedToId === currentUser.id);
    const byKey = Object.fromEntries(WORKFLOW_STATUS_KEYS.map((k) => [k, 0]));
    for (const c of mine) { const k = statusKeyOf(c); if (byKey[k] !== undefined) byKey[k] += 1; }
    const followUpCount = mine.filter((c) => nextFollowUpByCustomer.has(c.id)).length;
    const registered = (engagements || []).filter((e) => !e.archivedAt && e.ownerId === currentUser.id).length;
    return { total: mine.length, followUpCount, registered, byKey };
  }, [allRows, currentUser?.id, engagements, statusKeyOf, nextFollowUpByCustomer]);

  const editing = editingId ? customerById(editingId) : null;
  const contacting = contactId ? customerById(contactId) : null;
  const registering = registeringId ? customerById(registeringId) : null;
  const followUpCustomer = followUpId ? customerById(followUpId) : null;
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const assignedLabel = (c) => c.assignedToName || (c.assignedToId ? (users || []).find((u) => u.id === c.assignedToId)?.name : null) || tx("غير موزع", "Unassigned");

  const statusLabel = (key) => ({
    not_contacted: tx("لم يتم التواصل", "Not contacted"),
    no_answer: tx("لا يوجد رد", "No answer"),
    thinking: tx("بيفكر", "Thinking"),
    interested: tx("مهتم", "Interested"),
    not_interested: tx("غير مهتم", "Not interested"),
    will_book: tx("هيحجز", "Will register"),
    booked: tx("تم التسجيل", "Registered"),
  }[key] || key);

  const [distributeIds, setDistributeIds] = useState([]);

  const startDistribute = () => {
    const ids = selectedIds.size > 0 ? [...selectedIds] : selectUnassignedLeads(allRows).map((c) => c.id);
    setDistributeIds(ids);
    setDistributing(true);
  };
  const startReassign = () => {
    setDistributeIds([...selectedIds]);
    setReassigning(true);
  };

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
              placeholder={tx("بحث بالاسم أو الهاتف أو اسم المستخدم…", "Search name, phone or username…")}
              style={{ background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 10, paddingBlock: 9, paddingInlineStart: 34, paddingInlineEnd: 14, fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", minWidth: 220 }}
            />
          </div>
          {isAdmin && <Btn v="ghost" onClick={() => setImporting((v) => !v)}>{tx("رفع ملف Excel", "Upload Excel file")}</Btn>}
          {isAdmin && <Btn v="primary" onClick={startDistribute}>{tx("توزيع العملاء على السيلز", "Distribute leads to Sales")}</Btn>}
          <Btn v="primary" onClick={() => setAdding(true)}>+ {tx("إضافة عميل جديد", "Add New Customer")}</Btn>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8, marginBottom: 14 }}>
        <Stat label={tx("إجمالي العملاء", "Total customers")} value={distributionStats.total} />
        <Stat label={tx("الموزعين", "Assigned")} value={distributionStats.assigned} tone={C.success} />
        <Stat label={tx("غير الموزعين", "Unassigned")} value={distributionStats.unassigned} tone={C.purple} />
        <Stat label={tx("عملائي", "My customers")} value={myStats?.total ?? 0} tone={C.red} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} style={filterSx}>
          <option value="all">{tx("الكل", "All")}</option>
          <option value="unassigned">{tx("غير موزع", "Unassigned")}</option>
          <option value="mine">{tx("عملائي فقط", "My customers only")}</option>
          {isAdmin && activeSalesUsers.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={filterSx}>
          <option value="">{tx("كل الحالات", "All statuses")}</option>
          {WORKFLOW_STATUS_KEYS.map((k) => <option key={k} value={k}>{statusLabel(k)}</option>)}
        </select>
        {isAdmin && batches.length > 0 && (
          <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)} style={filterSx}>
            <option value="">{tx("كل ملفات الاستيراد", "All import files")}</option>
            {batches.filter((b) => b.kind === "customer_leads").map((b) => (
              <option key={b.id} value={b.id}>{b.fileName || b.id} — {fmtDate(b.createdAt)}</option>
            ))}
          </select>
        )}
      </div>

      {ownerFilter === "mine" && myStats && (
        <Card style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 10 }}>{tx("عملائي", "My customers")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
            <Stat label={tx("إجمالي المسندين", "Total assigned")} value={myStats.total} tone={C.red} />
            <Stat label={tx("لم يتم التواصل", "Not contacted")} value={myStats.byKey.not_contacted} />
            <Stat label={tx("متابعات مجدولة", "Scheduled follow-ups")} value={myStats.followUpCount} />
            <Stat label={tx("مهتم", "Interested")} value={myStats.byKey.interested} />
            <Stat label={tx("بيفكر", "Thinking")} value={myStats.byKey.thinking} />
            <Stat label={tx("هيحجز", "Will register")} value={myStats.byKey.will_book} />
            <Stat label={tx("غير مهتم", "Not interested")} value={myStats.byKey.not_interested} />
            <Stat label={tx("تم التسجيل", "Registered")} value={myStats.registered} tone={C.success} />
          </div>
        </Card>
      )}

      {importing && <LeadExcelImportPanel onClose={() => setImporting(false)} />}

      {isAdmin && selectedIds.size > 0 && (
        <Card style={{ padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{tx(`تم تحديد ${selectedIds.size} عميل`, `${selectedIds.size} customers selected`)}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn sm v="ghost" onClick={() => setSelectedIds(new Set())}>{tx("إلغاء التحديد", "Clear selection")}</Btn>
            <Btn sm v="ghost" onClick={startDistribute}>{tx("توزيع العملاء على السيلز", "Distribute leads to Sales")}</Btn>
            <Btn sm v="primary" onClick={startReassign}>{tx("إعادة توزيع", "Reassign")}</Btn>
          </div>
        </Card>
      )}

      {distributing && (
        <DistributeLeadsPanel
          customerIds={distributeIds}
          universeIds={allRowIds}
          sourceBatchId={null}
          mode="distribute"
          stats={distributionStats}
          onClose={() => { setDistributing(false); setSelectedIds(new Set()); }}
        />
      )}
      {reassigning && (
        <DistributeLeadsPanel
          customerIds={distributeIds}
          sourceBatchId={null}
          mode="reassign"
          heading={tx("إعادة توزيع العملاء المحددين", "Reassign selected customers")}
          onClose={() => { setReassigning(false); setSelectedIds(new Set()); }}
        />
      )}

      {loading ? (
        <Card style={{ padding: 32, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("جاري التحميل…", "Loading…")}</div></Card>
      ) : rows.length === 0 ? (
        <Card style={{ padding: 40, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("لا يوجد عملاء جدد", "No new customers")}</div></Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1020 }}>
              <thead>
                <tr>
                  {isAdmin && (
                    <th style={th}>
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && rows.every((c) => selectedIds.has(c.id))}
                        onChange={(e) => setSelectedIds(e.target.checked ? new Set(rows.map((c) => c.id)) : new Set())}
                      />
                    </th>
                  )}
                  <th style={th}>#</th>
                  <th style={th}>{tx("الاسم", "Name")}</th>
                  <th style={th}>{tx("الهاتف", "Phone")}</th>
                  <th style={th}>{tx("واتساب (اسم المستخدم)", "WhatsApp Username")}</th>
                  <th style={th}>{tx("الكورسات المهتم بيها", "Interested Programs")}</th>
                  <th style={th}>{tx("حالة التواصل", "Contact status")}</th>
                  <th style={th}>{tx("الموظف المسؤول", "Assigned")}</th>
                  <th style={th}>{tx("آخر تحديث", "Last update")}</th>
                  <th style={th} aria-label={tx("إجراءات", "Actions")}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, rowIndex) => {
                  const contact = customerContactTargets(c);
                  const status = currentStatusOf(c);
                  const key = statusKeyOf(c);
                  const nextFollowUp = nextFollowUpByCustomer.get(c.id);
                  const plannedProgram = c.plannedProgramId ? nodeById(c.plannedProgramId) : null;
                  return (
                    <tr key={c.id} className="edu-sheet-row">
                      {isAdmin && (
                        <td style={td}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.id)}
                            onChange={(e) => setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(c.id); else next.delete(c.id);
                              return next;
                            })}
                          />
                        </td>
                      )}
                      {/* Display sequence: 1..N over the currently visible (filtered/sorted) rows — never the raw
                          per-import c.importSequence, which restarts per batch and isn't meaningful as a row number
                          once multiple imports or filters are involved. See selectNewCustomers' own deterministic
                          createdAt-descending sort for why this is stable across re-renders. */}
                      <td style={{ ...td, color: C.muted, fontWeight: 700 }}>{rowIndex + 1}</td>
                      <td style={{ ...td, fontWeight: 800 }}>
                        {c.fullName || <span style={{ color: C.muted, fontWeight: 600 }}>{tx("بدون اسم", "No name")}</span>}
                        {c.notes && <div style={{ fontWeight: 500, fontSize: 11, color: C.muted, marginTop: 2, maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={c.notes}>{c.notes}</div>}
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span dir="ltr">{c.phone || "—"}</span>
                          {contact.e164 && (
                            <>
                              <a href={`tel:${contact.e164}`} title={tx("اتصال", "Call")} style={iconLinkSx}><IconPhone size={13} /></a>
                              <a href={contact.phoneLink} target="_blank" rel="noreferrer" title="WhatsApp" style={{ ...iconLinkSx, color: "#25d366" }}><IconWhatsapp size={14} /></a>
                            </>
                          )}
                        </div>
                      </td>
                      {/* WHATSAPP-USERNAME-01: the username is its own contact next to the phone (never merged into it); with
                          only a username this link IS the WhatsApp contact action. Neither -> no WhatsApp link at all. */}
                      <td style={td}>
                        {contact.username ? (
                          <a href={contact.usernameLink} target="_blank" rel="noreferrer" title={tx("فتح واتساب", "Open WhatsApp")} dir="ltr" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#128c7e", fontWeight: 700, textDecoration: "none" }}>
                            <IconWhatsapp size={14} />{contact.username}
                          </a>
                        ) : <span style={{ color: C.muted }}>—</span>}
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
