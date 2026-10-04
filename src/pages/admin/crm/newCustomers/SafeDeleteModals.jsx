import { useMemo, useState } from "react";
import { Modal, Btn, PBar } from "../../../../components/UI";
import { C } from "../../../../theme";
import { useLang } from "../../../../context/LangContext";
import { useSafeCustomerDeletion } from "../../../../hooks/useSafeCustomerDeletion";
import { summarizeProtectedReasons } from "../../../../utils/safeDelete";

function reasonLabel(code, tx) {
  switch (code) {
    case "HAS_ENGAGEMENT": return tx("لديه تسجيل / Engagement", "has an engagement / registration");
    case "HAS_PAYMENT": return tx("لديه دفعات", "has payment records");
    case "HAS_ACCOUNTING": return tx("مرتبط بمعاملات محاسبية", "linked to accounting transactions");
    case "HAS_FOLLOW_UP": return tx("لديه متابعات", "has follow-ups");
    case "HAS_ASSIGNMENT_HISTORY": return tx("موزَّع على مندوب / له سجل توزيع", "assigned to Sales / has assignment history");
    case "HAS_CONTACT_OUTCOME": return tx("سُجِّلت له نتيجة تواصل", "has a recorded contact outcome");
    case "HAS_ACCOUNT": return tx("مرتبط بحساب دخول", "linked to a login account");
    default: return code;
  }
}

function Row({ label, value, tone, last }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: last ? "none" : `1px solid ${C.border}`, fontSize: 12.5 }}>
      <span style={{ color: C.muted }}>{label}</span>
      <b style={{ color: tone || C.text }}>{value}</b>
    </div>
  );
}

function Ack({ checked, onChange, disabled, children }) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, fontWeight: 700, margin: "12px 0", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2 }} />
      <span>{children}</span>
    </label>
  );
}

function ResultErrors({ result, tx }) {
  if (!result?.errors?.length) return null;
  return (
    <div style={{ margin: "8px 0", fontSize: 12, color: C.danger }}>
      {result.errors.map((e, i) => <div key={i}>{e.code}{e.count ? ` (${e.count})` : ""}{e.message ? `: ${e.message}` : ""}</div>)}
      <div style={{ color: C.muted, marginTop: 4 }}>{tx("لم يُحذف إلا ما تم تأكيده أعلاه. يمكنك إعادة المحاولة بأمان.", "Only what is confirmed above was deleted. It is safe to try again.")}</div>
    </div>
  );
}

/**
 * "حذف المحدد" — bulk deletion of the customers ticked in "عملاء جدد". Shows a
 * preview (can be deleted vs protected) BEFORE anything is written, needs an
 * explicit acknowledgement, and only ever deletes customers with no
 * operational data (utils/safeDelete.js). Admin-only (the page only renders it
 * for an admin; the hook and Firestore rules enforce the same).
 */
export function DeleteCustomersModal({ customerIds, onClose, onDone }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { previewBulk, runBulk } = useSafeCustomerDeletion();
  const [ack, setAck] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);

  const plan = useMemo(() => previewBulk(customerIds), [customerIds, previewBulk]); // eslint-disable-line react-hooks/exhaustive-deps
  const reasons = summarizeProtectedReasons(plan.protectedList);
  const canRun = ack && !running && plan.deletable.length > 0;

  const execute = async () => {
    if (!canRun) return;
    setRunning(true);
    try {
      const res = await runBulk(customerIds, { onProgress: (done, total) => setProgress({ done, total }) });
      setResult(res);
      onDone?.(res);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal title={tx("حذف العملاء", "Delete Customers")} onClose={running ? () => {} : onClose}>
      {!result ? (
        <>
          <div style={{ fontSize: 13, marginBottom: 10 }}>{tx("أنت على وشك حذف عملاء محددين. قد يؤدي هذا إلى إزالة سجلاتهم نهائيًا.", "You are about to delete the selected customers. This may permanently remove their records.")}</div>
          <Row label={tx("المحدد", "Selected")} value={plan.requested} />
          <Row label={tx("يمكن حذفهم", "Can be deleted")} value={plan.deletable.length} tone={C.success} />
          <Row label={tx("عملاء محميون", "Protected")} value={plan.protectedList.length} tone={plan.protectedList.length ? C.purple : undefined} last={plan.missing.length === 0} />
          {plan.missing.length > 0 && <Row label={tx("غير موجودين (محذوفون بالفعل)", "Not found (already deleted)")} value={plan.missing.length} last />}
          {plan.protectedList.length > 0 && (
            <div style={{ fontSize: 12, color: C.muted, margin: "10px 0", lineHeight: 1.9 }}>
              <div style={{ fontWeight: 800, color: C.text }}>{tx("لا يمكن حذف هذا العميل لوجود بيانات تشغيلية مرتبطة به — لن يُحذف أي منهم:", "These customers have linked operational data — none of them will be deleted:")}</div>
              {Object.entries(reasons).map(([code, count]) => <div key={code}>• {reasonLabel(code, tx)}: {count}</div>)}
            </div>
          )}
          {plan.deletable.length > 0 ? (
            <>
              <div style={{ fontWeight: 800, fontSize: 13, margin: "10px 0" }}>{tx(`سيتم حذف ${plan.deletable.length} عميل`, `${plan.deletable.length} customers will be deleted`)}</div>
              <Ack checked={ack} onChange={setAck} disabled={running}>
                {tx("أفهم أن العملاء المحذوفين لا يمكن استرجاعهم، وأن العملاء المحميين لن يتأثروا.", "I understand deleted customers can't be recovered, and protected customers are not affected.")}
              </Ack>
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: C.muted, margin: "10px 0" }}>{tx("لا يوجد عملاء يمكن حذفهم من هذا التحديد.", "None of the selected customers can be deleted.")}</div>
          )}
          {running && (
            <div style={{ margin: "8px 0" }}>
              <PBar value={progress.total ? Math.round((progress.done / progress.total) * 100) : 0} color={C.danger} />
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{tx(`جاري الحذف… ${progress.done} / ${progress.total}`, `Deleting… ${progress.done} / ${progress.total}`)}</div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <Btn v="purple" disabled={running} onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
            {plan.deletable.length > 0 && <Btn v="danger" disabled={!canRun} onClick={execute}>{running ? tx("جاري الحذف…", "Deleting…") : tx(`حذف ${plan.deletable.length}`, `Delete ${plan.deletable.length}`)}</Btn>}
          </div>
        </>
      ) : (
        <>
          {result.forbidden ? <div style={{ color: C.danger }}>{tx("هذا الإجراء للأدمن فقط", "This action is admin-only")}</div> : result.busy ? <div style={{ color: C.muted }}>{tx("عملية حذف جارية بالفعل", "A deletion is already running")}</div> : (
            <>
              <div style={{ fontWeight: 800, marginBottom: 8, color: result.failed ? "#92400E" : C.success }}>{result.failed ? tx("اكتمل الحذف جزئيًا", "Deletion finished partially") : tx("تم الحذف", "Deletion completed")}</div>
              <Row label={tx("تم حذفهم", "Deleted")} value={result.deleted} tone={C.success} />
              <Row label={tx("عملاء محميون", "Protected")} value={result.protected} tone={result.protected ? C.purple : undefined} />
              <Row label={tx("فشل", "Failed")} value={result.failed} tone={result.failed ? C.danger : undefined} last />
              <ResultErrors result={result} tx={tx} />
            </>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}><Btn v="primary" onClick={onClose}>{tx("تم", "Done")}</Btn></div>
        </>
      )}
    </Modal>
  );
}

/**
 * "حذف الاستيراد" — deletes one lead import safely. Shows exactly what will
 * happen BEFORE any write: customers created only by this import (and safe)
 * are deleted; customers with other sources keep everything and lose only this
 * source; protected customers stay. The batch record is kept (status
 * "deleted") as the audit trail.
 */
export function DeleteImportModal({ batch, onClose }) {
  const { lang } = useLang();
  const ar = lang === "ar";
  const tx = (a, e) => (ar ? a : e);
  const { previewImport, runImport } = useSafeCustomerDeletion();
  const [ack, setAck] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);

  const plan = useMemo(() => previewImport(batch), [batch, previewImport]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = plan.counts;
  const name = batch.sourceName || batch.fileName || batch.id;
  const canRun = ack && !running;

  const execute = async () => {
    if (!canRun) return;
    setRunning(true);
    try {
      setResult(await runImport(batch.id, { onProgress: (done, total) => setProgress({ done, total }) }));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal title={tx("حذف الاستيراد", "Delete Import")} onClose={running ? () => {} : onClose}>
      {!result ? (
        <>
          <Row label={tx("المصدر", "Source")} value={name} />
          <Row label={tx("الملف", "File")} value={batch.fileName || "—"} />
          <Row label={tx("العملاء المرتبطون بهذا المصدر", "Source-linked customers")} value={c.linked} last />

          <div style={{ fontWeight: 800, fontSize: 12.5, margin: "12px 0 4px" }}>{tx("سيحدث الآتي:", "This will:")}</div>
          <Row label={tx("حذف عملاء (أُنشئوا بهذا الاستيراد فقط ولا بيانات تشغيلية)", "Delete (created only by this import, no operational data)")} value={c.delete} tone={c.delete ? C.danger : undefined} />
          <Row label={tx("إزالة مصدر الاستيراد فقط (لديهم مصادر أخرى)", "Remove this source only (have other sources)")} value={c.removeSourceOnly} />
          {c.preExisting > 0 && <Row label={tx("إزالة المصدر فقط (عملاء موجودون قبل هذا الاستيراد)", "Remove this source only (existed before this import)")} value={c.preExisting} />}
          <Row label={tx("عملاء محميون — يبقون كما هم (يُزال رابط المصدر فقط)", "Protected — stay as they are (only the source link is removed)")} value={c.protected} tone={c.protected ? C.purple : undefined} last={c.missing === 0} />
          {c.missing > 0 && <Row label={tx("غير موجودين (محذوفون بالفعل)", "Not found (already deleted)")} value={c.missing} last />}

          <div style={{ fontSize: 12, color: C.muted, margin: "10px 0", lineHeight: 1.9 }}>
            {tx(`سيتم حذف ${c.delete} عميل. سيتم إزالة مصدر الاستيراد فقط من ${c.removeSourceOnly + c.preExisting} عميل. ${c.protected} عميل محمي لن يُحذف. لن تُحذف أي Engagements أو دفعات أو معاملات محاسبية أو متابعات أو سجل توزيع.`,
              `${c.delete} customers will be deleted. The import source is removed only from ${c.removeSourceOnly + c.preExisting} customers. ${c.protected} protected customers stay. No engagement, payment, accounting transaction, follow-up or assignment history is deleted.`)}
          </div>
          <div style={{ fontWeight: 800, fontSize: 12.5, color: C.danger }}>{tx("هذا الإجراء لا يمكن التراجع عنه بسهولة.", "This action cannot be easily undone.")}</div>
          <Ack checked={ack} onChange={setAck} disabled={running}>{tx("أؤكد حذف هذا الاستيراد", "I confirm deleting this import")}</Ack>
          {running && (
            <div style={{ margin: "8px 0" }}>
              <PBar value={progress.total ? Math.round((progress.done / progress.total) * 100) : 0} color={C.danger} />
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{tx(`جاري الحذف… ${progress.done} / ${progress.total}`, `Deleting… ${progress.done} / ${progress.total}`)}</div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <Btn v="purple" disabled={running} onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
            <Btn v="danger" disabled={!canRun} onClick={execute}>{running ? tx("جاري الحذف…", "Deleting…") : tx("تأكيد حذف الاستيراد", "Confirm Delete Import")}</Btn>
          </div>
        </>
      ) : (
        <>
          {result.forbidden ? <div style={{ color: C.danger }}>{tx("هذا الإجراء للأدمن فقط", "This action is admin-only")}</div>
            : result.busy ? <div style={{ color: C.muted }}>{tx("عملية حذف جارية بالفعل", "A deletion is already running")}</div>
              : result.alreadyDeleted ? <div style={{ color: C.muted }}>{tx("هذا الاستيراد محذوف بالفعل", "This import was already deleted")}</div>
                : result.aborted ? <div style={{ color: C.danger }}>{tx("توقفت العملية قبل حذف أي شيء", "The operation stopped before deleting anything")}<ResultErrors result={result} tx={tx} /></div> : (
                  <>
                    <div style={{ fontWeight: 800, marginBottom: 8, color: result.ok ? C.success : "#92400E" }}>
                      {result.ok ? tx("تم حذف الاستيراد", "Import deleted") : tx("اكتمل الحذف جزئيًا — الاستيراد ما زال في السجل ويمكن إعادة المحاولة", "Deleted partially — the import stays in the history and can be run again")}
                    </div>
                    <Row label={tx("عملاء محذوفون", "Customers deleted")} value={result.deleted} tone={C.success} />
                    <Row label={tx("أُزيل منهم المصدر فقط", "Source removed only")} value={result.sourceRemoved} />
                    <Row label={tx("عملاء محميون", "Protected")} value={result.protected} tone={result.protected ? C.purple : undefined} />
                    <Row label={tx("فشل", "Failed")} value={result.failed} tone={result.failed ? C.danger : undefined} last />
                    <ResultErrors result={result} tx={tx} />
                  </>
                )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}><Btn v="primary" onClick={onClose}>{tx("تم", "Done")}</Btn></div>
        </>
      )}
    </Modal>
  );
}
