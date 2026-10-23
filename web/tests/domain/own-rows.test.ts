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
  assert.equal(m.total, 0);
  assert.equal(new Set(Object.values(m)).size, Object.keys(m).length);
});

test("limits", () => {
  const rows = ["v,i,t"];
  for (let i = 0; i < 20_001; i++) rows.push(`V${i},N${i},1.00`);
  const r = buildOwnRows(enc(rows.join("\n")), M, opts);
  assert.ok("error" in r && r.error === "too many rows");
  const big = buildOwnRows(new Uint8Array(10_485_761), M, opts);
  assert.ok("error" in big && big.error === "too large");
  assert.ok("error" in buildOwnRows(new Uint8Array([0xff, 0xfe, 0x41]), M, opts));
  assert.ok("error" in buildOwnRows(enc('a,"b\n'), M, opts));
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
  console.log(`buildOwnRows 20,000 rows: ${ms.toFixed(1)} ms`);
  assert.ok("invoices" in r && r.invoices.length === 20_000);
});

test("skipped rows carry reasons", () => {
  const csv = "v,i,t\nA,1,(250.00)\n,2,5.00\nB,,5.00\nC,3,abc\nD,4,\nE,5,9.99\n\nF,6,250.00-\n";
  const r = buildOwnRows(enc(csv), M, opts);
  assert.ok("invoices" in r);
  assert.deepEqual(r.invoices.map((i) => i.invoiceNorm), ["5"]);
  assert.deepEqual(r.skipped, [
    { row: 2, reason: "credit or negative amount" },
    { row: 3, reason: "missing vendor" },
    { row: 4, reason: "missing invoice number" },
    { row: 5, reason: "not a number" },
    { row: 6, reason: "missing total" },
    { row: 9, reason: "credit or negative amount" },
  ]);
});

test("components, dates and BOM", () => {
  const csv = "﻿v,i,t,s,x,d\nA,1,110.00,100.00,10.00,2026-03-05\nB,2,50.00,,,\nC,3,5.00,5.00,,bad\n";
  const m = { ...M, subtotal: 3, tax: 4, date: 5 };
  const r = buildOwnRows(enc(csv), m, opts);
  assert.ok("invoices" in r);
  assert.equal(r.checksAvailable.totals, true);
  assert.deepEqual(r.invoices.map((i) => [i.hasComponents, i.subtotal, i.tax, i.invoiceDate]), [
    [true, 10000, 1000, "2026-03-05"],
    [false, 0, 0, ""],
  ]);
  assert.deepEqual(r.skipped, [{ row: 4, reason: "unreadable date" }]);
});

test("date order: R1 ambiguity and explicit order", () => {
  const csv = "v,i,t,d\nA,1,1.00,03/04/2026\n";
  const m = { ...M, date: 3 };
  const amb = buildOwnRows(enc(csv), m, opts);
  assert.ok("error" in amb && amb.error === "ambiguous date order");
  const dmy = buildOwnRows(enc(csv), m, { dateOrder: "DMY", fileLabel: "t" });
  assert.ok("invoices" in dmy && dmy.invoices[0]!.invoiceDate === "2026-04-03");
});
