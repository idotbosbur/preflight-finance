import { test } from "node:test";
import assert from "node:assert/strict";
import { OverviewPage } from "../../src/pages/index.ts";
import { story } from "./fixtures.ts";
import { buttons, render } from "./helpers.ts";

const noop = () => {};

test("overview: headline, actions, artwork and story from real story data", () => {
  const html = render(<OverviewPage story={story} demo={{ kind: "not_loaded" }} onStartGuide={noop} onExplore={noop} />);
  assert.ok(html.includes("Catch invoice errors before they&#x27;re paid"));
  const b = buttons(html);
  assert.ok(b.includes("Try the demo"));
  assert.ok(/href="#\/mine"[^>]*>Check your own invoices</.test(html), "own-invoices link in hero");
  assert.ok(html.includes("<svg"));
  assert.ok(html.indexOf("Try the demo") < html.indexOf("<svg"), "primary action precedes artwork");
  for (const s of ["1234.50", "98.76", "15.00", "0.00", "1348.26", "1348.27", "+0.01", "NW-0042"]) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(html.includes("12 groups flagged: 10 genuine duplicates, 2 legitimate reuses"));
  assert.ok(html.includes('href="#/how"'), "links to How it works");
  assert.ok(html.includes("On 120 invented invoices"));
  assert.ok(!html.includes("<details"), "nothing hidden behind disclosures");
  assert.ok(!html.includes("reveal-pending"), "content not hidden in markup");
});

test("overview: null story shows no invented figures; error is shown", () => {
  const html = render(<OverviewPage story={null} demo={{ kind: "error", message: "boom" }} onStartGuide={noop} onExplore={noop} />);
  assert.ok(!html.includes("1348.27"));
  assert.ok(html.includes("The demo could not be loaded: boom"));
});

test("darknessAt: 1 inside the dark section, fades smoothly to 0 outside it", async () => {
  const { darknessAt } = await import("../../src/art/ChromeField.tsx");
  const secs = [{ top: 1000, bottom: 2000, mode: "dark" }, { top: 0, bottom: 1000, mode: "haze" }];
  assert.equal(darknessAt(secs, 1500, 500), 1);
  assert.equal(darknessAt(secs, 400, 500), 0);
  const near = darknessAt(secs, 900, 500);
  const nearer = darknessAt(secs, 950, 500);
  assert.ok(near > 0 && near < 1 && nearer > near, `${near} < ${nearer}`);
  assert.equal(darknessAt(secs, 2250, 500), darknessAt(secs, 750, 500), "symmetric fade in and out");
});

test("overview: dark section, check cards, tools and guide links", () => {
  const html = render(<OverviewPage story={story} demo={{ kind: "not_loaded" }} onStartGuide={noop} onExplore={noop} />);
  assert.ok(html.includes('data-chrome="dark"'));
  for (const s of ["Duplicate bills", "Repeat charges", "Stays in your browser", "QuickBooks Online", "/guide-excel-duplicate-invoices.html"]) {
    assert.ok(html.includes(s), s);
  }
});
