import { useState } from "react";
import { Card, Btn } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useImportBatches } from "../../../../context/ImportBatchContext";
import { useImportProfiles } from "../../../../context/ImportProfileContext";
import { useImportCommit } from "../../../../hooks/useImportCommit";

const th = { textAlign: "center", fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: "#475569", fontWeight: 800, padding: "12px 14px", borderBottom: `1px solid ${C.border}` };
const td = { padding: "11px 14px", fontSize: 12.5, textAlign: "center", verticalAlign: "middle", borderBottom: "1px solid #E2E8F0" };

export default function ImportHistoryList({ programId }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { batches: allBatches, loading } = useImportBatches();
  const { profileById } = useImportProfiles();
  const { rollbackBatch } = useImportCommit();
  const [rollingBackId, setRollingBackId] = useState(null);

  // Contextual to the current Program — opening a different Program shows
  // only that Program's import runs, never a global list.
  const batches = programId ? allBatches.filter((b) => b.programId === programId) : allBatches;

  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString(ar ? "ar-EG" : "en-US", { day: "numeric", month: "short", year: "numeric" }) : "—";

  const doRollback = async (batch) => {
    setRollingBackId(batch.id);
    try {
      await rollbackBatch(batch);
    } finally {
      setRollingBackId(null);
    }
  };

  if (loading) {
    return <Card style={{ padding: 32, textAlign: "center" }}><div style={{ color: C.muted }}>{tx("جاري التحميل…", "Loading…")}</div></Card>;
  }
  if (batches.length === 0) {
    return (
      <Card style={{ padding: 32, textAlign: "center" }}>
        <div style={{ color: C.muted, fontSize: 12.5 }}>{tx("لا توجد عمليات استيراد منفذة بعد", "No imports have been committed yet")}</div>
      </Card>
    );
  }

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
          <thead>
            <tr>
              <th style={th}>{tx("الملف", "File")}</th>
              <th style={th}>{tx("ملف الاستيراد", "Profile")}</th>
              <th style={th}>{tx("بواسطة", "By")}</th>
              <th style={th}>{tx("التاريخ", "Date")}</th>
              <th style={th}>{tx("منشأ", "Created")}</th>
              <th style={th}>{tx("محدّث", "Updated")}</th>
              <th style={th}>{tx("متخطى", "Skipped")}</th>
              <th style={th}>{tx("أخطاء", "Errors")}</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className="edu-sheet-row">
                <td style={td}>{b.fileName}</td>
                <td style={td}>{profileById(b.importProfileId)?.name || "—"} (v{b.importProfileVersion})</td>
                <td style={td}>{b.importedByName || "—"}</td>
                <td style={td}>{fmt(b.createdAt)}</td>
                <td style={td}>{b.createdCount ?? 0}</td>
                <td style={td}>{b.updatedCount ?? 0}</td>
                <td style={td}>{b.skippedCount ?? 0}</td>
                <td style={td}>{b.errorCount ?? 0}</td>
                <td style={td}>
                  {b.rolledBackAt ? (
                    <span style={{ fontSize: 11, color: C.muted }}>{tx("تم التراجع", "Rolled back")}</span>
                  ) : (
                    <Btn sm v="danger" disabled={rollingBackId === b.id || !(b.createdCustomerIds?.length || b.createdEngagementIds?.length)} onClick={() => doRollback(b)}>
                      {rollingBackId === b.id ? tx("جاري…", "…") : tx("تراجع", "Rollback")}
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
