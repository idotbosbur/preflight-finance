/** Read money-out lines from any bank or card statement CSV (own-data mode). */
import type { Cents } from "../contracts.ts";
import { OWN_MAX_BYTES, OWN_MAX_ROWS } from "../contracts.ts";
import { CsvError, parseCsvRecords } from "../csv.ts";
import { key } from "./columns.ts";
import { detectDateOrder, parseLooseAmount, parseLooseDate } from "./values.ts";
import type { DateOrder } from "./values.ts";

export type BankField = "date" | "description" | "amount" | "moneyOut";
export type BankMapping = Partial<Record<BankField, number>>;

export interface BankPayment {
  /** "P-" + content hash, set by the importer ("" before). */
  readonly paymentId: string;
  readonly row: number;
  readonly date: string;
  readonly description: string;
  readonly cents: Cents;
}
export type BankParseResult =
  | { readonly payments: BankPayment[]; readonly skipped: { row: number; reason: string }[]; readonly credits: number }
  | { readonly error: "too large" | "too many rows" | "not a CSV" | "no header" | "missing required column" | "ambiguous date order"; readonly detail: string };

const SYNONYMS: Readonly<Record<BankField, readonly string[]>> = {
  date: ["Date", "Transaction Date", "Posting Date", "Posted Date", "Post Date", "Trans Date", "Booking Date", "Value Date"],
  description: ["Description", "Transaction Description", "Original Description", "Details", "Payee", "Merchant", "Name", "Memo", "Narrative"],
  amount: ["Amount", "Transaction Amount", "Amount (USD)", "Value"],
  moneyOut: ["Debit", "Debit Amount", "Withdrawal", "Withdrawals", "Money Out", "Paid Out", "Charges", "Payments"],
};

/** Per field, the best-ranked synonym wins; a column is never used twice. */
export function guessBankMapping(headers: readonly string[]): BankMapping {
  const mapping: BankMapping = {};
  const used = new Set<number>();
  const keys = headers.map(key);
  for (const field of Object.keys(SYNONYMS) as BankField[]) {
    for (const syn of SYNONYMS[field]) {
      const i = keys.findIndex((h, idx) => !used.has(idx) && h === key(syn));
      if (i >= 0) { mapping[field] = i; used.add(i); break; }
    }
  }
  // A debit column means "Amount" is not needed (and may be a balance-like column).
  if (mapping.moneyOut !== undefined) delete mapping.amount;
  return mapping;
}

/** "-12.00", "(12.00)", "12.00 CR", "-$12.00" -> negative; blank -> null. */
function signedAmount(text: string): { cents: Cents; negative: boolean } | null | "bad" {
  const s = text.trim();
  if (s === "") return null;
  const negative = /^[-−]|^\(.*\)$|\d\s*(?:cr|[-−])$/i.test(s);
  const body = negative ? s.replace(/^[-−]|^\(|\)$|\s*(?:cr|[-−])$/gi, "") : s.replace(/^\+/, "");
  const a = parseLooseAmount(body);
  return a.ok ? { cents: a.cents, negative } : a.reason === "blank" ? null : "bad";
}

export function buildBankRows(bytes: Uint8Array, mapping: BankMapping, opts: { dateOrder: DateOrder | null; fileLabel: string }): BankParseResult {
  const { fileLabel } = opts;
  if (bytes.length > OWN_MAX_BYTES) return { error: "too large", detail: `${fileLabel} is over 10 MB` };
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let records: string[][];
  try {
    records = parseCsvRecords(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(hasBom ? bytes.subarray(3) : bytes));
  } catch (err) {
    if (err instanceof CsvError || err instanceof TypeError) return { error: "not a CSV", detail: `${fileLabel} could not be read as UTF-8 CSV` };
    throw err;
  }
  if (records.length === 0) return { error: "no header", detail: `${fileLabel} has no header row` };
  if (records.length - 1 > OWN_MAX_ROWS) return { error: "too many rows", detail: `${fileLabel} has over ${OWN_MAX_ROWS} rows` };
  const width = records[0]!.length;
  const has = (f: BankField) => mapping[f] !== undefined && mapping[f]! < width;
  if (!has("date") || !has("description") || !(has("amount") || has("moneyOut"))) {
    return { error: "missing required column", detail: "Map a column for: date, description, and amount or money out" };
  }
  const cell = (rec: string[], f: BankField) => (mapping[f] === undefined ? "" : (rec[mapping[f]!] ?? ""));
  const data = records.slice(1).map((rec, i) => ({ rec, row: i + 2 })).filter(({ rec }) => rec.some((c) => c.trim() !== ""));

  let order = opts.dateOrder;
  if (order === null) {
    const d = detectDateOrder(data.map(({ rec }) => cell(rec, "date")));
    if (d === "ambiguous") return { error: "ambiguous date order", detail: "Dates could be day-first or month-first; choose one" };
    order = d === "unrecognised" ? null : d;
  }
  const useDebit = has("moneyOut");
  const amounts = data.map(({ rec }) => signedAmount(cell(rec, useDebit ? "moneyOut" : "amount")));
  // Bank exports sign money out as negative; card exports often list every charge as positive.
  const outIsNegative = !useDebit && amounts.some((a) => a !== null && a !== "bad" && a.negative);

  const payments: BankPayment[] = [];
  const skipped: { row: number; reason: string }[] = [];
  let credits = 0;
  data.forEach(({ rec, row }, i) => {
    const a = amounts[i]!;
    if (a === "bad") { skipped.push({ row, reason: "amount is not a number" }); return; }
    if (a === null) { if (useDebit) credits++; else skipped.push({ row, reason: "missing amount" }); return; }
    if (!useDebit && a.negative !== outIsNegative) { credits++; return; }
    if (a.cents === 0) return;
    const date = order === null ? null : parseLooseDate(cell(rec, "date"), order);
    if (date === null) { skipped.push({ row, reason: "unreadable date" }); return; }
    const description = cell(rec, "description").trim();
    if (description === "") { skipped.push({ row, reason: "missing description" }); return; }
    payments.push({ paymentId: "", row, date, description, cents: a.cents });
  });
  return { payments, skipped, credits };
}
