import { test } from "node:test";
import assert from "node:assert/strict";
import { CasePage } from "../../src/pages/index.ts";
import type { CaseProps, SaveStatus } from "../../src/ui-contracts.ts";
import type { ReviewState } from "../../src/domain/contracts.ts";
import { XSS, batch, caseView, dupFinding, event, mismatchInvoice } from "./fixtures.ts";
import { buttons, render } from "./helpers.ts";

const noop = () => {};

function props(state: ReviewState, over: Partial<CaseProps> = {}): CaseProps {
  return {
    view: caseView(state),
    form: { reviewer: "Demo reviewer", reason: "" },
    onFormChange: noop,
    onAction: noop,
    save: { kind: "idle" },
    durability: "persistent",
    guideHint: null,
    queueHref: "#/queue",
    prevHref: null,
    nextHref: "#/case/b/next",
    suggestedReasons: ["Declared total is one cent over the components."],
    ...over,
  };
}

const ACTION_BUTTONS = ["Confirm finding", "Dismiss candidate", "Reopen"];
function actionButtons(html: string) {
  return buttons(html).filter((b) => ACTION_BUTTONS.includes(b));
}

test("case: only allowed actions per state", () => {
  assert.deepEqual(actionButtons(render(<CasePage {...props("open")} />)), ["Confirm finding", "Dismiss candidate"]);
  assert.deepEqual(actionButtons(render(<CasePage {...props("confirmed")} />)), ["Reopen"]);
  assert.deepEqual(actionButtons(render(<CasePage {...props("dismissed")} />)), ["Reopen"]);
});

test("case: mismatch evidence strings rendered verbatim with formula", () => {
  const html = render(<CasePage {...props("open")} />);
  assert.ok(html.includes("Why this was flagged"));
  assert.ok(html.includes("1234.50 + 98.76 + 15.00 − 0.00 = 1348.26"));
  assert.ok(html.includes("1348.27"));
  assert.ok(html.includes("+0.01"));
  assert.ok(html.includes("The invoice total is higher than it should be."));
  assert.ok(html.includes("never approves, blocks or pays anything"));
  assert.ok(html.includes("Reviewer (fictional demo name)"));
  assert.ok(html.includes("Source details"));
  assert.ok(html.includes(batch.fileSha256));
  assert.ok(html.includes("invoice-v1"));
  assert.ok(html.includes('href="#/queue"'));
  assert.ok(html.includes('href="#/case/b/next"'));
  assert.ok(buttons(html).includes("Declared total is one cent over the components."), "suggested reason chip");
});

test("case: duplicate members and normalized key", () => {
  const view = { ...caseView("open"), finding: dupFinding("open") };
  const html = render(<CasePage {...props("open", { view })} />);
  for (const s of ["R-0005", "R-0032", "V-ACME", "INV-7781", "2026-03-02", "2026-09-14", "410.00", "512.40"]) assert.ok(html.includes(s), s);
  assert.ok(html.includes("legitimately reused"));
});

test("case: user-supplied text escaped (reason, reviewer, raw fields)", () => {
  const view = caseView("confirmed", [event(1, "confirm", "open", "confirmed", XSS, XSS)]);
  const html = render(<CasePage {...props("confirmed", { view, form: { reviewer: XSS, reason: XSS } })} />);
  assert.ok(!html.includes("<script>"));
  assert.ok((html.match(/&lt;script&gt;/g) ?? []).length >= 4, "escaped in history, form and raw fields");
  assert.ok(mismatchInvoice.raw.includes(XSS));
});

test("case: history oldest first", () => {
  const view = caseView("open", [
    event(1, "confirm", "open", "confirmed", "first reason"),
    event(2, "reopen", "confirmed", "open", "second reason"),
  ]);
  const html = render(<CasePage {...props("open", { view })} />);
  assert.ok(html.indexOf("first reason") < html.indexOf("second reason"));
  assert.ok(html.includes("Confirmed</strong> by Demo reviewer"));
  assert.ok(html.includes("Reopened</strong>"));
});

test("case: save status states", () => {
  const r = (save: SaveStatus, reason = "") => render(<CasePage {...props("open", { save, form: { reviewer: "Demo reviewer", reason } })} />);
  const saving = r({ kind: "saving", action: "confirm" });
  assert.ok(saving.includes("Saving"));
  assert.ok(/<button[^>]*disabled=""[^>]*>Confirm finding/.test(saving));
  assert.ok(r({ kind: "saved", message: "Saved: confirmed." }).includes("Saved: confirmed."));
  const invalid = r({ kind: "invalid", errors: ["Reason is required."] });
  assert.ok(invalid.includes("Reason is required."));
  assert.match(invalid, /id="reason"[^>]*aria-describedby="decision-errors reason-hint"|aria-describedby="decision-errors reason-hint"[^>]*id="reason"/);
  assert.match(invalid, /aria-invalid="true"/);
  const conflict = r({ kind: "conflict", message: "This case changed in another tab." }, "my kept reason");
  assert.ok(conflict.includes("<p>This case changed in another tab.</p>"), "conflict message verbatim");
  assert.ok(!conflict.includes("Not saved"), "no Not saved prefix on conflict");
  assert.match(conflict, /role="status"[^>]*>[\s\S]*This case changed/, "still inside the announced status region");
  assert.ok(conflict.includes("my kept reason"));
  const err = r({ kind: "error", message: "Storage is full." });
  assert.ok(err.includes("Not saved: Storage is full."));
  assert.ok(!/>Saved/.test(err));
});

test("case: memory durability note", () => {
  const html = render(<CasePage {...props("open", { durability: "memory" })} />);
  assert.ok(html.includes("lost on reload"));
});
