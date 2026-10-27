/**
 * Review rules shared by both store adapters. A decision records whether a person agrees a
 * finding merits attention; it never approves, blocks or releases a payment.
 */
import {
  ACTIONS,
  REASON_MAX,
  REVIEWER_MAX,
  asciiTrim,
  codePointLength,
  compareTuples,
} from "../domain/contracts.ts";
import type { DecisionRequest, FindingView, ReviewAction, ReviewState } from "../domain/contracts.ts";

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface CleanDecision {
  readonly action: ReviewAction;
  readonly reason: string;
  readonly reviewer: string;
}

/** Python review.parse_review_form parity: ASCII trim, CRLF->LF, code-point limits, no controls. */
export function validateDecision(req: Pick<DecisionRequest, "action" | "reason" | "reviewer" | "expected">):
  { ok: true; value: CleanDecision } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!Object.hasOwn(ACTIONS, req.action)) errors.push("Choose confirm, dismiss or reopen.");

  const reason = asciiTrim(String(req.reason ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  if (!reason) errors.push("A reason is required for every decision.");
  else if (codePointLength(reason) > REASON_MAX) errors.push(`The reason must be at most ${REASON_MAX} characters.`);
  else if (CONTROL.test(reason)) errors.push("The reason contains unsupported control characters.");

  const reviewer = asciiTrim(String(req.reviewer ?? ""));
  if (!reviewer) errors.push("Enter a reviewer name or initials.");
  else if (codePointLength(reviewer) > REVIEWER_MAX) errors.push(`The reviewer name must be at most ${REVIEWER_MAX} characters.`);
  else if (CONTROL.test(reviewer) || /[\n\t]/.test(reviewer)) errors.push("The reviewer name must be a single line of text.");

  const { sequence, resetGeneration } = req.expected ?? { sequence: -1, resetGeneration: -1 };
  if (!Number.isSafeInteger(sequence) || sequence < 0 || !Number.isSafeInteger(resetGeneration) || resetGeneration < 0) {
    errors.push("This page is out of date; reload the case and try again.");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { action: req.action, reason, reviewer } };
}

export function canApply(action: ReviewAction, state: ReviewState): boolean {
  return ACTIONS[action].from.includes(state);
}

/** Transparent case order (Python case_sort_key): open first, then rule ID, then member IDs. */
export function compareCases(a: FindingView, b: FindingView): number {
  const sa = a.state === "open" ? 0 : 1;
  const sb = b.state === "open" ? 0 : 1;
  if (sa !== sb) return sa - sb;
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  return compareTuples(a.memberIds, b.memberIds);
}
