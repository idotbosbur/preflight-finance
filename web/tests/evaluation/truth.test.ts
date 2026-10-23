/**
 * TRUTH evaluation of the browser port against the independent fixture manifest
 * (fixtures/manifest/invoice-fixtures-v1.json). Labels are never derived from detector output.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Checks, evaluateBoundaryExtras, evaluateMain, evaluateManifestFile, loadManifest, loadSut, readProjectBytes,
  sha256Node, summarizeFailures,
} from "./harness.ts";
import type { Detector } from "./harness.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_ROOT } from "./harness.ts";

const sut = await loadSut();
const { manifest } = loadManifest();

function requireSut(): Detector {
  if (!sut.ok) assert.fail(sut.reason);
  return sut.detector;
}

test("public demo files are byte-identical to the manifest fixtures", () => {
  for (const name of ["main-120.csv", "mixed-128.csv"]) {
    const pub = new Uint8Array(readFileSync(join(WEB_ROOT, "public", "demo", name)));
    const src = readProjectBytes(`fixtures/out/${name}`);
    assert.equal(sha256Node(pub), manifest.files[`fixtures/out/${name}`]!.sha256, `${name} sha256 vs manifest`);
    assert.deepEqual(pub, src, `${name} bytes`);
  }
});

test("system under test is available (src/domain/csv.ts parseInvoiceCsv, rules.ts runInvoiceRules)", () => {
  requireSut();
});

test("main-120 against manifest truth labels", () => {
  const det = requireSut();
  const checks = new Checks();
  const m = evaluateMain(det, manifest, checks);
  assert.equal(checks.failures.length, 0, summarizeFailures(checks));
  assert.ok(m);
  // Explicit planned targets (mirrors manifest planned_targets; asserted literally as a second guard).
  assert.deepEqual(
    [m.duplicate.groupsExpected, m.duplicate.groupsFlagged, m.duplicate.groupsExact, m.duplicate.genuineGroups, m.duplicate.legitimateReuseGroups],
    [12, 12, 12, 10, 2]);
  assert.deepEqual([m.duplicate.pairTP, m.duplicate.pairFP, m.duplicate.pairFN, m.duplicate.pairTN, m.duplicate.pairTotal], [10, 2, 0, 7128, 7140]);
  assert.deepEqual([m.hardNegatives.pairs, m.hardNegatives.falseAlerts, m.hardNegatives.nearDuplicateFalseAlerts], [14, 2, 0]);
  assert.deepEqual([...m.hardNegatives.alertedPairIds].sort(), ["DG-11", "DG-12"]);
  assert.deepEqual([m.mismatch.tp, m.mismatch.fp, m.mismatch.fn, m.mismatch.tn, m.mismatch.exactDeltas], [20, 0, 0, 100, 20]);
  assert.deepEqual([m.findings, m.affectedRows], [32, 40]);
});

test("mixed-128 is rejected with exactly the 8 manifest issues on rows 121-128", () => {
  const det = requireSut();
  const rel = "fixtures/out/mixed-128.csv";
  const checks = new Checks();
  const res = evaluateManifestFile(det, rel, manifest.files[rel]!, checks);
  assert.equal(checks.failures.length, 0, summarizeFailures(checks));
  assert.ok(res && !res.ok);
  assert.equal(res.invoices.length, 0);
  assert.equal(res.issueCount, 8);
  const want = manifest.files[rel]!.expected.issues.map((i) => [i.row, i.field, i.code]);
  assert.deepEqual(res.issues.map((i) => [i.row, i.field, i.code]), want);
  assert.deepEqual(res.issues.map((i) => i.row), [121, 122, 123, 124, 125, 126, 127, 128]);
});

for (const [rel, meta] of Object.entries(manifest.files)) {
  if (meta.kind === "main" || meta.kind === "mixed") continue;
  test(`manifest ${meta.kind} fixture ${rel} (${meta.expected.accepted ? "accepted" : "rejected"})`, () => {
    const det = requireSut();
    const checks = new Checks();
    evaluateManifestFile(det, rel, meta, checks);
    assert.equal(checks.failures.length, 0, summarizeFailures(checks));
  });
}

test("boundary extras: BOM+CRLF equivalence and the split-across-batches KNOWN LIMITATION", () => {
  const det = requireSut();
  const checks = new Checks();
  evaluateBoundaryExtras(det, checks);
  assert.equal(checks.failures.length, 0, summarizeFailures(checks));
});
