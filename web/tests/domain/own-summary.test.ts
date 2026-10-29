import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPilotSummary, csvCell, summaryCsv } from "../../src/domain/own/summary.ts";
import { OWN_BATCH_ID } from "../../src/domain/contracts.ts";
import type { BatchSummary, FindingView, Invoice } from "../../src/domain/contracts.ts";
import { batch, dupEvidence, finding, mismatchEvidence } from "../ui/fixtures.ts";

const own: BatchSummary = { ...batch, batchId: OWN_BATCH_ID, source: "own", rowCount: 4 };
const inv = (id: string, date: string, vendor: string, num: string): Invoice => ({
  recordId: id, rowNumber: 1, raw: [id, vendor, num, date, "USD", "", "", "", "", "10.00"], vendorNorm: vendor.toUpperCase(),
  invoiceNorm: num, invoiceDate: date, currency: "USD", subtotal: 0, tax: 0, shipping: 0, discount: 0, total: 1000,
});
const rows = [inv("R-0005", "2026-03-02", "Zed Secret Co", "SECRET-1"), inv("R-0009", "", "=EVIL", "X-9"), inv("R-0032", "2026-09-14", "Zed Secret Co", "SECRET-1"), inv("R-0040", "2026-01-05", "Other", "O-1")];
const findings: FindingView[] = [
  finding({ state: "confirmed", ruleId: "DUPLICATE_CANDIDATE", memberIds: ["R-0005", "R-0032"], evidence: dupEvidence, findingId: "d1" }),
  finding({ state: "dismissed", findingId: "m1", memberIds: ["R-0009"], evidence: mismatchEvidence }),
  finding({ state: "open", findingId: "m2", memberIds: ["R-0009"], evidence: mismatchEvidence }),
  finding({ state: "open", ruleId: "NEAR_DUPLICATE", findingId: "n1", memberIds: ["R-0005", "R-0032"] }),
];
const files = [
  { fileSha256: "a", displayName: "private-name.csv", importedAt: "t", rowsAdded: 2, rowsSkipped: 0 },
  { fileSha256: "b", displayName: "b.csv", importedAt: "t", rowsAdded: 2, rowsSkipped: 0 },
];
const reasons = new Map([["d1", "Paid twice, +refund"], ["m1", "Rounding"]]);

test("counts match the fixture workspace", () => {
  const s = buildPilotSummary(own, findings, files, rows, reasons, false);
  assert.equal(s.invoices, 4);
  assert.equal(s.files, 2);
  assert.deepEqual([s.dateFrom, s.dateTo], ["2026-01-05", "2026-09-14"]);
  assert.deepEqual(s.byRule, { duplicate: 1, mismatch: 2, nearDuplicate: 1, paidTwice: 0, noBill: 0, priceUp: 0, monthlyUp: 0, chargedTwice: 0 });
  assert.deepEqual([s.confirmed, s.dismissed, s.open], [1, 1, 2]);
  assert.equal(s.details.length, 0);
});

test("details off: no vendor, invoice, reason or file name in the CSV", () => {
  const csv = summaryCsv(buildPilotSummary(own, findings, files, rows, reasons, false));
  for (const bad of ["Zed", "SECRET", "EVIL", "X-9", "Rounding", "refund", "private-name"]) assert.ok(!csv.includes(bad), bad);
  assert.ok(csv.startsWith("Section,Item,Value,Vendor,Invoice,Reason\r\n"));
  assert.ok(csv.includes("Invoices checked,4"));
});

test("details on: vendor, invoice and reason appear; formula cells and commas are neutralised", () => {
  const s = buildPilotSummary(own, findings, files, rows, reasons, true);
  assert.equal(s.details.length, 4);
  const csv = summaryCsv(s);
  assert.ok(csv.includes("Zed Secret Co,SECRET-1"));
  assert.ok(csv.includes("\"Paid twice, +refund\""));
  assert.ok(csv.includes("'=EVIL"));
  assert.ok(!csv.includes(",=EVIL") && csv.includes(",'=EVIL"));
});

test("csvCell prefixes every formula starter incl. tab and CR, and quotes specials", () => {
  for (const c of ["=1", "+1", "-1", "@x", "\tx", "\rx"]) assert.ok(csvCell(c).replace(/^"/, "").startsWith("'"), JSON.stringify(c));
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("plain"), "plain");
});
