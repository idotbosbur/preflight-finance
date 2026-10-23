/**
 * Rule tests. Expected outputs were observed by running the Python reference
 * (src/preflight/rules run_all on validate_bytes output for the same CSV text).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CandidateFinding, Invoice } from "../../src/domain/contracts.ts";
import { CSV_HEADER, RULE_DUPLICATE, RULE_MISMATCH } from "../../src/domain/contracts.ts";
import { parseInvoiceCsv } from "../../src/domain/csv.ts";
import { duplicateEvidence, mismatchEvidence } from "../../src/domain/evidence.ts";
import { compareFindings, runInvoiceRules } from "../../src/domain/rules.ts";

const H = CSV_HEADER.join(",");
interface RowOpts { rid?: string; v?: string; inv?: string; s?: string; t?: string; sh?: string; dc?: string; tot?: string }
function row(o: RowOpts = {}): string {
  return [o.rid ?? "R-1", o.v ?? "V-1", o.inv ?? "INV-1", "2026-01-15", "USD",
    o.s ?? "100.00", o.t ?? "8.25", o.sh ?? "5.00", o.dc ?? "3.00", o.tot ?? "110.25"].join(",");
}
function invoices(rows: string[]): readonly Invoice[] {
  const r = parseInvoiceCsv(new TextEncoder().encode([H, ...rows].join("\n") + "\n"));
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  return r.invoices;
}
const summary = (fs: readonly CandidateFinding[]) => fs.map((f) => [f.ruleId, ...f.memberIds]);

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

test("spec example: 100.00 + 8.25 + 5.00 - 3.00 = 110.25, declared 110.26 -> +0.01", () => {
  const fs = runInvoiceRules(invoices([row({ tot: "110.26" })]));
  assert.equal(fs.length, 1);
  assert.deepEqual(fs[0], {
    ruleId: RULE_MISMATCH,
    ruleVersion: "invoice-v1",
    memberIds: ["R-1"],
    evidence: {
      kind: RULE_MISMATCH, recordId: "R-1", row: 1, subtotal: "100.00", tax: "8.25", shipping: "5.00",
      discount: "3.00", expected: "110.25", declared: "110.26", delta: "+0.01",
    },
  });
});

test("matching totals yield no mismatch finding", () => {
  assert.deepEqual(runInvoiceRules(invoices([row()])), []);
});

test("a group of three is one duplicate finding with members sorted by recordId", () => {
  const fs = runInvoiceRules(invoices([row({ rid: "R-3" }), row({ rid: "R-1", v: "v-1", inv: " inv-1" }), row({ rid: "R-2" })]));
  assert.equal(fs.length, 1);
  assert.deepEqual(fs[0], {
    ruleId: RULE_DUPLICATE,
    ruleVersion: "invoice-v1",
    memberIds: ["R-1", "R-2", "R-3"],
    evidence: {
      kind: RULE_DUPLICATE,
      key: { vendor: "V-1", invoice: "INV-1", currency: "USD" },
      members: [
        { recordId: "R-1", row: 2, rawVendor: "v-1", rawInvoice: " inv-1", invoiceDate: "2026-01-15", total: "110.25" },
        { recordId: "R-2", row: 3, rawVendor: "V-1", rawInvoice: "INV-1", invoiceDate: "2026-01-15", total: "110.25" },
        { recordId: "R-3", row: 1, rawVendor: "V-1", rawInvoice: "INV-1", invoiceDate: "2026-01-15", total: "110.25" },
      ],
    },
  });
});

test("INV-01, INV01 and INV-1 stay distinct", () => {
  assert.deepEqual(runInvoiceRules(invoices([row({ rid: "R-1", inv: "INV-01" }), row({ rid: "R-2", inv: "INV01" }), row({ rid: "R-3", inv: "INV-1" })])), []);
});

test("inconsistent totals do not hide duplicates; a row can appear in both rules", () => {
  const fs = runInvoiceRules(invoices([row({ rid: "R-1", tot: "110.26" }), row({ rid: "R-2", tot: "99.00" }), row({ rid: "R-3", inv: "OTHER", tot: "110.24" })]));
  assert.deepEqual(summary(fs), [
    [RULE_DUPLICATE, "R-1", "R-2"],
    [RULE_MISMATCH, "R-1"],
    [RULE_MISMATCH, "R-2"],
    [RULE_MISMATCH, "R-3"],
  ]);
  assert.deepEqual(fs.map((f) => (f.evidence.kind === RULE_MISMATCH ? f.evidence.delta : null)), [null, "+0.01", "-11.25", "-0.01"]);
  const dup = fs[0]!.evidence;
  assert.equal(dup.kind, RULE_DUPLICATE);
  assert.deepEqual(dup.kind === RULE_DUPLICATE ? dup.members.map((m) => m.total) : [], ["110.26", "99.00"]);
});

test("max-amount arithmetic and signed deltas", () => {
  const fs = runInvoiceRules(invoices([
    row({ rid: "R-a", v: "V-3", inv: "Y", s: "999999999.99", t: "999999999.99", sh: "999999999.99", dc: "0.00", tot: "0.00" }),
    row({ rid: "R-B", v: "V-3", inv: "Y", s: "0.00", t: "0.00", sh: "0.00", dc: "0.00", tot: "999999999.99" }),
  ]));
  assert.deepEqual(summary(fs), [[RULE_DUPLICATE, "R-B", "R-a"], [RULE_MISMATCH, "R-B"], [RULE_MISMATCH, "R-a"]]);
  const a = fs[2]!.evidence;
  assert.ok(a.kind === RULE_MISMATCH);
  assert.equal(a.expected, "2999999999.97");
  assert.equal(a.delta, "-2999999999.97");
  const b = fs[1]!.evidence;
  assert.ok(b.kind === RULE_MISMATCH);
  assert.equal(b.delta, "+999999999.99");
});

test("ordering parity with Python tuple sort (code-unit, case-sensitive)", () => {
  const ids = ["b", "B", "a-1", "a", "A", "a_", "Z", "_"];
  const rows = [
    ...ids.map((r, i) => row({ rid: r, v: `V-${i}`, inv: "X", tot: "1.00" })),
    ...ids.map((r, i) => row({ rid: `${r}2`, v: `V-${i}`, inv: "X" })),
  ];
  const want = [
    ...["A", "B", "Z", "_", "a", "a-1", "a_", "b"].map((r) => [RULE_DUPLICATE, r, r === "a-1" ? "a-12" : `${r}2`]),
    ...["A", "B", "Z", "_", "a", "a-1", "a_", "b"].map((r) => [RULE_MISMATCH, r]),
  ];
  const invs = invoices(rows);
  assert.deepEqual(summary(runInvoiceRules(invs)), want);
  // Shorter prefix first, element-wise (Python-observed order).
  const mk = (ruleId: typeof RULE_DUPLICATE | typeof RULE_MISMATCH, memberIds: string[]): CandidateFinding =>
    ({ ruleId, ruleVersion: "invoice-v1", memberIds, evidence: { kind: RULE_DUPLICATE, key: { vendor: "", invoice: "", currency: "USD" }, members: [] } });
  const input = [
    mk(RULE_DUPLICATE, ["R-1", "R-2"]), mk(RULE_DUPLICATE, ["R-1"]), mk(RULE_MISMATCH, ["R-0"]), mk(RULE_DUPLICATE, ["R-0", "R-9"]),
    mk(RULE_DUPLICATE, ["R-1", "R-10"]), mk(RULE_DUPLICATE, ["r-1"]), mk(RULE_DUPLICATE, ["R-10"]),
  ];
  assert.deepEqual(input.slice().sort(compareFindings).map((f) => [f.ruleId, ...f.memberIds]), [
    [RULE_DUPLICATE, "R-0", "R-9"], [RULE_DUPLICATE, "R-1"], [RULE_DUPLICATE, "R-1", "R-10"], [RULE_DUPLICATE, "R-1", "R-2"],
    [RULE_DUPLICATE, "R-10"], [RULE_DUPLICATE, "r-1"], [RULE_MISMATCH, "R-0"],
  ]);
});

test("shuffled input gives identical output", () => {
  const rows = [
    row({ rid: "R-1", tot: "110.26" }), row({ rid: "R-2" }), row({ rid: "R-3", inv: "INV-2" }), row({ rid: "R-4", inv: "inv-2", tot: "1.00" }),
    row({ rid: "R-5", inv: "INV-3" }), row({ rid: "R-6", v: "V-2", inv: "INV-1", tot: "0.01" }), row({ rid: "R-7", v: "V-2", inv: "INV-1" }),
    row({ rid: "R-8", v: "V-2", inv: "INV-1" }),
  ];
  const invs = invoices(rows);
  const base = runInvoiceRules(invs);
  assert.deepEqual(summary(base), [
    [RULE_DUPLICATE, "R-1", "R-2"], [RULE_DUPLICATE, "R-3", "R-4"], [RULE_DUPLICATE, "R-6", "R-7", "R-8"],
    [RULE_MISMATCH, "R-1"], [RULE_MISMATCH, "R-4"], [RULE_MISMATCH, "R-6"],
  ]);
  for (let seed = 1; seed <= 25; seed++) assert.deepEqual(runInvoiceRules(shuffled(invs, seed)), base);
});

test("evidence builders", () => {
  const invs = invoices([row({ rid: "R-2", tot: "0.00" }), row({ rid: "R-1" })]);
  assert.deepEqual(duplicateEvidence(invs).members.map((m) => m.recordId), ["R-1", "R-2"]);
  assert.throws(() => duplicateEvidence(invs.slice(0, 1)), RangeError);
  const m = mismatchEvidence(invs[0]!);
  assert.equal(m.delta, "-110.25");
  assert.equal(m.expected, "110.25");
  assert.equal(m.declared, "0.00");
});
