// Ad-hoc tests for "move the Unassigned money to Company Cash", against the real
// accounting.js (planner, balances, validation, edit history). Synthetic data only.
//   node --import ./scripts/esm-ext-loader.mjs scripts/test-assign-unassigned.mjs
import { readFileSync } from "node:fs";
import {
  ACCOUNTS, TRANSACTION_TYPES as T, INCOME_CATEGORIES, EXPENSE_CATEGORIES, REFUND_CATEGORIES,
  planUnassignedReassignment, computeAccountBalances, computeTransactionTotals, validateTransaction, diffForEditHistory,
} from "../src/utils/accounting.js";

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ok  - ${name}`); } else { fail++; console.log(`FAIL  - ${name}`); } };
const eq = (name, a, e) => check(`${name} (expected ${JSON.stringify(e)}, got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(e));
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// 41 unassigned student payments totalling exactly 38,400 (the figure on the dashboard)
const amounts = [...Array(40).fill(900), 2400]; // 40*900 = 36,000 + 2,400
const unassignedIncome = amounts.map((amount, i) => ({ id: `u${i}`, type: T.INCOME, account: ACCOUNTS.UNASSIGNED, amount, category: INCOME_CATEGORIES.STUDENT_PAYMENT, relatedPaymentId: `p${i}`, date: "2026-08-31" }));
const known = [
  { id: "k1", type: T.INCOME, account: ACCOUNTS.CASH, amount: 5000, category: INCOME_CATEGORIES.STUDENT_PAYMENT },
  { id: "k2", type: T.INCOME, account: ACCOUNTS.INSTAPAY, amount: 2000, category: INCOME_CATEGORIES.STUDENT_PAYMENT },
  { id: "k3", type: T.EXPENSE, account: ACCOUNTS.BANK, amount: 300, category: EXPENSE_CATEGORIES.RENT },
];
const all = [...unassignedIncome, ...known];

console.log("The dashboard figure");
eq("unassigned balance is 38,400", computeAccountBalances(all)[ACCOUNTS.UNASSIGNED], 38400);

console.log("The plan");
const plan = planUnassignedReassignment(all);
eq("41 edits, one per unassigned transaction", plan.count, 41);
eq("every edit only changes `account` to cash (nothing else)", plan.edits.every((e) => JSON.stringify(e.updates) === JSON.stringify({ account: ACCOUNTS.CASH })), true);
eq("effect: cash +38,400, unassigned -38,400, every other account 0", [plan.effect.cash, plan.effect.unassigned, plan.effect.instapay, plan.effect.vodafone_cash, plan.effect.bank], [38400, -38400, 0, 0, 0]);
eq("target defaults to Company Cash", plan.targetAccount, "cash");

console.log("Applying it");
const byId = new Map(plan.edits.map((e) => [e.id, e.updates]));
const applied = all.map((t) => (byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t));
const b = computeAccountBalances(applied);
eq("Company Cash = 5,000 + 38,400 = 43,400", b.cash, 43400);
eq("Unassigned is now 0", b.unassigned, 0);
eq("InstaPay / Bank untouched", [b.instapay, b.bank], [2000, -300]);
eq("grand total unchanged (money moved, not created)", computeAccountBalances(applied).total, computeAccountBalances(all).total);
eq("revenue / expense totals unchanged", computeTransactionTotals(applied), computeTransactionTotals(all));
eq("every edited transaction is still valid, so updateTransaction won't reject it", applied.filter((t) => byId.has(t.id)).map((t) => validateTransaction(t).length).reduce((a, x) => a + x, 0), 0);
const d = diffForEditHistory(unassignedIncome[0], { account: ACCOUNTS.CASH });
eq("each change is recorded in editHistory as unassigned -> cash", d, { oldValue: { account: "unassigned" }, newValue: { account: "cash" } });
eq("amounts / dates / links never touched", applied.filter((t) => byId.has(t.id)).every((t, i) => t.amount === amounts[i] && t.relatedPaymentId === `p${i}` && t.date === "2026-08-31"), true);

console.log("Safe to repeat");
eq("a second plan over the result finds nothing to move", planUnassignedReassignment(applied).count, 0);
const half = all.map((t) => (t.id < "u2" && byId.has(t.id) ? { ...t, account: "cash" } : t));
eq("after a partial run only the remainder is planned", planUnassignedReassignment(half).count, planUnassignedReassignment(all).count - half.filter((t, i) => t.account !== all[i].account).length);

console.log("Edge cases");
{
  const soft = [{ id: "d1", type: T.INCOME, account: ACCOUNTS.UNASSIGNED, amount: 700, category: INCOME_CATEGORIES.STUDENT_PAYMENT, isDeleted: true }];
  eq("soft-deleted transactions are never touched", planUnassignedReassignment(soft).count, 0);
  const mixed = [
    { id: "e1", type: T.EXPENSE, account: ACCOUNTS.UNASSIGNED, amount: 100, category: EXPENSE_CATEGORIES.OTHER },
    { id: "r1", type: T.REFUND, account: ACCOUNTS.UNASSIGNED, amount: 50, category: REFUND_CATEGORIES.STUDENT_REFUND, note: "x" },
    { id: "i1", type: T.INCOME, account: ACCOUNTS.UNASSIGNED, amount: 1000, category: INCOME_CATEGORIES.STUDENT_PAYMENT },
  ];
  const pm = planUnassignedReassignment(mixed);
  eq("expense / refund / income all move; net effect = 1000 - 100 - 50", [pm.count, pm.effect.cash, pm.effect.unassigned], [3, 850, -850]);
  const tr = [
    { id: "t1", type: T.TRANSFER, fromAccount: ACCOUNTS.UNASSIGNED, toAccount: ACCOUNTS.BANK, amount: 200 },
    { id: "t2", type: T.TRANSFER, fromAccount: ACCOUNTS.CASH, toAccount: ACCOUNTS.UNASSIGNED, amount: 300 },
    { id: "t3", type: T.TRANSFER, fromAccount: ACCOUNTS.CASH, toAccount: ACCOUNTS.BANK, amount: 400 },
  ];
  const pt = planUnassignedReassignment(tr);
  eq("a transfer moves only its unassigned side; unrelated transfers are ignored", pt.edits.map((e) => [e.id, e.updates]), [["t1", { fromAccount: "cash" }]]);
  eq("a transfer that would become cash->cash is skipped, not broken", pt.skipped, [{ id: "t2", reason: "SAME_ACCOUNT_TRANSFER" }]);
  eq("other target accounts work too", planUnassignedReassignment(mixed, ACCOUNTS.BANK).effect.bank, 850);
  eq("nothing unassigned -> empty plan", planUnassignedReassignment(known).count, 0);
  eq("empty / undefined input is safe", [planUnassignedReassignment([]).count, planUnassignedReassignment(undefined).count], [0, 0]);
}

console.log("Wiring");
{
  const ctx = read("src/context/AccountingContext.jsx");
  const modal = read("src/pages/admin/accounting/AssignUnassignedModal.jsx");
  const dash = read("src/pages/admin/accounting/AccountingDashboard.jsx");
  check("the bulk action goes through the normal updateTransaction (validation + editHistory), sequentially", ctx.includes("await updateTransaction(e.id, e.updates)") && ctx.includes("planUnassignedReassignment(transactions, targetAccount)"));
  check("it never deletes or re-amounts (no deleteTransaction / addTransaction in the bulk action)", !/deleteTransaction|addTransaction|amount:/.test(ctx.slice(ctx.indexOf("const reassignUnassignedTransactions"), ctx.indexOf("return (\n    <AccountingCtx.Provider"))));
  check("the button only shows when there is unassigned money, and opens a confirmation (nothing writes on click)", dash.includes("unassigned !== 0 &&") && dash.includes("setAssigning(true)") && !dash.includes("reassignUnassignedTransactions"));
  check("the modal shows the count + amount first and needs an explicit confirm button", modal.includes("تأكيد النقل لخزينة الشركة") && modal.includes("plan.count") && modal.includes("onClick={run}"));
  check("in-flight lock against double click", modal.includes("inFlight.current") && modal.includes("disabled={running || plan.count === 0}"));
  const rules = read("firestore.rules");
  const blk = rules.slice(rules.indexOf("match /accountingTransactions/{id}"), rules.indexOf("match /accountingTransactionAudit"));
  check("no rules change is needed: Admin and Accounting can already update accountingTransactions", /allow update: if isAdmin\(\)\s*\|\| \(isAccountingStaff\(\)/.test(blk));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
