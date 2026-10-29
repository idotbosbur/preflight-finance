/**
 * Bank statement vs bills. Pure and synchronous: the name similarity (word overlap, or the in-browser
 * AI model's scores looked up from a precomputed table) is passed in, so the money rules stay exact.
 *
 * A payment matches a bill only on the exact amount, a payment date 0..PAY_WINDOW_DAYS after the bill
 * date (any date when the bill has none), and a name score >= MATCH. Payments are taken in date order,
 * each paying the best still-unpaid eligible bill; a payment whose eligible bills are all paid already
 * is a second payment (PAID_TWICE). A payment that matches no bill but clearly names a known supplier
 * (score >= STRONG) is PAYMENT_NO_BILL. Everything else on the statement is ignored.
 */
import type { CandidateFinding, Invoice, PaymentEvidence } from "./contracts.ts";
import { CSV_HEADER, PAY_WINDOW_DAYS, RULE_PAID_TWICE, RULE_PAYMENT_NO_BILL, RULESET_VERSION, compareStrings } from "./contracts.ts";
import { duplicateMember } from "./evidence.ts";
import { formatCents } from "./money.ts";
import type { BankPayment } from "./own/bank.ts";

export const MATCH = 0.55;
export const STRONG = 0.75;

export interface NameScore { readonly score: number; readonly how: string }
/** Similarity of a bank description to a supplier name, 0..1, with how it was decided. */
export type NameScorer = (description: string, vendor: string) => NameScore;

const STOP = new Set(["INC", "LLC", "LTD", "CO", "CORP", "CORPORATION", "COMPANY", "THE", "AND", "OF", "PLC", "GMBH"]);
const words = (s: string) => s.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !STOP.has(w));

/** Share of the supplier's words found in the bank line; a distinctive first word alone scores 0.6. */
export function tokenScore(description: string, vendor: string): number {
  const v = words(vendor);
  if (v.length === 0) return 0;
  const d = new Set(words(description));
  const compactD = words(description).join("");
  if (compactD.includes(v.join(""))) return 1;
  const share = v.filter((w) => d.has(w) || compactD.includes(w)).length / v.length;
  const first = v[0]!.length >= 4 && (d.has(v[0]!) || compactD.startsWith(v[0]!)) ? 0.6 : 0;
  return Math.max(share, first);
}

const VENDOR_INDEX = CSV_HEADER.indexOf("vendor_id");
const vendorOf = (inv: Invoice) => (inv.raw[VENDOR_INDEX] ?? "").trim() || inv.vendorNorm;
const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

function paymentEvidence(p: BankPayment, s: NameScore): PaymentEvidence {
  return { paymentId: p.paymentId, row: p.row, date: p.date, description: p.description, amount: formatCents(p.cents), match: s.how };
}

export interface Reconciled {
  readonly findings: CandidateFinding[];
  /** Payments matched to a bill (first or second payment). */
  readonly matched: number;
  /** Bills dated inside the statement's date range with no payment. */
  readonly unpaidBills: number;
}

export function reconcile(invoices: readonly Invoice[], payments: readonly BankPayment[], score: NameScorer): Reconciled {
  const byAmount = new Map<number, Invoice[]>();
  for (const inv of invoices) byAmount.set(inv.total, [...(byAmount.get(inv.total) ?? []), inv]);
  const suppliers = [...new Set(invoices.map(vendorOf))];
  const paid = new Map<string, PaymentEvidence[]>();
  const findings: CandidateFinding[] = [];
  let matched = 0;

  const ordered = [...payments].sort((a, b) => compareStrings(a.date, b.date) || compareStrings(a.paymentId, b.paymentId));
  for (const p of ordered) {
    const pd = day(p.date);
    const eligible = (byAmount.get(p.cents) ?? [])
      .filter((b) => b.invoiceDate === "" || (pd >= day(b.invoiceDate) && pd - day(b.invoiceDate) <= PAY_WINDOW_DAYS))
      .map((b) => ({ b, s: score(p.description, vendorOf(b)) }))
      .filter((c) => c.s.score >= MATCH)
      .sort((x, y) => y.s.score - x.s.score || compareStrings(x.b.invoiceDate, y.b.invoiceDate) || compareStrings(x.b.recordId, y.b.recordId));
    if (eligible.length > 0) {
      matched++;
      // A payment with every eligible bill already paid is a second payment of the most recent of them.
      const latest = () => [...eligible].sort((x, y) => compareStrings(y.b.invoiceDate, x.b.invoiceDate) || y.s.score - x.s.score)[0]!;
      const pick = eligible.find((c) => !paid.has(c.b.recordId)) ?? latest();
      paid.set(pick.b.recordId, [...(paid.get(pick.b.recordId) ?? []), paymentEvidence(p, pick.s)]);
      continue;
    }
    let best: { vendor: string; s: NameScore } | null = null;
    for (const v of suppliers) {
      const s = score(p.description, v);
      if (s.score >= STRONG && (!best || s.score > best.s.score)) best = { vendor: v, s };
    }
    if (best) {
      findings.push({ ruleId: RULE_PAYMENT_NO_BILL, ruleVersion: RULESET_VERSION, memberIds: [p.paymentId],
        evidence: { kind: RULE_PAYMENT_NO_BILL, vendor: best.vendor, payment: paymentEvidence(p, best.s) } });
    }
  }

  const byId = new Map(invoices.map((i) => [i.recordId, i]));
  for (const [billId, pays] of paid) {
    if (pays.length < 2) continue;
    const b = byId.get(billId)!;
    findings.push({ ruleId: RULE_PAID_TWICE, ruleVersion: RULESET_VERSION, memberIds: [billId, ...pays.map((x) => x.paymentId)].sort(compareStrings),
      evidence: { kind: RULE_PAID_TWICE, bill: duplicateMember(b), currency: b.currency, payments: pays } });
  }

  const days = payments.map((p) => day(p.date));
  const [lo, hi] = [Math.min(...days), Math.max(...days)];
  const unpaidBills = payments.length === 0 ? 0 : invoices.filter((b) => b.invoiceDate !== "" && !paid.has(b.recordId)
    && day(b.invoiceDate) >= lo && day(b.invoiceDate) <= hi).length;
  return { findings: findings.sort((a, b) => compareStrings(a.ruleId, b.ruleId) || compareStrings(a.memberIds.join("|"), b.memberIds.join("|"))), matched, unpaidBills };
}
