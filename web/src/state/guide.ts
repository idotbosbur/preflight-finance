/**
 * Guided demo as a pure derivation from stored state (no pre-seeded decisions). Restarting the
 * guide never erases decisions; steps already satisfied show as done with a note.
 */
import type { CaseView } from "../domain/contracts.ts";
import { RULE_DUPLICATE, RULE_MISMATCH } from "../domain/contracts.ts";
import type { GuideStepView, GuideView, RouteHref } from "../ui-contracts.ts";

/** Demo cases named in the spec (verified against the manifest: R-0009 one-cent-low; DG-12 reuse). */
export const DEMO_TARGETS = {
  mismatch: { ruleId: RULE_MISMATCH, memberIds: ["R-0009"] },
  reuse: { ruleId: RULE_DUPLICATE, memberIds: ["R-0005", "R-0032"] },
} as const;

export interface GuideFacts {
  readonly active: boolean;
  readonly demoLoaded: boolean;
  readonly mismatch: CaseView | null;
  readonly reuse: CaseView | null;
  readonly mismatchHref: RouteHref | null;
  readonly reuseHref: RouteHref | null;
  readonly visitedResults: boolean;
}

const hasAction = (c: CaseView | null, action: string) => !!c?.history.some((e) => e.action === action);

export function deriveGuide(f: GuideFacts): GuideView {
  const confirmDone = f.mismatch?.finding.state === "confirmed" || hasAction(f.mismatch, "confirm");
  const dismissDone = f.reuse?.finding.state === "dismissed" || hasAction(f.reuse, "dismiss");
  const reopenDone = hasAction(f.reuse, "reopen") || hasAction(f.mismatch, "reopen");

  const raw: Array<Omit<GuideStepView, "status"> & { done: boolean }> = [
    { id: "load", title: "Load 120 synthetic invoices", done: f.demoLoaded, href: "#/queue",
      instruction: "The demo batch loads in your browser — nothing is uploaded.", note: null },
    { id: "confirm-mismatch", title: "Confirm a one-cent total mismatch", done: confirmDone, href: f.mismatchHref,
      instruction: "Open invoice R-0009, read why it was flagged, and confirm it with a reason.",
      note: !confirmDone && f.mismatch?.finding.state === "dismissed" ? "This finding is dismissed — reopen it, then confirm." : null },
    { id: "dismiss-reuse", title: "Dismiss a legitimate invoice-number reuse", done: dismissDone, href: f.reuseHref,
      instruction: "Compare R-0005 and R-0032: same vendor and number, different periods. Dismiss the false alert with a reason.",
      note: !dismissDone && f.reuse?.finding.state === "confirmed" ? "This candidate is confirmed — reopen it, then dismiss." : null },
    { id: "reopen-history", title: "Reopen and see the history", done: reopenDone, href: f.reuseHref,
      instruction: "Reopen the dismissed candidate. The history keeps every decision and reason.", note: null },
    { id: "results", title: "See the measured results", done: f.visitedResults, href: "#/results",
      instruction: "Compare your decisions with the fixed synthetic benchmark.", note: null },
  ];

  const currentIndex = raw.findIndex((s) => !s.done);
  const idx = currentIndex === -1 ? raw.length : currentIndex;
  const steps: GuideStepView[] = raw.map(({ done, ...s }, i) => ({
    ...s,
    status: done ? "done" : i === idx ? "current" : "upcoming",
    note: s.note ?? (done && i > 0 && i < 4 ? "Already done in this browser — reopen the case to replay it." : null),
  }));
  return { active: f.active, steps, currentIndex: idx, complete: idx === raw.length };
}

export const SUGGESTED_REASONS: Readonly<Record<string, readonly string[]>> = {
  [RULE_MISMATCH]: [
    "Declared total does not equal subtotal + tax + shipping − discount; request a corrected invoice.",
    "Recomputed from the source invoice; the difference is real.",
  ],
  [RULE_DUPLICATE]: [
    "Different billing periods — legitimate reuse of the invoice number, not a duplicate.",
    "Same obligation billed twice; hold for vendor confirmation through a known contact.",
  ],
};
