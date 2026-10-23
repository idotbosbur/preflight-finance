import { test } from "node:test";
import assert from "node:assert/strict";
import { AppShell, GuideBar, guideCompleteCopy, pageTitle, routeFocusTarget, shouldFocusOnRouteChange } from "../../src/components/index.ts";
import { CasePage, HowPage, NotFoundPage, QueuePage, ResetConfirmation, ResultsPage, RoadmapPage, OverviewPage, QUEUE_HEADING_ID } from "../../src/pages/index.ts";
import { MODULES } from "../../src/domain/contracts.ts";
import type { Route } from "../../src/ui-contracts.ts";
import { caseView, guide, queueProps } from "./fixtures.ts";
import { buttons, render } from "./helpers.ts";

const noop = () => {};
const complete = { ...guide, complete: true, currentIndex: guide.steps.length };

test("guide completion copy depends on durability", () => {
  const persistent = render(<GuideBar guide={complete} onExit={noop} durability="persistent" />);
  assert.ok(persistent.includes("Your decisions stay in this browser until you reset the demo data."));
  const memory = render(<GuideBar guide={complete} onExit={noop} durability="memory" />);
  assert.ok(memory.includes("kept only in this tab and will be lost on reload"));
  assert.ok(memory.includes("storage is unavailable"));
  assert.ok(!memory.includes("stay in this browser"));
  assert.equal(guideCompleteCopy("memory").includes("until you reset"), false);
});

test("shell passes durability to the guide bar", () => {
  const html = render(
    <AppShell route={{ name: "results" }} guide={complete} onGuideExit={noop} durability="memory" announcement="">
      <p />
    </AppShell>,
  );
  assert.ok(html.includes("kept only in this tab"));
  assert.ok(!html.includes("stay in this browser until"));
});

test("case history hint depends on durability", () => {
  const base = {
    view: caseView("open"), form: { reviewer: "Demo reviewer", reason: "" }, onFormChange: noop, onAction: noop,
    save: { kind: "idle" } as const, guideHint: null, queueHref: "#/queue", prevHref: null, nextHref: null, suggestedReasons: [],
  };
  assert.ok(render(<CasePage {...base} durability="persistent" />).includes("until you reset the demo data"));
  const mem = render(<CasePage {...base} durability="memory" />);
  assert.ok(mem.includes("kept only in this tab and will be lost on reload"));
  assert.ok(!mem.includes("History is kept in this browser only"));
});

test("reset confirmation exposes Cancel and the confirm action; queue h1 is a stable focus target", () => {
  const html = render(<ResetConfirmation onConfirm={noop} onCancel={noop} />);
  const b = buttons(html);
  assert.ok(b.includes("Cancel"));
  assert.ok(b.includes("Yes, reset demo data"));
  assert.match(html, /role="group" aria-labelledby="reset-q"/);
  const queue = render(<QueuePage {...queueProps({ batch: null, batches: [], findings: [], demo: { kind: "not_loaded" } })} />);
  assert.match(queue, new RegExp(`<h1 id="${QUEUE_HEADING_ID}"[^>]*tabindex="-1"`));
});

test("route focus helpers: title, initial load, change detection, heading target", () => {
  const routes: Route[] = [
    { name: "overview" }, { name: "demo" }, { name: "queue", batchId: null }, { name: "case", batchId: "b", findingId: "f" },
    { name: "results" }, { name: "how" }, { name: "roadmap" }, { name: "not_found", hash: "#/x" },
  ];
  for (const r of routes) assert.match(pageTitle(r), /^.+ — Preflight \(synthetic demo\)$/);
  assert.equal(pageTitle({ name: "case", batchId: "b", findingId: "f" }), "Investigation — Preflight (synthetic demo)");
  assert.equal(shouldFocusOnRouteChange(null, "a"), false, "initial load never steals focus");
  assert.equal(shouldFocusOnRouteChange("a", "a"), false);
  assert.equal(shouldFocusOnRouteChange("a", "b"), true);

  const attrs = new Map<string, string>();
  const heading = { focus: noop, hasAttribute: (n: string) => attrs.has(n), setAttribute: (n: string, v: string) => void attrs.set(n, v) };
  const main = { focus: noop, hasAttribute: () => true, setAttribute: noop, querySelector: (s: string) => (s === "h1" ? heading : null) };
  assert.equal(routeFocusTarget(main), heading);
  assert.equal(attrs.get("tabindex"), "-1");
  const emptyMain = { ...main, querySelector: () => null };
  assert.equal(routeFocusTarget(emptyMain), emptyMain, "falls back to main");
});

test("every page h1 is programmatically focusable", () => {
  const pages = [
    render(<OverviewPage story={null} demo={{ kind: "not_loaded" }} onStartGuide={noop} onExplore={noop} />),
    render(<QueuePage {...queueProps()} />),
    render(<HowPage />),
    render(<RoadmapPage modules={MODULES} />),
    render(<ResultsPage benchmark={null} benchmarkError={null} visitor={null} />),
    render(<NotFoundPage message="x" homeHref="#/" onLoadDemo={null} />),
  ];
  for (const html of pages) assert.match(html, /<h1[^>]*tabindex="-1"/);
});
