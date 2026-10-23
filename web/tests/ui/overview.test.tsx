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
  assert.ok(b.includes("Try the synthetic demo"));
  assert.ok(b.includes("Explore findings"));
  assert.ok(html.includes("<svg"));
  assert.ok(html.indexOf("Try the synthetic demo") < html.indexOf("<svg"), "primary action precedes artwork");
  for (const s of ["1234.50", "98.76", "15.00", "0.00", "1348.26", "1348.27", "+0.01", "V-NORTHWIND", "NW-0042", "R-0005", "R-0032"]) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(html.includes("12 groups flagged: 10 genuine duplicates, 2 legitimate invoice-number reuses"));
  assert.ok(html.includes("not a production finance platform"));
  assert.ok(html.includes("120 invented invoices and 32 candidate findings"));
  assert.ok(!html.includes("reveal-pending"), "content not hidden in markup");
});

test("overview: null story shows no invented figures; error is shown", () => {
  const html = render(<OverviewPage story={null} demo={{ kind: "error", message: "boom" }} onStartGuide={noop} onExplore={noop} />);
  assert.ok(!html.includes("1348.27"));
  assert.ok(html.includes("The demo could not be loaded: boom"));
});
