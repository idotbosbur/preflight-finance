/** Plain-language labels shared by pages. Text only, no arithmetic on money. */
import type { BatchSource, ReviewAction, ReviewState, RuleId, FindingView } from "../domain/contracts.ts";
import { RULE_DUPLICATE, RULE_NEAR_DUPLICATE, RULE_PAID_TWICE, RULE_PAYMENT_NO_BILL, RULE_PRICE_INCREASE, RULE_RECURRING_INCREASE, RULE_CHARGED_TWICE } from "../domain/contracts.ts";

export const RULE_LABEL: Readonly<Record<RuleId, string>> = {
  DUPLICATE_CANDIDATE: "Possible duplicate",
  TOTAL_MISMATCH: "Total mismatch",
  NEAR_DUPLICATE: "Possible duplicate (lower confidence)",
  PAID_TWICE: "Paid twice",
  PAYMENT_NO_BILL: "Payment with no bill",
  PRICE_INCREASE: "Price went up",
  RECURRING_INCREASE: "Monthly charge went up",
  CHARGED_TWICE: "Charged twice in a month",
};

export const OWN_BADGE = "Your data stays in this browser";
export const DEMO_BADGE = "Synthetic demo";
/** Batches uploaded with an earlier version of the app may hold real data: never call them synthetic. */
export const LEGACY_UPLOAD_BADGE = "Uploaded file (older version)";
export const sourceBadge = (source: BatchSource): string =>
  source === "own" ? OWN_BADGE : source === "upload" ? LEGACY_UPLOAD_BADGE : DEMO_BADGE;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const STATE_LABEL: Readonly<Record<ReviewState, string>> = {
  open: "Open",
  confirmed: "Confirmed",
  dismissed: "Dismissed",
};

export const ACTION_LABEL: Readonly<Record<ReviewAction, string>> = {
  confirm: "Confirm finding",
  dismiss: "Dismiss candidate",
  reopen: "Reopen",
};

/** Plain wording on the person's own data (the demo keeps the reviewer vocabulary). */
export const OWN_ACTION_LABEL: Readonly<Record<ReviewAction, string>> = {
  confirm: "Yes, this needs fixing",
  dismiss: "No, this is fine",
  reopen: "Change my answer",
};

/** Past-tense wording for history entries. */
export const ACTION_PAST: Readonly<Record<ReviewAction, string>> = {
  confirm: "Confirmed",
  dismiss: "Dismissed",
  reopen: "Reopened",
};

export const ACTION_ORDER: readonly ReviewAction[] = ["confirm", "dismiss", "reopen"];

/** A plain-language case title built from evidence strings only. */
export function caseTitle(finding: FindingView, asWritten = false): string {
  const ev = finding.evidence;
  if (ev.kind === RULE_DUPLICATE) {
    const m = ev.members[0];
    return asWritten && m
      ? `Same vendor and invoice number: ${m.rawVendor} · ${m.rawInvoice}`
      : `Same vendor and invoice number: ${ev.key.vendor} · ${ev.key.invoice}`;
  }
  if (ev.kind === RULE_NEAR_DUPLICATE) {
    return `Same vendor and amount, ${ev.daysApart} days apart: ${asWritten && ev.members[0] ? ev.members[0].rawVendor : ev.vendor} · ${ev.total}`;
  }
  if (ev.kind === RULE_PAID_TWICE) {
    return `Bill paid ${ev.payments.length} times: ${ev.bill.rawVendor.trim() || "supplier"} · ${ev.bill.rawInvoice} · ${ev.bill.total}`;
  }
  if (ev.kind === RULE_RECURRING_INCREASE) return `Monthly charge went up ${ev.percent}%: ${ev.payee} · ${ev.from} to ${ev.to}`;
  if (ev.kind === RULE_CHARGED_TWICE) return `Charged twice in ${ev.month}: ${ev.payee} · ${ev.amount}`;
  if (ev.kind === RULE_PRICE_INCREASE) {
    return `Price went up ${ev.percent}%: ${ev.vendor} · ${ev.purchases[ev.purchases.length - 1]?.description ?? ""} · ${ev.from} to ${ev.to}`;
  }
  if (ev.kind === RULE_PAYMENT_NO_BILL) return `Payment with no matching bill: ${ev.payment.description} · ${ev.payment.amount}`;
  return `Total doesn't add up: invoice says ${ev.declared}, parts add to ${ev.expected}`;
}
