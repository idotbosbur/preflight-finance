import { test } from "node:test";
import assert from "node:assert/strict";
import { payeeKey, recurringChecks } from "../../src/domain/recurring.ts";
import type { BankPayment } from "../../src/domain/own/bank.ts";

let n = 0;
const pay = (date: string, description: string, cents: number): BankPayment => ({ paymentId: `P-${++n}`, row: n, date, description, cents });

test("payee key ignores store numbers, card prefixes and reference digits", () => {
  assert.equal(payeeKey("SQ *RIVER PHONE 4412"), payeeKey("RIVER PHONE 9981"));
  assert.notEqual(payeeKey("RIVER PHONE"), payeeKey("OAK RENTALS"));
});

test("a monthly charge that went up is flagged with what it costs a year", () => {
  const pays = [pay("2026-01-05", "COMCAST BUSINESS 123", 9900), pay("2026-02-05", "COMCAST BUSINESS 456", 9900),
    pay("2026-03-05", "COMCAST BUSINESS 789", 11900), pay("2026-04-05", "COMCAST BUSINESS 111", 11900)];
  const f = recurringChecks(pays, new Set());
  assert.equal(f.length, 1);
  const ev = f[0]!.evidence;
  assert.ok(ev.kind === "RECURRING_INCREASE");
  assert.deepEqual([ev.from, ev.to, ev.percent, ev.extra, ev.perYear], ["99.00", "119.00", "20.2", "40.00", "240.00"]);
  assert.equal(ev.payments.length, 4);
});

test("charged twice in one month for a monthly service", () => {
  const pays = [pay("2026-01-10", "ADOBE *CREATIVE CLD", 5999), pay("2026-02-10", "ADOBE *CREATIVE CLD", 5999),
    pay("2026-03-10", "ADOBE *CREATIVE CLD", 5999), pay("2026-03-12", "ADOBE *CREATIVE CLD", 5999)];
  const f = recurringChecks(pays, new Set());
  assert.deepEqual(f.map((x) => x.ruleId), ["CHARGED_TWICE"]);
  const ev = f[0]!.evidence;
  assert.ok(ev.kind === "CHARGED_TWICE" && ev.month === "2026-03" && ev.payments.length === 2 && ev.amount === "59.99");
});

test("not flagged: one-off spending, steady bills, tiny changes, and payments already in a paid-twice finding", () => {
  const pays = [
    pay("2026-01-03", "HOME DEPOT 1", 4512), pay("2026-01-19", "HOME DEPOT 2", 13001), pay("2026-02-07", "HOME DEPOT 3", 899),
    pay("2026-01-01", "RENT", 120000), pay("2026-02-01", "RENT", 120000), pay("2026-03-01", "RENT", 120000),
    pay("2026-01-15", "WATER CO", 3000), pay("2026-02-15", "WATER CO", 3010), pay("2026-03-15", "WATER CO", 3020),
  ];
  assert.deepEqual(recurringChecks(pays, new Set()), []);
  const twice = [pay("2026-01-10", "PHONE", 8900), pay("2026-02-10", "PHONE", 8900), pay("2026-02-12", "PHONE", 8900), pay("2026-03-10", "PHONE", 8900)];
  assert.equal(recurringChecks(twice, new Set()).length, 1);
  assert.equal(recurringChecks(twice, new Set(twice.map((p) => p.paymentId))).length, 0);
});
