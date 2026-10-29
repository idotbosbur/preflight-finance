/**
 * The "at a glance" headline for a batch: how much money the open and confirmed findings touch,
 * and the biggest ones first. Pure; integer cents only.
 *
 * Counting: a duplicate group counts its extra copies (every member except the largest), a
 * near-duplicate counts its repeats, a total mismatch counts only the difference. Dismissed findings
 * are left out. Amounts in other currencies are named, never added together.
 */
import type { Cents, FindingView, Invoice } from "./contracts.ts";
import { CSV_HEADER, RULE_DUPLICATE, RULE_NEAR_DUPLICATE } from "./contracts.ts";
import { formatCents, parseCents } from "./money.ts";

const VENDOR_INDEX = CSV_HEADER.indexOf("vendor_id");
const INVOICE_INDEX = CSV_HEADER.indexOf("invoice_number");

export interface GlanceItem {
  readonly finding: FindingView;
  readonly cents: Cents;
  readonly currency: string;
  readonly vendor: string;
  /** Invoice numbers as written, de-duplicated. */
  readonly invoices: readonly string[];
  readonly reason: string;
}

export interface Glance {
  /** Total in the main currency (the one with the most money flagged); 0 when nothing is flagged. */
  readonly cents: Cents;
  readonly currency: string | null;
  readonly otherCurrencies: readonly string[];
  /** Distinct invoices touched by the counted findings. */
  readonly bills: number;
  /** Biggest first. */
  readonly items: readonly GlanceItem[];
}

const list = (xs: readonly string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const unique = (xs: readonly string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

function item(f: FindingView, byId: ReadonlyMap<string, Invoice>): GlanceItem {
  const first = byId.get(f.memberIds[0] ?? "");
  const ev = f.evidence;
  const vendorOf = (fallback: string) => (first?.raw[VENDOR_INDEX] ?? fallback).trim() || fallback;
  if (ev.kind === RULE_DUPLICATE) {
    const totals = ev.members.map((m) => parseCents(m.total));
    const invoices = unique(ev.members.map((m) => m.rawInvoice));
    const reason = invoices.length === 1
      ? `Invoice #${invoices[0]} appears ${ev.members.length} times`
      : `${list(invoices.map((n) => `#${n}`))} look like the same bill`;
    return {
      finding: f, cents: totals.reduce((a, b) => a + b, 0) - Math.max(...totals), currency: ev.key.currency,
      vendor: (ev.members[0]?.rawVendor ?? "").trim() || ev.key.vendor, invoices, reason,
    };
  }
  if (ev.kind === RULE_NEAR_DUPLICATE) {
    const invoices = unique(ev.members.map((m) => m.rawInvoice));
    return {
      finding: f, cents: parseCents(ev.total) * (f.memberIds.length - 1), currency: first?.currency ?? "",
      vendor: vendorOf(ev.vendor), invoices, reason: `Same amount, ${ev.daysApart} days apart${invoices.length ? ` (${list(invoices.map((n) => `#${n}`))})` : ""}`,
    };
  }
  const invoices = unique([first?.raw[INVOICE_INDEX] ?? ""]);
  const label = invoices[0] ? `Invoice #${invoices[0]}` : `Record ${ev.recordId}`;
  return {
    finding: f, cents: Math.abs(parseCents(ev.declared) - parseCents(ev.expected)), currency: first?.currency ?? "",
    vendor: vendorOf("Unknown supplier"), invoices, reason: `${label}: the parts add up to ${ev.expected}, but the total says ${ev.declared}`,
  };
}

export function buildGlance(findings: readonly FindingView[], invoices: readonly Invoice[]): Glance {
  const byId = new Map(invoices.map((i) => [i.recordId, i]));
  const counted = findings.filter((f) => f.state !== "dismissed");
  const items = counted.map((f) => item(f, byId))
    .sort((a, b) => b.cents - a.cents || (a.finding.findingId < b.finding.findingId ? -1 : 1));
  const perCurrency = new Map<string, number>();
  for (const i of items) perCurrency.set(i.currency, (perCurrency.get(i.currency) ?? 0) + i.cents);
  const ranked = [...perCurrency].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return {
    cents: ranked[0]?.[1] ?? 0,
    currency: ranked[0]?.[0] ?? null,
    otherCurrencies: ranked.slice(1).map(([c]) => c).filter(Boolean),
    bills: new Set(counted.flatMap((f) => f.memberIds)).size,
    items,
  };
}

/** `421250, "USD"` -> `"$4,212.50"`; other codes go after the number. */
export function formatMoney(cents: Cents, currency: string | null): string {
  const [whole = "0", frac = "00"] = formatCents(cents).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (currency === "USD") return `$${grouped}.${frac}`;
  return currency ? `${grouped}.${frac} ${currency}` : `${grouped}.${frac}`;
}

/** A polite draft the person can copy into their own email. Preflight never sends it. */
export function supplierEmail(i: GlanceItem): { readonly subject: string; readonly body: string } {
  const ev = i.finding.evidence;
  const nums = list(i.invoices.map((n) => `#${n}`)) || "these invoices";
  const sign = "\n\nThank you,\n";
  if (ev.kind === "TOTAL_MISMATCH") {
    return {
      subject: `Question about invoice ${nums}`,
      body: `Hello,\n\nWhile checking our bills before payment, we noticed that invoice ${nums} shows a total of ${ev.declared} ${i.currency}, `
        + `but its amounts (subtotal, tax, shipping and discount) add up to ${ev.expected}. Could you check it and send a corrected invoice if needed?${sign}`,
    };
  }
  return {
    subject: `Possible duplicate invoice ${nums}`,
    body: `Hello,\n\nWhile checking our bills, we noticed that invoice ${nums} may have reached us more than once. `
      + `Could you confirm whether one copy was sent by mistake? If it was paid twice, please let us know how you would like to handle a credit or refund.${sign}`,
  };
}
