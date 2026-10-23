import { test } from "node:test";
import assert from "node:assert/strict";
import { AppShell } from "../../src/components/index.ts";
import { HowPage, NotFoundPage, ResultsPage, RoadmapPage } from "../../src/pages/index.ts";
import { MODULES, SYNTHETIC_LABEL } from "../../src/domain/contracts.ts";
import { batch, benchmark } from "./fixtures.ts";
import { buttons, render } from "./helpers.ts";

test("results: visitor separate from benchmark, per-source labels, raw counts, no percentage", () => {
  const html = render(<ResultsPage benchmark={benchmark} benchmarkError={null} visitor={batch} />);
  assert.ok(html.includes("Your demo batch in this browser"));
  assert.ok(html.includes("Fixed synthetic benchmark"));
  assert.ok(html.includes("Reference implementation (Python)"));
  assert.ok(html.includes("Browser port (this TypeScript app)"));
  assert.ok(html.includes("12 groups flagged: 10 genuine duplicates, 2 legitimate"));
  assert.ok(html.includes("7,128") && html.includes("7,140"));
  assert.ok(html.includes("263 of 263"));
  assert.ok(html.includes("110 tests"));
  assert.ok(!html.includes("%"), "no percentage anywhere on the results page");
});

test("results: benchmark error and null handled", () => {
  assert.ok(render(<ResultsPage benchmark={null} benchmarkError="HTTP 404" visitor={null} />).includes("could not be loaded: HTTP 404"));
  const loading = render(<ResultsPage benchmark={null} benchmarkError={null} visitor={null} />);
  assert.ok(loading.includes("Loading benchmark results"));
  assert.ok(loading.includes("No demo batch in this browser yet"));
});

test("how: principles, Python reference 403 history, truthful attribution", () => {
  const html = render(<HowPage />);
  for (const s of ["Exact cents", "Atomic validation", "Idempotent import by file hash", "Stale-review conflicts", "Browser-local, resettable, unauthenticated history"]) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(html.includes("Python reference history"));
  assert.ok(html.includes("403"));
  assert.ok(html.includes("An earlier assistant elaborated"));
  assert.ok(html.includes("Claude (Anthropic&#x27;s AI coding agent) wrote the application code and tests"));
  assert.ok(html.includes("Codex coordinated"));
  assert.ok(html.includes("The owner does not claim to have written this code."));
});

test("roadmap: all twelve modules with labels, phases and qualifiers", () => {
  const html = render(<RoadmapPage modules={MODULES} />);
  assert.equal(MODULES.length, 12);
  for (const m of MODULES) {
    assert.ok(html.includes(m.name), m.name);
    assert.ok(html.includes(`Phase ${m.phase}`));
    if (m.qualifier) assert.ok(html.includes(m.qualifier.replace(/'/g, "&#x27;")), m.qualifier);
  }
  for (const l of ["Working in this demo", "Implemented foundation", "Next synthetic scenario", "Planned"]) assert.ok(html.includes(l), l);
});

test("not found: message, home link, optional Load demo data", () => {
  const html = render(<NotFoundPage message="No case here." homeHref="#/" onLoadDemo={() => {}} />);
  assert.ok(html.includes("No case here."));
  assert.ok(html.includes('href="#/"'));
  assert.ok(buttons(html).includes("Load demo data"));
  assert.ok(!buttons(render(<NotFoundPage message="x" homeHref="#/" onLoadDemo={null} />)).includes("Load demo data"));
});

test("every page renders inside the shell with the synthetic label", () => {
  const pages = [
    <HowPage key="h" />,
    <RoadmapPage key="r" modules={MODULES} />,
    <ResultsPage key="s" benchmark={benchmark} benchmarkError={null} visitor={null} />,
    <NotFoundPage key="n" message="x" homeHref="#/" onLoadDemo={null} />,
  ];
  for (const page of pages) {
    const html = render(
      <AppShell route={{ name: "how" }} guide={null} onGuideExit={() => {}} durability="persistent" announcement="">
        {page}
      </AppShell>,
    );
    assert.ok(html.includes(SYNTHETIC_LABEL));
  }
});
