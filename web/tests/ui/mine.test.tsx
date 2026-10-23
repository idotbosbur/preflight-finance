import { test } from "node:test";
import assert from "node:assert/strict";
import { AppShell, pageTitle } from "../../src/components/index.ts";
import { CasePage, QueuePage } from "../../src/pages/index.ts";
import { DateOrderQuestion, ImportSummary, MappingForm, MinePage, PreviewTable, continueLabel } from "../../src/pages/MinePage.tsx";
import { OWN_BATCH_ID, RULE_NEAR_DUPLICATE } from "../../src/domain/contracts.ts";
import type { BatchSummary, CaseView, FindingView } from "../../src/domain/contracts.ts";
import { guessMapping } from "../../src/domain/own/columns.ts";
import { batch, caseView, finding, queueProps } from "./fixtures.ts";
import { buttons, render } from "./helpers.ts";

const noop = () => {};
const OWN_BADGE = "Your data — stays in this browser";
const ownBatch: BatchSummary = { ...batch, batchId: OWN_BATCH_ID, displayName: "Your data", source: "own", nearDuplicateCount: 1 };

test("mapping: a labelled select per field, required ones marked", () => {
  const headers = ["Supplier", "Inv No", "Date", "Amount"];
  const html = render(<MappingForm headers={headers} mapping={guessMapping(headers)} onChange={noop} />);
  assert.equal(html.match(/<select/g)?.length, 9);
  for (const f of ["vendor", "invoiceNumber", "date", "total", "subtotal", "tax", "shipping", "discount", "currency"]) {
    assert.match(html, new RegExp(`<label[^>]*for="map-${f}"`));
    assert.match(html, new RegExp(`<select[^>]*id="map-${f}"`));
  }
  assert.equal(html.match(/\(required\)/g)?.length, 3);
  assert.ok(html.includes("Amount"));
});

test("preview shows only the first 5 rows", () => {
  const rows = Array.from({ length: 8 }, (_, i) => [`V${i}`, `N${i}`]);
  const html = render(<PreviewTable headers={["Vendor", "No"]} rows={rows} />);
  assert.ok(html.includes("V4") && !html.includes("V5"));
});

test("ambiguous dates ask day-first or month-first", () => {
  const html = render(<DateOrderQuestion value={null} onChange={noop} />);
  assert.match(html, /<fieldset/);
  assert.ok(html.includes("Day first") && html.includes("Month first"));
  assert.equal(html.match(/type="radio"/g)?.length, 2);
});

test("summary lists skipped reasons and warnings; continue label", () => {
  const html = render(
    <ImportSummary readable={3} skipped={[{ row: 4, reason: "missing vendor" }, { row: 9, reason: "not a number" }]}
      warnings={[{ row: 6, field: "date", reason: "unreadable date" }, { row: 0, field: "date", reason: "format not recognised" }]}
      totalsCheck={false} onContinue={noop} disabled={false} />,
  );
  assert.ok(html.includes("missing vendor") && html.includes("not a number") && html.includes("Row 9"));
  assert.ok(html.includes("unreadable date") && html.includes("format not recognised"));
  assert.ok(html.includes("subtotal"), "says the totals check is off");
  assert.ok(buttons(html).includes("Continue with 3 readable rows (2 skipped)"));
  assert.equal(continueLabel(5, 0), "Continue with 5 readable rows");
});

test("mine page: privacy line, file picker, imported files and confirmed delete", () => {
  const html = render(
    <MinePage ownBatch={ownBatch} files={[{ fileSha256: "a", displayName: "march.csv", importedAt: "2026-10-23T10:00:00Z", rowsAdded: 12, rowsSkipped: 1 }]}
      onImport={() => Promise.reject(new Error("unused"))} onDeleteOwn={noop} queueHref="#/queue/x" summaryHref="#/mine/summary" />,
  );
  assert.ok(html.includes("Your file is read on this device. It is never uploaded."));
  assert.match(html, /type="file"/);
  assert.ok(html.includes("march.csv"));
  assert.ok(buttons(html).includes("Delete my data"));
});

test("own-batch queue shows the own badge and never Synthetic demo", () => {
  const html = render(<QueuePage {...queueProps({ batch: ownBatch, batches: [ownBatch] })} />);
  assert.ok(html.includes(OWN_BADGE));
  assert.ok(!/synthetic demo/i.test(html));
  const demo = render(<QueuePage {...queueProps()} />);
  assert.ok(demo.includes("Synthetic demo") && !demo.includes(OWN_BADGE));
  assert.ok(!/type="file"/.test(demo), "demo queue has no file input");
});

test("queue pages 50 findings at a time", () => {
  const many: FindingView[] = Array.from({ length: 120 }, (_, i) => finding({ state: "open", findingId: `f${String(i).padStart(15, "0")}` }));
  const html = render(<QueuePage {...queueProps({ findings: many })} />);
  assert.equal(html.match(/class="case-row /g)?.length, 50);
  assert.ok(buttons(html).includes("Show 50 more"));
  const few = render(<QueuePage {...queueProps({ findings: many.slice(0, 50) })} />);
  assert.ok(!buttons(few).includes("Show 50 more"));
});

const nearView: CaseView = {
  batch: ownBatch,
  finding: finding({
    state: "open", ruleId: RULE_NEAR_DUPLICATE, memberIds: ["O-aaa", "O-bbb"], findingId: "f0000000000near1", batchId: OWN_BATCH_ID,
    evidence: {
      kind: RULE_NEAR_DUPLICATE, vendor: "ACME", total: "410.00", daysApart: 6,
      members: [
        { recordId: "O-aaa", row: 2, rawVendor: "Acme", rawInvoice: "A-1", invoiceDate: "2026-03-02", total: "410.00" },
        { recordId: "O-bbb", row: 7, rawVendor: "ACME Ltd", rawInvoice: "A-2", invoiceDate: "2026-03-08", total: "410.00" },
      ],
    },
  }),
  members: caseView("open").members.map((m, i) => ({ ...m, recordId: i === 0 ? "O-aaa" : "O-bbb", currency: "EUR" })),
  history: [],
};

test("near-duplicate case: both members, dates, gap, total, currency, own badge", () => {
  const props = { view: nearView, form: { reviewer: "Me", reason: "" }, onFormChange: noop, onAction: noop, save: { kind: "idle" } as const,
    durability: "persistent" as const, guideHint: null, queueHref: "#/q", prevHref: null, nextHref: null, suggestedReasons: [] };
  const html = render(<CasePage {...props} />);
  for (const s of ["O-aaa", "O-bbb", "2026-03-02", "2026-03-08", "6 days", "410.00", "EUR", "A-1", "A-2", "Possible duplicate (lower confidence)"]) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(html.includes(OWN_BADGE) && !/synthetic demo/i.test(html));
  assert.ok(!/fictional demo name/.test(html));
  assert.ok(render(<CasePage {...props} view={caseView("open")} />).includes("Synthetic demo"));
});

test("shell: own mode badge, title and nav", () => {
  const base = { guide: null, onGuideExit: noop, durability: "persistent" as const, announcement: "" };
  const html = render(<AppShell {...base} route={{ name: "mine" }} own><p /></AppShell>);
  assert.ok(html.includes(OWN_BADGE) && !/synthetic demo/i.test(html));
  assert.match(html, /aria-current="page"[^>]*>Your data|>Your data<\/a>/);
  assert.equal(pageTitle({ name: "mine" }, true), "Your data — Preflight (your data)");
  assert.equal(pageTitle({ name: "mine" }), "Your data — Preflight (synthetic demo)");
  assert.ok(render(<AppShell {...base} route={{ name: "results" }}><p /></AppShell>).includes("Synthetic demo"));
});
