import { test } from "node:test";
import assert from "node:assert/strict";
import { QueuePage } from "../../src/pages/index.ts";
import { batch, dupFinding, finding, queueProps } from "./fixtures.ts";
import { buildGlance } from "../../src/domain/glance.ts";
import { buttons, render } from "./helpers.ts";

test("queue: cards with rule and state words, filters, ordering note, investigate links", () => {
  const html = render(<QueuePage {...queueProps()} />);
  assert.ok(html.includes("Total mismatch"));
  assert.ok(html.includes("Possible duplicate"));
  assert.ok(html.includes("Open"));
  assert.ok(html.includes("Dismissed"));
  assert.ok(html.includes("open first, then rule, then record ID. No risk score"));
  assert.match(html, /<label[^>]*for="filter-state"/);
  assert.match(html, /<label[^>]*for="filter-rule"/);
  assert.ok(html.includes(`href="#/case/${batch.batchId}/f00000000000mm09"`));
  assert.ok(!/type="file"/.test(html), "the demo queue has no upload");
  assert.ok(buttons(html).includes("Reset this browser&#x27;s demo data"));
  assert.ok(!html.includes("<table"), "cards, not wide tables");
});

test("queue: empty state offers Load demo", () => {
  const html = render(<QueuePage {...queueProps({ batch: null, batches: [], findings: [], demo: { kind: "not_loaded" } })} />);
  assert.ok(buttons(html).includes("Load demo"));
});

test("queue: at-a-glance headline with the biggest findings first", () => {
  const glance = buildGlance([dupFinding("open"), finding({ state: "open" })], []);
  const html = render(<QueuePage {...queueProps({ glance })} />);
  assert.ok(html.includes("$410.00"));
  assert.ok(html.includes("may have been overpaid, or needs a second look"));
  assert.ok(html.includes("3 of 120 bills need a look"));
  assert.ok(buttons(html).includes("Review all 2"));
  assert.ok(buttons(html).includes("Email supplier"));
  assert.ok(html.indexOf("$410.00") < html.indexOf("0.01 off"), "biggest first");
});

test("queue: at-a-glance says so when nothing needs a look", () => {
  const html = render(<QueuePage {...queueProps({ glance: buildGlance([], []) })} />);
  assert.ok(html.includes("Nothing needs a second look"));
  assert.ok(!buttons(html).some((b) => b.startsWith("Review all")));
});
