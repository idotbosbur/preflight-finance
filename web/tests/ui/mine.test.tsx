import { test } from "node:test";
import assert from "node:assert/strict";
import { AppShell, pageTitle } from "../../src/components/index.ts";
import { CasePage, QueuePage } from "../../src/pages/index.ts";
import { DateOrderQuestion, DeleteConfirmation, ImportSummary, MapStep, MappingForm, MinePage, PreviewTable, continueLabel, forgetOwnMappings, readPreview } from "../../src/pages/MinePage.tsx";
import { OWN_BATCH_ID, RULE_NEAR_DUPLICATE } from "../../src/domain/contracts.ts";
import type { BatchSummary, CaseView, FindingView } from "../../src/domain/contracts.ts";
import { guessMapping } from "../../src/domain/own/columns.ts";
import { reviewerFor } from "../../src/state/draft.ts";
import { XSS, batch, caseView, dupEvidence, finding, queueProps } from "./fixtures.ts";
import { renderToStaticMarkup } from "react-dom/server";
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
      onImport={() => Promise.reject(new Error("unused"))} onDeleteOwn={() => Promise.resolve({ ok: true })} queueHref="#/queue/x" summaryHref="#/mine/summary" />,
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
  assert.match(html, /aria-current="page"[^>]*>Your data/);
  assert.equal(pageTitle({ name: "mine" }, true), "Your data — Preflight");
  assert.equal(pageTitle({ name: "mine" }), "Your data — Preflight (synthetic demo)");
  assert.ok(render(<AppShell {...base} route={{ name: "results" }}><p /></AppShell>).includes("Synthetic demo"));
});

const enc = (t: string) => new TextEncoder().encode(t);
const loadedOf = (csv: string) => {
  const rows = csv.trim().split("\n").map((l) => l.split(","));
  return { name: "x.csv", bytes: enc(csv), headers: rows[0]!, rows: rows.slice(1) };
};
const AMBIGUOUS = "Vendor,Invoice,Date,Total\nAcme,1,03/04/2025,10.00\nAcme,2,05/06/2025,11.00\n";

test("an ambiguous file asks day/month and keeps asking after the answer", () => {
  const l = loadedOf(AMBIGUOUS);
  const props = { loaded: l, mapping: guessMapping(l.headers), working: false, onMapping: noop, onDateOrder: noop, onContinue: noop };
  const asked = render(<MapStep {...props} dateOrder={null} />);
  assert.ok(asked.includes("Day first") && asked.includes("Month first"));
  assert.ok(!buttons(asked).some((b) => b.startsWith("Continue")), "no continue until answered");
  const answered = render(<MapStep {...props} dateOrder="DMY" />);
  assert.ok(answered.includes("Day first"), "question stays after the answer");
  assert.match(answered, /checked=""/);
  assert.ok(buttons(answered).includes("Continue with 2 readable rows"));
  const clear = loadedOf("Vendor,Invoice,Date,Total\nAcme,1,2025-03-04,10.00\n");
  assert.ok(!render(<MapStep {...props} loaded={clear} mapping={guessMapping(clear.headers)} dateOrder={null} />).includes("Day first"));
});

test("header-only file explains itself; too many rows suggests splitting", () => {
  const l = loadedOf("Vendor,Invoice,Total\n");
  const html = render(<MapStep loaded={l} mapping={guessMapping(l.headers)} dateOrder={null} working={false} onMapping={noop} onDateOrder={noop} onContinue={noop} />);
  assert.ok(html.includes("No rows can be imported from this file"));
});

test("own cases start with an empty reviewer; demo keeps the default", () => {
  assert.equal(reviewerFor(true, "Demo reviewer", "Demo reviewer"), "");
  assert.equal(reviewerFor(true, "Sam", "Demo reviewer"), "Sam");
  assert.equal(reviewerFor(false, "", "Demo reviewer"), "Demo reviewer");
  assert.equal(reviewerFor(false, "Sam", "Demo reviewer"), "Sam");
});

test("delete confirmation has confirm and cancel; busy disables both", () => {
  const html = render(<DeleteConfirmation onConfirm={noop} onCancel={noop} busy={false} />);
  assert.deepEqual(buttons(html), ["Yes, delete my data", "Cancel"]);
  assert.match(html, /role="group" aria-labelledby="delete-q"/);
  assert.equal(render(<DeleteConfirmation onConfirm={noop} onCancel={noop} busy />).match(/disabled=""/g)?.length, 2);
});

test("user text is escaped in preview and file list", () => {
  const html = render(<PreviewTable headers={[XSS]} rows={[[XSS]]} />);
  assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"));
  const page = render(
    <MinePage ownBatch={ownBatch} files={[{ fileSha256: "a", displayName: XSS, importedAt: "2026-10-23T10:00:00Z", rowsAdded: 1, rowsSkipped: 0 }]}
      onImport={() => Promise.reject(new Error("unused"))} onDeleteOwn={() => Promise.resolve({ ok: true })} queueHref="#/q" summaryHref="#/s" />,
  );
  assert.ok(!page.includes("<script>") && page.includes("&lt;script&gt;"));
  assert.match(page, /<time datetime="2026-10-23T10:00:00Z">/i);
  assert.ok(page.includes("1 row added"));
});

test("singular counts and as-written titles on own pages", () => {
  const one = { ...ownBatch, rowCount: 1, findingCount: 1, duplicateCount: 1, mismatchCount: 0, nearDuplicateCount: 0 };
  const dup = { ...finding({ state: "open", ruleId: "DUPLICATE_CANDIDATE", memberIds: ["R-0005", "R-0032"], evidence: dupEvidence, findingId: "f0000000000dg012" }) };
  const html = render(<QueuePage {...queueProps({ batch: one, batches: [one], findings: [dup] })} />);
  assert.ok(html.includes("1 invoice checked") && html.includes("1 candidate finding ") && html.includes("1 possible duplicate group,"));
  assert.ok(html.includes("v-acme · inv-7781") && !html.includes("V-ACME · INV-7781"), "own title shows the vendor as written");
  const demoHtml = render(<QueuePage {...queueProps({ findings: [dup] })} />);
  assert.ok(demoHtml.includes("V-ACME · INV-7781"));
});

test("summary page: counts only by default, details only when ticked, own badge", async () => {
  const { MineSummaryPage } = await import("../../src/pages/MineSummaryPage.tsx");
  const dup = finding({ state: "confirmed", ruleId: "DUPLICATE_CANDIDATE", memberIds: ["R-0005"], evidence: dupEvidence, findingId: "d1" });
  const row = { recordId: "R-0005", rowNumber: 1, raw: ["R-0005", "Zed Secret Co", "SECRET-1", "2026-03-02", "USD", "", "", "", "", "1"], vendorNorm: "Z", invoiceNorm: "S",
    invoiceDate: "2026-03-02", currency: "USD", subtotal: 0, tax: 0, shipping: 0, discount: 0, total: 100 };
  const files = [{ fileSha256: "a", displayName: "private-name.csv", importedAt: "t", rowsAdded: 1, rowsSkipped: 0 }];
  const props = { batch: ownBatch, findings: [dup], files, rows: [row], reasons: new Map([["d1", "Rounding note"]]), mineHref: "#/mine" };
  const off = render(<MineSummaryPage {...props} />);
  assert.ok(off.includes(OWN_BADGE) && !/synthetic demo/i.test(off));
  assert.match(off, /<input[^>]*type="checkbox"/);
  assert.ok(!/checked=""/.test(off));
  for (const bad of ["Zed", "SECRET", "Rounding", "private-name"]) assert.ok(!off.includes(bad), bad);
  assert.deepEqual(buttons(off), ["Print", "Download (.csv)"]);
  const on = render(<MineSummaryPage {...props} initialDetails />);
  assert.ok(on.includes("Zed Secret Co") && on.includes("SECRET-1") && on.includes("Rounding note"));
  const empty = render(<MineSummaryPage {...props} batch={null} findings={[]} files={[]} rows={[]} />);
  assert.ok(empty.includes('href="#/mine"'));
});

test("summary page while loading: no counts, no Print or Download", async () => {
  const { MineSummaryPage } = await import("../../src/pages/MineSummaryPage.tsx");
  const html = render(<MineSummaryPage batch={ownBatch} findings={[]} files={[]} rows={[]} reasons={new Map()} mineHref="#/mine" loading />);
  assert.ok(html.includes("Reading your results"));
  assert.ok(!html.includes("Invoices checked") && !html.includes("Confirmed"));
  assert.deepEqual(buttons(html), []);
});

test("mine page: feedback link only when a URL is set", () => {
  const props = { ownBatch, files: [], onImport: () => Promise.reject(new Error("unused")), onDeleteOwn: () => Promise.resolve({ ok: true }), queueHref: "#/q", summaryHref: "#/s" };
  assert.ok(!render(<MinePage {...props} />).includes("Send feedback"));
  const html = renderToStaticMarkup(<MinePage {...props} feedbackUrl="https://example.test/f" />);
  assert.ok(html.includes('href="https://example.test/f"'));
});

test("I2: deleting own data forgets remembered column choices only", () => {
  const data = new Map([["preflight.ownMapping:a|b", "{}"], ["preflight.ownMapping:c", "{}"], ["preflight.guide", "x"]]);
  const storage = {
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
  } as unknown as Storage;
  forgetOwnMappings(storage);
  assert.deepEqual([...data.keys()], ["preflight.guide"]);
  forgetOwnMappings(undefined); // no storage: no throw
  assert.match(render(<DeleteConfirmation onConfirm={noop} onCancel={noop} busy={false} />), /remembered column choices/);
});

test("M6/M7: non-UTF-8 says CSV UTF-8; a semicolon file says so", () => {
  const latin1 = new Uint8Array([0x56, 0x65, 0x6e, 0x64, 0x6f, 0x72, 0x0a, 0xe9, 0x0a]);
  assert.match(readPreview("x.csv", latin1) as string, /CSV UTF-8/);
  const semi = new TextEncoder().encode("Vendor;Invoice;Total\nA;1;2\n");
  assert.match(readPreview("x.csv", semi) as string, /semicolon/);
});

test("M10: preview scroll area is a focusable labelled region", () => {
  const html = render(<PreviewTable headers={["Vendor"]} rows={[["A"]]} />);
  assert.match(html, /<div[^>]*class="dup-scroll"[^>]*>/);
  const div = html.match(/<div[^>]*class="dup-scroll"[^>]*>/)![0];
  assert.match(div, /tabindex="0"/);
  assert.match(div, /role="region"/);
  assert.match(div, /aria-label="/);
});

test("M2: near-duplicate key shows the vendor as written", () => {
  const props = { view: nearView, form: { reviewer: "Me", reason: "" }, onFormChange: noop, onAction: noop, save: { kind: "idle" } as const,
    durability: "persistent" as const, guideHint: null, queueHref: "#/q", prevHref: null, nextHref: null, suggestedReasons: [] };
  const key = render(<CasePage {...props} />).match(/<p class="dup-key">.*?<\/p>/s)![0];
  assert.ok(key.includes("<code>Acme</code>"), key);
  assert.ok(!key.includes("<code>ACME</code>"), key);
});

test("M15: a legacy uploaded batch is labelled neutrally, never as synthetic", () => {
  const up = { ...batch, source: "upload" as const };
  const html = render(<QueuePage {...queueProps({ batch: up, batches: [up] })} />);
  assert.ok(html.includes("Uploaded file (older version)"));
  assert.ok(!/<span class="badge badge-synthetic">Synthetic demo/.test(html));
  assert.ok(render(<CasePage {...{ view: { ...caseView("open"), batch: up }, form: { reviewer: "Me", reason: "" }, onFormChange: noop, onAction: noop,
    save: { kind: "idle" } as const, durability: "persistent" as const, guideHint: null, queueHref: "#/q", prevHref: null, nextHref: null,
    suggestedReasons: [] }} />).includes("Uploaded file (older version)"));
});
