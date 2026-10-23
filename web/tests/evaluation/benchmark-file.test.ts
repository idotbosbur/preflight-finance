/** Shape and honesty checks for public/results/benchmark.json (produced by benchmark.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkFile } from "../../src/ui-contracts.ts";
import { loadManifest, readProjectBytes, sha256Node, WEB_ROOT } from "./harness.ts";
import { loadNearDupFixture } from "./near-dup-eval.ts";

const path = join(WEB_ROOT, "public", "results", "benchmark.json");

test("public/results/benchmark.json matches BenchmarkFile, manifest hashes and raw-count policy", () => {
  assert.ok(existsSync(path), "benchmark.json not generated yet: run `node tests/evaluation/benchmark.ts` from web/");
  const text = readFileSync(path, "utf-8");
  const b = JSON.parse(text) as BenchmarkFile;
  const { manifest, sha256 } = loadManifest();
  assert.equal(b.fixtureVersion, manifest.version);
  assert.equal(b.fixtureSeed, manifest.seed);
  assert.equal(b.manifestSha256, sha256);
  assert.equal(b.datasetSha256, sha256Node(readProjectBytes(manifest.main.file)));
  assert.ok(!/%|precision|recall|fpr|rate/i.test(JSON.stringify(b.runs)), "runs must carry raw counts only");
  const sources = b.runs.map((r) => r.source);
  assert.ok(sources.includes("browser-port"), "browser-port run missing");
  assert.equal(new Set(sources).size, sources.length, "duplicate run sources");
  for (const r of b.runs) {
    assert.match(r.runAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(r.command.length > 0);
    assert.ok(Number.isInteger(r.checksPassed) && r.checksPassed <= r.checksTotal && r.checksTotal > 0);
    const d = r.duplicate;
    assert.equal(d.pairTP + d.pairFP + d.pairFN + d.pairTN, d.pairTotal, `${r.source} pair counts sum`);
    assert.equal(r.mismatch.tp + r.mismatch.fp + r.mismatch.fn + r.mismatch.tn, manifest.main.rows.length, `${r.source} mismatch sum`);
    if (r.source === "browser-port") assert.equal(r.referenceTests, undefined, "referenceTests is Python-only");
  }
  const nd = b.nearDuplicate;
  assert.ok(nd, "nearDuplicate missing");
  const { labels } = loadNearDupFixture();
  assert.equal(nd.pairsLabelled, labels.pairs.length);
  assert.equal(nd.tp + nd.fn, labels.pairs.filter((p) => p.genuine).length, "tp + fn = genuine labelled pairs");
  assert.ok([nd.tp, nd.fp, nd.fn].every((n) => Number.isInteger(n) && n >= 0));
  assert.ok(b.limitations.length >= 4);
  for (const needle of [/within one batch/i, /self-constructed/i, /legitimate/i, /browser|unauthenticated/i]) {
    assert.ok(b.limitations.some((l) => needle.test(l)), `limitation ${needle} missing`);
  }
});
