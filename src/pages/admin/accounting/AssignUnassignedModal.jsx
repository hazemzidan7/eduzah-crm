import { useMemo, useRef, useState } from "react";
import { Modal, Btn, PBar } from "../../../components/UI";
import { C } from "../../../theme";
import { useAccounting } from "../../../context/AccountingContext";
import { ACCOUNTS, planUnassignedReassignment } from "../../../utils/accounting";

/**
 * Moves the whole "Unassigned / Unverified Money" balance into Company Cash
 * (خزينة الشركة). It shows exactly what will move BEFORE anything is written,
 * needs an explicit confirmation, and applies the change through the normal
 * transaction edit (validated, one editHistory entry per transaction).
 * No transaction is deleted and no amount changes — only the account.
 */
export default function AssignUnassignedModal({ transactions, ar, tx, onClose }) {
  const { reassignUnassignedTransactions } = useAccounting();
  const plan = useMemo(() => planUnassignedReassignment(transactions, ACCOUNTS.CASH), [transactions]);
  const moving = plan.effect[ACCOUNTS.CASH] || 0;

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const inFlight = useRef(false); // a second click while the first run is going does nothing

  const fmt = (n) => n.toLocaleString();
  const run = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    try {
      setResult(await reassignUnassignedTransactions(ACCOUNTS.CASH, { onProgress: (done, total) => setProgress({ done, total }) }));
    } catch (e) {
      setResult({ moved: 0, failed: [{ id: "-", reason: e?.message || String(e) }], skipped: [], planned: plan.count });
    } finally {
      setRunning(false);
      inFlight.current = false;
    }
  };

  return (
    <Modal title={tx("نقل الأموال غير المحددة إلى خزينة الشركة", "Move unassigned money to Company Cash")} onClose={running ? () => {} : onClose}>
      {!result ? (
        <>
          {plan.count === 0 ? (
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>{tx("لا توجد حركات غير محددة الحساب.", "There are no unassigned transactions.")}</div>
          ) : (
            <>
              <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 12, lineHeight: 1.7 }}>
                {tx(
                  `سيتم نقل ${plan.count} حركة من «غير محدد» إلى «خزينة الشركة» — بمبلغ صافي `,
                  `${plan.count} transactions will move from “Unassigned” to “Company Cash” — net `,
                )}
                <b dir="ltr">{fmt(moving)} {ar ? "ج.م" : "EGP"}</b>
                {tx(". رصيد «غير محدد» هيبقى صفر ورصيد الخزينة هيزيد بنفس المبلغ.", ". Unassigned will drop to zero and Company Cash will rise by the same amount.")}
              </div>
              <ul style={{ fontSize: 12, color: C.muted, margin: "0 0 12px", paddingInlineStart: 18, lineHeight: 1.8 }}>
                <li>{tx("لن يتم حذف أي حركة ولن يتغير أي مبلغ أو تاريخ أو تصنيف — الحساب فقط.", "No transaction is deleted and no amount, date or category changes — only the account.")}</li>
                <li>{tx("كل تعديل بيتسجّل في سجل تعديلات الحركة (مين وامتى).", "Each change is recorded in the transaction's edit history (who and when).")}</li>
                <li>{tx("مش هيغيّر إجمالي الإيرادات أو المصروفات.", "Total revenue and expenses do not change.")}</li>
              </ul>
              {plan.skipped.length > 0 && (
                <div style={{ fontSize: 12, color: "#92400E", marginBottom: 12 }}>
                  {tx(`${plan.skipped.length} تحويل هيتساب زي ما هو (النقل هيخليه تحويل لنفس الحساب).`, `${plan.skipped.length} transfer(s) will be left as they are (moving them would make a same-account transfer).`)}
                </div>
              )}
            </>
          )}
          {running && (
            <div style={{ marginBottom: 12 }}>
              <PBar value={progress.total ? Math.round((progress.done / progress.total) * 100) : 0} />
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{tx(`جاري النقل… ${progress.done} / ${progress.total}`, `Moving… ${progress.done} / ${progress.total}`)}</div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Btn v="purple" disabled={running} onClick={onClose}>{tx("إلغاء", "Cancel")}</Btn>
            <Btn v="primary" disabled={running || plan.count === 0} onClick={run}>{running ? tx("جاري النقل…", "Moving…") : tx("تأكيد النقل لخزينة الشركة", "Confirm — move to Company Cash")}</Btn>
          </div>
        </>
      ) : (
        <>
          <div style={{ background: result.failed.length ? "#FEF3C7" : "#F0FDF4", border: `1px solid ${result.failed.length ? "#FDE68A" : "#BBF7D0"}`, borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 12 }}>
            {result.failed.length === 0
              ? tx(`تم نقل ${result.moved} حركة إلى خزينة الشركة.`, `${result.moved} transactions were moved to Company Cash.`)
              : tx(`تم نقل ${result.moved} من ${result.planned}. تعذّر نقل ${result.failed.length} — تقدر تعيد المحاولة وهيكمّل الباقي فقط.`, `${result.moved} of ${result.planned} moved. ${result.failed.length} could not be moved — retrying only moves what is left.`)}
          </div>
          {result.failed.map((f) => <div key={f.id} style={{ color: C.danger, fontSize: 11.5 }}>{f.id}: {f.reason}</div>)}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}><Btn v="primary" onClick={onClose}>{tx("إغلاق", "Close")}</Btn></div>
        </>
      )}
    </Modal>
  );
}
