/**
 * LEAD-IMPORT-01 — bulk import of NEW CUSTOMERS/LEADS ("عملاء جدد") from a
 * spreadsheet. Pure module: no React, no Firestore, no file access — it turns
 * already-parsed rows into a PLAN (what would be created/updated and why
 * each row was accepted or rejected). Nothing is written until the UI shows
 * that plan and the user explicitly confirms; the write itself lives in
 * hooks/useLeadImportCommit.js.
 *
 * SCOPE — customers and their INTERESTS only. A plan never contains an
 * engagement, enrollment, payment, accounting transaction, catalog change,
 * status change, or role change. Interests are stored only in the existing
 * customers/{id}.interestedProgramIds (see utils/interestedPrograms.js) and
 * only ever ADDED — an existing customer's interests are never overwritten
 * or removed.
 *
 * THE ONE REQUIRED FIELD IS THE PHONE NUMBER. A missing name is fine (the
 * customer schema's own empty `fullName`, never an invented placeholder);
 * a name with no phone is rejected.
 */
import { cleanPhone, cleanWhitespace } from "./importEngine/dataCleaning";
import { convertArabicDigits, normalizeForFuzzyMatch } from "./importEngine/arabicNormalize";
import { normalizeInterestedProgramIds } from "./interestedPrograms";

/** Hard ceiling on rows per file — beyond this the browser would be doing far more than a lead import should. */
export const MAX_IMPORT_ROWS = 20000;

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));
const uniq = (arr) => [...new Set(arr)];

// ───────────────────────── phone numbers ─────────────────────────

const PERSIAN_DIGITS = /[۰-۹]/g;
const EG_MOBILE = /^01[0125]\d{8}$/;

/**
 * Cleans ONE phone number for validation/matching. Handles Arabic-Indic and
 * Persian digits, spaces/dashes/brackets, "+20…", "0020…", "20…", and a
 * missing leading zero (Excel drops it from numeric cells), by building on
 * the CRM's own normalizePhone (via cleanPhone) — the only additions are the
 * "00" international prefix and Persian digits. It never mutates the
 * caller's original text: validation reads it, the customer's stored `phone`
 * is still the raw value as entered (the CRM's existing convention).
 */
export function normalizeImportPhone(raw) {
  let s = String(raw ?? "");
  s = s.replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0));
  s = convertArabicDigits(s);
  let digits = s.replace(/\D/g, "");
  digits = digits.replace(/^00/, ""); // "0020…" -> "20…" (then normalizePhone drops the 20)
  const normalized = cleanPhone(digits);
  const valid = EG_MOBILE.test(normalized);
  let why = null;
  if (!valid) {
    if (!normalized) why = "no_digits";
    else if (normalized.length < 11) why = "too_short";
    else if (normalized.length > 11) why = "too_long";
    else why = "not_egyptian_mobile";
  }
  return { normalized, valid, why };
}

/**
 * Reads ONE phone cell. Egyptian mobiles only (01[0125]xxxxxxxx after
 * cleaning) — anything else (landline, foreign number, truncated digits) is
 * reported invalid for manual review rather than guessed at or stored.
 * A cell holding two numbers ("0108… - 0101…", "0108…/0101…") yields the
 * first valid one as the primary and the rest as secondary numbers; the
 * WHOLE cell is tried first so a single number written "010-1234-5678"
 * isn't torn apart by the dash.
 */
export function extractPhones(rawCell) {
  const raw = rawCell == null ? "" : String(rawCell).trim();
  if (!raw) return { status: "empty", raw: "" };

  const whole = normalizeImportPhone(raw);
  if (whole.valid) return { status: "ok", primaryRaw: raw, normalized: whole.normalized, secondaryRaw: [], secondaryNormalized: [] };

  const parts = raw.split(/[\/\\,;،؛|\n\r]+|\s+[-–—]\s+|\s{2,}/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const valid = parts.map((p) => ({ raw: p, n: normalizeImportPhone(p) })).filter((x) => x.n.valid);
    if (valid.length > 0) {
      const primary = valid[0];
      const others = valid.slice(1).filter((x, i, a) => x.n.normalized !== primary.n.normalized && a.findIndex((y) => y.n.normalized === x.n.normalized) === i);
      return { status: "ok", primaryRaw: primary.raw, normalized: primary.n.normalized, secondaryRaw: others.map((x) => x.raw), secondaryNormalized: others.map((x) => x.n.normalized) };
    }
  }
  return { status: "invalid", raw, normalized: whole.normalized, why: whole.why };
}

// ───────────────────────── column detection ─────────────────────────

/** Comparable form of a header/label: fuzzy-normalized (Arabic variants, case) with everything but letters/digits removed. */
const compact = (s) => normalizeForFuzzyMatch(s).replace(/[^\p{L}\p{N}]+/gu, "");

const FIELD_SYNONYMS = {
  phone: ["رقم التليفون", "رقم الهاتف", "رقم الموبايل", "الموبايل", "الهاتف", "التليفون", "تليفون", "هاتف", "موبايل", "رقم واتساب", "رقم الواتساب", "واتساب", "phone", "phone number", "mobile", "mobile number", "tel", "telephone", "whatsapp"],
  name: ["اسم الطالب رباعي", "الاسم", "اسم", "اسم الطالب", "اسم العميل", "الاسم بالكامل", "الاسم رباعي", "name", "full name", "fullname", "student name", "customer name"],
  programs: ["الكورسات المهتم بيها", "الكورسات المهتم بها", "الكورس المهتم به", "الكورس", "الكورسات", "الدبلومة", "الدبلومات", "اسم الدبلومة", "اسم الكورس", "البرنامج", "البرامج", "interested courses", "interested programs", "courses", "course", "programs", "program"],
  notes: ["ملاحظات", "ملاحظة", "notes", "note", "comments"],
  source: ["مصدر", "المصدر", "مصدر العميل", "source", "lead source"],
  assignedTo: ["موظف مسؤول", "الموظف المسؤول", "الموظف", "المسؤول", "مسؤول", "assignedto", "assigned to", "assigned"],
};
const SYNONYM_LOOKUP = new Map();
for (const [field, list] of Object.entries(FIELD_SYNONYMS)) for (const label of list) SYNONYM_LOOKUP.set(compact(label), field);
const PHONE_KEYWORDS = ["phone", "mobile", "تليفون", "هاتف", "موبايل", "واتس", "whatsapp"].map(compact);

/** The header whose values look most like phone numbers (>= 60% of its non-empty cells parse as valid) — for sheets with no recognizable phone header, or no header at all. */
export function guessPhoneColumn(headers, rows) {
  let best = null;
  let bestRatio = 0;
  for (const h of headers) {
    let filled = 0, ok = 0;
    for (const r of rows.slice(0, 300)) {
      const v = r[h];
      if (v == null || String(v).trim() === "") continue;
      filled += 1;
      if (extractPhones(v).status === "ok") ok += 1;
    }
    if (filled > 0 && ok / filled >= 0.6 && ok / filled > bestRatio) { best = h; bestRatio = ok / filled; }
  }
  return best;
}

/**
 * Maps a sheet's headers onto the import fields. Only phone is required.
 * `mapping` is the default the preview starts from (the user can change any
 * of it); notes/source/assignedTo are RECOGNIZED and reported but not stored
 * — the customer document has no field for them, and this import doesn't
 * invent one.
 */
const HAS_LETTER = /\p{L}/u;

/** For a sheet with NO header row only: the text-looking column that isn't the phone column — its values are the names. Never used when the sheet has real headers (an unknown "City" column must not become a name). */
export function guessNameColumn(headers, rows, phoneHeader) {
  let best = null;
  let bestRatio = 0;
  for (const h of headers) {
    if (h === phoneHeader) continue;
    let filled = 0, texty = 0;
    for (const r of rows.slice(0, 300)) {
      const v = r[h];
      if (v == null || String(v).trim() === "") continue;
      filled += 1;
      if (HAS_LETTER.test(String(v)) && extractPhones(v).status !== "ok") texty += 1;
    }
    if (filled > 0 && texty / filled >= 0.8 && texty / filled > bestRatio) { best = h; bestRatio = texty / filled; }
  }
  return best;
}

export function detectColumns(headers, rows = [], { hasHeader = true } = {}) {
  const candidates = { phone: [], name: [], programs: [], notes: [], source: [], assignedTo: [] };
  const claimed = new Set();
  for (const h of headers) {
    const field = SYNONYM_LOOKUP.get(compact(h));
    if (field) { candidates[field].push(h); claimed.add(h); }
  }
  if (candidates.phone.length === 0) {
    for (const h of headers) {
      if (claimed.has(h)) continue;
      const c = compact(h);
      if (PHONE_KEYWORDS.some((k) => c.includes(k))) { candidates.phone.push(h); claimed.add(h); }
    }
  }
  let phoneGuessed = false;
  if (candidates.phone.length === 0) {
    const guess = guessPhoneColumn(headers.filter((h) => !claimed.has(h)), rows);
    if (guess) { candidates.phone.push(guess); claimed.add(guess); phoneGuessed = true; }
  }
  const phoneHeader = candidates.phone[0] || null;
  let nameHeader = candidates.name[0] || null;
  let nameGuessed = false;
  if (!nameHeader && !hasHeader) {
    nameHeader = guessNameColumn(headers.filter((h) => !claimed.has(h) || h === phoneHeader), rows, phoneHeader);
    nameGuessed = !!nameHeader;
    if (nameHeader) claimed.add(nameHeader);
  }
  return {
    mapping: {
      phone: phoneHeader,
      name: nameHeader,
      programs: [...candidates.programs],
    },
    candidates,
    phoneGuessed,
    nameGuessed,
    recognizedButNotStored: { notes: candidates.notes, source: candidates.source, assignedTo: candidates.assignedTo },
    ignored: headers.filter((h) => !claimed.has(h)),
  };
}

// ───────────────────────── program matching ─────────────────────────

/** Words that say "this is a course" without naming which one — dropped on BOTH sides for the loosest match tier only. */
const FILLER_WORDS = new Set(["development", "design", "course", "courses", "program", "programs", "programme", "diploma", "training", "دبلومه", "الدبلومه", "كورس", "الكورس", "دوره", "الدوره", "برنامج", "البرنامج", "تدريب"]);

function keysFor(text) {
  const exact = normalizeForFuzzyMatch(text)
    .replace(/[()[\]{}"'“”‘’.]/g, " ")
    .replace(/[-_/\\&+:،,;|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const compactKey = exact.replace(/ /g, "");
  const core = exact.split(" ").filter((w) => w && !FILLER_WORDS.has(w)).join("");
  return { exact, compact: compactKey, core: core || compactKey };
}

const isActiveProgram = (n) => !!n && n.type === "program" && n.isActive !== false && !n.archivedAt;

/** Index over the ACTIVE catalog Programs only (name_en, name_ar, slug). Nothing here can create or alter a Program. */
export function buildProgramIndex(nodes) {
  const index = { exact: new Map(), compact: new Map(), core: new Map(), byId: new Map() };
  const add = (map, key, id) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };
  for (const node of nodes || []) {
    if (!isActiveProgram(node)) continue;
    index.byId.set(node.id, node);
    for (const label of [node.name_en, node.name_ar, node.slug]) {
      if (!label) continue;
      const k = keysFor(label);
      add(index.exact, k.exact, node.id);
      add(index.compact, k.compact, node.id);
      add(index.core, k.core, node.id);
    }
  }
  return index;
}

function lookupProgram(text, index) {
  const k = keysFor(text);
  if (!k.exact) return { status: "empty" };
  for (const level of ["exact", "compact", "core"]) {
    const set = index[level].get(k[level]);
    if (set && set.size === 1) return { status: "matched", id: [...set][0], via: level };
    if (set && set.size > 1) return { status: "ambiguous", ids: [...set] };
  }
  return { status: "unmatched" };
}

/** Splits one interests cell into program tokens on unambiguous list delimiters only: , ; ، ؛ | + newline, and a SPACED slash. Never a bare "/" or "-" ("UI/UX", "Front-End" are single names), never bare "و". */
export function splitProgramCell(raw) {
  return String(raw ?? "")
    .split(/[,;،؛|+\n\r]+|\s+[/\\]\s+/)
    .map((t) => cleanWhitespace(t))
    .filter(Boolean);
}

const scriptOf = (s) => (/[؀-ۿ]/.test(s) ? "ar" : "en");

/**
 * Matches ONE token against the active Programs. Returns
 * { ids, unmatched:[text], ambiguous:[{token,ids}], via }.
 *  - exact / spacing-insensitive / "generic word" tiers (so "Front-End
 *    Development" finds "Front-End", "UI/UX Design" finds "UI/UX");
 *  - a bilingual label ("أساسيات الكمبيوتر - Computer Basics") counts as ONE
 *    program when one side matches and the other is just the same name in the
 *    other script — but two sides that BOTH match different Programs are a list;
 *  - "AI & Data Analysis" / "AI and Data Analysis" / "AI و Data Analysis"
 *    split into pieces, each matched on its own;
 *  - anything that can't be matched confidently is returned as unmatched —
 *    never guessed, never turned into a new Program.
 * `overrides` ({ [compactToken]: programId | "" }) is the user's explicit
 * decision from the preview; "" means "ignore this token".
 */
export function matchProgramToken(token, index, overrides = {}) {
  const t = cleanWhitespace(token);
  const empty = { ids: [], unmatched: [], ambiguous: [], via: "none" };
  if (!t) return { ...empty, via: "empty" };

  const okey = keysFor(t).compact;
  if (Object.prototype.hasOwnProperty.call(overrides, okey)) {
    const v = overrides[okey];
    return v ? { ...empty, ids: [v], via: "manual" } : { ...empty, via: "ignored" };
  }

  const direct = lookupProgram(t, index);
  if (direct.status === "matched") return { ...empty, ids: [direct.id], via: direct.via };
  if (direct.status === "ambiguous") return { ...empty, ambiguous: [{ token: t, ids: direct.ids }], via: "ambiguous" };

  const resolveParts = (parts, allowBilingual) => {
    const results = parts.map((p) => ({ p, r: lookupProgram(p, index) }));
    const matched = results.filter((x) => x.r.status === "matched");
    if (matched.length === 0) return null;
    const ids = uniq(matched.map((x) => x.r.id));
    const amb = results.filter((x) => x.r.status === "ambiguous").map((x) => ({ token: x.p, ids: x.r.ids }));
    const un = results.filter((x) => x.r.status === "unmatched");
    const bilingual = allowBilingual && ids.length === 1 && amb.length === 0 && un.length > 0
      && un.every((u) => matched.every((m) => scriptOf(u.p) !== scriptOf(m.p)));
    return { ids, unmatched: bilingual ? [] : un.map((x) => x.p), ambiguous: amb, via: bilingual ? "bilingual" : "split" };
  };

  const dashParts = t.split(/\s+[-–—]\s+/).map(cleanWhitespace).filter(Boolean);
  if (dashParts.length > 1) { const r = resolveParts(dashParts, true); if (r) return r; }

  const weakParts = t.split(/\s+(?:and|&|و)\s+/i).map(cleanWhitespace).filter(Boolean);
  if (weakParts.length > 1) { const r = resolveParts(weakParts, false); if (r) return r; }

  return { ...empty, unmatched: [t], via: "none" };
}

/** The override key the preview uses for an unmatched token (see matchProgramToken's `overrides`). */
export const programTokenKey = (token) => keysFor(token).compact;

// ───────────────────────── the plan ─────────────────────────

function buildCustomerIndex(customers) {
  const map = new Map();
  const add = (key, c) => {
    if (!key) return;
    const list = map.get(key);
    if (!list) map.set(key, [c]);
    else if (!list.includes(c)) list.push(c);
  };
  for (const c of customers || []) {
    add(c.normalizedPhone || cleanPhone(c.phone), c);
    for (const p of c.secondaryPhones || []) add(cleanPhone(p), c);
  }
  return map;
}

const sameName = (a, b) => normalizeForFuzzyMatch(a) === normalizeForFuzzyMatch(b);

/**
 * Builds the import plan for already-parsed rows. Read-only and repeatable:
 * running it twice on the same input gives the same plan, and re-running it
 * AFTER an import (against the refreshed customer list) yields no new
 * customers and no new interests — the import is safe to repeat.
 *
 * `rows[i]` is a plain object keyed by header; `rowNumbers[i]` its real
 * spreadsheet row. `mapping` = { phone, name, programs:[headers] }.
 * Async only so a large file can yield to the browser every `yieldEvery`
 * rows instead of freezing the tab (0 disables yielding — used by tests).
 */
export async function planLeadImport({
  rows, rowNumbers = [], mapping, existingCustomers = [], programs = [],
  tokenOverrides = {}, batchProgramIds = [], yieldEvery = 400, onProgress,
}) {
  const index = buildProgramIndex(programs);
  // Programs the user picked ONCE for the whole import ("الكورسات المهتم بيها"): applied as interests to every
  // customer this file imports or updates. Only ACTIVE catalog Programs count — anything else is silently dropped.
  const batchIds = uniq(normalizeInterestedProgramIds(batchProgramIds)).filter((id) => index.byId.has(id));
  const customerIndex = buildCustomerIndex(existingCustomers);
  const programHeaders = mapping?.programs || [];

  const rowResults = [];
  const groups = new Map(); // normalized phone -> group
  const unmatchedTokens = new Map(); // override key -> { token, key, rows:[] }
  const matchedCounts = new Map(); // programId -> rows
  let missingPhoneRows = 0, invalidPhoneRows = 0, duplicateRows = 0;

  for (let i = 0; i < rows.length; i++) {
    if (yieldEvery && i > 0 && i % yieldEvery === 0) { onProgress?.(i, rows.length); await yieldToUi(); }
    const row = rows[i];
    const rowNumber = rowNumbers[i] ?? i + 2;
    const name = mapping?.name ? cleanWhitespace(row[mapping.name]) : "";
    const phoneCell = mapping?.phone ? row[mapping.phone] : "";
    const phone = extractPhones(phoneCell);
    const result = { rowNumber, name, phoneRaw: phone.status === "empty" ? "" : String(phoneCell).trim(), phoneNormalized: phone.status === "ok" ? phone.normalized : "", status: "accepted", outcome: null, reasons: [], warnings: [] };

    if (phone.status === "empty") {
      missingPhoneRows += 1;
      result.status = "rejected";
      result.reasons.push({ code: "NO_PHONE" });
      rowResults.push(result);
      continue;
    }
    if (phone.status === "invalid") {
      invalidPhoneRows += 1;
      result.status = "rejected";
      result.reasons.push({ code: "INVALID_PHONE", params: { normalized: phone.normalized, why: phone.why } });
      rowResults.push(result);
      continue;
    }

    // Interests for this row (zero, one, or many tokens across every mapped interests column).
    const rowProgramIds = [];
    for (const h of programHeaders) {
      for (const token of splitProgramCell(row[h])) {
        const m = matchProgramToken(token, index, tokenOverrides);
        for (const id of m.ids) { rowProgramIds.push(id); matchedCounts.set(id, (matchedCounts.get(id) || 0) + 1); }
        for (const u of m.unmatched) {
          const key = programTokenKey(u);
          if (!unmatchedTokens.has(key)) unmatchedTokens.set(key, { token: u, key, rows: [] });
          unmatchedTokens.get(key).rows.push(rowNumber);
          result.warnings.push({ code: "UNMATCHED_PROGRAM", severity: "review", params: { token: u } });
        }
        for (const a of m.ambiguous) {
          result.warnings.push({ code: "AMBIGUOUS_PROGRAM", severity: "review", params: { token: a.token, names: a.ids.map((id) => index.byId.get(id)?.name_en || id) } });
        }
      }
    }
    if (phone.secondaryRaw.length > 0) result.warnings.push({ code: "MULTI_PHONE", severity: "info", params: { secondary: phone.secondaryRaw } });

    const key = phone.normalized;
    let group = groups.get(key);
    if (!group) {
      group = { key, phoneRaw: phone.primaryRaw, secondaryRaw: [], secondaryNormalized: [], name: "", nameRow: null, interestIds: [], rows: [], firstRow: rowNumber };
      groups.set(key, group);
    } else {
      duplicateRows += 1;
      result.outcome = "duplicate";
      result.duplicateOfRow = group.firstRow;
      result.warnings.push({ code: "DUPLICATE_IN_FILE", severity: "info", params: { firstRow: group.firstRow } });
    }
    group.rows.push(rowNumber);
    // Same phone, same customer: merge interests; keep the first name we see, fill it from a later row if it was empty.
    if (name) {
      if (!group.name) { group.name = name; group.nameRow = rowNumber; }
      else if (!sameName(group.name, name)) result.warnings.push({ code: "NAME_CONFLICT", severity: "review", params: { keptName: group.name, keptRow: group.nameRow, otherName: name } });
    }
    for (const id of rowProgramIds) if (!group.interestIds.includes(id)) group.interestIds.push(id);
    phone.secondaryRaw.forEach((raw, k) => {
      const n = phone.secondaryNormalized[k];
      if (n !== key && !group.secondaryNormalized.includes(n)) { group.secondaryRaw.push(raw); group.secondaryNormalized.push(n); }
    });
    result.groupKey = key;
    rowResults.push(result);
  }

  // ── resolve each unique phone against the customers that already exist ──
  const customersToCreate = [];
  const customersToUpdate = [];
  let unchangedExisting = 0, missingNameCustomers = 0, newInterests = 0;
  const skippedGroups = new Map(); // key -> reason
  const rowsByGroup = new Map();
  for (const r of rowResults) if (r.groupKey) { if (!rowsByGroup.has(r.groupKey)) rowsByGroup.set(r.groupKey, []); rowsByGroup.get(r.groupKey).push(r); }

  for (const group of groups.values()) {
    const matches = customerIndex.get(group.key) || [];
    // Interests this customer should end up with from THIS import: whatever the file's own program column said + the batch selection.
    const wanted = uniq([...group.interestIds, ...batchIds]);
    const setOutcome = (outcome) => { for (const r of rowsByGroup.get(group.key) || []) if (!r.outcome) r.outcome = outcome; };
    if (matches.length > 1) {
      skippedGroups.set(group.key, { code: "AMBIGUOUS_EXISTING", params: { count: matches.length } });
      continue;
    }
    if (matches.length === 1) {
      const c = matches[0];
      if (c.archivedAt) { skippedGroups.set(group.key, { code: "ARCHIVED_CUSTOMER", params: { customerId: c.id } }); continue; }
      const have = normalizeInterestedProgramIds(c.interestedProgramIds);
      const added = wanted.filter((id) => !have.includes(id));
      const fillName = !cleanWhitespace(c.fullName) && !!group.name;
      const patch = {};
      if (added.length > 0) patch.interestedProgramIds = [...have, ...added]; // existing interests kept, new ones appended
      if (fillName) patch.fullName = group.name; // never overwrites a name that's already there
      if (Object.keys(patch).length > 0) {
        customersToUpdate.push({ customerId: c.id, phone: c.phone, patch, addedInterestIds: added, filledName: fillName, sourceRows: group.rows });
        newInterests += added.length;
        setOutcome("update");
      } else {
        unchangedExisting += 1;
        setOutcome("existing_unchanged");
      }
      if (!cleanWhitespace(c.fullName) && !group.name) missingNameCustomers += 1;
      continue;
    }
    customersToCreate.push({
      key: group.key,
      // Stored in the cleaned 01xxxxxxxxx form (what the Import Wizard's own cleaning stores, and what tel:/wa.me
      // links expect); `originalPhone` is the cell exactly as typed, kept for the preview/audit only.
      phone: group.key,
      originalPhone: group.phoneRaw,
      normalizedPhone: group.key,
      secondaryPhones: group.secondaryNormalized,
      fullName: group.name, // "" when the file had none — the schema's empty value, never an invented name
      interestedProgramIds: wanted,
      sourceRows: group.rows,
    });
    newInterests += wanted.length;
    if (!group.name) missingNameCustomers += 1;
    setOutcome("create");
  }

  for (const [key, reason] of skippedGroups) {
    for (const r of rowsByGroup.get(key) || []) { r.status = "skipped"; r.outcome = "skipped"; r.reasons.push(reason); }
  }

  const importedRows = rowResults.filter((r) => r.status === "accepted").length;
  const manualReviewRows = rowResults.filter((r) => r.status !== "accepted" || r.warnings.some((w) => w.severity === "review")).length;
  const matchedPrograms = [...matchedCounts.entries()].map(([programId, count]) => ({ programId, name: index.byId.get(programId)?.name_en || programId, count }));

  return {
    rows: rowResults,
    customersToCreate,
    customersToUpdate,
    unmatchedPrograms: [...unmatchedTokens.values()].map((u) => ({ ...u, count: u.rows.length })),
    matchedPrograms,
    stats: {
      totalRows: rows.length,
      validPhoneRows: rows.length - missingPhoneRows - invalidPhoneRows,
      uniquePhones: groups.size,
      batchProgramCount: batchIds.length,
      missingPhoneRows,
      invalidPhoneRows,
      duplicateRows,
      existingCustomers: customersToUpdate.length + unchangedExisting,
      newCustomers: customersToCreate.length,
      updatedCustomers: customersToUpdate.length,
      unchangedExistingCustomers: unchangedExisting,
      missingNameCustomers,
      matchedProgramsDistinct: matchedPrograms.length,
      unmatchedProgramsDistinct: unmatchedTokens.size,
      newInterests,
      importedRows,
      notImportedRows: rows.length - importedRows,
      manualReviewRows,
    },
  };
}
