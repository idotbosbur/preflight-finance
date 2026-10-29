/**
 * Year-end contractor totals (US Form 1099-NEC preparation). Pure: bills in, payee totals out.
 *
 * Totals use bill dates in the chosen year, USD only. Spellings of one payee ("J. Smith Plumbing",
 * "Smith Plumbing LLC") are grouped when each name's words are all found in the other, or when the
 * name scorer (word overlap or the in-browser AI model) rates them >= SAME. A list for a person to
 * check, not tax advice.
 */
import type { Cents, Invoice } from "./contracts.ts";
import { CSV_HEADER, compareStrings } from "./contracts.ts";
import { formatCents } from "./money.ts";
import { csvCell } from "./own/summary.ts";
import type { NameScorer } from "./reconcile.ts";

export const SAME = 0.9;
/** Below SAME but worth a look when the two together cross the threshold. */
export const MAYBE = 0.65;
const VENDOR_INDEX = CSV_HEADER.indexOf("vendor_id");

/** 1099-NEC reporting threshold: $600 for payments through 2025, $2,000 from 2026 (later years may be inflation-adjusted). */
export const thresholdCents = (year: number): Cents => (year >= 2026 ? 200_000 : 60_000);

export type PayeeStatus = "over" | "corporation" | "under";
export interface PayeeTotal {
  /** The spelling with the most money. */
  readonly name: string;
  /** Every spelling grouped into this payee, sorted. */
  readonly names: readonly string[];
  readonly cents: Cents;
  readonly bills: number;
  readonly status: PayeeStatus;
}
export interface ContractorTotals {
  readonly payees: readonly PayeeTotal[];
  readonly threshold: Cents;
  readonly otherCurrencyBills: number;
  readonly undatedBills: number;
  /** Payees that may be one person, listed only when their combined total reaches the threshold. */
  readonly maybeSame: readonly { readonly a: string; readonly b: string; readonly cents: Cents }[];
}

// Corporations usually get no 1099-NEC (lawyers are the common exception). LLCs often do, so they are not listed here.
const CORPORATION = /\b(inc|incorporated|corp|corporation)\b\.?\s*$/i;

export const yearsIn = (invoices: readonly Invoice[]): number[] =>
  [...new Set(invoices.filter((i) => i.invoiceDate !== "").map((i) => Number(i.invoiceDate.slice(0, 4))))].sort((a, b) => b - a);

export function contractorTotals(invoices: readonly Invoice[], year: number, score: NameScorer): ContractorTotals {
  const prefix = `${year}-`;
  const inYear = invoices.filter((i) => i.invoiceDate.startsWith(prefix));
  const usd = inYear.filter((i) => i.currency === "USD");
  const byName = new Map<string, { cents: number; bills: number }>();
  for (const i of usd) {
    const name = (i.raw[VENDOR_INDEX] ?? "").trim() || i.vendorNorm;
    const t = byName.get(name) ?? { cents: 0, bills: 0 };
    byName.set(name, { cents: t.cents + i.total, bills: t.bills + 1 });
  }
  // ponytail: all-pairs name comparison, fine for a few thousand payees.
  const names = [...byName.keys()].sort(compareStrings);
  const parent = names.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  const near: [number, number][] = [];
  for (let a = 0; a < names.length; a++) {
    for (let b = a + 1; b < names.length; b++) {
      const s = Math.min(score(names[a]!, names[b]!).score, score(names[b]!, names[a]!).score);
      if (s >= SAME) parent[root(b)] = root(a);
      else if (s >= MAYBE) near.push([a, b]);
    }
  }
  const groups = new Map<number, string[]>();
  names.forEach((n, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), n]));
  const threshold = thresholdCents(year);
  const payees = [...groups.values()].map((group): PayeeTotal => {
    const cents = group.reduce((a, n) => a + byName.get(n)!.cents, 0);
    const name = [...group].sort((x, y) => byName.get(y)!.cents - byName.get(x)!.cents || compareStrings(x, y))[0]!;
    const status: PayeeStatus = CORPORATION.test(name) ? "corporation" : cents >= threshold ? "over" : "under";
    return { name, names: group, cents, bills: group.reduce((a, n) => a + byName.get(n)!.bills, 0), status };
  }).sort((x, y) => y.cents - x.cents || compareStrings(x.name, y.name));
  const payeeOf = new Map(payees.flatMap((p) => p.names.map((n) => [n, p] as const)));
  const seen = new Set<string>();
  const maybeSame = near.flatMap(([a, b]) => {
    const [pa, pb] = [payeeOf.get(names[a]!)!, payeeOf.get(names[b]!)!];
    const key = [pa.name, pb.name].sort(compareStrings).join("\u0000");
    if (pa === pb || seen.has(key) || pa.cents + pb.cents < threshold) return [];
    seen.add(key);
    return [{ a: pa.name, b: pb.name, cents: pa.cents + pb.cents }];
  });
  return {
    payees, threshold, maybeSame,
    otherCurrencyBills: inYear.length - usd.length,
    undatedBills: invoices.filter((i) => i.invoiceDate === "").length,
  };
}

export const STATUS_TEXT: Readonly<Record<PayeeStatus, string>> = {
  over: "At or over the threshold: may need a 1099-NEC",
  corporation: "Name ends in Inc. or Corp.: usually no 1099 (lawyers still get one)",
  under: "Under the threshold",
};

export function contractorCsv(t: ContractorTotals, year: number): string {
  const lines: (string | number)[][] = [
    ["Payee", "Other spellings", "Bills", "Total (USD)", "Status"],
    ...t.payees.map((p) => [p.name, p.names.filter((n) => n !== p.name).join("; "), p.bills, formatCents(p.cents), STATUS_TEXT[p.status]]),
    [],
    [`Totals use bill dates in ${year}. Threshold ${formatCents(t.threshold)} USD. Not tax advice: check the IRS Form 1099-NEC instructions.`],
  ];
  return lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
