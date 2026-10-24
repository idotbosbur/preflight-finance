import { test } from "node:test";
import assert from "node:assert/strict";
import { QueuePage } from "../../src/pages/index.ts";
import { batch, queueProps } from "./fixtures.ts";
import { buttons, render } from "./helpers.ts";

test("queue: cards with rule and state words, filters, ordering note, investigate links", () => {
  const html = render(<QueuePage {...queueProps()} />);
  assert.ok(html.includes("Total mismatch"));
  assert.ok(html.includes("Possible duplicate"));
  assert.ok(html.includes("Open"));
  assert.ok(html.includes("Dismissed"));
  assert.ok(html.includes("Open first, then rule, then record ID — no risk score"));
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
