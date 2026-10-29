import { test } from "node:test";
import assert from "node:assert/strict";
import { priceIncreases, sameSizes } from "../../src/domain/prices.ts";
import type { OwnInvoice, OwnLine } from "../../src/domain/own/rows.ts";
import { buildOwnRows } from "../../src/domain/own/rows.ts";
import { guessMapping } from "../../src/domain/own/columns.ts";
import { tokenScore } from "../../src/domain/reconcile.ts";
import type { NameScorer } from "../../src/domain/reconcile.ts";

const bill = (id: string, vendor: string, date: string, lines: OwnLine[]): OwnInvoice => ({
  recordId: id, rowNumber: 2, raw: [id, vendor, `INV-${id}`, date, "USD", "", "", "", "", ""], vendorNorm: vendor.toUpperCase(),
  invoiceNorm: `INV-${id}`, invoiceDate: date, currency: "USD", subtotal: 0, tax: 0, shipping: 0, discount: 0, total: 0,
  hasComponents: false, lines,
});
const line = (description: string, unitCents: number, quantity = "1"): OwnLine => ({ description, quantity, unitCents });
const words: NameScorer = (a, b) => ({ score: tokenScore(a, b), how: "name words" });

test("sizes and counts must match before two item names can be the same item", () => {
  assert.equal(sameSizes("Nitrile gloves L 100ct", "Gloves, large, box of 100"), true);
  assert.equal(sameSizes("Nitrile gloves L 100ct", "Nitrile gloves M 100ct"), false);
  assert.equal(sameSizes("Copy paper 10 reams", "Copy paper 5 reams"), false);
});

test("a unit price that rose is flagged with the extra paid since the first price", () => {
  const bills = [
    bill("O-1", "Acme Supply", "2026-01-10", [line("Nitrile gloves L 100ct", 1200, "10"), line("Freight", 5000)]),
    bill("O-2", "Acme Supply", "2026-03-10", [line("Nitrile Gloves L 100ct", 1200, "10")]),
    bill("O-3", "Acme Supply", "2026-06-10", [line("NITRILE GLOVES L 100CT", 1450, "8"), line("Freight", 5000)]),
    bill("O-4", "Acme Supply", "2026-06-11", [line("Nitrile gloves M 100ct", 1500, "1")]),
  ];
  const f = priceIncreases(bills, words);
  assert.equal(f.length, 1);
  const ev = f[0]!.evidence;
  assert.ok(ev.kind === "PRICE_INCREASE");
  assert.deepEqual(f[0]!.memberIds, ["O-1", "O-2", "O-3"]);
  assert.deepEqual([ev.from, ev.to, ev.percent, ev.extra], ["12.00", "14.50", "20.8", "20.00"]);
  assert.equal(ev.purchases.length, 3);
});

test("small or no rises, a single purchase, and different suppliers are not flagged", () => {
  const bills = [
    bill("O-1", "Acme", "2026-01-01", [line("Widget", 10000)]), bill("O-2", "Acme", "2026-02-01", [line("Widget", 10150)]),
    bill("O-3", "Beta", "2026-01-01", [line("Gadget", 1000)]), bill("O-4", "Gamma", "2026-02-01", [line("Gadget", 5000)]),
    bill("O-5", "Acme", "2026-03-01", [line("Sprocket", 1000)]),
  ];
  assert.deepEqual(priceIncreases(bills, words), []);
});

test("a price that went up and came back down is judged on the latest price", () => {
  const bills = [bill("O-1", "Acme", "2026-01-01", [line("Widget", 1000)]), bill("O-2", "Acme", "2026-02-01", [line("Widget", 1500)]),
    bill("O-3", "Acme", "2026-03-01", [line("Widget", 1000)])];
  assert.deepEqual(priceIncreases(bills, words), []);
});

test("Xero line-item export keeps each bill's item lines", () => {
  const csv = "*ContactName,*InvoiceNumber,*InvoiceDate,Total,Description,*Quantity,*UnitAmount,Currency\n"
    + "Initech,LI-1,2026-03-05,220.00,Widgets,2,50.00,USD\nInitech,LI-1,2026-03-05,220.00,Gadgets,1,120.00,USD\n";
  const bytes = new TextEncoder().encode(csv);
  const r = buildOwnRows(bytes, guessMapping(csv.split("\n")[0]!.split(",")), { dateOrder: null, fileLabel: "x" });
  assert.ok("invoices" in r);
  assert.equal(r.checksAvailable.prices, true);
  assert.deepEqual(r.invoices[0]!.lines, [line("Widgets", 5000, "2"), line("Gadgets", 12000, "1")]);
});
