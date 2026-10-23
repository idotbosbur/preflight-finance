/** Plain-language labels shared by pages. Text only — no arithmetic on money. */
import type { ReviewAction, ReviewState, RuleId, FindingView } from "../domain/contracts.ts";
import { RULE_DUPLICATE } from "../domain/contracts.ts";

export const RULE_LABEL: Readonly<Record<RuleId, string>> = {
  DUPLICATE_CANDIDATE: "Possible duplicate",
  TOTAL_MISMATCH: "Total mismatch",
};

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
export function caseTitle(finding: FindingView): string {
  const ev = finding.evidence;
  if (ev.kind === RULE_DUPLICATE) {
    return `Same vendor and invoice number: ${ev.key.vendor} · ${ev.key.invoice}`;
  }
  return `Total doesn't add up: invoice says ${ev.declared}, parts add to ${ev.expected}`;
}
