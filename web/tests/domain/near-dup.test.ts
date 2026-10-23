import { test } from "node:test";
import assert from "node:assert/strict";
import { NEAR_DUP_WINDOW_DAYS, RULE_DUPLICATE, RULE_NEAR_DUPLICATE } from "../../src/domain/contracts.ts";
import type { OwnInvoice } from "../../src/domain/own/rows.ts";
import { nearDuplicates, runOwnRules } from "../../src/domain/rules.ts";
import { idForRow, loadNearDupFixture, measureNearDuplicates, pairKey } from "../evaluation/near-dup-eval.ts";

test("near-dup-v1: measured against hand-written labels", () => {
  const m = measureNearDuplicates();
  console.log(`near-dup-v1: pairsLabelled=${m.pairsLabelled} tp=${m.tp} fp=${m.fp} fn=${m.fn}`);
  assert.deepEqual(m.unlabelledFlagged, [], "every flagged pair must be a labelled scenario");
  // Expected from the labels + rule definition (written before the rule existed):
  // fp = weekly cleaning (7 days) and same-day courier; fn = re-entry 20 days later (outside window).
  assert.deepEqual({ pairsLabelled: m.pairsLabelled, tp: m.tp, fp: m.fp, fn: m.fn }, { pairsLabelled: 18, tp: 5, fp: 2, fn: 1 });
});

test("near-dup-v1: evidence, member order and exact-duplicate exclusion", () => {
  const { invoices, labels } = loadNearDupFixture();
  const near = nearDuplicates(invoices, NEAR_DUP_WINDOW_DAYS);
  for (const f of near) {
    assert.equal(f.ruleId, RULE_NEAR_DUPLICATE);
    assert.equal(f.memberIds.length, 2);
    assert.ok(f.memberIds[0]! < f.memberIds[1]!);
  }
  const ts = near.find((f) => f.memberIds.join() === `${idForRow(12)},${idForRow(29)}`);
  assert.deepEqual(ts?.evidence, {
    kind: RULE_NEAR_DUPLICATE, vendor: "TAILSPIN EXAMPLE", total: "2000.00", daysApart: 14,
    members: [
      { recordId: "R012", row: 12, rawVendor: "Tailspin Example", rawInvoice: "TS7781", invoiceDate: "2026-03-01", total: "2000.00" },
      { recordId: "R029", row: 29, rawVendor: "Tailspin Example", rawInvoice: "TS-7781", invoiceDate: "2026-03-15", total: "2000.00" },
    ],
  });
  const exact = labels.exactDuplicatePairs.map((p) => pairKey(idForRow(p.rows[0]), idForRow(p.rows[1])));
  const all = runOwnRules(invoices);
  for (const k of exact) {
    assert.ok(all.some((f) => f.ruleId === RULE_DUPLICATE && f.memberIds.join("|") === k), `exact ${k} flagged`);
    assert.ok(!all.some((f) => f.ruleId === RULE_NEAR_DUPLICATE && f.memberIds.join("|") === k), `exact ${k} not near`);
  }
});

const inv = (row: number, o: Partial<OwnInvoice> = {}): OwnInvoice => ({
  recordId: idForRow(row), rowNumber: row, raw: [], vendorNorm: "V", invoiceNorm: `N${row}`, invoiceDate: "2026-01-01",
  currency: "USD", subtotal: 0, tax: 0, shipping: 0, discount: 0, total: 1000, hasComponents: false, ...o,
});

test("window boundary is inclusive and timezone-free (DST/leap/year boundaries)", () => {
  const days = (a: string, b: string) => nearDuplicates([inv(1, { invoiceDate: a }), inv(2, { invoiceDate: b })], 400);
  assert.equal((days("2026-03-01", "2026-03-15")[0]!.evidence as { daysApart: number }).daysApart, 14);
  assert.equal((days("2026-03-29", "2026-03-08")[0]!.evidence as { daysApart: number }).daysApart, 21);
  assert.equal((days("2024-02-28", "2024-03-01")[0]!.evidence as { daysApart: number }).daysApart, 2);
  assert.equal((days("2025-12-31", "2026-01-01")[0]!.evidence as { daysApart: number }).daysApart, 1);
  assert.equal(nearDuplicates([inv(1, { invoiceDate: "2026-03-01" }), inv(2, { invoiceDate: "2026-03-15" })], 14).length, 1);
  assert.equal(nearDuplicates([inv(1, { invoiceDate: "2026-03-01" }), inv(2, { invoiceDate: "2026-03-16" })], 14).length, 0);
});

test("rows without a date never pair; different vendor, total or currency never pair", () => {
  assert.deepEqual(nearDuplicates([inv(1, { invoiceDate: "" }), inv(2)], 14), []);
  assert.deepEqual(nearDuplicates([inv(1, { invoiceDate: "" }), inv(2, { invoiceDate: "" })], 14), []);
  assert.deepEqual(nearDuplicates([inv(1), inv(2, { vendorNorm: "W" })], 14), []);
  assert.deepEqual(nearDuplicates([inv(1), inv(2, { total: 1001 })], 14), []);
  assert.deepEqual(nearDuplicates([inv(1), inv(2, { currency: "GBP" })], 14), []);
  assert.deepEqual(nearDuplicates([inv(1), inv(2, { invoiceNorm: "N1" })], 14), []);
  assert.equal(nearDuplicates([inv(1), inv(2), inv(3)], 14).length, 3, "one finding per unordered pair");
});

test("runOwnRules: totals only for rows with components; sorted", () => {
  const rows = [inv(2, { vendorNorm: "W", total: 999, subtotal: 1000 }), inv(1, { total: 999, subtotal: 1000, hasComponents: true })];
  const out = runOwnRules(rows);
  assert.deepEqual(out.map((f) => [f.ruleId, ...f.memberIds]), [["TOTAL_MISMATCH", "R001"]]);
  const mixed = runOwnRules([inv(3, { invoiceNorm: "X" }), inv(1, { invoiceNorm: "X" }), inv(2)]);
  assert.deepEqual(mixed.map((f) => [f.ruleId, ...f.memberIds]), [
    ["DUPLICATE_CANDIDATE", "R001", "R003"], ["NEAR_DUPLICATE", "R001", "R002"], ["NEAR_DUPLICATE", "R002", "R003"],
  ]);
});
