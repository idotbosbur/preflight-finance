/**
 * Draft reconciliation for the investigation form (pure).
 *
 * A draft is bound to the case version the reviewer was looking at when they started typing.
 * If another tab changes the case, the refreshed evidence/history is shown, the typed reason is
 * kept, but the draft stays bound to the OLD token so submitting it produces an explicit
 * conflict. Only after that conflict (the reviewer has now been shown the change) — or when the
 * draft is empty — does the draft rebind to the latest version.
 */
import type { ExpectedToken, FindingView } from "../domain/contracts.ts";

export const tokenOf = (f: Pick<FindingView, "sequence" | "resetGeneration">): ExpectedToken => ({
  sequence: f.sequence,
  resetGeneration: f.resetGeneration,
});

export const sameToken = (a: ExpectedToken, b: ExpectedToken) =>
  a.sequence === b.sequence && a.resetGeneration === b.resetGeneration;

export interface DraftBinding {
  readonly token: ExpectedToken;
  /** True when the case changed after the draft was started (shown to the reviewer). */
  readonly stale: boolean;
}

/** Called whenever a (possibly refreshed) case view arrives. */
export function onCaseLoaded(prev: DraftBinding | null, latest: FindingView, isNewCase: boolean, reasonTyped: boolean): DraftBinding {
  const latestToken = tokenOf(latest);
  if (isNewCase || prev === null || !reasonTyped) return { token: latestToken, stale: false };
  if (sameToken(prev.token, latestToken)) return { token: prev.token, stale: prev.stale };
  return { token: prev.token, stale: true }; // keep the old token: submission must conflict
}

/** After the store reports a conflict, the reviewer has seen the latest state: rebind explicitly. */
export function onConflictShown(latest: FindingView | null, prev: DraftBinding | null): DraftBinding | null {
  return latest ? { token: tokenOf(latest), stale: false } : prev;
}

/** After our own successful save, bind to the saved version. */
export function onSaved(saved: FindingView): DraftBinding {
  return { token: tokenOf(saved), stale: false };
}
