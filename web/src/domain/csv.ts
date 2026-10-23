/**
 * Strict, atomic validation of one synthetic invoice CSV batch — parity with Python
 * `src/preflight/imports.py` `validate_bytes` (precedence, issue codes, rows and fields).
 *
 * The CSV tokenizer is a hand-written state machine mirroring CPython 3.12
 * `csv.reader(io.StringIO(text, newline=""), strict=True)` with the excel dialect.
 * Behaviours confirmed by running CPython 3.12.10:
 * - input is split into lines after `\n`, `\r\n` or a lone `\r` (no other separators);
 * - a blank line yields an empty record `[]`; `,` alone yields `["", ""]`;
 * - a quote inside an unquoted field is literal text (`a"b` -> `a"b`, ` "a"` -> ` "a"`);
 * - NUL is ordinary data, quoted or unquoted;
 * - quoted fields keep delimiters and line breaks verbatim (CRLF preserved);
 * - strict errors: any char other than delimiter/quote/line end after a closing quote
 *   ("',' expected after '\"'"), EOF inside a quoted field ("unexpected end of data"), and a field
 *   longer than 131072 stored code points ("field larger than field limit (131072)").
 * Pure and synchronous: no DOM, Node or storage APIs.
 */
import type { CsvField, Invoice, IssueCode, ParseInvoiceCsv, ValidationIssue, ValidationResult } from "./contracts.ts";
import {
  AMOUNT_FIELDS,
  CSV_FIELD_LIMIT,
  CSV_HEADER,
  MAX_BYTES,
  MAX_LISTED_ISSUES,
  MAX_ROWS,
  asciiTrim,
  normalizeIdentifier,
} from "./contracts.ts";
import { AmountError, parseCents } from "./money.ts";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const INVOICE_NUMBER_PATTERN = /^[A-Za-z0-9_\-/.]{1,64}$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// ---------------------------------------------------------------------------
// Issue collection
// ---------------------------------------------------------------------------

class Issues {
  readonly items: ValidationIssue[] = [];
  count = 0;
  add(row: number | null, field: CsvField | null, code: IssueCode, message: string): void {
    this.count++;
    if (this.items.length < MAX_LISTED_ISSUES) this.items.push({ row, field, code, message });
  }
}

function reject(issues: Issues): ValidationResult {
  return { ok: false, invoices: [], issues: issues.items.slice(), issueCount: issues.count };
}

// ---------------------------------------------------------------------------
// CPython csv.reader(strict=True) mirror
// ---------------------------------------------------------------------------

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

const START_RECORD = 0;
const START_FIELD = 1;
const IN_FIELD = 2;
const IN_QUOTED_FIELD = 3;
const QUOTE_IN_QUOTED_FIELD = 4;
const EAT_CRNL = 5;

const CR = 0x0d;
const LF = 0x0a;
const COMMA = 0x2c;
const QUOTE = 0x22;
/** Pseudo-character marking the end of a physical line (CPython `EOL`). */
const EOL = -1;

/**
 * Parse decoded text exactly as CPython `csv.reader(io.StringIO(text, newline=""), strict=True)`.
 * Throws {@link CsvError} with CPython's message on the first strict error.
 */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let field: string[] = [];
  let fieldLen = 0; // stored code points
  let state = START_RECORD;

  const saveField = (): void => {
    fields.push(field.join(""));
    field = [];
    fieldLen = 0;
  };
  const addChar = (ch: string): void => {
    if (fieldLen >= CSV_FIELD_LIMIT) throw new CsvError(`field larger than field limit (${CSV_FIELD_LIMIT})`);
    field.push(ch);
    fieldLen++;
  };

  const process = (c: number, ch: string): void => {
    if (state === START_RECORD) {
      if (c === EOL) return; // empty line -> []
      if (c === LF || c === CR) {
        state = EAT_CRNL;
        return;
      }
      state = START_FIELD; // normal character: handle as START_FIELD (CPython fall-through)
    }
    switch (state) {
      case START_FIELD:
        if (c === LF || c === CR || c === EOL) {
          saveField();
          state = c === EOL ? START_RECORD : EAT_CRNL;
        } else if (c === QUOTE) {
          state = IN_QUOTED_FIELD;
        } else if (c === COMMA) {
          saveField();
        } else {
          addChar(ch);
          state = IN_FIELD;
        }
        return;
      case IN_FIELD:
        if (c === LF || c === CR || c === EOL) {
          saveField();
          state = c === EOL ? START_RECORD : EAT_CRNL;
        } else if (c === COMMA) {
          saveField();
          state = START_FIELD;
        } else {
          addChar(ch);
        }
        return;
      case IN_QUOTED_FIELD:
        if (c === EOL) return; // line continuation; the line-break chars were already stored
        if (c === QUOTE) state = QUOTE_IN_QUOTED_FIELD;
        else addChar(ch);
        return;
      case QUOTE_IN_QUOTED_FIELD:
        if (c === QUOTE) {
          addChar(ch);
          state = IN_QUOTED_FIELD;
        } else if (c === COMMA) {
          saveField();
          state = START_FIELD;
        } else if (c === LF || c === CR || c === EOL) {
          saveField();
          state = c === EOL ? START_RECORD : EAT_CRNL;
        } else {
          throw new CsvError(`',' expected after '"'`);
        }
        return;
      case EAT_CRNL:
        if (c === LF || c === CR) return;
        if (c === EOL) {
          state = START_RECORD;
          return;
        }
        throw new CsvError("new-line character seen in unquoted field - do you need to open the file with newline=''?");
    }
  };

  // Iterate physical lines as io.StringIO(newline="") does: a line ends after "\n", "\r\n" or lone "\r".
  const n = text.length;
  let pos = 0;
  while (pos < n) {
    // One CPython reader `next()` may consume several lines (quoted line breaks).
    do {
      if (pos >= n) {
        // CPython: EOF with a pending field or inside quotes is a strict error; otherwise stop.
        if (fieldLen !== 0 || state === IN_QUOTED_FIELD) throw new CsvError("unexpected end of data");
        return records;
      }
      while (pos < n) {
        const code = text.charCodeAt(pos);
        let ch: string;
        if (code >= 0xd800 && code <= 0xdbff && pos + 1 < n) {
          const next = text.charCodeAt(pos + 1);
          ch = next >= 0xdc00 && next <= 0xdfff ? text.slice(pos, pos + 2) : text[pos]!;
        } else {
          ch = text[pos]!;
        }
        pos += ch.length;
        process(code, ch);
        if (code === LF) break;
        if (code === CR) {
          if (pos < n && text.charCodeAt(pos) === LF) {
            pos++;
            process(LF, "\n");
          }
          break;
        }
      }
      process(EOL, "");
    } while (state !== START_RECORD);
    records.push(fields);
    fields = [];
  }
  return records;
}

// ---------------------------------------------------------------------------
// Python repr() of str (for HEADER_MISMATCH message parity)
// ---------------------------------------------------------------------------

const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** Python `repr(str)` for message text. */
export function pyRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === quote || ch === "\\") out += "\\" + ch;
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (cp === 0x20) out += ch;
    else if (cp < 0x20 || cp === 0x7f) out += "\\x" + cp.toString(16).padStart(2, "0");
    else if (cp > 0x7f && NON_PRINTABLE.test(ch)) {
      if (cp <= 0xff) out += "\\x" + cp.toString(16).padStart(2, "0");
      else if (cp <= 0xffff) out += "\\u" + cp.toString(16).padStart(4, "0");
      else out += "\\U" + cp.toString(16).padStart(8, "0");
    } else out += ch;
  }
  return out + quote;
}

// ---------------------------------------------------------------------------
// Header and row validation (imports.py `_check_header`, `_identifier`, `_row`)
// ---------------------------------------------------------------------------

const HEADER_SET: ReadonlySet<string> = new Set(CSV_HEADER);

function checkHeader(header: readonly string[], issues: Issues): void {
  if (header.length === CSV_HEADER.length && header.every((h, i) => h === CSV_HEADER[i])) return;
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const name of header) {
    if (seen.has(name)) problems.push(`duplicate column ${pyRepr(name)}`);
    seen.add(name);
  }
  const missing = CSV_HEADER.filter((h) => !seen.has(h));
  const extra = header.filter((h) => !HEADER_SET.has(h));
  if (missing.length) problems.push("missing " + missing.join(", "));
  if (extra.length) problems.push("unexpected " + extra.map(pyRepr).join(", "));
  if (!problems.length) problems.push("columns are out of order");
  issues.add(null, null, "HEADER_MISMATCH",
    "Header must be exactly: " + CSV_HEADER.join(",") + " (" + problems.join("; ") + ")");
}

function identifier(
  value: string, row: number, field: CsvField, pattern: RegExp, code: IssueCode, issues: Issues,
): string | null {
  const trimmed = asciiTrim(value);
  if (trimmed === "") {
    issues.add(row, field, "FIELD_REQUIRED", `${field} is required`);
    return null;
  }
  if (!pattern.test(trimmed)) {
    const allowed = pattern === ID_PATTERN ? "letters, digits, '-', '_'" : "letters, digits, '-', '_', '/', '.'";
    issues.add(row, field, code, `${field} must be 1-64 ASCII ${allowed}`);
    return null;
  }
  return trimmed;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** `datetime.date.fromisoformat` acceptance for a string already matching DATE_PATTERN. */
function isRealDate(text: string): boolean {
  const year = Number.parseInt(text.slice(0, 4), 10);
  const month = Number.parseInt(text.slice(5, 7), 10);
  const day = Number.parseInt(text.slice(8, 10), 10);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const dim = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= dim;
}

const AMOUNT_FORMAT_MESSAGE = "must be a nonnegative amount like 1234.56 (two decimals, no sign, "
  + "symbol, separator or spaces; max 999999999.99)";

function validateRow(cells: readonly string[], row: number, issues: Issues): Invoice | null {
  const start = issues.count;
  const v = (name: CsvField): string => cells[CSV_HEADER.indexOf(name)]!;

  const recordId = identifier(v("record_id"), row, "record_id", ID_PATTERN, "ID_FORMAT", issues);
  const vendor = identifier(v("vendor_id"), row, "vendor_id", ID_PATTERN, "ID_FORMAT", issues);
  const number = identifier(v("invoice_number"), row, "invoice_number", INVOICE_NUMBER_PATTERN,
    "INVOICE_NUMBER_FORMAT", issues);

  const dateText = v("invoice_date");
  if (dateText === "") {
    issues.add(row, "invoice_date", "FIELD_REQUIRED", "invoice_date is required");
  } else if (!DATE_PATTERN.test(dateText)) {
    issues.add(row, "invoice_date", "DATE_FORMAT", "invoice_date must be YYYY-MM-DD");
  } else if (!isRealDate(dateText)) {
    issues.add(row, "invoice_date", "DATE_INVALID", `${dateText} is not a real calendar date`);
  }

  const currency = asciiTrim(v("currency"));
  if (currency === "") {
    issues.add(row, "currency", "FIELD_REQUIRED", "currency is required");
  } else if (normalizeIdentifier(currency) !== "USD") {
    issues.add(row, "currency", "CURRENCY_UNSUPPORTED", "Only USD is supported in Stage 1");
  }

  const cents: Partial<Record<(typeof AMOUNT_FIELDS)[number], number>> = {};
  for (const name of AMOUNT_FIELDS) {
    const text = v(name);
    if (text === "") {
      issues.add(row, name, "AMOUNT_REQUIRED", `${name} is required`);
      continue;
    }
    try {
      cents[name] = parseCents(text);
    } catch (err) {
      if (!(err instanceof AmountError)) throw err;
      issues.add(row, name, "AMOUNT_FORMAT", `${name} ${AMOUNT_FORMAT_MESSAGE}`);
    }
  }

  const { subtotal, tax, shipping, discount, total } = cents;
  if (subtotal !== undefined && tax !== undefined && shipping !== undefined && discount !== undefined) {
    if (discount > subtotal + tax + shipping) {
      issues.add(row, "discount", "DISCOUNT_EXCEEDS_CHARGES", "discount must not exceed subtotal + tax + shipping");
    }
  }

  if (issues.count !== start) return null;
  return {
    recordId: recordId!,
    rowNumber: row,
    raw: cells.slice(),
    vendorNorm: normalizeIdentifier(vendor!),
    invoiceNorm: normalizeIdentifier(number!),
    invoiceDate: dateText,
    currency: "USD",
    subtotal: subtotal!,
    tax: tax!,
    shipping: shipping!,
    discount: discount!,
    total: total!,
  };
}

// ---------------------------------------------------------------------------
// validate_bytes
// ---------------------------------------------------------------------------

/** Validate one uploaded CSV file (original bytes). Pure and synchronous. */
export const parseInvoiceCsv: ParseInvoiceCsv = (bytes: Uint8Array): ValidationResult => {
  const issues = new Issues();

  if (bytes.length === 0) {
    issues.add(null, null, "EMPTY_FILE", "The file is empty");
    return reject(issues);
  }
  if (bytes.length > MAX_BYTES) {
    issues.add(null, null, "FILE_TOO_LARGE", `The file exceeds ${MAX_BYTES} bytes (1 MiB)`);
    return reject(issues);
  }

  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hasBom ? bytes.subarray(3) : bytes;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    issues.add(null, null, "ENCODING", "The file is not valid UTF-8");
    return reject(issues);
  }

  let rows: string[][];
  try {
    rows = parseCsvRecords(text);
  } catch (err) {
    if (!(err instanceof CsvError)) throw err;
    issues.add(null, null, "MALFORMED_CSV", `CSV could not be parsed: ${err.message}`);
    return reject(issues);
  }

  if (rows.length === 0) {
    issues.add(null, null, "NO_DATA_ROWS", "The file has no header or data rows");
    return reject(issues);
  }
  checkHeader(rows[0]!, issues);
  if (issues.count) return reject(issues);

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    issues.add(null, null, "NO_DATA_ROWS", "The file has a header but no invoice rows");
    return reject(issues);
  }
  if (dataRows.length > MAX_ROWS) {
    issues.add(null, null, "TOO_MANY_ROWS", `${dataRows.length} rows; at most ${MAX_ROWS} allowed per batch`);
    return reject(issues);
  }

  const invoices: Invoice[] = [];
  const firstSeen = new Map<string, number>();
  for (let i = 0; i < dataRows.length; i++) {
    const index = i + 1;
    const cells = dataRows[i]!;
    // Register the source key first so duplicates are reported even next to malformed rows.
    const recordId = cells.length ? asciiTrim(cells[0]!) : ""; // case-sensitive
    let duplicateOf: number | undefined;
    if (recordId && ID_PATTERN.test(recordId)) {
      duplicateOf = firstSeen.get(recordId);
      if (duplicateOf === undefined) firstSeen.set(recordId, index);
    }
    if (cells.length === 0) {
      issues.add(index, null, "ROW_SHAPE", "Row is a blank line; remove blank lines (including at the end of the file)");
      continue;
    }
    if (cells.length !== CSV_HEADER.length) {
      issues.add(index, null, "ROW_SHAPE", `Row has ${cells.length} cells; expected ${CSV_HEADER.length}`);
      continue;
    }
    const invoice = validateRow(cells, index, issues);
    if (duplicateOf !== undefined) {
      issues.add(index, "record_id", "DUPLICATE_RECORD_ID",
        `record_id ${pyRepr(recordId)} already used on row ${duplicateOf}`);
      continue;
    }
    if (invoice !== null) invoices.push(invoice);
  }

  if (issues.count) return reject(issues);
  return { ok: true, invoices, issues: [], issueCount: 0 };
};
