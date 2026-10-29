/**
 * Monthly charges on a bank or card statement (phone, internet, software, rent). Pure.
 *
 * A payee (statement description without card prefixes and numbers) is a monthly charge when it
 * appears in 3+ calendar months, about once a month, at no more than 3 different amounts. Then:
 * RECURRING_INCREASE when the latest amount is more than RISE_MIN above the first, and CHARGED_TWICE
 * for a month with two payments of the same amount. Payments already in a paid-twice finding are skipped.
 */
import type { CandidateFinding, PaymentEvidence } from "./contracts.ts";
import { RULE_CHARGED_TWICE, RULE_RECURRING_INCREASE, RULESET_VERSION, compareStrings } from "./contracts.ts";
import { formatCents } from "./money.ts";
import type { BankPayment } from "./own/bank.ts";
import { RISE_MIN } from "./prices.ts";

const NOISE = /\b(?:SQ|TST|POS|ACH|DEBIT|PURCHASE|CARD|PPD|WEB|ID|AUTOPAY|RECURRING|PAYMENT|PMT|BILL)\b/g;
export const payeeKey = (description: string) =>
  description.toUpperCase().replace(/[*#\d]+/g, " ").replace(NOISE, " ").replace(/[^A-Z&' ]/g, " ").replace(/\s+/g, " ").trim();

const evidence = (p: BankPayment): PaymentEvidence =>
  ({ paymentId: p.paymentId, row: p.row, date: p.date, description: p.description, amount: formatCents(p.cents), match: "" });

export function recurringChecks(payments: readonly BankPayment[], skip: ReadonlySet<string>): CandidateFinding[] {
  const byPayee = new Map<string, BankPayment[]>();
  for (const p of payments) {
    const k = payeeKey(p.description);
    if (k === "" || skip.has(p.paymentId)) continue;
    byPayee.set(k, [...(byPayee.get(k) ?? []), p]);
  }
  const findings: CandidateFinding[] = [];
  for (const list of byPayee.values()) {
    const ordered = [...list].sort((a, b) => compareStrings(a.date, b.date) || compareStrings(a.paymentId, b.paymentId));
    const months = new Set(ordered.map((p) => p.date.slice(0, 7)));
    const amounts = new Set(ordered.map((p) => p.cents));
    if (months.size < 3 || ordered.length > months.size + 2 || amounts.size > 3) continue;
    const payee = ordered[ordered.length - 1]!.description;
    const first = ordered[0]!.cents, last = ordered[ordered.length - 1]!.cents;
    if (last > first * (1 + RISE_MIN)) {
      const extra = ordered.reduce((sum, p) => sum + Math.max(0, p.cents - first), 0);
      findings.push({
        ruleId: RULE_RECURRING_INCREASE, ruleVersion: RULESET_VERSION, memberIds: ordered.map((p) => p.paymentId).sort(compareStrings),
        evidence: {
          kind: RULE_RECURRING_INCREASE, payee, payments: ordered.map(evidence), from: formatCents(first), to: formatCents(last),
          percent: (((last - first) / first) * 100).toFixed(1), extra: formatCents(extra), perYear: formatCents((last - first) * 12),
        },
      });
    }
    const byMonth = new Map<string, BankPayment[]>();
    for (const p of ordered) byMonth.set(`${p.date.slice(0, 7)}|${p.cents}`, [...(byMonth.get(`${p.date.slice(0, 7)}|${p.cents}`) ?? []), p]);
    for (const [k, same] of byMonth) {
      if (same.length < 2) continue;
      findings.push({
        ruleId: RULE_CHARGED_TWICE, ruleVersion: RULESET_VERSION, memberIds: same.map((p) => p.paymentId).sort(compareStrings),
        evidence: { kind: RULE_CHARGED_TWICE, payee, month: k.slice(0, 7), amount: formatCents(same[0]!.cents), payments: same.map(evidence) },
      });
    }
  }
  return findings.sort((a, b) => compareStrings(a.ruleId, b.ruleId) || compareStrings(a.memberIds.join("|"), b.memberIds.join("|")));
}
