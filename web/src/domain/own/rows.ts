/** Build Invoice-shaped rows from any CSV export, tolerantly (own-data mode). */
import { CSV_HEADER, OWN_MAX_BYTES, OWN_MAX_ROWS, normalizeIdentifier } from "../contracts.ts";
import type { Invoice } from "../contracts.ts";
import { CsvError, parseCsvRecords } from "../csv.ts";
import { REQUIRED_FIELDS } from "./columns.ts";
import type { ColumnMapping, OwnField } from "./columns.ts";
import { detectDateOrder, parseLooseAmount, parseLooseDate } from "./values.ts";
import type { DateOrder } from "./values.ts";

export type OwnInvoice = Omit<Invoice, "currency"> & { readonly currency: string; readonly hasComponents: boolean };
export interface SkippedRow { readonly row: number; readonly reason: string }
export interface OwnWarning { readonly row: number; readonly field: string; readonly reason: string }
export type OwnParseResult =
  | { readonly invoices: OwnInvoice[]; readonly skipped: SkippedRow[]; readonly warnings: OwnWarning[]; readonly checksAvailable: { readonly totals: boolean } }
  | {
      readonly error: "too large" | "too many rows" | "not a CSV" | "no header" | "missing required column" | "ambiguous date order";
      readonly detail: string;
    };

const CSV_COLUMN: Record<OwnField, string> = {
  vendor: "vendor_id", invoiceNumber: "invoice_number", date: "invoice_date", currency: "currency",
  subtotal: "subtotal", tax: "tax", shipping: "shipping", discount: "discount", total: "total",
};
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
        warnings.push({ row: 0, field: "date", reason: "date format not recognised — dates left blank; date-based checks are off for this file" });
      }
      order = null;
    } else order = d;
  }

  const invoices: OwnInvoice[] = [];
  const skipped: SkippedRow[] = [];
  const OPTIONAL = ["subtotal", "tax", "shipping", "discount"] as const;
  rows: for (const { rec, row } of data) {
    const skip = (reason: string) => (skipped.push({ row, reason }), undefined);
    const vendor = cell(rec, "vendor").trim();
    const number = cell(rec, "invoiceNumber").trim();
    if (vendor === "") { skip("missing vendor"); continue; }
    if (number === "") { skip("missing invoice number"); continue; }
    const t = parseLooseAmount(cell(rec, "total"));
    if (!t.ok) { skip(t.reason === "blank" ? "missing total" : t.reason); continue; }
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
        warnings.push({ row, field: "date", reason: "unreadable date — this row is excluded from the date-based check" });
      } else invoiceDate = iso;
    }
    const currency = normalizeIdentifier(cell(rec, "currency")) || "USD";
    const raw = CSV_HEADER.map(() => "");
    for (const f of Object.keys(RAW_INDEX) as OwnField[]) if (mapping[f] !== undefined) raw[RAW_INDEX[f]] = cell(rec, f);
    invoices.push({
      recordId: "", rowNumber: row, raw,
      vendorNorm: normalizeIdentifier(vendor), invoiceNorm: normalizeIdentifier(number),
      invoiceDate, currency, ...amounts, total: t.cents,
      hasComponents: mapping.subtotal !== undefined && cell(rec, "subtotal").trim() !== "",
    });
  }
  return { invoices, skipped, warnings, checksAvailable: { totals: mapping.subtotal !== undefined } };
}
