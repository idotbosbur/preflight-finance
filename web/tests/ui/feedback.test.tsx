import { test } from "node:test";
import assert from "node:assert/strict";
import { FeedbackPage, FEEDBACK_NOTE } from "../../src/pages/FeedbackPage.tsx";
import { render } from "./helpers.ts";

test("feedback page: 8 questions, every control labelled, Q1 required, note shown", () => {
  const html = render(<FeedbackPage demoHref="#/demo" />);
  assert.equal(html.match(/<fieldset/g)?.length, 5);
  assert.equal(html.match(/<textarea/g)?.length, 3);
  assert.equal(html.match(/type="email"/g)?.length, 1);
  for (const q of ["What best describes you", "Which accounting software", "What did you try", "find anything you would have missed", "How easy was it", "What confused you", "What one thing", "15-minute follow-up"]) {
    assert.ok(html.includes(q), q);
  }
  const ids = [...html.matchAll(/<(?:textarea|input)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]!);
  assert.equal(ids.length, 5);
  for (const id of ids) assert.match(html, new RegExp(`<label[^>]*for="${id}"`));
  // every radio sits inside its own label
  assert.equal(html.match(/<label[^>]*><input type="radio"/g)?.length, html.match(/type="radio"/g)?.length);
  assert.ok(html.includes("(required)"));
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled/);
  assert.ok(html.includes(FEEDBACK_NOTE.replace("'", "&#x27;")));
  assert.ok(html.includes("Two minutes."));
  assert.equal(html.match(/maxLength="1000"/g)?.length, 3);
});
