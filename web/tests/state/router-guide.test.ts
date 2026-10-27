import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRoute, parseRoute } from "../../src/state/router.ts";
import { deriveGuide } from "../../src/state/guide.ts";
import type { CaseView, ReviewEvent } from "../../src/domain/contracts.ts";
import type { Route } from "../../src/ui-contracts.ts";

const B = "0123456789abcdef";
const F = "fedcba9876543210";

test("routes round-trip and reject malformed hashes", () => {
  const routes: Route[] = [
    { name: "overview" }, { name: "demo" }, { name: "queue", batchId: null }, { name: "queue", batchId: B },
    { name: "case", batchId: B, findingId: F }, { name: "results" }, { name: "how" }, { name: "roadmap" },
    { name: "mine" }, { name: "mine-summary" }, { name: "feedback" },
  ];
  for (const r of routes) assert.deepEqual(parseRoute(formatRoute(r)), r);
  assert.deepEqual(parseRoute(""), { name: "overview" });
  for (const bad of ["#/case/xyz/abc", "#/queue/ABCDEF0123456789", "#/nope", "#/results/extra", "#/case/" + B]) {
    assert.equal(parseRoute(bad).name, "not_found", bad);
  }
});

function caseWith(state: "open" | "confirmed" | "dismissed", actions: ReviewEvent["action"][]): CaseView {
  return {
    batch: {} as CaseView["batch"],
    finding: { state } as CaseView["finding"],
    members: [],
    history: actions.map((action, i) => ({ action, sequence: i + 1 } as ReviewEvent)),
  };
}

test("guide derives steps from stored state, never from pre-seeded decisions", () => {
  const base = { active: true, demoLoaded: false, mismatch: null, reuse: null, mismatchHref: null, reuseHref: null, visitedResults: false };
  let g = deriveGuide(base);
  assert.equal(g.steps[0]!.status, "current");
  assert.equal(g.complete, false);

  g = deriveGuide({ ...base, demoLoaded: true, mismatch: caseWith("open", []), reuse: caseWith("open", []) });
  assert.equal(g.steps[1]!.status, "current");

  g = deriveGuide({ ...base, demoLoaded: true, mismatch: caseWith("confirmed", ["confirm"]), reuse: caseWith("open", []) });
  assert.equal(g.steps[1]!.status, "done");
  assert.equal(g.currentIndex, 2);

  g = deriveGuide({ ...base, demoLoaded: true, mismatch: caseWith("dismissed", ["dismiss"]), reuse: caseWith("open", []) });
  assert.match(g.steps[1]!.note ?? "", /Reopen it, then confirm/);

  g = deriveGuide({ ...base, demoLoaded: true, mismatch: caseWith("confirmed", ["confirm"]),
    reuse: caseWith("open", ["dismiss", "reopen"]), visitedResults: true });
  assert.equal(g.complete, true);
  assert.ok(g.steps.every((s) => s.status === "done"));
});
