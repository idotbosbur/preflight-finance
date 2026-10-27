import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeedbackBody, sendFeedback } from "../../src/state/feedback.ts";

test("body uses exact entry names and omits empties", () => {
  const b = buildFeedbackBody({ role: "Small business owner", software: "Xero", tried: "Both", missed: "No", ease: 4, confusion: "  ", wish: "Faster", email: "" });
  assert.equal(b.get("entry.776378412"), "Small business owner");
  assert.equal(b.get("entry.552812709"), "Xero");
  assert.equal(b.get("entry.772120213"), "Both");
  assert.equal(b.get("entry.1506806643"), "No");
  assert.equal(b.get("entry.766796994"), "4");
  assert.equal(b.get("entry.581263092"), "Faster");
  for (const k of ["entry.1467106461", "entry.23912197", "entry.552812709.other_option_response"]) assert.equal(b.has(k), false, k);
});

test("Other software sends sentinel plus response", () => {
  const b = buildFeedbackBody({ role: "Recruiter or just curious", software: "__other_option__", softwareOther: "Wave" });
  assert.equal(b.get("entry.552812709"), "__other_option__");
  assert.equal(b.get("entry.552812709.other_option_response"), "Wave");
});

test("Q4 Yes appends detail", () => {
  const base = { role: "Xero" };
  assert.equal(buildFeedbackBody({ ...base, missed: "Yes", missedDetail: "a dup" }).get("entry.1506806643"), "Yes: a dup");
  assert.equal(buildFeedbackBody({ ...base, missed: "Yes" }).get("entry.1506806643"), "Yes");
  assert.equal(buildFeedbackBody({ ...base, missed: "No", missedDetail: "x" }).get("entry.1506806643"), "No");
});

test("sendFeedback: resolved fetch is true, rejected is false, posts no-cors", async () => {
  let seen: RequestInit | undefined;
  const ok = await sendFeedback({ role: "Xero" }, (async (_u: unknown, init?: RequestInit) => { seen = init; return new Response(); }) as typeof fetch);
  assert.equal(ok, true);
  assert.equal(seen?.method, "POST");
  assert.equal(seen?.mode, "no-cors");
  assert.equal(await sendFeedback({ role: "Xero" }, (async () => { throw new TypeError("x"); }) as typeof fetch), false);
});
