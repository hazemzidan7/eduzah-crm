import { useMemo, useState } from "react";
import { Card, Btn } from "../../../components/UI";
import { C, radius } from "../../../theme";
import { useCustomers } from "../../../context/CustomerContext";
import { useAccounting } from "../../../context/AccountingContext";
import { useFollowUps } from "../../../context/FollowUpContext";
import { useCatalog } from "../../../context/CatalogContext";
import { buildCrmExport, toCsv } from "../../../utils/crmExport";

/** Browser-side file download — no server, no credentials, nothing leaves the client except the file the browser itself saves. */
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const CSV_COLLECTIONS = [
  { key: "customers", ar: "العملاء", en: "Customers" },
  { key: "engagements", ar: "التسجيلات", en: "Engagements" },
  { key: "paymentRecords", ar: "سجلات الدفع", en: "Payment Records" },
  { key: "accountingTransactions", ar: "حركات المحاسبة", en: "Accounting Transactions" },
  { key: "deletedAccountingTransactions", ar: "حركات محاسبة محذوفة", en: "Deleted Accounting Transactions" },
  { key: "followUps", ar: "المتابعات", en: "Follow-ups" },
  { key: "catalogNodes", ar: "عناصر الكتالوج", en: "Catalog Nodes" },
];

/**
 * CRM-EXPORT-01 — Admin-only, read-only reconciliation export. Lives inside
 * ManagementDashboard as a third tab, exactly like SalesPerformanceView —
 * inherits AdminShell's existing strandedOnManagement guard for free, no
 * new permission check needed here. Builds the export ENTIRELY from data
 * the signed-in admin's own contexts already loaded (CustomerContext/
 * AccountingContext/FollowUpContext/CatalogContext) — no new Firestore
 * read, no service account, no credentials of any kind touch the frontend.
 * The download itself is a plain client-side Blob + <a download> — nothing
 * is uploaded or sent anywhere.
 */
export default function CrmDataExportView({ ar, tx }) {
  const { customers, engagements } = useCustomers();
  const { transactions } = useAccounting();
  const { followUps } = useFollowUps();
  const { nodes } = useCatalog();

  const [status, setStatus] = useState(null); // null | "success" | "error"
  const [errorMsg, setErrorMsg] = useState("");

  const exportData = useMemo(
    () => buildCrmExport({ customers, engagements, transactions, followUps, catalogNodes: nodes }),
    [customers, engagements, transactions, followUps, nodes],
  );

  const counts = {
    customers: exportData.customers.length,
    engagements: exportData.engagements.length,
    paymentRecords: exportData.paymentRecords.length,
    accountingTransactions: exportData.accountingTransactions.length,
    deletedAccountingTransactions: exportData.deletedAccountingTransactions.length,
    followUps: exportData.followUps.length,
    catalogNodes: exportData.catalogNodes.length,
  };

  const runExport = (fn) => {
    try {
      fn();
      setStatus("success");
      setErrorMsg("");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || tx("حدث خطأ غير متوقع", "An unexpected error occurred"));
    }
  };

  const handleExportJson = () => runExport(() => {
    downloadFile(
      `eduzah-crm-export-${exportData.exportedAt.slice(0, 10)}.json`,
      JSON.stringify(exportData, null, 2),
      "application/json",
    );
  });

  const handleExportCsv = (key) => runExport(() => {
    downloadFile(
      `eduzah-crm-${key}-${exportData.exportedAt.slice(0, 10)}.csv`,
      toCsv(exportData[key]),
      "text/csv",
    );
  });

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{tx("تصدير بيانات الـCRM للمراجعة", "Export CRM Data for Reconciliation")}</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 1.7 }}>
          {tx(
            "تصدير للقراءة فقط — لا يتم تعديل أو حذف أي بيانات. يتم إنشاء الملف بالكامل من داخل المتصفح من البيانات المتاحة بالفعل لحساب الأدمن؛ لا تُستخدم أي بيانات اعتماد أو مفاتيح خدمة، ولا يُرسل أي شيء لأي جهة خارجية.",
            "Read-only export — nothing is modified or deleted. The file is built entirely in your browser from data your admin session already has; no credentials or service keys are used, and nothing is sent anywhere else.",
          )}
        </div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {tx("ما سيتم تصديره", "What will be exported")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 18 }}>
        {CSV_COLLECTIONS.map((c) => (
          <Card key={c.key} style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, marginBottom: 4 }}>{ar ? c.ar : c.en}</div>
            <div style={{ fontSize: 18, fontWeight: 900 }} dir="ltr">{counts[c.key].toLocaleString()}</div>
          </Card>
        ))}
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {tx("تصدير JSON كامل (موصى به)", "Full JSON export (recommended)")}
      </div>
      <Card style={{ padding: 16, marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          {tx(
            "ملف واحد يحتوي على كل المجموعات أعلاه بالكامل — الأنسب للمراجعة والمطابقة.",
            "One file containing every collection above in full — best for reconciliation and matching.",
          )}
        </div>
        <Btn v="primary" onClick={handleExportJson}>{tx("تصدير JSON", "Export JSON")}</Btn>
      </Card>

      <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {tx("تصدير CSV لكل مجموعة (اختياري)", "Per-collection CSV export (optional)")}
      </div>
      <Card style={{ padding: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {CSV_COLLECTIONS.map((c) => (
            <Btn key={c.key} v="purple" sm onClick={() => handleExportCsv(c.key)}>
              {ar ? c.ar : c.en} (.csv)
            </Btn>
          ))}
        </div>
      </Card>

      {status === "success" && (
        <div style={{ marginTop: 14, fontSize: 12.5, color: C.success, fontWeight: 700 }}>
          ✓ {tx("تم إنشاء الملف — تحقق من مجلد التنزيلات.", "File generated — check your downloads folder.")}
        </div>
      )}
      {status === "error" && (
        <div style={{ marginTop: 14, fontSize: 12.5, color: C.danger, fontWeight: 700 }}>
          ⚠ {errorMsg}
        </div>
      )}
    </div>
  );
}
