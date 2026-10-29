/** Build Invoice-shaped rows from any CSV export, tolerantly (own-data mode). */
import { CSV_HEADER, OWN_MAX_BYTES, OWN_MAX_ROWS, normalizeIdentifier } from "../contracts.ts";
import type { Cents, Invoice } from "../contracts.ts";
import { CsvError, parseCsvRecords } from "../csv.ts";
import { REQUIRED_FIELDS, key } from "./columns.ts";
import type { ColumnMapping, OwnField } from "./columns.ts";
import { detectDateOrder, parseLooseAmount, parseLooseDate } from "./values.ts";
import type { DateOrder } from "./values.ts";

/** One item line of a bill (line-item exports such as Xero's), kept for the price-change check. */
export interface OwnLine { readonly description: string; readonly quantity: string; readonly unitCents: Cents }
export type OwnInvoice = Invoice & { readonly hasComponents: boolean; readonly lines?: readonly OwnLine[] };
export interface SkippedRow { readonly row: number; readonly reason: string }
export interface OwnWarning { readonly row: number; readonly field: string; readonly reason: string }
export type OwnParseResult =
  | { readonly invoices: OwnInvoice[]; readonly skipped: SkippedRow[]; readonly warnings: OwnWarning[]; readonly checksAvailable: { readonly totals: boolean; readonly prices: boolean } }
  | {
      readonly error: "too large" | "too many rows" | "not a CSV" | "no header" | "missing required column" | "ambiguous date order";
      readonly detail: string;
    };

const CSV_COLUMN: Record<OwnField, string> = {
  vendor: "vendor_id", invoiceNumber: "invoice_number", date: "invoice_date", currency: "currency",
  subtotal: "subtotal", tax: "tax", shipping: "shipping", discount: "discount", total: "total",
};
// Only exports with a line-item column repeat one bill over several rows (R20).
const LINE_ITEM_KEYS = new Set(["description", "quantity", "qty", "unitamount", "unitprice", "lineamount", "item", "itemcode", "lineitem"]);
// Item columns are found by header name (no mapping step); description + unit price turn on the price check.
const ITEM_DESC = ["description", "itemdescription", "linedescription", "item"];
const ITEM_QTY = ["quantity", "qty"];
const ITEM_UNIT = ["unitamount", "unitprice", "unitcost", "rate", "price"];
const QTY = /^\d{1,7}(?:\.\d{1,4})?$/;
const RAW_INDEX = Object.fromEntries(
  (Object.keys(CSV_COLUMN) as OwnField[]).map((f) => [f, CSV_HEADER.indexOf(CSV_COLUMN[f] as (typeof CSV_HEADER)[number])]),
) as Record<OwnField, number>;

export function buildOwnRows(
  bytes: Uint8Array,
  mapping: ColumnMapping,
  opts: { dateOrder: DateOrder | null; fileLabel: string },
): OwnParseResult {
  const { fileLabel } = opts;
  if (bytes.length > OWN_MAX_BYTES) return { error: "too large", detail: `${fileLabel} is over ${OWN_MAX_BYTES} bytes (10 MB)` };
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let records: string[][];
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(hasBom ? bytes.subarray(3) : bytes);
    records = parseCsvRecords(text);
  } catch (err) {
    if (err instanceof CsvError || err instanceof TypeError) return { error: "not a CSV", detail: `${fileLabel} could not be read as UTF-8 CSV` };
    throw err;
  }
  if (records.length === 0) return { error: "no header", detail: `${fileLabel} has no header row` };
  if (records.length - 1 > OWN_MAX_ROWS) return { error: "too many rows", detail: `${fileLabel} has over ${OWN_MAX_ROWS} rows` };

  const width = records[0]!.length;
  const lineCols = records[0]!.flatMap((h, i) => (LINE_ITEM_KEYS.has(key(h)) ? [i] : []));
  const headerKeys = records[0]!.map(key);
  const itemCol = (ks: readonly string[]) => ks.map((k) => headerKeys.indexOf(k)).find((i) => i >= 0) ?? -1;
  const [descCol, qtyCol, unitCol] = [itemCol(ITEM_DESC), itemCol(ITEM_QTY), itemCol(ITEM_UNIT)];
  const hasItems = descCol >= 0 && unitCol >= 0;
  const lineOf: (OwnLine | null)[] = [];
  const missing = REQUIRED_FIELDS.filter((f) => !(mapping[f] !== undefined && mapping[f]! < width));
  if (missing.length) return { error: "missing required column", detail: `Map a column for: ${missing.join(", ")}` };

  const cell = (rec: string[], f: OwnField) => (mapping[f] === undefined ? "" : (rec[mapping[f]!] ?? ""));
  const data = records.slice(1).map((rec, i) => ({ rec, row: i + 2 })).filter(({ rec }) => rec.some((c) => c.trim() !== ""));

  const warnings: OwnWarning[] = [];
  let order = opts.dateOrder;
  if (mapping.date !== undefined && order === null) {
    const d = detectDateOrder(data.map(({ rec }) => cell(rec, "date")));
    if (d === "ambiguous") return { error: "ambiguous date order", detail: "Dates could be day-first or month-first; choose one" };
    if (d === "unrecognised") {
      if (data.some(({ rec }) => cell(rec, "date").trim() !== "")) {
        warnings.push({ row: 0, field: "date", reason: "date format not recognised, so dates are left blank and date-based checks are off for this file" });
      }
      order = null;
    } else order = d;
  }

  const invoices: OwnInvoice[] = [];
  const skipped: SkippedRow[] = [];
  const recKeys: string[] = [];
  const OPTIONAL = ["subtotal", "tax", "shipping", "discount"] as const;
  rows: for (const { rec, row } of data) {
    const skip = (reason: string) => (skipped.push({ row, reason }), undefined);
    const vendor = cell(rec, "vendor").trim();
    const number = cell(rec, "invoiceNumber").trim();
    if (vendor === "") { skip("missing vendor"); continue; }
    if (number === "") { skip("missing invoice number"); continue; }
    const t = parseLooseAmount(cell(rec, "total"));
    if (!t.ok) { skip(t.reason === "blank" ? "missing total" : `total: ${t.reason}`); continue; }
    const amounts = { subtotal: 0, tax: 0, shipping: 0, discount: 0 };
    for (const f of OPTIONAL) {
      const text = cell(rec, f);
      let a = parseLooseAmount(text);
      // A negative discount is a normal export convention: use its absolute value.
      if (f === "discount" && !a.ok && a.reason === "credit or negative amount") {
        a = parseLooseAmount(text.replace(/[()\-−]/g, "").replace(/\s*cr\s*$/i, ""));
      }
      if (a.ok) amounts[f] = a.cents;
      else if (a.reason !== "blank") { skip(`${f}: ${a.reason}`); continue rows; }
    }
    let invoiceDate = "";
    const dateText = cell(rec, "date");
    if (order !== null && dateText.trim() !== "") {
      const iso = parseLooseDate(dateText, order);
      if (iso === null) {
        warnings.push({ row, field: "date", reason: "unreadable date, so this row is left out of the date-based check" });
      } else invoiceDate = iso;
    }
    const currency = normalizeIdentifier(cell(rec, "currency")) || "USD";
    const raw = CSV_HEADER.map(() => "");
    for (const f of Object.keys(RAW_INDEX) as OwnField[]) if (mapping[f] !== undefined) raw[RAW_INDEX[f]] = cell(rec, f);
    recKeys.push(JSON.stringify(lineCols.map((i) => rec[i] ?? "")));
    let line: OwnLine | null = null;
    if (hasItems) {
      const description = (rec[descCol] ?? "").trim();
      const quantity = qtyCol >= 0 ? (rec[qtyCol] ?? "").trim() || "1" : "1";
      const unit = parseLooseAmount(rec[unitCol] ?? "");
      if (description !== "" && unit.ok && unit.cents > 0 && QTY.test(quantity)) line = { description, quantity, unitCents: unit.cents };
    }
    lineOf.push(line);
    invoices.push({
      recordId: "", rowNumber: row, raw,
      vendorNorm: normalizeIdentifier(vendor), invoiceNorm: normalizeIdentifier(number),
      invoiceDate, currency, ...amounts, total: t.cents,
      hasComponents: mapping.subtotal !== undefined && cell(rec, "subtotal").trim() !== "",
    });
  }
  // Line-item exports repeat the bill's header on every row: combine rows of one bill.
  const combined = new Map<string, OwnInvoice>();
  const linesOf = new Map<string, OwnLine[]>();
  const addLine = (k: string, i: number) => { const l = lineOf[i]; if (l) linesOf.set(k, [...(linesOf.get(k) ?? []), l]); };
  const rowsIn = new Map<string, number>();
  const seenRecs = new Set<string>();
  for (const [i, inv] of invoices.entries()) {
    const k = [inv.vendorNorm, inv.invoiceNorm, inv.invoiceDate, inv.total, inv.currency].join("\u0000");
    // Same bill with identical line-item cells (or no line-item column at all) is a re-entry,
    // a real duplicate, not another line item (R19/R20).
    const lineKey = k + "\u0000" + recKeys[i]!;
    const dup = seenRecs.has(lineKey);
    seenRecs.add(lineKey);
    if (dup) { combined.set(`dup${i}`, inv); addLine(`dup${i}`, i); continue; }
    addLine(k, i);
    rowsIn.set(k, (rowsIn.get(k) ?? 0) + 1);
    const first = combined.get(k);
    if (!first) { combined.set(k, inv); continue; }
    const same = OPTIONAL.every((f) => first[f] === inv[f]) && first.hasComponents === inv.hasComponents;
    // Differing component values are per-line amounts: never compare them to the bill total.
    if (!same) combined.set(k, { ...first, subtotal: 0, tax: 0, shipping: 0, discount: 0, hasComponents: false });
  }
  if (combined.size < invoices.length) {
    // Counts only the bills that had several rows; single-row bills are not "combined".
    const multi = [...rowsIn.values()].filter((c) => c > 1);
    const n = multi.reduce((a, b) => a + b, 0), m = multi.length;
    warnings.push({ row: 0, field: "rows", reason: `${n} line-item rows were combined into ${m} invoice${m === 1 ? "" : "s"} (same vendor, invoice number, date, total and currency)` });
  }
  const withLines = [...combined].map(([k, inv]) => (linesOf.has(k) ? { ...inv, lines: linesOf.get(k)! } : inv));
  return { invoices: withLines, skipped, warnings, checksAvailable: { totals: mapping.subtotal !== undefined, prices: hasItems } };
}
