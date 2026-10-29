/**
 * Supplier price changes, from bill line items. Pure: the item-name scorer (word overlap or the
 * in-browser AI model) is passed in.
 *
 * Lines of one supplier (vendorNorm + currency) are the same item when their sizes and counts match
 * exactly (sameSizes) and both names score >= ITEM_SAME against each other. Per item, purchases are
 * taken in bill-date order: if the latest unit price is more than RISE_MIN above the first, it is
 * flagged, with the money paid above the first price across later purchases.
 */
import type { CandidateFinding, PurchaseEvidence } from "./contracts.ts";
import { CSV_HEADER, RULE_PRICE_INCREASE, RULESET_VERSION, compareStrings } from "./contracts.ts";
import { formatCents } from "./money.ts";
import type { OwnInvoice } from "./own/rows.ts";
import type { NameScorer } from "./reconcile.ts";

export const ITEM_SAME = 0.8;
/** A rise of 2% or less is treated as noise (rounding, small surcharges). */
export const RISE_MIN = 0.02;

const SIZE_WORDS: Readonly<Record<string, string>> = {
  XS: "XS", XSMALL: "XS", S: "S", SM: "S", SMALL: "S", M: "M", MD: "M", MED: "M", MEDIUM: "M",
  L: "L", LG: "L", LRG: "L", LARGE: "L", XL: "XL", XLARGE: "XL", XXL: "XXL",
};
/** Numbers and size words of an item name, as a sorted signature ("100|L"). */
const sizes = (s: string) => {
  const out = s.toUpperCase().match(/\d+(?:\.\d+)?|[A-Z]+/g) ?? [];
  return out.flatMap((t) => (/^\d/.test(t) ? [String(Number(t))] : SIZE_WORDS[t] ? [SIZE_WORDS[t]!] : [])).sort().join("|");
};
export const sameSizes = (a: string, b: string): boolean => sizes(a) === sizes(b);

const VENDOR_INDEX = CSV_HEADER.indexOf("vendor_id");
const INVOICE_INDEX = CSV_HEADER.indexOf("invoice_number");

interface Purchase { readonly bill: OwnInvoice; readonly description: string; readonly quantity: string; readonly unit: number }

export function priceIncreases(invoices: readonly OwnInvoice[], score: NameScorer): CandidateFinding[] {
  const bySupplier = new Map<string, Purchase[]>();
  for (const bill of invoices) {
    if (!bill.lines || bill.invoiceDate === "") continue;
    const k = JSON.stringify([bill.vendorNorm, bill.currency]);
    const list = bySupplier.get(k) ?? [];
    for (const l of bill.lines) list.push({ bill, description: l.description, quantity: l.quantity, unit: l.unitCents });
    bySupplier.set(k, list);
  }
  const findings: CandidateFinding[] = [];
  for (const purchases of bySupplier.values()) {
    // Group distinct names into items; identical names (ignoring case and spacing) need no scoring.
    const norm = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();
    const names = [...new Set(purchases.map((p) => norm(p.description)))].sort(compareStrings);
    const parent = names.map((_, i) => i);
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
    const how = new Map<number, string>();
    // ponytail: all-pairs per supplier, fine for a few hundred distinct item names.
    for (let a = 0; a < names.length; a++) {
      for (let b = a + 1; b < names.length; b++) {
        if (!sameSizes(names[a]!, names[b]!)) continue;
        const [x, y] = [score(names[a]!, names[b]!), score(names[b]!, names[a]!)];
        const low = x.score <= y.score ? x : y;
        if (low.score >= ITEM_SAME) { parent[root(b)] = root(a); how.set(root(a), low.how); }
      }
    }
    const items = new Map<number, Purchase[]>();
    for (const p of purchases) {
      const r = root(names.indexOf(norm(p.description)));
      items.set(r, [...(items.get(r) ?? []), p]);
    }
    for (const [r, item] of items) {
      const ordered = [...item].sort((a, b) => compareStrings(a.bill.invoiceDate, b.bill.invoiceDate) || compareStrings(a.bill.recordId, b.bill.recordId));
      const first = ordered[0]!, last = ordered[ordered.length - 1]!;
      if (first.bill.invoiceDate === last.bill.invoiceDate || last.unit <= first.unit * (1 + RISE_MIN)) continue;
      // Quantities may be fractional: round each line's extra to whole cents.
      const extra = ordered.slice(1).reduce((sum, p) => sum + Math.max(0, Math.round((p.unit - first.unit) * Number(p.quantity))), 0);
      const purchasesEv: PurchaseEvidence[] = ordered.map((p) => ({
        recordId: p.bill.recordId, invoice: (p.bill.raw[INVOICE_INDEX] ?? "").trim(), date: p.bill.invoiceDate,
        description: p.description, quantity: p.quantity, unit: formatCents(p.unit),
      }));
      const distinctNames = new Set(ordered.map((p) => norm(p.description))).size;
      findings.push({
        ruleId: RULE_PRICE_INCREASE, ruleVersion: RULESET_VERSION,
        memberIds: [...new Set(ordered.map((p) => p.bill.recordId))].sort(compareStrings),
        evidence: {
          kind: RULE_PRICE_INCREASE, vendor: (first.bill.raw[VENDOR_INDEX] ?? "").trim() || first.bill.vendorNorm, currency: first.bill.currency,
          purchases: purchasesEv, from: formatCents(first.unit), to: formatCents(last.unit),
          percent: (((last.unit - first.unit) / first.unit) * 100).toFixed(1), extra: formatCents(extra),
          match: distinctNames === 1 ? "same name" : (how.get(r) ?? "name words"),
        },
      });
    }
  }
  return findings.sort((a, b) => compareStrings(a.memberIds.join("|"), b.memberIds.join("|")));
}
