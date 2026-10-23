/** Plain-language labels shared by pages. Text only — no arithmetic on money. */
import type { BatchSource, ReviewAction, ReviewState, RuleId, FindingView } from "../domain/contracts.ts";
import { RULE_DUPLICATE, RULE_NEAR_DUPLICATE } from "../domain/contracts.ts";

export const RULE_LABEL: Readonly<Record<RuleId, string>> = {
  DUPLICATE_CANDIDATE: "Possible duplicate",
  TOTAL_MISMATCH: "Total mismatch",
  NEAR_DUPLICATE: "Possible duplicate (lower confidence)",
};

export const OWN_BADGE = "Your data — stays in this browser";
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
  return `Total doesn't add up: invoice says ${ev.declared}, parts add to ${ev.expected}`;
}
