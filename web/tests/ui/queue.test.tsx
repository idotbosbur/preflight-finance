import { test } from "node:test";
import assert from "node:assert/strict";
import { QueuePage } from "../../src/pages/index.ts";
import type { ValidationIssue } from "../../src/domain/contracts.ts";
import { XSS, batch, queueProps } from "./fixtures.ts";
import { buttons, render } from "./helpers.ts";

test("queue: cards with rule and state words, filters, ordering note, investigate links", () => {
  const html = render(<QueuePage {...queueProps()} />);
  assert.ok(html.includes("Total mismatch"));
  assert.ok(html.includes("Possible duplicate"));
  assert.ok(html.includes("Open"));
  assert.ok(html.includes("Dismissed"));
  assert.ok(html.includes("open first, then rule, then record ID — no risk score"));
  assert.match(html, /<label[^>]*for="filter-state"/);
  assert.match(html, /<label[^>]*for="filter-rule"/);
  assert.ok(html.includes(`href="#/case/${batch.batchId}/f00000000000mm09"`));
  assert.ok(html.includes("Advanced: try your own synthetic CSV"));
  assert.match(html, /type="file"/);
  assert.match(html, /href="demo\/sample.csv"[^>]*download/);
  assert.ok(html.includes("record_id,vendor_id,invoice_number,invoice_date,currency,subtotal,tax,shipping,discount,total"));
  assert.ok(html.includes("1 MiB") && html.includes("1,000") && html.includes("USD"));
  assert.ok(buttons(html).includes("Reset this browser&#x27;s demo data"));
  assert.ok(!html.includes("<table"), "cards, not wide tables");
});

test("queue: empty state offers Load demo", () => {
  const html = render(<QueuePage {...queueProps({ batch: null, batches: [], findings: [], demo: { kind: "not_loaded" } })} />);
  assert.ok(buttons(html).includes("Load demo"));
});

test("queue: rejected import lists issues and N more, escaped", () => {
  const issues: ValidationIssue[] = Array.from({ length: 30 }, (_, i) => ({
    row: 121 + i,
    field: "total",
    code: "AMOUNT_FORMAT",
    message: i === 0 ? `bad ${XSS}` : "Amount must be a decimal",
  }));
  issues.push({ row: null, field: null, code: "HEADER_MISMATCH", message: "Header differs" });
  const html = render(
    <QueuePage
      {...queueProps({
        importState: { kind: "done", fileName: "mixed.csv", outcome: { status: "rejected", fileSha256: "f".repeat(64), issues, issueCount: 40 } },
      })}
    />,
  );
  assert.ok(html.includes("Nothing was imported"));
  assert.ok(html.includes("Row 121, field total"));
  assert.ok(html.includes("AMOUNT_FORMAT"));
  assert.ok(html.includes("15 more issues not listed."));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("queue: file-level issue and existing import", () => {
  const html1 = render(
    <QueuePage
      {...queueProps({
        importState: { kind: "done", fileName: "h.csv", outcome: { status: "rejected", fileSha256: "f", issues: [{ row: null, field: null, code: "HEADER_MISMATCH", message: "Header differs" }], issueCount: 1 } },
      })}
    />,
  );
  assert.ok(html1.includes("File") && html1.includes("HEADER_MISMATCH"));
  const html2 = render(<QueuePage {...queueProps({ importState: { kind: "done", fileName: "s.csv", outcome: { status: "existing", batch } } })} />);
  assert.ok(html2.includes("already imported"));
  assert.ok(html2.includes("synthetic demo batch"));
  const html3 = render(<QueuePage {...queueProps({ importState: { kind: "done", fileName: "s.csv", outcome: { status: "storage_error", fileSha256: null, message: "quota" } } })} />);
  assert.ok(html3.includes("could not be saved"));
  assert.ok(!/Imported s\.csv/.test(html3));
  const html4 = render(<QueuePage {...queueProps({ importState: { kind: "error", fileName: "s.csv", message: "Batch changed in another tab. Nothing was imported." } })} />);
  assert.ok(html4.includes("s.csv: Batch changed in another tab. Nothing was imported."), "error rendered as fileName: message");
  assert.ok(!html4.includes("Could not read"));
  assert.equal(html4.split("Nothing was imported").length - 1, 1, "no added sentence");
  assert.match(html4, /role="alert"/);
});
