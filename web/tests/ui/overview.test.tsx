import { test } from "node:test";
import assert from "node:assert/strict";
import { OverviewPage } from "../../src/pages/index.ts";
import { story } from "./fixtures.ts";
import { buttons, render } from "./helpers.ts";

const noop = () => {};

test("overview: the drop box is the first thing, with the demo as a quiet second option", () => {
  const html = render(<OverviewPage story={story} demo={{ kind: "not_loaded" }} onStartGuide={noop} onExplore={noop} drop={<div id="drop-slot" />} />);
  assert.ok(html.includes("Find the bills you paid twice"));
  assert.ok(html.indexOf("drop-slot") < html.indexOf("Try the demo"), "drop box comes before the demo button");
  assert.ok(buttons(html).includes("Try the demo"));
  assert.ok(html.includes('href="#/how"'), "links to How it works");
  assert.ok(!html.includes("<details"), "nothing hidden behind disclosures");
  assert.ok(!html.includes("reveal-pending"), "content not hidden in markup");
});

test("overview: null story shows no invented figures; error is shown", () => {
  const html = render(<OverviewPage story={null} demo={{ kind: "error", message: "boom" }} onStartGuide={noop} onExplore={noop} />);
  assert.ok(!html.includes("1348.27"));
  assert.ok(html.includes("The demo could not be loaded: boom"));
});

test("darknessAt: 1 inside the dark section, fades in above it and stays dark to the end", async () => {
  const { darknessAt } = await import("../../src/art/ChromeField.tsx");
  const secs = [{ top: 1000, bottom: 2000, mode: "dark" }, { top: 0, bottom: 1000, mode: "haze" }];
  assert.equal(darknessAt(secs, 1500, 500), 1);
  assert.equal(darknessAt(secs, 400, 500), 0);
  const near = darknessAt(secs, 900, 500);
  const nearer = darknessAt(secs, 950, 500);
  assert.ok(near > 0 && near < 1 && nearer > near, `${near} < ${nearer}`);
  assert.equal(darknessAt(secs, 2600, 500), 1, "stays dark below the dark section (no fade back to white)");
});

test("overview: dark section, the six checks and the paid-idea vote", () => {
  const html = render(<OverviewPage story={story} demo={{ kind: "not_loaded" }} onStartGuide={noop} onExplore={noop} />);
  assert.ok(html.includes('data-chrome="dark"'));
  for (const s of ["Bills entered twice", "Bills paid twice", "Monthly charges creeping up", "Year-end 1099 contractor list", "Your files never leave your browser.", "Which would you use?"]) {
    assert.ok(html.includes(s), s);
  }
});
