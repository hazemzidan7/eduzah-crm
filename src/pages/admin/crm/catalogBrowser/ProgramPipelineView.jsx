import { useState } from "react";
import { Card } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useCustomers } from "../../../../context/CustomerContext";
import EngagementDetailModal from "../EngagementDetailModal";

/** A kanban board, one column per status — grouping is the only job here;
 * changing a card's status happens in the detail modal (single place that
 * already knows how to do it safely, including the timeline entry). */
export default function ProgramPipelineView({ engagements, statuses, ar, tx }) {
  const { customerById } = useCustomers();
  const [openEngagementId, setOpenEngagementId] = useState(null);

  const byStatus = new Map(statuses.map((s) => [s.id, []]));
  const unassigned = [];
  for (const e of engagements) {
    if (e.statusId && byStatus.has(e.statusId)) byStatus.get(e.statusId).push(e);
    else unassigned.push(e);
  }

  const columns = [
    ...statuses.map((s) => ({ id: s.id, label: ar ? s.name_ar : s.name_en, color: s.color, items: byStatus.get(s.id) || [] })),
    ...(unassigned.length ? [{ id: "__none", label: tx("بدون حالة", "No status"), color: C.muted, items: unassigned }] : []),
  ];

  return (
    <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
      {columns.map((col) => (
        <div key={col.id} style={{ minWidth: 240, flex: "0 0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "0 4px" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: col.color || C.muted }} />
            <span style={{ fontWeight: 800, fontSize: 12.5 }}>{col.label}</span>
            <span style={{ fontSize: 11, color: C.muted }}>({col.items.length})</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 40 }}>
            {col.items.map((e) => {
              const customer = customerById(e.customerId);
              return (
                <Card key={e.id} onClick={() => setOpenEngagementId(e.id)} style={{ padding: "10px 12px", cursor: "pointer" }}>
                  <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 2 }}>{customer?.fullName || "—"}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{customer?.phone || "—"}</div>
                  {e.priority === "high" && (
                    <div style={{ fontSize: 10, color: C.danger, fontWeight: 800, marginTop: 4 }}>{tx("أولوية عالية", "High priority")}</div>
                  )}
                </Card>
              );
            })}
            {col.items.length === 0 && (
              <div style={{ fontSize: 11, color: C.muted, padding: "8px 4px" }}>{tx("لا يوجد", "Empty")}</div>
            )}
          </div>
        </div>
      ))}

      {openEngagementId && (
        <EngagementDetailModal
          engagement={engagements.find((e) => e.id === openEngagementId)}
          onClose={() => setOpenEngagementId(null)}
        />
      )}
    </div>
  );
}
