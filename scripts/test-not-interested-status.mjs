// Ad-hoc tests for making «غير مهتم» (key not_interested) selectable in "عملاء جدد":
// the pure ensure-planner and the guarded one-time admin effect that applies it.
//   node --import ./scripts/esm-ext-loader.mjs scripts/test-not-interested-status.mjs
import { readFileSync } from "node:fs";
import { planEnsureGlobalStatus } from "../src/utils/leadStatusEnsure.js";
import { workflowStatusOptions, NOT_INTERESTED_STATUS, WORKFLOW_STATUS_KEYS } from "../src/utils/newCustomerWorkflow.js";

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log(`  ok  - ${name}`); } else { fail++; console.log(`FAIL  - ${name}`); } }
function eq(name, actual, expected) { check(`${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, JSON.stringify(actual) === JSON.stringify(expected)); }
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const K = "not_interested";
const doc = (o) => ({ key: K, scope: "global", isActive: true, archivedAt: null, createdAt: "2026-08-31T09:54:49.260Z", ...o });

console.log("planEnsureGlobalStatus");
eq("an active global copy exists -> nothing to do", planEnsureGlobalStatus([doc({ id: "a" })], K), { action: "none" });
eq("active copy next to an archived duplicate -> nothing to do (never restores a second one)", planEnsureGlobalStatus([doc({ id: "a" }), doc({ id: "b", isActive: false, archivedAt: "x" })], K), { action: "none" });
eq("no doc with that key at all -> create", planEnsureGlobalStatus([doc({ id: "z", key: "other" })], K), { action: "create" });
eq("empty / missing list -> create", [planEnsureGlobalStatus([], K).action, planEnsureGlobalStatus(undefined, K).action], ["create", "create"]);
eq("only archived copies (the cleanup case) -> restore the OLDEST, the original", planEnsureGlobalStatus([
  doc({ id: "PFdieLoh6", isActive: false, archivedAt: "2026-09-13", createdAt: "2026-08-31T09:54:49.260Z" }),
  doc({ id: "1xjaD93qF", isActive: false, archivedAt: "2026-09-13", createdAt: "2026-07-29T16:48:51.000Z" }),
], K), { action: "restore", id: "1xjaD93qF" });
eq("a copy that is inactive but not archived is also restored", planEnsureGlobalStatus([doc({ id: "a", isActive: false })], K), { action: "restore", id: "a" });
eq("a business-unit status sharing the key does not count as the global one", planEnsureGlobalStatus([doc({ id: "bu", scope: "business_unit" })], K), { action: "create" });

console.log("The picker");
{
  const without = workflowStatusOptions([{ key: "not_contacted" }]).find((o) => o.key === K);
  const withIt = workflowStatusOptions([{ key: "not_contacted" }, { key: K, id: "s1" }]).find((o) => o.key === K);
  eq("with no active status the option is 'not enabled yet' (status null)", without.status, null);
  eq("once an active status exists the same option is selectable", withIt.status?.id, "s1");
  check("not_interested is already one of the workflow outcomes (no new outcome is invented)", WORKFLOW_STATUS_KEYS.includes(K));
  eq("the template is the original seed's: «غير مهتم», terminal, global", [NOT_INTERESTED_STATUS.name_ar, NOT_INTERESTED_STATUS.name_en, NOT_INTERESTED_STATUS.isTerminal], ["غير مهتم", "Not Interested", true]);
}

console.log("The one-time admin effect");
{
  const ctx = read("src/context/LeadStatusContext.jsx");
  const start = ctx.indexOf("notInterestedStatusEnsured === true");
  const eff = ctx.slice(ctx.lastIndexOf("useEffect(", start), ctx.indexOf("// ── SELECTORS"));
  check("admin-only", /if \(currentUser\?\.role !== "admin"\) return;/.test(eff));
  check("claimed once through a transaction on settings/seedState (no double run, no duplicate)", /runTransaction\(db/.test(eff) && eff.includes("notInterestedStatusEnsured: true"));
  check("uses the planner: restores via a single updateDoc, or creates only when no doc has the key", eff.includes("planEnsureGlobalStatus(") && /plan\.action === "restore"/.test(eff) && /plan\.action === "create"/.test(eff));
  check("the claim is released if the write fails, so the next admin session retries", eff.includes("notInterestedStatusEnsured: false"));
  check("restore only flips isActive/archivedAt on that one doc (never rewrites its name/key/order)", /updateDoc\(doc\(db, "leadStatuses", plan\.id\), \{ isActive: true, archivedAt: null, updatedAt: now \}\)/.test(eff));
  check("the earlier ensure for «مهتم» / «هيحجز» is untouched", ctx.includes("newCustomerStatusesEnsured") && ctx.includes("NEW_CUSTOMER_REQUIRED_STATUSES"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
