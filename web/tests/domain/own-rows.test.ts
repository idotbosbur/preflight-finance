import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guessMapping, REQUIRED_FIELDS } from "../../src/domain/own/columns.ts";
import { buildOwnRows } from "../../src/domain/own/rows.ts";

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`../fixtures/own/${n}`, import.meta.url)));
const headersOf = (n: string) => new TextDecoder().decode(fx(n)).split("\n")[0]!.trim().split(",");
const enc = (s: string) => new TextEncoder().encode(s);
const opts = { dateOrder: null, fileLabel: "t.csv" } as const;
const M = { vendor: 0, invoiceNumber: 1, total: 2 };

test("QuickBooks fixture", () => {
  const m = guessMapping(headersOf("quickbooks-bills.csv"));
  assert.deepEqual(m, { vendor: 0, invoiceNumber: 2, date: 1, total: 4 });
  const r = buildOwnRows(fx("quickbooks-bills.csv"), m, opts);
  assert.ok("invoices" in r);
  assert.equal(r.invoices.length, 4);
  assert.equal(r.skipped.length, 0);
  const a = r.invoices[0]!;
  assert.equal(a.total, 123456);
  assert.equal(a.invoiceDate, "2026-03-05");
  assert.equal(a.vendorNorm, "ACME TEST SUPPLIES");
  assert.equal(a.currency, "USD");
  assert.equal(a.hasComponents, false);
  assert.equal(a.rowNumber, 2);
  assert.equal(a.recordId, "");
  assert.deepEqual(a.raw, ["", "Acme Test Supplies", "INV-1001", "03/05/2026", "", "", "", "", "", "$1,234.56"]);
  assert.equal(r.checksAvailable.totals, false);
});

test("Xero fixture", () => {
  const m = guessMapping(headersOf("xero-bills.csv"));
  assert.deepEqual(m, { vendor: 0, invoiceNumber: 1, date: 2, total: 4, tax: 5, currency: 6 });
  const r = buildOwnRows(fx("xero-bills.csv"), m, { dateOrder: null, fileLabel: "x" });
  assert.ok("invoices" in r);
  assert.equal(r.invoices[1]!.currency, "GBP");
  assert.equal(r.invoices[1]!.tax, 1008);
  assert.equal(r.invoices[0]!.invoiceDate, "2026-03-05");
});

test("missing invoice number header", () => {
  const m = guessMapping(headersOf("excel-simple.csv"));
  assert.equal(m.invoiceNumber, undefined);
  assert.ok(REQUIRED_FIELDS.includes("invoiceNumber"));
  const r = buildOwnRows(fx("excel-simple.csv"), m, opts);
  assert.ok("error" in r && r.error === "missing required column");
});

test("guessMapping never uses a column twice", () => {
  const m = guessMapping(["Amount", "Total", "Vendor"]);
  assert.equal(m.total, 1); // synonym priority beats column position
  assert.equal(m.vendor, 2);
  assert.equal(new Set(Object.values(m)).size, Object.keys(m).length);
});

test("limits", () => {
  const rows = ["v,i,t"];
  for (let i = 0; i < 20_001; i++) rows.push(`V${i},N${i},1.00`);
  const r = buildOwnRows(enc(rows.join("\n")), M, opts);
  assert.ok("error" in r && r.error === "too many rows");
  const big = buildOwnRows(new Uint8Array(10_485_761), M, opts);
  assert.ok("error" in big && big.error === "too large");
  const bad8 = buildOwnRows(new Uint8Array([0xff, 0xfe, 0x41]), M, opts);
  assert.ok("error" in bad8 && bad8.error === "not a CSV");
  const badq = buildOwnRows(enc('a,"b\n'), M, opts);
  assert.ok("error" in badq && badq.error === "not a CSV");
  const h = buildOwnRows(enc(""), M, opts);
  assert.ok("error" in h && h.error === "no header");
});

test("20,000 rows build time", () => {
  const rows = ["v,i,t,d"];
  for (let i = 0; i < 20_000; i++) rows.push(`Vendor ${i % 500},N${i},"${i}.25",3/${(i % 28) + 1}/2026`);
  const bytes = enc(rows.join("\r\n"));
  const t0 = performance.now();
  const r = buildOwnRows(bytes, { ...M, date: 3 }, { dateOrder: "MDY", fileLabel: "t" });
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `took ${ms} ms`);
  assert.ok("invoices" in r && r.invoices.length === 20_000);
});

test("skipped rows carry reasons", () => {
  const csv = "v,i,t\nA,1,(250.00)\n,2,5.00\nB,,5.00\nC,3,abc\nD,4,\nE,5,9.99\n\nF,6,250.00-\n";
  const r = buildOwnRows(enc(csv), M, opts);
  assert.ok("invoices" in r);
  assert.deepEqual(r.invoices.map((i) => i.invoiceNorm), ["5"]);
  assert.deepEqual(r.skipped, [
    { row: 2, reason: "total: credit or negative amount" },
    { row: 3, reason: "missing vendor" },
    { row: 4, reason: "missing invoice number" },
    { row: 5, reason: "total: not a number" },
    { row: 6, reason: "missing total" },
    { row: 9, reason: "total: credit or negative amount" },
  ]);
});

test("components and dates", () => {
  const csv = "v,i,t,s,x,d\nA,1,110.00,100.00,10.00,2026-03-05\nB,2,50.00,,,\nC,3,5.00,5.00,,bad\n";
  const m = { ...M, subtotal: 3, tax: 4, date: 5 };
  const r = buildOwnRows(enc(csv), m, opts);
  assert.ok("invoices" in r);
  assert.equal(r.checksAvailable.totals, true);
  assert.deepEqual(r.invoices.map((i) => [i.hasComponents, i.subtotal, i.tax, i.invoiceDate]), [
    [true, 10000, 1000, "2026-03-05"],
    [false, 0, 0, ""],
    [true, 500, 0, ""],
  ]);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.invoices[2]!.invoiceDate, "");
  assert.deepEqual(r.warnings.map((w) => [w.row, w.field]), [[4, "date"]]);
  assert.match(r.warnings[0]!.reason, /^unreadable date/);
});

test("date order: R1 ambiguity and explicit order", () => {
  const csv = "v,i,t,d\nA,1,1.00,03/04/2026\n";
  const m = { ...M, date: 3 };
  const amb = buildOwnRows(enc(csv), m, opts);
  assert.ok("error" in amb && amb.error === "ambiguous date order");
  const dmy = buildOwnRows(enc(csv), m, { dateOrder: "DMY", fileLabel: "t" });
  assert.ok("invoices" in dmy && dmy.invoices[0]!.invoiceDate === "2026-04-03");
});


test("unrecognised date format imports every row with one warning", () => {
  const csv = "v,i,t,d\nA,1,1.00,5-Mar-26\nB,2,2.00,6-Mar-26\n";
  const r = buildOwnRows(enc(csv), { ...M, date: 3 }, opts);
  assert.ok("invoices" in r);
  assert.equal(r.invoices.length, 2);
  assert.deepEqual(r.invoices.map((i) => i.invoiceDate), ["", ""]);
  assert.equal(r.skipped.length, 0);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0]!.field, "date");
});

test("negative discount uses its absolute value; other negatives still skip", () => {
  const csv = "v,i,t,s,x,d\nA,1,90.00,100.00,0,-10.00\nB,2,90.00,100.00,0,(10.00)\nC,3,90.00,100.00,0,10.00-\nD,4,90.00,-100.00,0,0\nE,5,-9.00,1.00,0,0\n";
  const r = buildOwnRows(enc(csv), { ...M, subtotal: 3, tax: 4, discount: 5 }, opts);
  assert.ok("invoices" in r);
  assert.deepEqual(r.invoices.map((i) => i.discount), [1000, 1000, 1000]);
  assert.deepEqual(r.skipped, [
    { row: 5, reason: "subtotal: credit or negative amount" },
    { row: 6, reason: "total: credit or negative amount" },
  ]);
});

test("guessMapping prefers InvoiceNumber over Reference regardless of order", () => {
  const m = guessMapping(["Reference", "ContactName", "InvoiceNumber", "Total"]);
  assert.equal(m.invoiceNumber, 2);
  assert.deepEqual(guessMapping(["Supplier Name", "Inv #", "Amount Due"]), { vendor: 0, invoiceNumber: 1, total: 2 });
});

// --- line-item rows of one bill are combined ---
import { runOwnRules } from "../../src/domain/rules.ts";

test("Xero line-item fixture: header mapping", () => {
  const m = guessMapping(headersOf("xero-line-items.csv"));
  assert.equal(m.vendor, 0);
  assert.equal(m.invoiceNumber, 2);
  assert.equal(m.date, 3);
  assert.equal(m.total, 5);
  assert.equal(m.tax, 6);
  assert.equal(m.currency, 11);
});

test("Xero line-item fixture: rows of one bill combine, no false duplicate", () => {
  const r = buildOwnRows(fx("xero-line-items.csv"), guessMapping(headersOf("xero-line-items.csv")), opts);
  assert.ok("invoices" in r);
  assert.equal(r.invoices.length, 2);
  assert.equal(r.invoices[0]!.rowNumber, 2);
  assert.equal(r.invoices[0]!.total, 30000);
  assert.deepEqual(r.warnings.filter((w) => w.row === 0), [
    { row: 0, field: "rows", reason: "3 line-item rows were combined into 1 invoice (same vendor, invoice number, date, total and currency)" },
  ]);
  assert.deepEqual(runOwnRules(r.invoices), []);
});

test("different date is not combined and is still flagged", () => {
  const csv = "v,n,d,t\nAcme,A1,2026-03-01,10.00\nAcme,A1,2026-03-02,10.00\n";
  const r = buildOwnRows(enc(csv), { vendor: 0, invoiceNumber: 1, date: 2, total: 3 }, opts);
  assert.ok("invoices" in r);
  assert.equal(r.invoices.length, 2);
  assert.ok(runOwnRules(r.invoices).length > 0);
  assert.equal(r.warnings.some((w) => w.field === "rows"), false);
});

test("combined components: identical kept, differing drop to hasComponents false", () => {
  const M2 = { vendor: 0, invoiceNumber: 1, total: 2, subtotal: 3 };
  const same = buildOwnRows(enc("v,n,t,s,Description\nAcme,A1,100.00,100.00,one\nAcme,A1,100.00,100.00,two\n"), M2, opts);
  assert.ok("invoices" in same);
  assert.equal(same.invoices.length, 1);
  assert.equal(same.invoices[0]!.hasComponents, true);
  assert.equal(same.invoices[0]!.subtotal, 10000);
  assert.match(same.warnings.find((w) => w.field === "rows")!.reason, /^2 line-item rows were combined into 1 invoice/);
  const diff = buildOwnRows(enc("v,n,t,s,Description\nAcme,A1,100.00,40.00,x\nAcme,A1,100.00,60.00,y\n"), M2, opts);
  assert.ok("invoices" in diff);
  assert.equal(diff.invoices.length, 1);
  assert.equal(diff.invoices[0]!.hasComponents, false);
  assert.equal(diff.invoices[0]!.subtotal, 0);
  assert.equal(runOwnRules(diff.invoices).length, 0);
});

test("a row identical in every cell is a re-entry, not a line item", () => {
  const r = buildOwnRows(enc("v,n,t\nAcme,A1,10.00\nAcme,A1,10.00\n"), M, opts);
  assert.ok("invoices" in r);
  assert.equal(r.invoices.length, 2);
  assert.equal(r.warnings.some((w) => w.field === "rows"), false);
});

test("R20: QuickBooks-shaped bill twice, differing only in Open Balance, stays 2 invoices and is flagged", () => {
  const head = "Vendor,Date,Bill No.,Due Date,Amount,Open Balance";
  const csv = [head,
    "Acme Test Supplies,03/05/2026,INV-1001,04/04/2026,$100.00,$100.00",
    "Acme Test Supplies,03/05/2026,INV-1001,04/04/2026,$100.00,$0.00", ""].join("\n");
  const r = buildOwnRows(enc(csv), guessMapping(head.split(",")), { ...opts, dateOrder: "MDY" });
  assert.ok("invoices" in r);
  assert.equal(r.invoices.length, 2);
  assert.equal(r.warnings.some((w) => w.field === "rows"), false);
  assert.ok(runOwnRules(r.invoices).some((f) => f.ruleId === "DUPLICATE_CANDIDATE"));
});

test("R20: line-item header but rows equal in every line-item column are not combined", () => {
  const r = buildOwnRows(enc(["v,n,t,Description,Note", "Acme,A1,10.00,Widgets,a", "Acme,A1,10.00,Widgets,b", ""].join("\n")), M, opts);
  assert.ok("invoices" in r);
  assert.equal(r.invoices.length, 2);
});

test("M9: bill-level TaxTotal outranks line-level Tax Amount", () => {
  assert.equal(guessMapping(["Vendor", "Tax Amount", "TaxTotal"]).tax, 2);
});
