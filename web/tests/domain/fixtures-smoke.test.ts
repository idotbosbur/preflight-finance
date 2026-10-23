/**
 * Smoke tests on the real generated fixtures (counts only; the independent evaluator does the full
 * label comparison and this test never reads the manifest).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RULE_DUPLICATE, RULE_MISMATCH } from "../../src/domain/contracts.ts";
import { parseInvoiceCsv } from "../../src/domain/csv.ts";
import { runInvoiceRules } from "../../src/domain/rules.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../fixtures/out/${name}`, import.meta.url)));

test("main-120.csv imports and yields 12 duplicate + 20 mismatch candidates", () => {
  const r = parseInvoiceCsv(fixture("main-120.csv"));
  assert.equal(r.ok, true, JSON.stringify(r.issues.slice(0, 5)));
  assert.equal(r.invoices.length, 120);
  const fs = runInvoiceRules(r.invoices);
  assert.equal(fs.filter((f) => f.ruleId === RULE_DUPLICATE).length, 12);
  assert.equal(fs.filter((f) => f.ruleId === RULE_MISMATCH).length, 20);
});

test("mixed-128.csv is rejected with exactly 8 issues on rows 121-128", () => {
  const r = parseInvoiceCsv(fixture("mixed-128.csv"));
  assert.equal(r.ok, false);
  assert.equal(r.invoices.length, 0);
  assert.equal(r.issueCount, 8);
  assert.deepEqual(r.issues.map((i) => i.row), [121, 122, 123, 124, 125, 126, 127, 128]);
});
