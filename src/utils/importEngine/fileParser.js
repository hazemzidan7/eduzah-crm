import * as XLSX from "xlsx";
import { isRowEmpty } from "./dataCleaning";

const BOM_CHAR_CODE = 65279; // U+FEFF, byte-order mark some Excel/CSV exports prepend to the first cell

/** Trim a header string and strip a leading BOM, if present. */
export function cleanHeaderText(h) {
  let s = String(h ?? "");
  if (s.charCodeAt(0) === BOM_CHAR_CODE) s = s.slice(1);
  return s.trim();
}

// Explicit date/timestamp shapes only — Date.parse() is far too lenient for
// this (e.g. Date.parse("Column 1") returns a valid timestamp in V8), which
// would misclassify an ordinary header label as a data value.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;
const SLASH_DATE_RE = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/;

function looksNumericOrDate(s) {
  return /^\d+(\.\d+)?$/.test(s) || ISO_DATE_RE.test(s) || SLASH_DATE_RE.test(s);
}

/** A row only qualifies as a real header if most of its non-empty cells read
 * as labels (short text, not numbers/dates) AND its own first cell isn't a
 * data value itself — some real exports (e.g. a raw Google Form response
 * dump) have NO header row at all, with the first column being a timestamp
 * from row 1 onward. Scoring every row as "some header" regardless would
 * silently swallow that sheet's first real record as if it were a label row. */
function rowHeaderQuality(row) {
  const nonEmpty = row.filter((c) => String(c ?? "").trim() !== "");
  if (nonEmpty.length === 0) return { qualifies: false, score: 0 };
  let labelLike = 0;
  for (const cell of nonEmpty) {
    const s = String(cell).trim();
    if (!looksNumericOrDate(s) && s.length <= 60) labelLike += 1;
  }
  const firstCell = String(row[0] ?? "").trim();
  const firstCellIsData = firstCell !== "" && looksNumericOrDate(firstCell);
  const labelRatio = labelLike / nonEmpty.length;
  return { qualifies: labelRatio >= 0.6 && !firstCellIsData, score: labelLike };
}

/**
 * Scans the first 5 rows for a qualifying header row. Returns
 * `{ headerRowIndex: number|null, headers }` — null means no row in the file
 * looks like a real header, so every row (including row 0) is data, and the
 * caller should fall back to positional column names instead of consuming
 * a real record as if it were labels.
 */
export function detectHeader(rawRows) {
  const scanLimit = Math.min(5, rawRows.length);
  let bestIdx = null;
  let bestScore = -1;
  for (let i = 0; i < scanLimit; i++) {
    const { qualifies, score } = rowHeaderQuality(rawRows[i] || []);
    if (qualifies && score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

export async function readFileAsWorkbook(file) {
  const isCsv = /\.csv$/i.test(file.name);
  if (isCsv) {
    const text = await file.text();
    return XLSX.read(text, { type: "string" });
  }
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: "array" });
}

/**
 * Parses an uploaded .xlsx/.xls/.csv File into a normalized structure:
 * { fileName, sheets: [{ name, headerRowIndex, headers, rows }] }
 * `rows` are plain objects keyed by detected header, fully-blank rows dropped.
 */
export async function parseWorkbookFile(file) {
  const wb = await readFileAsWorkbook(file);
  const sheets = wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
    if (rawRows.length === 0) return { name, headerRowIndex: null, headers: [], rows: [] };

    const headerRowIndex = detectHeader(rawRows);
    const hasHeader = headerRowIndex !== null;
    const headers = hasHeader
      ? (rawRows[headerRowIndex] || []).map(cleanHeaderText)
      : Array.from({ length: Math.max(...rawRows.map((r) => r.length)) }, (_, i) => `Column ${i + 1}`);

    const rows = [];
    const firstDataRow = hasHeader ? headerRowIndex + 1 : 0;
    for (let r = firstDataRow; r < rawRows.length; r++) {
      const raw = rawRows[r] || [];
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = raw[i] ?? ""; });
      if (!isRowEmpty(obj)) rows.push(obj);
    }
    return { name, headerRowIndex, headers: headers.filter(Boolean), rows };
  });

  return { fileName: file.name, sheets };
}

/**
 * LEAD-IMPORT-01 — same detection/cleaning as parseWorkbookFile above (it
 * reuses detectHeader/cleanHeaderText/readFileAsWorkbook — nothing duplicated),
 * but keeps each data row's REAL spreadsheet row number, which
 * parseWorkbookFile can't: it drops blank rows before indexing, so its
 * positions no longer line up with what a person sees in Excel. Needed so a
 * preview can say "Row 12 — phone is empty" and mean Excel row 12.
 *
 * Returns { fileName, sheets: [{ name, hasHeader, headers, rows, rowNumbers }] }
 * where rowNumbers[i] is the 1-based sheet row of rows[i]. A sheet with no
 * header row (e.g. just a column of phone numbers) gets positional
 * "Column N" headers and its first row is treated as data, exactly like
 * parseWorkbookFile. Existing parseWorkbookFile behavior is unchanged.
 */
export async function parseWorkbookFileWithRowNumbers(file) {
  const wb = await readFileAsWorkbook(file);
  const sheets = wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    const ref = sheet && sheet["!ref"];
    // sheet_to_json(header:1) is relative to the sheet's own first row (usually row 1).
    const firstSheetRow = ref ? XLSX.utils.decode_range(ref).s.r : 0;
    const all = ref ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: true }) : [];

    // Non-blank rows only, remembering where each one really sits.
    const kept = [];
    all.forEach((cells, i) => {
      const row = cells || [];
      if (row.some((c) => String(c ?? "").trim() !== "")) kept.push({ cells: row, sheetRow: firstSheetRow + i + 1 });
    });
    if (kept.length === 0) return { name, hasHeader: false, headers: [], rows: [], rowNumbers: [] };

    const headerIdx = detectHeader(kept.map((k) => k.cells));
    const hasHeader = headerIdx !== null;
    const width = Math.max(...kept.map((k) => k.cells.length));
    const headers = hasHeader
      ? (kept[headerIdx].cells || []).map(cleanHeaderText)
      : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);

    const rows = [];
    const rowNumbers = [];
    for (let r = hasHeader ? headerIdx + 1 : 0; r < kept.length; r++) {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = kept[r].cells[i] ?? ""; });
      if (!isRowEmpty(obj)) { rows.push(obj); rowNumbers.push(kept[r].sheetRow); }
    }
    return { name, hasHeader, headers: headers.filter(Boolean), rows, rowNumbers };
  });
  return { fileName: file.name, sheets };
}
