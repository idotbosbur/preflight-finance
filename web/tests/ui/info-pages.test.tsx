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

test("how: three plain steps, trust points, limits and a truthful one-line credit", () => {
  const html = render(<HowPage />);
  for (const s of ["Drop in your files", "We check them in your browser", "You decide", "Exact to the cent", "Nothing leaves your browser", "Limits"]) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(html.includes("built with Claude, Anthropic&#x27;s AI coding agent"));
  assert.ok(html.includes('href="https://github.com/idotbosbur/preflight-finance"'), "engineering detail lives on GitHub");
  assert.ok(!html.includes("Referrer-Policy"), "no engineering war stories on the user page");
});

test("what's next: Now, Next and Later, honest labels, the vote and a feedback link", () => {
  const html = render(<RoadmapPage />);
  for (const s of ["Where Catchfold is going", "Now", "Free and live today", "Next", "not built yet", "Later", "Which would you use?"]) assert.ok(html.includes(s), s);
  assert.ok(html.includes('href="#/feedback"'));
  assert.doesNotMatch(html, /\$\d/, "no prices");
});

test("not found: message, home link, optional Load demo data", () => {
  const html = render(<NotFoundPage message="No case here." homeHref="#/" onLoadDemo={() => {}} />);
  assert.ok(html.includes("No case here."));
  assert.ok(html.includes('href="#/"'));
  assert.ok(buttons(html).includes("Load demo data"));
  assert.ok(!buttons(render(<NotFoundPage message="x" homeHref="#/" onLoadDemo={null} />)).includes("Load demo data"));
});

test("every info page renders inside the shell with the free, nothing-uploaded label", () => {
  const pages = [
    <HowPage key="h" />,
    <RoadmapPage key="r" />,
    <ResultsPage key="s" benchmark={benchmark} benchmarkError={null} visitor={null} />,
    <NotFoundPage key="n" message="x" homeHref="#/" onLoadDemo={null} />,
  ];
  for (const page of pages) {
    const html = render(
      <AppShell route={{ name: "how" }} guide={null} onGuideExit={() => {}} durability="persistent" announcement="">
        {page}
      </AppShell>,
    );
    assert.ok(html.includes("Free · nothing uploaded") && !html.includes(SYNTHETIC_LABEL));
  }
});

test("M5: results show the near-duplicate measurement in one honest line", () => {
  const nd = { pairsLabelled: 18, tp: 5, fp: 2, fn: 1 };
  const html = render(<ResultsPage benchmark={{ ...benchmark, nearDuplicate: nd }} benchmarkError={null} visitor={batch} />);
  const line = html.match(/<p class="[^"]*results-near">.*?<\/p>/s)?.[0] ?? "";
  for (const s of ["18 labelled pairs", "5 found", "2 false alarms", "1 missed", "small"]) assert.ok(line.includes(s), `${s} in ${line}`);
  assert.ok(!render(<ResultsPage benchmark={benchmark} benchmarkError={null} visitor={batch} />).includes("results-near"));
});
