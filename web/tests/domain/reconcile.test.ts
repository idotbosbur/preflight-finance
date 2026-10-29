import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBankRows, guessBankMapping } from "../../src/domain/own/bank.ts";
import type { BankPayment } from "../../src/domain/own/bank.ts";
import { reconcile, tokenScore } from "../../src/domain/reconcile.ts";
import type { NameScorer } from "../../src/domain/reconcile.ts";
import type { Invoice } from "../../src/domain/contracts.ts";

const csv = (text: string) => new TextEncoder().encode(text);

test("bank: guesses common headers", () => {
  assert.deepEqual(guessBankMapping(["Posting Date", "Description", "Amount", "Balance"]), { date: 0, description: 1, amount: 2 });
  assert.deepEqual(guessBankMapping(["Date", "Details", "Debit", "Credit"]), { date: 0, description: 1, moneyOut: 2 });
});

test("bank: negative amounts are money out when the file has any", () => {
  const out = buildBankRows(csv("Date,Description,Amount\n2026-03-01,ACME SUPPLY,-1850.00\n2026-03-02,DEPOSIT,500.00\n2026-03-03,CITY ELEC,(42.10)\n"),
    { date: 0, description: 1, amount: 2 }, { dateOrder: null, fileLabel: "x.csv" });
  assert.ok(!("error" in out));
  assert.deepEqual(out.payments.map((p) => [p.row, p.date, p.description, p.cents]), [[2, "2026-03-01", "ACME SUPPLY", 185000], [4, "2026-03-03", "CITY ELEC", 4210]]);
  assert.equal(out.credits, 1);
});

test("bank: all-positive card statements are all money out; debit column wins when mapped", () => {
  const card = buildBankRows(csv("Date,Description,Amount\n03/01/2026,SQ *ACME,18.50\n03/15/2026,ADOBE,59.99\n"),
    { date: 0, description: 1, amount: 2 }, { dateOrder: null, fileLabel: "c.csv" });
  assert.ok(!("error" in card));
  assert.deepEqual(card.payments.map((p) => [p.date, p.cents]), [["2026-03-01", 1850], ["2026-03-15", 5999]]);
  const debit = buildBankRows(csv("Date,Details,Debit,Credit\n2026-03-01,ACME,12.00,\n2026-03-02,REFUND,,5.00\n"),
    { date: 0, description: 1, moneyOut: 2 }, { dateOrder: null, fileLabel: "d.csv" });
  assert.ok(!("error" in debit));
  assert.deepEqual(debit.payments.map((p) => p.cents), [1200]);
});

test("bank: a missing required column is an error", () => {
  const out = buildBankRows(csv("Date,Description\n2026-03-01,x\n"), { date: 0, description: 1 }, { dateOrder: null, fileLabel: "x.csv" });
  assert.ok("error" in out && out.error === "missing required column");
});

test("token score: supplier words inside a messy bank line", () => {
  assert.equal(tokenScore("SQ *ACME SUPPLY 4412 HOUSTON TX", "Acme Supply Co."), 1);
  assert.equal(tokenScore("ACMESUPPLY*4412", "Acme Supply"), 1);
  assert.ok(tokenScore("ACME 4412", "Acme Supply") >= 0.55, "a distinctive first word is enough");
  assert.equal(tokenScore("STARBUCKS 123", "Acme Supply"), 0);
});

// ---- reconcile ----
const bill = (id: string, vendor: string, date: string, cents: number): Invoice => ({
  recordId: id, rowNumber: 2, raw: [id, vendor, `INV-${id}`, date, "USD", "", "", "", "", ""], vendorNorm: vendor.toUpperCase(),
  invoiceNorm: `INV-${id}`, invoiceDate: date, currency: "USD", subtotal: 0, tax: 0, shipping: 0, discount: 0, total: cents,
});
const pay = (id: string, date: string, description: string, cents: number): BankPayment => ({ paymentId: id, row: 2, date, description, cents });
const words: NameScorer = (d, v) => ({ score: tokenScore(d, v), how: "name words" });

test("reconcile: one bill paid twice is flagged; monthly bills of one amount are not", () => {
  const bills = [bill("O-1", "Acme Supply", "2026-03-01", 185000), bill("O-2", "Rent Co", "2026-01-01", 50000), bill("O-3", "Rent Co", "2026-02-01", 50000)];
  const pays = [
    pay("P-1", "2026-03-05", "ACH ACME SUPPLY", 185000), pay("P-2", "2026-03-20", "SQ *ACME SUPPLY", 185000),
    pay("P-3", "2026-01-03", "RENT CO", 50000), pay("P-4", "2026-02-03", "RENT CO", 50000),
  ];
  const r = reconcile(bills, pays, words);
  assert.equal(r.findings.length, 1);
  const f = r.findings[0]!;
  assert.equal(f.ruleId, "PAID_TWICE");
  assert.deepEqual(f.memberIds, ["O-1", "P-1", "P-2"]);
  assert.ok(f.evidence.kind === "PAID_TWICE" && f.evidence.payments.length === 2 && f.evidence.payments[0]!.match === "name words");
  assert.equal(r.matched, 4);
});

test("reconcile: a payment outside the 90-day window or before the bill does not match", () => {
  const r = reconcile([bill("O-1", "Acme Supply", "2026-03-01", 1000)],
    [pay("P-1", "2026-02-27", "ACME SUPPLY", 1000), pay("P-2", "2026-06-30", "ACME SUPPLY", 1000)], words);
  assert.equal(r.matched, 0);
  assert.deepEqual(r.findings.map((f) => f.ruleId), ["PAYMENT_NO_BILL", "PAYMENT_NO_BILL"]);
});

test("reconcile: payment to a known supplier with no bill is flagged; unrelated spending is ignored", () => {
  const r = reconcile([bill("O-1", "Acme Supply", "2026-03-01", 1000)],
    [pay("P-1", "2026-03-04", "ACME SUPPLY", 1000), pay("P-2", "2026-03-09", "ACME SUPPLY HOUSTON", 77700), pay("P-3", "2026-03-09", "STARBUCKS", 650)], words);
  assert.deepEqual(r.findings.map((f) => [f.ruleId, f.memberIds]), [["PAYMENT_NO_BILL", ["P-2"]]]);
  const ev = r.findings[0]!.evidence;
  assert.ok(ev.kind === "PAYMENT_NO_BILL" && ev.vendor === "Acme Supply" && ev.payment.amount === "777.00");
});

test("reconcile: bills with no payment inside the statement's dates are counted", () => {
  const r = reconcile([bill("O-1", "Acme", "2026-03-01", 1000), bill("O-2", "Acme", "2026-03-10", 2000), bill("O-3", "Acme", "2025-01-01", 3000)],
    [pay("P-1", "2026-03-02", "ACME", 1000), pay("P-9", "2026-03-30", "STARBUCKS", 1)], words);
  assert.equal(r.unpaidBills, 1);
});

test("reconcile: a second payment in a later month counts against the most recent bill", () => {
  const bills = [bill("O-4", "River Phone Co", "2026-04-01", 8900), bill("O-5", "River Phone Co", "2026-05-01", 8900)];
  const pays = [pay("P-1", "2026-04-05", "RIVER PHONE AUTOPAY", 8900), pay("P-2", "2026-05-04", "RIVER PHONE AUTOPAY", 8900),
    pay("P-3", "2026-05-06", "RIVER PHONE AUTOPAY", 8900)];
  const [f] = reconcile(bills, pays, words).findings;
  assert.deepEqual(f?.memberIds, ["O-5", "P-2", "P-3"]);
});
