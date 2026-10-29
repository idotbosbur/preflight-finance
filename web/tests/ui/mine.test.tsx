import { test } from "node:test";
import assert from "node:assert/strict";
import { AppShell, pageTitle } from "../../src/components/index.ts";
import { CasePage, QueuePage } from "../../src/pages/index.ts";
import { DateOrderQuestion, DeleteConfirmation, MappingForm, MinePage, PreviewTable, forgetOwnMappings, readPreview } from "../../src/pages/MinePage.tsx";
import { checkItem } from "../../src/pages/DropFiles.tsx";
import { MatchResult } from "../../src/pages/BankSection.tsx";
import { ContractorList } from "../../src/pages/MineSummaryPage.tsx";
import { OWN_BATCH_ID, RULE_NEAR_DUPLICATE } from "../../src/domain/contracts.ts";
import type { BatchSummary, CaseView, FindingView } from "../../src/domain/contracts.ts";
import { guessMapping } from "../../src/domain/own/columns.ts";
import { reviewerFor } from "../../src/state/draft.ts";
import { XSS, batch, caseView, dupEvidence, finding, queueProps } from "./fixtures.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { buttons, render } from "./helpers.ts";

const noop = () => {};
const OWN_BADGE = "Your data stays in this browser";
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

test("mine page: privacy line, file picker, imported files and confirmed delete", () => {
  const html = render(
    <MinePage ownBatch={ownBatch} files={[{ fileSha256: "a", displayName: "march.csv", importedAt: "2026-10-23T10:00:00Z", rowsAdded: 12, rowsSkipped: 1 }]}
      onImport={() => Promise.reject(new Error("unused"))} onDeleteOwn={() => Promise.resolve({ ok: true })} queueHref="#/queue/x" summaryHref="#/mine/summary" />,
  );
  assert.ok(html.includes("Your files") && html.includes("See what we found"), "files page leads with results");
  assert.match(html, /type="file"/);
  assert.ok(html.includes("march.csv"));
  assert.ok(buttons(html).includes("Delete my data"));
});

test("own-batch queue shows the own badge and never Synthetic demo", () => {
  const html = render(<QueuePage {...queueProps({ batch: ownBatch, batches: [ownBatch] })} />);
  assert.ok(html.includes(OWN_BADGE));
  assert.ok(!/synthetic demo/i.test(html));
  const demo = render(<QueuePage {...queueProps()} />);
  assert.ok(demo.includes("Sample data") && !demo.includes(OWN_BADGE));
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
  assert.ok(render(<CasePage {...props} view={caseView("open")} />).includes("Sample data"));
});

test("shell: own mode badge, title and nav", () => {
  const base = { guide: null, onGuideExit: noop, durability: "persistent" as const, announcement: "" };
  const html = render(<AppShell {...base} route={{ name: "mine" }} own><p /></AppShell>);
  assert.ok(html.includes("Free · nothing uploaded") && !/sample data/i.test(html));
  assert.match(html, /aria-current="page"[^>]*>Your files/);
  assert.equal(pageTitle({ name: "mine" }, true), "Your files | Preflight");
  assert.equal(pageTitle({ name: "mine" }), "Your files | Preflight");
  assert.ok(render(<AppShell {...base} route={{ name: "results" }}><p /></AppShell>).includes("Sample data"));
});

const enc = (t: string) => new TextEncoder().encode(t);
const loadedOf = (csv: string) => {
  const rows = csv.trim().split("\n").map((l) => l.split(","));
  return { name: "x.csv", bytes: enc(csv), headers: rows[0]!, rows: rows.slice(1) };
};
const AMBIGUOUS = "Vendor,Invoice,Date,Total\nAcme,1,03/04/2025,10.00\nAcme,2,05/06/2025,11.00\n";

const item = (l: ReturnType<typeof loadedOf>, over: Partial<Parameters<typeof checkItem>[0]> = {}) =>
  ({ loaded: l, kind: "bills" as const, bills: guessMapping(l.headers), bank: {}, dateOrder: null, ...over });

test("drop check: an ambiguous file asks day/month, then is ready", () => {
  const l = loadedOf(AMBIGUOUS);
  assert.deepEqual(checkItem(item(l)), { ok: false, need: "dates", detail: "" });
  assert.deepEqual(checkItem(item(l, { dateOrder: "DMY" })), { ok: true, count: 2, skipped: 0, prices: false });
  assert.equal(checkItem(item(loadedOf("Vendor,Invoice,Date,Total\nAcme,1,2025-03-04,10.00\n"))).ok, true);
});

test("drop check: header-only file, unknown type, and a missing invoice number column", () => {
  assert.equal(checkItem(item(loadedOf("Vendor,Invoice,Total\n"))).ok, false);
  assert.deepEqual(checkItem(item(loadedOf(AMBIGUOUS), { kind: null })), { ok: false, need: "kind", detail: "" });
  const r = checkItem(item(loadedOf("Vendor,Date,Amount\nUmbrella Sample,2026-01-02,10.00\n"), { bills: { vendor: 0, date: 1, total: 2 } }));
  assert.ok(!r.ok && r.need === "columns");
  assert.ok(!r.ok && r.detail.startsWith("Choose a column for Invoice number."), "names the missing field");
  assert.ok(!r.ok && r.detail.includes("If your file has no invoice or bill number"));
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
  const one = { ...ownBatch, rowCount: 1, findingCount: 1, duplicateCount: 1, mismatchCount: 0, nearDuplicateCount: 0, openCount: 1, confirmedCount: 0, dismissedCount: 0 };
  const dup = { ...finding({ state: "open", ruleId: "DUPLICATE_CANDIDATE", memberIds: ["R-0005", "R-0032"], evidence: dupEvidence, findingId: "f0000000000dg012" }) };
  const html = render(<QueuePage {...queueProps({ batch: one, batches: [one], findings: [dup] })} />);
  assert.ok(html.includes("1 bill checked") && html.includes("1 thing to look at"), "plain counts on own data");
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
  assert.ok(!render(<MinePage {...props} feedbackUrl="" />).includes("Send feedback"));
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

test("readPreview: a PDF or a spreadsheet file gets a clear 'not a CSV' message", async () => {
  const { readPreview } = await import("../../src/pages/MinePage.tsx");
  const pdf = readPreview("bills.pdf", new TextEncoder().encode("%PDF-1.4"));
  assert.equal(typeof pdf, "string");
  assert.match(pdf as string, /That is a PDF/);
  const xlsx = readPreview("bills.xlsx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]));
  assert.match(xlsx as string, /spreadsheet file, not a CSV/);
  const zipNamedCsv = readPreview("bills.csv", new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  assert.match(zipNamedCsv as string, /spreadsheet file/);
  assert.equal(typeof readPreview("ok.csv", new TextEncoder().encode("Vendor,Bill No.,Amount\nA,1,2\n")), "object");
});

test("match result says how names were matched", () => {
  const ai = render(<MatchResult report={{ payments: 9, matched: 6, unpaidBills: 1, ai: true, paidTwice: 1, noBill: 1 }} />);
  assert.ok(ai.includes("Matched 6 of 9 payments"));
  assert.ok(ai.includes("1 bill paid more than once"));
  assert.ok(ai.includes("AI model running in this browser"));
  const words = render(<MatchResult report={{ payments: 2, matched: 2, unpaidBills: 0, ai: false, paidTwice: 0, noBill: 0 }} />);
  assert.ok(words.includes("Nothing looks paid twice"));
  assert.ok(words.includes("could not load"));
});

test("contractor list: year picker and a build button, nothing computed until asked", () => {
  const rows = [{ ...caseView("open").members[0]!, invoiceDate: "2026-02-01" }];
  const html = render(<ContractorList rows={rows} scoreNames={async () => ({ scorer: () => ({ score: 0, how: "" }), ai: false })} />);
  assert.ok(html.includes("Year-end contractor list (1099)"));
  assert.match(html, /<option[^>]*value="2026"/);
  assert.ok(buttons(html).includes("Build the contractor list"));
  assert.ok(!html.includes("<table"));
});
