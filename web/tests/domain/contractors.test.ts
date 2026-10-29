import { test } from "node:test";
import assert from "node:assert/strict";
import { contractorCsv, contractorTotals, thresholdCents, yearsIn } from "../../src/domain/contractors.ts";
import type { Invoice } from "../../src/domain/contracts.ts";
import { tokenScore } from "../../src/domain/reconcile.ts";

const bill = (vendor: string, date: string, cents: number, currency = "USD"): Invoice => ({
  recordId: `${vendor}-${date}-${cents}`, rowNumber: 2, raw: ["", vendor, "N", date, currency, "", "", "", "", ""], vendorNorm: vendor.toUpperCase(),
  invoiceNorm: "N", invoiceDate: date, currency, subtotal: 0, tax: 0, shipping: 0, discount: 0, total: cents,
});
const words = (a: string, b: string) => ({ score: tokenScore(a, b), how: "name words" });

test("threshold: $600 through 2025, $2,000 from 2026", () => {
  assert.equal(thresholdCents(2025), 60000);
  assert.equal(thresholdCents(2026), 200000);
});

test("totals per payee for one year, grouping spellings of one name, biggest first", () => {
  const bills = [
    bill("Smith Plumbing LLC", "2026-02-01", 150000), bill("J. Smith Plumbing", "2026-06-01", 90000),
    bill("Smith Electric", "2026-03-01", 50000), bill("Acme Supply Inc.", "2026-04-01", 900000),
    bill("Smith Plumbing LLC", "2025-12-30", 99900), bill("Euro Co", "2026-01-01", 500000, "EUR"), bill("No Date", "", 100),
  ];
  const r = contractorTotals(bills, 2026, words);
  assert.deepEqual(r.payees.map((p) => [p.name, p.cents, p.bills]), [
    ["Acme Supply Inc.", 900000, 1], ["Smith Plumbing LLC", 240000, 2], ["Smith Electric", 50000, 1],
  ]);
  const smith = r.payees[1]!;
  assert.deepEqual(smith.names, ["J. Smith Plumbing", "Smith Plumbing LLC"]);
  assert.equal(smith.status, "over");
  assert.equal(r.payees[0]!.status, "corporation");
  assert.equal(r.payees[2]!.status, "under");
  assert.deepEqual([r.otherCurrencyBills, r.undatedBills], [1, 1]);
  assert.deepEqual(r.maybeSame, [], "Smith Electric is not Smith Plumbing");
});

test("payees that may be one person are listed when together they reach the threshold", () => {
  const r = contractorTotals([bill("Maria Lopez Design", "2026-04-01", 120000), bill("Lopez Design Studio", "2026-09-01", 110000),
    bill("Ann Lee Photo", "2026-01-01", 1000), bill("Lee Photo Studio", "2026-02-01", 1000)], 2026, words);
  assert.equal(r.payees.length, 4, "not merged automatically");
  assert.deepEqual(r.maybeSame, [{ a: "Lopez Design Studio", b: "Maria Lopez Design", cents: 230000 }]);
});

test("years found in the bills, newest first", () => {
  assert.deepEqual(yearsIn([bill("A", "2025-01-01", 1), bill("B", "2026-05-01", 1), bill("C", "", 1)]), [2026, 2025]);
});

test("csv lists every payee with status words", () => {
  const csv = contractorCsv(contractorTotals([bill("=Evil", "2026-01-01", 300000)], 2026, words), 2026);
  assert.ok(csv.startsWith("Payee,Other spellings,Bills,Total (USD),Status\r\n"));
  assert.ok(csv.includes("'=Evil"), "formula-looking names are defused");
  assert.ok(csv.includes("3000.00"));
});
