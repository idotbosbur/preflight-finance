/**
 * PARITY of the browser port with the Python reference, using outputs captured by
 * tests/fixtures/reference-parity/capture_reference.py ("python-reference-parity").
 * This is a compatibility oracle, separate from the independent manifest truth labels.
 * Finding and batch IDs are computed with ids.ts finalizeBatch and compared with Python's
 * make_finding_id / batch_id_for as captured (never hand-written).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Checks, compareParityCase, loadParity, loadSut, readParityFile, readProjectBytes, summarizeFailures, WEB_ROOT,
} from "./harness.ts";
import type { Detector, PyCase } from "./harness.ts";

const sut = await loadSut();
const doc = loadParity();

function requireSut(): Detector {
  if (!sut.ok) assert.fail(sut.reason);
  return sut.detector;
}

test("parity oracle is labelled python-reference-parity and covers the requested edge cases", () => {
  assert.equal(doc.source, "python-reference-parity");
  for (const name of [
    "single-bom.csv", "double-bom.csv", "crlf.csv", "cr-only.csv", "quoted-crlf-in-field.csv", "quoted-comma.csv",
    "blank-line-mid.csv", "blank-line-trailing.csv", "eof-inside-quotes.csv", "char-after-closing-quote.csv",
    "bare-quote-unquoted-field.csv", "nul-in-field.csv", "field-over-limit-astral.csv", "field-at-limit-astral.csv",
    "bad-header-then-unterminated-quote.csv", "rows-1001-malformed-after-1000.csv", "negative-zero.csv", "plus-sign.csv",
    "year-0000.csv", "feb-30.csv", "dup-id-after-row-shape.csv", "unicode-digit-amount.csv", "nbsp-padded-identifier.csv",
  ]) {
    assert.ok(doc.cases[name], `missing parity case ${name}`);
  }
});

function parityTest(label: string, bytes: () => Uint8Array, py: PyCase): void {
  test(`${label} (python: ok=${py.ok}, issues=${py.issue_count}, findings=${py.findings.length})`, async () => {
    const det = requireSut();
    const checks = new Checks();
    await compareParityCase(det, label, bytes(), py, checks);
    assert.equal(checks.failures.length, 0, summarizeFailures(checks));
  });
}

for (const [name, py] of Object.entries(doc.cases)) parityTest(`parity edge ${name}`, () => readParityFile(name), py);
for (const [name, py] of Object.entries(doc.demo)) {
  parityTest(`parity demo ${name}`, () => new Uint8Array(readFileSync(join(WEB_ROOT, "public", "demo", name))), py);
}
for (const [rel, py] of Object.entries(doc.manifest_fixtures)) {
  if (rel.endsWith("/main-120.csv") || rel.endsWith("/mixed-128.csv")) continue; // same bytes as demo copies
  parityTest(`parity fixture ${rel}`, () => readProjectBytes(rel), py);
}
