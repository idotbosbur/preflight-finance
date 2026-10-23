/**
 * Parser tests. Expected values were observed by running the Python reference
 * (src/preflight/imports.py validate_bytes and CPython 3.12.10 csv.reader(strict=True)).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ValidationResult } from "../../src/domain/contracts.ts";
import { CSV_HEADER } from "../../src/domain/contracts.ts";
import { parseCsvRecords, parseInvoiceCsv, pyRepr } from "../../src/domain/csv.ts";

const H = CSV_HEADER.join(",");
const enc = new TextEncoder();

interface RowOpts {
  rid?: string; v?: string; inv?: string; d?: string; cur?: string;
  s?: string; t?: string; sh?: string; dc?: string; tot?: string;
}
function row(o: RowOpts = {}): string {
  return [
    o.rid ?? "R-1", o.v ?? "V-1", o.inv ?? "INV-1", o.d ?? "2026-01-15", o.cur ?? "USD",
    o.s ?? "100.00", o.t ?? "8.25", o.sh ?? "5.00", o.dc ?? "3.00", o.tot ?? "110.25",
  ].join(",");
}
function doc(rows: string[], nl = "\n", end = true): Uint8Array {
  return enc.encode([H, ...rows].join(nl) + (end ? nl : ""));
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
const codes = (r: ValidationResult) => r.issues.map((i) => i.code);
const triples = (r: ValidationResult) => r.issues.map((i) => [i.row, i.field, i.code]);

function only(r: ValidationResult, code: string, message?: string): void {
  assert.equal(r.ok, false);
  assert.equal(r.invoices.length, 0);
  assert.equal(r.issueCount, 1);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0]!.code, code);
  assert.equal(r.issues[0]!.row, null);
  if (message !== undefined) assert.equal(r.issues[0]!.message, message);
}

// ---------------------------------------------------------------------------
// CPython csv.reader(strict=True) parity (observed with CPython 3.12.10)
// ---------------------------------------------------------------------------

test("csv records: line endings, blank lines, quoting, NUL (CPython-observed)", () => {
  const cases: Array<[string, string[][]]> = [
    ['a"b,c\n', [['a"b', "c"]]],
    ['a""b,c\n', [['a""b', "c"]]],
    [' "a",b\n', [[' "a"', "b"]]],
    ['ab",c\n', [['ab"', "c"]]],
    ["a\x00b,c\n", [["a\x00b", "c"]]],
    ['"a\x00b",c\n', [["a\x00b", "c"]]],
    ["a,b\rc,d\r", [["a", "b"], ["c", "d"]]],
    ["a,b\r\nc,d\r\n", [["a", "b"], ["c", "d"]]],
    ["a,b\nc,d", [["a", "b"], ["c", "d"]]],
    ["a\n\n\r\n\rb\n", [["a"], [], [], [], ["b"]]],
    ["a\n\n", [["a"], []]],
    ['"x\r\ny",z\r\n', [["x\r\ny", "z"]]],
    ['"x\ry",z\r', [["x\ry", "z"]]],
    ['a,"b"', [["a", "b"]]],
    ['"",a\n', [["", "a"]]],
    ['"a""b",c\n', [['a"b', "c"]]],
    ["a\r\r\nb\n", [["a"], [], ["b"]]],
    ["\n", [[]]],
    [",\n", [["", ""]]],
    ["a\u2028b,c\x85d\x0ce\n", [["a\u2028b", "c\x85d\x0ce"]]],
    ['a\r"b"\n', [["a"], ["b"]]],
    ["", []],
  ];
  for (const [text, want] of cases) assert.deepEqual(parseCsvRecords(text), want, JSON.stringify(text));
});

test("csv strict errors carry CPython messages", () => {
  assert.throws(() => parseCsvRecords('"a"b,c\n'), { message: `',' expected after '"'` });
  assert.throws(() => parseCsvRecords('"a" ,c\n'), { message: `',' expected after '"'` });
  assert.throws(() => parseCsvRecords('a,"b\n'), { message: "unexpected end of data" });
  assert.throws(() => parseCsvRecords('a,"'), { message: "unexpected end of data" });
});

test("csv field limit is 131072 stored code points", () => {
  const lim = 131_072;
  assert.equal(parseCsvRecords("x".repeat(lim) + "\n")[0]![0]!.length, lim);
  assert.equal(parseCsvRecords('"' + "x".repeat(lim) + '"\n')[0]![0]!.length, lim);
  assert.throws(() => parseCsvRecords("x".repeat(lim + 1) + "\n"), { message: "field larger than field limit (131072)" });
  assert.throws(() => parseCsvRecords('"' + "x".repeat(lim + 1) + '"\n'), { message: "field larger than field limit (131072)" });
  // Astral characters count once (Python code points), not twice (UTF-16).
  assert.equal(parseCsvRecords("\u{1F600}".repeat(lim) + "\n")[0]![0]!.length, lim * 2);
  assert.throws(() => parseCsvRecords("\u{1F600}".repeat(lim) + "x\n"), { message: "field larger than field limit (131072)" });
  // Doubled quotes count as one stored character.
  assert.equal(parseCsvRecords('"' + '""'.repeat(lim) + '"\n')[0]![0]!.length, lim);
});

// ---------------------------------------------------------------------------
// File-level precedence
// ---------------------------------------------------------------------------

test("empty file and size limit", () => {
  only(parseInvoiceCsv(new Uint8Array(0)), "EMPTY_FILE", "The file is empty");
  only(parseInvoiceCsv(new Uint8Array(1_048_577).fill(0x78)), "FILE_TOO_LARGE", "The file exceeds 1048576 bytes (1 MiB)");
  // Exactly 1 MiB passes the size check and fails later (one 1 MiB field exceeds the CSV field limit).
  only(parseInvoiceCsv(new Uint8Array(1_048_576).fill(0x78)), "MALFORMED_CSV",
    "CSV could not be parsed: field larger than field limit (131072)");
  // Size check precedes encoding.
  only(parseInvoiceCsv(new Uint8Array(1_048_577).fill(0xff)), "FILE_TOO_LARGE");
});

test("encoding errors (code parity)", () => {
  only(parseInvoiceCsv(concat(enc.encode(H + "\n"), new Uint8Array([0xff, 0x0a]))), "ENCODING");
  only(parseInvoiceCsv(new Uint8Array([0xed, 0xa0, 0x80])), "ENCODING"); // encoded surrogate
  only(parseInvoiceCsv(new Uint8Array([0xc0, 0xaf])), "ENCODING"); // overlong
});

test("exactly one BOM is stripped; a double BOM is a header mismatch", () => {
  const one = parseInvoiceCsv(concat(BOM, doc([row()])));
  assert.equal(one.ok, true);
  assert.equal(one.invoices[0]!.recordId, "R-1");
  only(parseInvoiceCsv(concat(BOM, BOM, doc([row()]))), "HEADER_MISMATCH",
    "Header must be exactly: " + H + " (missing record_id; unexpected '\\ufeffrecord_id')");
  only(parseInvoiceCsv(BOM), "NO_DATA_ROWS", "The file has no header or data rows");
});

test("LF, CRLF, CR-only and no trailing newline all parse identically", () => {
  for (const r of [doc([row()]), doc([row()], "\r\n"), doc([row()], "\r"), doc([row()], "\n", false)]) {
    const res = parseInvoiceCsv(r);
    assert.equal(res.ok, true);
    assert.equal(res.invoices.length, 1);
    assert.deepEqual(res.invoices[0]!.raw, row().split(","));
  }
});

test("quoted fields keep CRLF and commas in raw cells", () => {
  const res = parseInvoiceCsv(doc([row({ v: '"V-1"', inv: '"INV,1"' })]));
  assert.equal(res.ok, false); // INV,1 is not a valid invoice number
  const crlf = parseInvoiceCsv(doc([row({ v: '"V-\r\n1"' })]));
  assert.deepEqual(triples(crlf), [[1, "vendor_id", "ID_FORMAT"]]);
  const quoted = parseInvoiceCsv(doc([row({ v: '"V-1"', inv: '"INV/1.a"' })]));
  assert.equal(quoted.ok, true);
  assert.equal(quoted.invoices[0]!.raw[1], "V-1");
  assert.equal(quoted.invoices[0]!.raw[2], "INV/1.a");
  // Raw cell preserves an embedded CRLF exactly when a field may contain it (here: padded currency).
  const cur = parseInvoiceCsv(doc([row({ cur: '"USD\r\n"' })]));
  assert.equal(cur.ok, true);
  assert.equal(cur.invoices[0]!.raw[4], "USD\r\n");
});

test("MALFORMED_CSV is reported before header and row-count checks", () => {
  only(parseInvoiceCsv(enc.encode('record_id,vendor\na,"b\n')), "MALFORMED_CSV", "CSV could not be parsed: unexpected end of data");
  only(parseInvoiceCsv(doc([row({ v: '"V-1' })], "\n", false)), "MALFORMED_CSV", "CSV could not be parsed: unexpected end of data");
  only(parseInvoiceCsv(doc([row({ v: '"V-1"x' })])), "MALFORMED_CSV", `CSV could not be parsed: ',' expected after '"'`);
  only(parseInvoiceCsv(doc([row({ v: "V".repeat(131_073) })])), "MALFORMED_CSV",
    "CSV could not be parsed: field larger than field limit (131072)");
  const rows1001 = Array.from({ length: 1001 }, (_, i) => row({ rid: `R-${i}` }));
  only(parseInvoiceCsv(concat(doc(rows1001), enc.encode('"x'))), "MALFORMED_CSV");
  // A field exactly at the limit parses (and then fails field validation).
  assert.deepEqual(codes(parseInvoiceCsv(doc([row({ v: "V".repeat(131_072) })]))), ["ID_FORMAT"]);
});

test("bare quote and NUL inside unquoted fields are data, not CSV errors", () => {
  assert.deepEqual(triples(parseInvoiceCsv(doc([row({ v: 'V"1' })]))), [[1, "vendor_id", "ID_FORMAT"]]);
  assert.deepEqual(triples(parseInvoiceCsv(doc([row({ v: "V\x001" })]))), [[1, "vendor_id", "ID_FORMAT"]]);
});

test("header checks", () => {
  only(parseInvoiceCsv(enc.encode(H.replace(/,total$/, ",totl") + "\n" + row() + "\n")), "HEADER_MISMATCH",
    "Header must be exactly: " + H + " (missing total; unexpected 'totl')");
  only(parseInvoiceCsv(enc.encode(H + ",total\n" + row() + "\n")), "HEADER_MISMATCH",
    "Header must be exactly: " + H + " (duplicate column 'total')");
  const swapped = ["vendor_id", "record_id", ...CSV_HEADER.slice(2)].join(",");
  only(parseInvoiceCsv(enc.encode(swapped + "\n" + row() + "\n")), "HEADER_MISMATCH",
    "Header must be exactly: " + H + " (columns are out of order)");
  only(parseInvoiceCsv(enc.encode(H + ",'x\",\"\u00e9\u00a0\x7f\t\"\n" + row() + "\n")), "HEADER_MISMATCH",
    "Header must be exactly: " + H + " (unexpected '\\'x\"', '\u00e9\\xa0\\x7f\\t')");
  only(parseInvoiceCsv(enc.encode("\n" + row() + "\n")), "HEADER_MISMATCH");
  only(parseInvoiceCsv(enc.encode(" " + H + "\n" + row() + "\n")), "HEADER_MISMATCH");
});

test("pyRepr matches Python repr for message text", () => {
  assert.equal(pyRepr("abc"), "'abc'");
  assert.equal(pyRepr("it's"), `"it's"`);
  assert.equal(pyRepr(`'"`), `'\\'"'`);
  assert.equal(pyRepr("\ufeffx"), "'\\ufeffx'");
  assert.equal(pyRepr("a\\b"), "'a\\\\b'");
  assert.equal(pyRepr("\u00e9\u00a0\x7f\t\n\r\x00"), "'\u00e9\\xa0\\x7f\\t\\n\\r\\x00'");
});

test("no data rows and row limits", () => {
  only(parseInvoiceCsv(doc([])), "NO_DATA_ROWS", "The file has a header but no invoice rows");
  only(parseInvoiceCsv(enc.encode(H)), "NO_DATA_ROWS", "The file has a header but no invoice rows");
  const rows = (n: number) => Array.from({ length: n }, (_, i) => row({ rid: `R-${i}`, inv: `INV-${i}` }));
  const ok = parseInvoiceCsv(doc(rows(1000)));
  assert.equal(ok.ok, true);
  assert.equal(ok.invoices.length, 1000);
  assert.equal(ok.invoices[999]!.rowNumber, 1000);
  only(parseInvoiceCsv(doc(rows(1001))), "TOO_MANY_ROWS", "1001 rows; at most 1000 allowed per batch");
});

// ---------------------------------------------------------------------------
// Row-level validation
// ---------------------------------------------------------------------------

test("blank lines and wrong cell counts are ROW_SHAPE", () => {
  const blank = parseInvoiceCsv(concat(doc([row()]), enc.encode("\n")));
  assert.deepEqual(blank.issues, [{ row: 2, field: null, code: "ROW_SHAPE",
    message: "Row is a blank line; remove blank lines (including at the end of the file)" }]);
  const mid = parseInvoiceCsv(doc([row(), "", row({ rid: "R-2" })]));
  assert.deepEqual(triples(mid), [[2, null, "ROW_SHAPE"]]);
  const shape = parseInvoiceCsv(doc([row() + ",extra", "a,b", row({ rid: "R-3" })]));
  assert.deepEqual(shape.issues.map((i) => [i.row, i.message]), [
    [1, "Row has 11 cells; expected 10"],
    [2, "Row has 2 cells; expected 10"],
  ]);
  // Row numbers count CSV records, not physical lines.
  const quotedNl = parseInvoiceCsv(doc([row({ v: '"V\n1"' }), row({ rid: "R-2", s: "x" })]));
  assert.deepEqual(triples(quotedNl), [[1, "vendor_id", "ID_FORMAT"], [2, "subtotal", "AMOUNT_FORMAT"]]);
});

test("every field code (expected issues observed from the Python reference)", () => {
  const rows = [
    row({ rid: "" }), row({ rid: "  ", v: "V 1" }), row({ rid: "R@3", inv: "INV#1" }), row({ rid: "R-4", inv: " " }),
    row({ rid: "R-5", d: "" }), row({ rid: "R-6", d: " 2026-01-15" }), row({ rid: "R-7", d: "2026-02-30" }),
    row({ rid: "R-8", d: "0000-01-01" }), row({ rid: "R-9", d: "2024-02-29" }), row({ rid: "R-10", d: "1900-02-29" }),
    row({ rid: "R-11", d: "2000-02-29" }), row({ rid: "R-12", d: "2026-13-01" }), row({ rid: "R-13", d: "2026-1-15" }),
    row({ rid: "R-14", d: "２０２６-01-15" }), row({ rid: "R-15", cur: "" }), row({ rid: "R-16", cur: " usd " }),
    row({ rid: "R-17", cur: "EUR" }), row({ rid: "R-18", cur: "US D" }), row({ rid: "R-19", s: "" }),
    row({ rid: "R-20", s: "-0.00" }), row({ rid: "R-21", s: "+1.00" }), row({ rid: "R-22", s: " 1.00" }),
    row({ rid: "R-23", s: "1.0" }), row({ rid: "R-24", s: "1,000.00" }), row({ rid: "R-25", s: "١.٠٠" }),
    row({ rid: "R-26", s: "1000000000.00" }), row({ rid: "R-27", s: "999999999.99", tot: "1000000013.24" }),
    row({ rid: "R-28", dc: "200.00" }), row({ rid: "R-29", dc: "113.25", tot: "0.00" }), row({ rid: "R-30", dc: "113.26" }),
    row({ rid: "R-31", s: "", dc: "999.00" }),
    row({ rid: "R-32", v: "", inv: "", d: "", cur: "", s: "", t: "", sh: "", dc: "", tot: "" }),
    row({ rid: "R-33", s: "$1.00" }), row({ rid: "R-34", s: "1.00\n" }), row({ rid: "r-34" }), row({ rid: "\u00a0R-35" }),
    row({ rid: "R-36", v: "v".repeat(65) }), row({ rid: "R-37", inv: "a/b.c_d-e" }), row({ rid: "\x0bR-38\x0c" }),
  ];
  const r = parseInvoiceCsv(doc(rows));
  assert.equal(r.ok, false);
  assert.equal(r.invoices.length, 0);
  assert.equal(r.issueCount, 43);
  assert.deepEqual(triples(r), [
    [1, "record_id", "FIELD_REQUIRED"], [2, "record_id", "FIELD_REQUIRED"], [2, "vendor_id", "ID_FORMAT"],
    [3, "record_id", "ID_FORMAT"], [3, "invoice_number", "INVOICE_NUMBER_FORMAT"], [4, "invoice_number", "FIELD_REQUIRED"],
    [5, "invoice_date", "FIELD_REQUIRED"], [6, "invoice_date", "DATE_FORMAT"], [7, "invoice_date", "DATE_INVALID"],
    [8, "invoice_date", "DATE_INVALID"], [10, "invoice_date", "DATE_INVALID"], [12, "invoice_date", "DATE_INVALID"],
    [13, "invoice_date", "DATE_FORMAT"], [14, "invoice_date", "DATE_FORMAT"], [15, "currency", "FIELD_REQUIRED"],
    [17, "currency", "CURRENCY_UNSUPPORTED"], [18, "currency", "CURRENCY_UNSUPPORTED"], [19, "subtotal", "AMOUNT_REQUIRED"],
    [20, "subtotal", "AMOUNT_FORMAT"], [21, "subtotal", "AMOUNT_FORMAT"], [22, "subtotal", "AMOUNT_FORMAT"],
    [23, "subtotal", "AMOUNT_FORMAT"], [24, null, "ROW_SHAPE"], [25, "subtotal", "AMOUNT_FORMAT"],
    [26, "subtotal", "AMOUNT_FORMAT"], [27, "total", "AMOUNT_FORMAT"], [28, "discount", "DISCOUNT_EXCEEDS_CHARGES"],
    [30, "discount", "DISCOUNT_EXCEEDS_CHARGES"], [31, "subtotal", "AMOUNT_REQUIRED"],
    [32, "vendor_id", "FIELD_REQUIRED"], [32, "invoice_number", "FIELD_REQUIRED"], [32, "invoice_date", "FIELD_REQUIRED"],
    [32, "currency", "FIELD_REQUIRED"], [32, "subtotal", "AMOUNT_REQUIRED"], [32, "tax", "AMOUNT_REQUIRED"],
    [32, "shipping", "AMOUNT_REQUIRED"], [32, "discount", "AMOUNT_REQUIRED"], [32, "total", "AMOUNT_REQUIRED"],
    [33, "subtotal", "AMOUNT_FORMAT"], [34, null, "ROW_SHAPE"], [35, null, "ROW_SHAPE"],
    [37, "record_id", "ID_FORMAT"], [38, "vendor_id", "ID_FORMAT"],
  ]);
  const msg = (rowN: number, field: string) => r.issues.find((i) => i.row === rowN && i.field === field)!.message;
  assert.equal(msg(1, "record_id"), "record_id is required");
  assert.equal(msg(2, "vendor_id"), "vendor_id must be 1-64 ASCII letters, digits, '-', '_'");
  assert.equal(msg(3, "invoice_number"), "invoice_number must be 1-64 ASCII letters, digits, '-', '_', '/', '.'");
  assert.equal(msg(6, "invoice_date"), "invoice_date must be YYYY-MM-DD");
  assert.equal(msg(7, "invoice_date"), "2026-02-30 is not a real calendar date");
  assert.equal(msg(8, "invoice_date"), "0000-01-01 is not a real calendar date");
  assert.equal(msg(17, "currency"), "Only USD is supported in Stage 1");
  assert.equal(msg(19, "subtotal"), "subtotal is required");
  assert.equal(msg(20, "subtotal"),
    "subtotal must be a nonnegative amount like 1234.56 (two decimals, no sign, symbol, separator or spaces; max 999999999.99)");
  assert.equal(msg(28, "discount"), "discount must not exceed subtotal + tax + shipping");
});

test("valid row normalization", () => {
  const r = parseInvoiceCsv(doc([row({ rid: " R-1 ", v: " v-1\t", inv: "inv-01", cur: " usd " })]));
  assert.equal(r.ok, true);
  const inv = r.invoices[0]!;
  assert.deepEqual(
    { recordId: inv.recordId, rowNumber: inv.rowNumber, vendorNorm: inv.vendorNorm, invoiceNorm: inv.invoiceNorm,
      invoiceDate: inv.invoiceDate, currency: inv.currency,
      cents: [inv.subtotal, inv.tax, inv.shipping, inv.discount, inv.total] },
    { recordId: "R-1", rowNumber: 1, vendorNorm: "V-1", invoiceNorm: "INV-01", invoiceDate: "2026-01-15", currency: "USD",
      cents: [10000, 825, 500, 300, 11025] },
  );
  assert.deepEqual(inv.raw, [" R-1 ", " v-1\t", "inv-01", "2026-01-15", " usd ", "100.00", "8.25", "5.00", "3.00", "110.25"]);
});

test("duplicate record IDs are registered before row-shape checks (Python-observed)", () => {
  const r = parseInvoiceCsv(doc([
    row({ rid: "R-1", s: "bad" }), row({ rid: "R-1" }), row({ rid: " R-1 ", v: "" }), "R-1,short", "R-2,short", row({ rid: "R-2" }),
  ]));
  assert.equal(r.issueCount, 7);
  assert.deepEqual(r.issues.map((i) => [i.row, i.field, i.code, i.message]), [
    [1, "subtotal", "AMOUNT_FORMAT",
      "subtotal must be a nonnegative amount like 1234.56 (two decimals, no sign, symbol, separator or spaces; max 999999999.99)"],
    [2, "record_id", "DUPLICATE_RECORD_ID", "record_id 'R-1' already used on row 1"],
    [3, "vendor_id", "FIELD_REQUIRED", "vendor_id is required"],
    [3, "record_id", "DUPLICATE_RECORD_ID", "record_id 'R-1' already used on row 1"],
    [4, null, "ROW_SHAPE", "Row has 2 cells; expected 10"],
    [5, null, "ROW_SHAPE", "Row has 2 cells; expected 10"],
    [6, "record_id", "DUPLICATE_RECORD_ID", "record_id 'R-2' already used on row 5"],
  ]);
  // Record IDs are case-sensitive.
  assert.equal(parseInvoiceCsv(doc([row({ rid: "R-1" }), row({ rid: "r-1", inv: "INV-2" })])).ok, true);
});

test("all issues are collected; at most 500 listed with the full count", () => {
  const rows = Array.from({ length: 400 }, (_, i) => row({ rid: `R-${i}`, s: "x", t: "y" }));
  const r = parseInvoiceCsv(doc(rows));
  assert.equal(r.ok, false);
  assert.equal(r.issueCount, 800);
  assert.equal(r.issues.length, 500);
  assert.deepEqual(r.issues[499], { row: 250, field: "tax", code: "AMOUNT_FORMAT",
    message: "tax must be a nonnegative amount like 1234.56 (two decimals, no sign, symbol, separator or spaces; max 999999999.99)" });
});
