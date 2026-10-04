/**
 * LEAD-IMPORT-01 — bulk import of NEW CUSTOMERS/LEADS ("عملاء جدد") from a
 * spreadsheet. Pure module: no React, no Firestore, no file access — it turns
 * already-parsed rows into a PLAN (what would be created/updated and why
 * each row was accepted or rejected). Nothing is written until the UI shows
 * that plan and the user explicitly confirms; the write itself lives in
 * utils/leadImportCommit.js (wired to Firestore by hooks/useLeadImportCommit.js).
 *
 * SCOPE — customers and their INTERESTS only. A plan never contains an
 * engagement, enrollment, payment, accounting transaction, catalog change,
 * status change, or role change. Interests are stored only in the existing
 * customers/{id}.interestedProgramIds (see utils/interestedPrograms.js) and
 * only ever ADDED — an existing customer's interests are never overwritten
 * or removed.
 *
 * THE CONTACT IDENTIFIER IS A PHONE NUMBER (any country's — see normalizeImportPhone) OR A WHATSAPP USERNAME (see
 * utils/whatsappContact.js) — at least one of the two per row, both kept when both are there; a username is never
 * stored in, or converted into, a phone. A missing name is fine (the customer schema's own empty `fullName`, never an
 * invented placeholder); a name with neither a phone nor a username is rejected.
 */
import { cleanPhone, cleanWhitespace } from "./importEngine/dataCleaning";
import { convertArabicDigits, normalizeForFuzzyMatch } from "./importEngine/arabicNormalize";
import { normalizeInterestedProgramIds } from "./interestedPrograms";
import { parseWhatsappUsername, normalizeWhatsappUsername } from "./whatsappContact";

/** Hard ceiling on rows per file — beyond this the browser would be doing far more than a lead import should. */
export const MAX_IMPORT_ROWS = 20000;

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));
const uniq = (arr) => [...new Set(arr)];

// ───────────────────────── phone numbers ─────────────────────────

const PERSIAN_DIGITS = /[۰-۹]/g;
/** Zero-width / bidi marks and NBSP that spreadsheets and chat apps sneak into copied numbers. */
const INVISIBLE = /[\s\u00a0\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
/** What a phone cell may contain besides digits: a leading +, and the usual separators. Anything else is not a phone number. */
const PHONE_CHARS = /^[\d+\-().]+$/;
const EG_LOCAL_MOBILE = /^01[0125]\d{8}$/; // 01012345678
const EG_NATIONAL_MOBILE = /^1[0125]\d{8}$/; // 1012345678 (after +20, or with Excel's dropped leading zero)

/** E.164 allows at most 15 digits including the country code; fewer than 8 can't be a real subscriber number. */
export const PHONE_MIN_DIGITS = 8;
export const PHONE_MAX_DIGITS = 15;

const bad = (why, digits = "") => ({ normalized: digits, display: "", valid: false, why, kind: null });

/**
 * Validates and canonicalizes ONE phone number. The CRM serves customers from
 * many countries, so this is NOT an Egypt-only check:
 *
 *  - Egyptian local mobiles (010/011/012/015 + 8 digits, or the same with
 *    Excel's dropped leading zero, or with +20 / 0020 / 20) are canonicalized
 *    to the CRM's existing local form "01xxxxxxxxx" — so "+201012345678" and
 *    "01012345678" are the SAME customer, exactly as everywhere else in the CRM.
 *  - Any other number with an explicit international marker ("+…" or "00…")
 *    is accepted as long as it is a plausible E.164 number: a country code
 *    (never starting with 0) and 8–15 digits in total. It is kept as typed
 *    ("+971523276550") — never truncated, never re-countried.
 *  - Digits with NO marker: 12–15 digits can only be a full international
 *    number (no local format is that long), so it is accepted as "+…". A
 *    shorter, non-Egyptian-looking number (8–11 digits) could belong to any
 *    country — it is NOT guessed at; it is reported "ambiguous_country" for
 *    manual review ("write it with its +country code").
 *  - Letters/symbols, too few digits, too many digits, or a leading 0 on an
 *    international number are rejected with a specific reason.
 *
 * `normalized` is the MATCHING KEY: exactly what the rest of the CRM computes
 * for the same number (leadDedupe.normalizePhone, i.e. the customer's stored
 * `normalizedPhone`), so an import finds customers that already exist.
 * `display` is what gets stored as the customer's `phone`. The caller's
 * original cell text is never modified.
 */
export function normalizeImportPhone(raw) {
  let s = String(raw ?? "");
  s = s.replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0));
  s = convertArabicDigits(s);
  const t = s.replace(INVISIBLE, "");
  if (!t) return bad("no_digits");
  if (!PHONE_CHARS.test(t)) return bad(/\p{L}/u.test(t) ? "contains_letters" : "invalid_characters");
  const plusCount = (t.match(/\+/g) || []).length;
  if (plusCount > 1 || (plusCount === 1 && !t.startsWith("+"))) return bad("invalid_characters");
  const digits = t.replace(/\D/g, "");
  if (!digits) return bad("no_digits");

  const done = (display, kind, unmarked = false) => ({ normalized: cleanPhone(display), display, valid: true, why: null, kind, unmarked });

  const international = t.startsWith("+") || digits.startsWith("00");
  if (international) {
    const d = t.startsWith("+") ? digits : digits.slice(2);
    if (d.startsWith("0")) return bad("bad_country_code", d);
    if (d.length < PHONE_MIN_DIGITS) return bad("too_short", d);
    if (d.length > PHONE_MAX_DIGITS) return bad("too_long", d);
    if (d.startsWith("20")) {
      const rest = d.slice(2);
      if (EG_NATIONAL_MOBILE.test(rest)) return done(`0${rest}`, "egypt");
      if (EG_LOCAL_MOBILE.test(rest)) return done(rest, "egypt"); // "+20 01012345678": stray trunk zero
    }
    return done(`+${d}`, "international");
  }

  if (digits.length < PHONE_MIN_DIGITS) return bad("too_short", digits);
  if (EG_LOCAL_MOBILE.test(digits)) return done(digits, "egypt");
  if (EG_NATIONAL_MOBILE.test(digits)) return done(`0${digits}`, "egypt");
  if (digits.length === 12 && digits.startsWith("20") && EG_NATIONAL_MOBILE.test(digits.slice(2))) return done(`0${digits.slice(2)}`, "egypt");
  if (digits.length > PHONE_MAX_DIGITS) return bad("too_long", digits);
  if (digits.startsWith("0")) return bad(digits.length > 11 ? "bad_country_code" : "ambiguous_country", digits);
  if (digits.length >= 12) return done(`+${digits}`, "international", true);
  return bad("ambiguous_country", digits);
}

/**
 * Reads ONE phone cell. A cell holding two numbers ("0108… - 0101…",
 * "0108…/+971…") yields the first valid one as the primary and the rest as
 * secondary numbers; the WHOLE cell is tried first so a single number written
 * "010-1234-5678" or "+971 52 327 6550" isn't torn apart by its separators.
 * Result for a valid cell: { status:"ok", primaryRaw, display, normalized (matching key),
 * kind, unmarked, secondaryRaw[], secondaryDisplay[], secondaryNormalized[] }.
 */
export function extractPhones(rawCell) {
  const raw = rawCell == null ? "" : String(rawCell).trim();
  if (!raw) return { status: "empty", raw: "" };

  const ok = (primaryRaw, n, others) => ({
    status: "ok", primaryRaw, display: n.display, normalized: n.normalized, kind: n.kind, unmarked: !!n.unmarked,
    secondaryRaw: others.map((x) => x.raw), secondaryDisplay: others.map((x) => x.n.display), secondaryNormalized: others.map((x) => x.n.normalized),
  });

  const whole = normalizeImportPhone(raw);
  if (whole.valid) return ok(raw, whole, []);

  const parts = raw.split(/[/\\,;،؛|\n\r]+|\s+[-–—]\s+|\s{2,}/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const valid = parts.map((p) => ({ raw: p, n: normalizeImportPhone(p) })).filter((x) => x.n.valid);
    if (valid.length > 0) {
      const primary = valid[0];
      const others = valid.slice(1).filter((x, i, a) => x.n.normalized !== primary.n.normalized && a.findIndex((y) => y.n.normalized === x.n.normalized) === i);
      return ok(primary.raw, primary.n, others);
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
  // WHATSAPP-USERNAME-01: matched by exact header, so the "whatsapp"-keyword phone fallback below never sees these.
  username: ["username", "user name", "whatsapp username", "whatsapp user name", "wa username", "اسم المستخدم", "اسم مستخدم", "اسم المستخدم واتساب", "اسم المستخدم في واتساب", "اسم المستخدم على واتساب", "يوزر", "يوزرنيم", "يوزر واتساب", "معرف واتساب"],
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
  const candidates = { phone: [], name: [], programs: [], notes: [], source: [], assignedTo: [], username: [] };
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
  const usernameHeader = candidates.username[0] || null;
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
      // Present only when the sheet has a username column, so a phone-only sheet maps exactly as it always did.
      ...(usernameHeader ? { username: usernameHeader } : {}),
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

// ───────────────────────── shared import note ─────────────────────────

/** DD/MM/YYYY in local time, e.g. 19/09/2026. */
export function formatImportNoteDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * The ONE note the user typed for this whole import ("ملاحظة عامة"), as the
 * block written into each customer's existing `notes` field:
 *   [ملاحظة استيراد - 19/09/2026]
 *   <note>
 * Empty / whitespace-only -> "" (the import then behaves exactly as without a note).
 */
export function buildImportNoteBlock(note, date = new Date()) {
  const text = String(note ?? "").replace(/\r\n/g, "\n").trim();
  return text ? `[ملاحظة استيراد - ${formatImportNoteDate(date)}]\n${text}` : "";
}

/**
 * The customer's notes after applying the import note. NEW customers get just the
 * block; EXISTING customers keep their old notes untouched and the block is
 * appended after a blank line. Returns the same string when the exact block is
 * already there (so a repeat of the same import — or the same customer listed
 * twice — never stacks the same note again).
 */
export function appendImportNote(existingNotes, block) {
  const have = String(existingNotes ?? "");
  if (!block) return have;
  if (have.includes(block)) return have;
  return have.trim() ? `${have.replace(/\s+$/, "")}\n\n${block}` : block;
}

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

/** normalized whatsappUsername -> the existing customers that have it (customers without one are simply absent). */
function buildUsernameIndex(customers) {
  const map = new Map();
  for (const c of customers || []) {
    const u = normalizeWhatsappUsername(c.whatsappUsername);
    if (!u) continue;
    const list = map.get(u);
    if (!list) map.set(u, [c]);
    else if (!list.includes(c)) list.push(c);
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
  tokenOverrides = {}, batchProgramIds = [], sharedNote = "", importDate = new Date(), yieldEvery = 400, onProgress,
}) {
  const index = buildProgramIndex(programs);
  // ONE shared note for the whole import (optional). Applied to every ACCEPTED customer — created or updated —
  // through the customer's existing `notes` field; it never touches an engagement, payment, or accounting record.
  const noteBlock = buildImportNoteBlock(sharedNote, importDate);
  // Programs the user picked ONCE for the whole import ("الكورسات المهتم بيها"): applied as interests to every
  // customer this file imports or updates. Only ACTIVE catalog Programs count — anything else is silently dropped.
  const batchIds = uniq(normalizeInterestedProgramIds(batchProgramIds)).filter((id) => index.byId.has(id));
  const customerIndex = buildCustomerIndex(existingCustomers);
  const usernameIndex = buildUsernameIndex(existingCustomers);
  const programHeaders = mapping?.programs || [];
  const hasUsernameColumn = !!mapping?.username;

  const rowResults = [];
  // One group per real person in the file. Its key is the normalized phone — or "u:<username>" for a contact that
  // only has a WhatsApp username so far. A phone-only file therefore groups exactly as it always did.
  const groups = new Map();
  const byPhone = new Map(); // normalized phone -> group
  const byUsername = new Map(); // normalized username -> group
  const mergedInto = new Map(); // key of a group absorbed into another -> key of the survivor
  let groupOrder = 0;
  const unmatchedTokens = new Map(); // override key -> { token, key, rows:[] }
  const matchedCounts = new Map(); // programId -> rows
  let missingPhoneRows = 0, invalidPhoneRows = 0, invalidUsernameRows = 0, usernameOnlyRows = 0, duplicateRows = 0;

  for (let i = 0; i < rows.length; i++) {
    if (yieldEvery && i > 0 && i % yieldEvery === 0) { onProgress?.(i, rows.length); await yieldToUi(); }
    const row = rows[i];
    const rowNumber = rowNumbers[i] ?? i + 2;
    const name = mapping?.name ? cleanWhitespace(row[mapping.name]) : "";
    const phoneCell = mapping?.phone ? row[mapping.phone] : "";
    const phone = extractPhones(phoneCell);
    const usernameCell = hasUsernameColumn ? row[mapping.username] : "";
    const uname = hasUsernameColumn ? parseWhatsappUsername(usernameCell) : { status: "empty", normalized: "" };
    const result = {
      rowNumber, name, phoneRaw: phone.status === "empty" ? "" : String(phoneCell).trim(), phoneNormalized: phone.status === "ok" ? phone.normalized : "", phoneDisplay: phone.status === "ok" ? phone.display : "", phoneKind: phone.status === "ok" ? phone.kind : null, status: "accepted", outcome: null, reasons: [], warnings: [],
      // Only on sheets that have a username column, so a phone-only import produces exactly the rows it always did.
      ...(hasUsernameColumn ? { usernameRaw: uname.status === "empty" ? "" : String(usernameCell).trim(), username: uname.status === "ok" ? uname.normalized : "" } : {}),
    };

    const phoneOk = phone.status === "ok";
    const userOk = uname.status === "ok";
    // A row needs a phone OR a username. A bad value next to a good one never costs the lead — it is kept out of the
    // customer and flagged for review instead; a bad value with nothing good beside it rejects the row.
    if (!phoneOk && !userOk) {
      result.status = "rejected";
      if (phone.status === "invalid") {
        invalidPhoneRows += 1;
        result.reasons.push({ code: "INVALID_PHONE", params: { normalized: phone.normalized, why: phone.why } });
      } else if (uname.status === "invalid") {
        invalidUsernameRows += 1;
        result.reasons.push({ code: "INVALID_USERNAME", params: { normalized: uname.normalized, why: uname.why } });
      } else {
        missingPhoneRows += 1;
        result.reasons.push({ code: hasUsernameColumn ? "NO_CONTACT" : "NO_PHONE" });
      }
      rowResults.push(result);
      continue;
    }
    if (phone.status === "invalid") result.warnings.push({ code: "INVALID_PHONE_IGNORED", severity: "review", params: { normalized: phone.normalized, why: phone.why } });
    if (uname.status === "invalid") result.warnings.push({ code: "INVALID_USERNAME_IGNORED", severity: "review", params: { normalized: uname.normalized, why: uname.why } });

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
    if (phoneOk && phone.secondaryRaw.length > 0) result.warnings.push({ code: "MULTI_PHONE", severity: "info", params: { secondary: phone.secondaryRaw } });

    const pk = phoneOk ? phone.normalized : "";
    const un = userOk ? uname.normalized : "";
    if (!pk && un) usernameOnlyRows += 1;

    // Which person is this row? The phone decides first (exactly as before). A row with only a username — or a
    // username-only contact that now shows its phone — joins the contact that already owns that username, so one
    // person is never split in two just because one row had the phone and another the username. The one thing that
    // keeps two customers apart is a username that appears with two DIFFERENT phones.
    let group = pk ? byPhone.get(pk) : undefined;
    const usernameOwner = un ? byUsername.get(un) : undefined;
    if (!group && usernameOwner && (!pk || !usernameOwner.phoneKey)) {
      group = usernameOwner;
      if (pk) { group.phoneKey = pk; group.phoneRaw = phone.primaryRaw; group.phoneDisplay = phone.display; byPhone.set(pk, group); }
    }
    const isNewGroup = !group;
    if (isNewGroup) {
      group = { key: pk || `u:${un}`, phoneKey: pk, username: "", phoneRaw: pk ? phone.primaryRaw : "", phoneDisplay: pk ? phone.display : "", secondaryRaw: [], secondaryDisplay: [], secondaryNormalized: [], name: "", nameRow: null, interestIds: [], rows: [], firstRow: rowNumber, order: groupOrder++ };
      groups.set(group.key, group);
      if (pk) byPhone.set(pk, group);
    } else {
      duplicateRows += 1;
      result.outcome = "duplicate";
      result.duplicateOfRow = group.firstRow;
      result.warnings.push({ code: "DUPLICATE_IN_FILE", severity: "info", params: { firstRow: group.firstRow } });
    }
    if (un) {
      const owner = byUsername.get(un);
      if (!owner) {
        if (!group.username) { group.username = un; byUsername.set(un, group); }
        else result.warnings.push({ code: "USERNAME_CONFLICT", severity: "review", params: { username: un, keptUsername: group.username } });
      } else if (owner !== group) {
        if (!owner.phoneKey) {
          // A username-only contact seen earlier turns out to be this same person: fold it in.
          group.rows.push(...owner.rows);
          group.rows.sort((a, b) => a - b);
          group.firstRow = Math.min(group.firstRow, owner.firstRow);
          group.order = Math.min(group.order, owner.order);
          if (!group.name && owner.name) { group.name = owner.name; group.nameRow = owner.nameRow; }
          for (const id of owner.interestIds) if (!group.interestIds.includes(id)) group.interestIds.push(id);
          if (!group.username) group.username = un;
          byUsername.set(un, group);
          groups.delete(owner.key);
          mergedInto.set(owner.key, group.key);
        } else {
          result.warnings.push({ code: "USERNAME_CONFLICT", severity: "review", params: { username: un, otherPhoneRow: owner.firstRow } });
        }
      }
    }
    group.rows.push(rowNumber);
    // Same phone, same customer: merge interests; keep the first name we see, fill it from a later row if it was empty.
    if (name) {
      if (!group.name) { group.name = name; group.nameRow = rowNumber; }
      else if (!sameName(group.name, name)) result.warnings.push({ code: "NAME_CONFLICT", severity: "review", params: { keptName: group.name, keptRow: group.nameRow, otherName: name } });
    }
    for (const id of rowProgramIds) if (!group.interestIds.includes(id)) group.interestIds.push(id);
    if (phoneOk) phone.secondaryRaw.forEach((raw, k) => {
      const n = phone.secondaryNormalized[k];
      if (n !== pk && !group.secondaryNormalized.includes(n)) { group.secondaryRaw.push(raw); group.secondaryDisplay.push(phone.secondaryDisplay[k]); group.secondaryNormalized.push(n); }
    });
    result.groupKey = group.key;
    rowResults.push(result);
  }
  // A row that went into a group which was later folded into another belongs to the survivor.
  const survivorKey = (k) => { let cur = k; while (mergedInto.has(cur)) cur = mergedInto.get(cur); return cur; };
  if (mergedInto.size > 0) for (const r of rowResults) if (r.groupKey) r.groupKey = survivorKey(r.groupKey);

  // ── resolve each unique phone against the customers that already exist ──
  const customersToCreate = [];
  const customersToUpdate = [];
  // Every ACCEPTED lead (created, updated, or already existing with nothing new to write), one entry per unique
  // phone, in the order its phone was FIRST seen in the file — never randomized, never re-sorted. This is the
  // "final accepted lead list order" that Sales distribution slices into ranges; ambiguous/archived matches (see
  // `skippedGroups` below) never reach this array. `customerId` is null for a "create" entry — the real Firestore
  // id only exists after the commit step (see utils/leadImportCommit.js's acceptedCustomerIds).
  const acceptedCustomers = [];
  let unchangedExisting = 0, missingNameCustomers = 0, newInterests = 0, notesApplied = 0;
  const skippedGroups = new Map(); // key -> reason
  const rowsByGroup = new Map();
  for (const r of rowResults) if (r.groupKey) { if (!rowsByGroup.has(r.groupKey)) rowsByGroup.set(r.groupKey, []); rowsByGroup.get(r.groupKey).push(r); }

  // Insertion order IS first-seen order — unless two groups were folded together above, in which case the survivor
  // takes the earlier group's position.
  const orderedGroups = mergedInto.size > 0 ? [...groups.values()].sort((a, b) => a.order - b.order) : [...groups.values()];
  for (const group of orderedGroups) {
    // An existing customer matches by phone (primary or secondary — exactly as before) OR by WhatsApp username. One
    // group landing on two different customers is ambiguous and left for manual review, never guessed.
    const matchSet = new Set();
    if (group.phoneKey) for (const c of customerIndex.get(group.phoneKey) || []) matchSet.add(c);
    if (group.username) for (const c of usernameIndex.get(group.username) || []) matchSet.add(c);
    const matches = [...matchSet];
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
      // Contact identifiers are only ever FILLED IN, never overwritten: an existing phone / username stays exactly as it is.
      const keptUsername = normalizeWhatsappUsername(c.whatsappUsername);
      if (group.username && !keptUsername) patch.whatsappUsername = group.username;
      const hasPhone = !!(cleanWhitespace(c.phone) || c.normalizedPhone);
      if (group.phoneKey && !hasPhone) { patch.phone = group.phoneDisplay; patch.normalizedPhone = group.phoneKey; }
      const noteExisting = (code, params) => { for (const r of rowsByGroup.get(group.key) || []) r.warnings.push({ code, severity: "info", params }); };
      if (group.username && keptUsername && keptUsername !== group.username) noteExisting("EXISTING_USERNAME_KEPT", { kept: keptUsername, ignored: group.username });
      if (group.phoneKey && hasPhone && !(customerIndex.get(group.phoneKey) || []).includes(c)) noteExisting("EXISTING_PHONE_KEPT", { kept: c.phone, ignored: group.phoneDisplay });
      // The old note is kept; the import note is appended (skipped if this exact block is already there).
      const nextNotes = appendImportNote(c.notes, noteBlock);
      if (noteBlock && nextNotes !== (c.notes ?? "")) { patch.notes = nextNotes; notesApplied += 1; }
      if (Object.keys(patch).length > 0) {
        customersToUpdate.push({ customerId: c.id, phone: c.phone, patch, addedInterestIds: added, filledName: fillName, sourceRows: group.rows });
        acceptedCustomers.push({ key: group.key, kind: "update", customerId: c.id });
        newInterests += added.length;
        setOutcome("update");
      } else {
        unchangedExisting += 1;
        acceptedCustomers.push({ key: group.key, kind: "unchanged", customerId: c.id });
        setOutcome("existing_unchanged");
      }
      if (!cleanWhitespace(c.fullName) && !group.name) missingNameCustomers += 1;
      continue;
    }
    customersToCreate.push({
      key: group.key,
      // Stored as the canonical display form — Egyptian numbers as 01xxxxxxxxx (what the Import Wizard's own cleaning
      // stores), any other number as +<country code><number>; both work with tel:/wa.me links. `originalPhone` is the
      // cell exactly as typed, kept for the preview/audit only. `normalizedPhone` is the matching key.
      phone: group.phoneDisplay,
      originalPhone: group.phoneRaw,
      normalizedPhone: group.phoneKey,
      secondaryPhones: group.secondaryDisplay,
      // Its own field next to `phone` — only present when the file gave one, so a phone-only import plans exactly what it always did.
      ...(group.username ? { whatsappUsername: group.username } : {}),
      fullName: group.name, // "" when the file had none — the schema's empty value, never an invented name
      interestedProgramIds: wanted,
      // Only present when a shared note was entered, so an import without one produces exactly the documents it always did.
      ...(noteBlock ? { notes: noteBlock } : {}),
      sourceRows: group.rows,
    });
    acceptedCustomers.push({ key: group.key, kind: "create", customerId: null });
    if (noteBlock) notesApplied += 1;
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
    acceptedCustomers,
    unmatchedPrograms: [...unmatchedTokens.values()].map((u) => ({ ...u, count: u.rows.length })),
    matchedPrograms,
    stats: {
      totalRows: rows.length,
      // Rows with a usable contact identifier (a phone, or — only on sheets with a username column — a username).
      validPhoneRows: rows.length - missingPhoneRows - invalidPhoneRows - invalidUsernameRows,
      usernameOnlyRows,
      invalidUsernameRows,
      uniquePhones: groups.size,
      batchProgramCount: batchIds.length,
      notesApplied,
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
