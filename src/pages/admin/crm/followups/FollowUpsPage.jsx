import { useMemo, useState } from "react";
import { Card, Badge, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useAuth } from "../../../../context/AuthContext";
import { useCatalog } from "../../../../context/CatalogContext";
import { useCustomers } from "../../../../context/CustomerContext";
import { useFollowUps } from "../../../../context/FollowUpContext";
import { IconSearch, IconBell } from "../../../../components/Icons";
import { FOLLOW_UP_QUICK_FILTERS, getDueBucket, sortFollowUps, filterFollowUps } from "../../../../utils/followUps";
import FollowUpFormModal from "./FollowUpFormModal";
import CompleteFollowUpModal from "./CompleteFollowUpModal";
import EngagementDetailModal from "../EngagementDetailModal";

const QUICK_FILTERS = [
  { v: FOLLOW_UP_QUICK_FILTERS.ALL, ar: "الكل", en: "All" },
  { v: FOLLOW_UP_QUICK_FILTERS.MINE, ar: "متابعاتي", en: "My Follow-ups" },
  { v: FOLLOW_UP_QUICK_FILTERS.OVERDUE, ar: "متأخرة", en: "Overdue" },
  { v: FOLLOW_UP_QUICK_FILTERS.TODAY, ar: "اليوم", en: "Today" },
  { v: FOLLOW_UP_QUICK_FILTERS.UPCOMING, ar: "قادمة", en: "Upcoming" },
  { v: FOLLOW_UP_QUICK_FILTERS.COMPLETED, ar: "مكتملة", en: "Completed" },
];

const BUCKET_COLOR = { overdue: C.danger, today: C.orange, upcoming: C.muted, completed: C.success, cancelled: C.muted };
const BUCKET_LABEL = {
  overdue: ["متأخرة", "Overdue"],
  today: ["اليوم", "Today"],
  upcoming: ["قادمة", "Upcoming"],
  completed: ["مكتملة", "Completed"],
  cancelled: ["ملغاة", "Cancelled"],
};

function pillStyle(active) {
  return {
    padding: "6px 13px", borderRadius: 99, border: "none", cursor: "pointer",
    fontWeight: 800, fontSize: 11.5, fontFamily: "'Cairo',sans-serif",
    background: active ? C.red : `${C.purple}26`, color: active ? "#fff" : C.muted,
    transition: "all .2s", whiteSpace: "nowrap",
  };
}

/**
 * CRM-05 — global, cross-Program Follow-ups list. Every action here calls
 * FollowUpContext functions directly (addFollowUp/updateFollowUp/
 * completeFollowUp/cancelFollowUp) — no new CRUD logic in this component.
 * Reuses CustomerContext (customers/engagements) and CatalogContext
 * (program names) exactly as PaymentVerificationQueue already does for its
 * own cross-Engagement list, rather than duplicating any of that data.
 */
export default function FollowUpsPage() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { currentUser, users } = useAuth();
  const { nodeById } = useCatalog();
  const { engagements, customerById, engagementById } = useCustomers();
  const { followUps, cancelFollowUp } = useFollowUps();

  const [quickFilter, setQuickFilter] = useState(FOLLOW_UP_QUICK_FILTERS.ALL);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // followUp being edited
  const [completing, setCompleting] = useState(null); // followUp being completed
  const [openEngagementId, setOpenEngagementId] = useState(null);
  const [confirmCancelId, setConfirmCancelId] = useState(null);

  const rows = useMemo(() => {
    return (followUps || []).map((f) => {
      // CRM-05 FINALIZATION — Sales-role sessions have no Firestore read
      // access to customers/engagements (see firestore.rules), so these
      // joins always come back null for them; engagement/customer/program
      // stay live-resolved for admin exactly as before (unchanged), and fall
      // back to the follow-up's own denormalized snapshot fields otherwise.
      // See utils/followUps.buildFollowUp for where those are captured.
      const engagement = engagementById(f.engagementId);
      const customer = customerById(f.customerId);
      const program = engagement?.catalogNodeId ? nodeById(engagement.catalogNodeId) : null;
      const displayName = customer?.fullName || f.customerName || null;
      const displayPhone = customer?.phone || f.customerPhone || null;
      const displayProgram = program?.name_en || f.programLabel || null;
      const assignee = f.assignedTo ? users.find((u) => u.id === f.assignedTo) : null;
      const assigneeLabel = assignee?.name || assignee?.email
        || (f.assignedTo && f.assignedTo === currentUser?.id ? currentUser?.name : null);
      const timeline = [...(engagement?.timeline || [])].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
      const lastActivity = timeline.find((t) => t.type !== "system") || timeline[0] || null;
      return { ...f, engagement, customer, program, displayName, displayPhone, displayProgram, assignee, assigneeLabel, lastActivity };
    });
  }, [followUps, engagementById, customerById, nodeById, users, currentUser?.id]);

  const counts = useMemo(() => {
    const c = { all: rows.length, mine: 0, overdue: 0, today: 0, upcoming: 0, completed: 0 };
    for (const r of rows) {
      if (r.assignedTo === currentUser?.id) c.mine += 1;
      const bucket = getDueBucket(r);
      if (c[bucket] !== undefined) c[bucket] += 1;
    }
    return c;
  }, [rows, currentUser?.id]);

  const filtered = useMemo(() => {
    const list = filterFollowUps(
      rows,
      { quickFilter, currentUserId: currentUser?.id, search },
      { searchTextFor: (f) => [f.displayName, f.displayPhone, f.displayProgram].filter(Boolean).join(" ") },
    );
    return sortFollowUps(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, quickFilter, search, currentUser?.id]);

  const fmt = (iso) => iso ? new Date(iso).toLocaleString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  const handleCancel = async (id) => {
    await cancelFollowUp(id);
    setConfirmCancelId(null);
  };

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 800 }}>
          <IconBell size={18} />
          {tx("المتابعات", "Follow-ups")}
        </div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
          {tx("مين لازم أكلمه؟ وإمتى؟ وإيه اللي حصل آخر مرة؟", "Who do I need to call? When? And what happened last time?")}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {QUICK_FILTERS.map((f) => (
            <button key={f.v} onClick={() => setQuickFilter(f.v)} style={pillStyle(quickFilter === f.v)}>
              {ar ? f.ar : f.en} <span style={{ opacity: 0.7 }}>({counts[f.v] ?? 0})</span>
            </button>
          ))}
        </div>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <span style={{ position: "absolute", insetInlineStart: 12, color: C.muted, display: "flex", pointerEvents: "none" }}><IconSearch size={14} /></span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tx("بحث بالاسم أو الهاتف أو البرنامج…", "Search name, phone, or program…")}
            style={{ background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 10, paddingBlock: 9, paddingInlineStart: 34, paddingInlineEnd: 14, color: C.text, fontFamily: "'Cairo',sans-serif", fontSize: 12.5, outline: "none", minWidth: 240 }}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card style={{ padding: 40, textAlign: "center" }}>
          <div style={{ color: C.muted }}>{tx("لا توجد متابعات", "No follow-ups")}</div>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((f) => {
            const bucket = getDueBucket(f);
            const [labelAr, labelEn] = BUCKET_LABEL[bucket] || [bucket, bucket];
            const isPending = f.status === "pending";
            return (
              <Card key={f.id} style={{ padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 180 }}>
                    <button
                      onClick={() => f.engagement && setOpenEngagementId(f.engagement.id)}
                      style={{ background: "none", border: "none", padding: 0, cursor: f.engagement ? "pointer" : "default", color: C.text, fontSize: 13.5, fontWeight: 800, fontFamily: "'Cairo',sans-serif", textDecoration: f.engagement ? "underline dotted" : "none" }}
                    >
                      {f.displayName || tx("عميل غير معروف", "Unknown customer")}
                    </button>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
                      <span dir="ltr">{f.displayPhone || "—"}</span>
                      {f.displayProgram ? <> · <span dir="ltr">{f.displayProgram}</span></> : ""}
                    </div>
                  </div>
                  <Badge color={BUCKET_COLOR[bucket]}>{ar ? labelAr : labelEn}</Badge>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 16px", marginTop: 8, fontSize: 11.5 }}>
                  <span style={{ color: C.muted }}>{tx("الموعد", "Due")}: <b style={{ color: bucket === "overdue" ? C.danger : C.text }} dir="ltr">{fmt(f.dueAt)}</b></span>
                  <span style={{ color: C.muted }}>{tx("المسؤول", "Assigned")}: <b style={{ color: C.text }}>{f.assigneeLabel || tx("غير معيّن", "Unassigned")}</b></span>
                  <span style={{ color: C.muted }}>{tx("آخر نشاط", "Last activity")}: <b style={{ color: C.text }}>{f.lastActivity?.at ? fmt(f.lastActivity.at) : "—"}</b></span>
                </div>

                {f.note && <div style={{ fontSize: 12, color: "#334155", marginTop: 8 }}>{f.note}</div>}
                {f.status === "completed" && f.result && (
                  <div style={{ fontSize: 12, color: C.success, marginTop: 8 }}>✓ {f.result}</div>
                )}

                {isPending && (
                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    <Btn sm v="primary" onClick={() => setCompleting(f)}>{tx("إكمال", "Complete")}</Btn>
                    <Btn sm v="ghost" onClick={() => setEditing(f)}>{tx("تعديل", "Edit")}</Btn>
                    {confirmCancelId === f.id ? (
                      <Btn sm v="danger" onClick={() => handleCancel(f.id)}>{tx("تأكيد الإلغاء", "Confirm Cancel")}</Btn>
                    ) : (
                      <Btn sm v="ghost" onClick={() => setConfirmCancelId(f.id)}>{tx("إلغاء", "Cancel")}</Btn>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <FollowUpFormModal
          followUp={editing}
          engagement={editing.engagement}
          studentName={editing.displayName}
          studentPhone={editing.displayPhone}
          programLabel={editing.displayProgram}
          ar={ar} tx={tx}
          onClose={() => setEditing(null)}
        />
      )}
      {completing && (
        <CompleteFollowUpModal
          followUp={completing}
          studentName={completing.displayName}
          programLabel={completing.displayProgram}
          ar={ar} tx={tx}
          onClose={() => setCompleting(null)}
        />
      )}
      {openEngagementId && (
        <EngagementDetailModal
          engagement={engagements.find((e) => e.id === openEngagementId)}
          onClose={() => setOpenEngagementId(null)}
        />
      )}
    </div>
  );
}
