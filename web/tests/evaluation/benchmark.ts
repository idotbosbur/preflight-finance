/**
 * Benchmark producer: writes public/results/benchmark.json (BenchmarkFile).
 *
 *   cd web && node tests/evaluation/benchmark.ts
 *
 * - "browser-port": actually runs the TS detector (src/domain/csv.ts + rules.ts) against the
 *   manifest truth labels for main-120 and every rejection/boundary fixture (evaluateTruth).
 * - "python-reference": actually runs `python -m tests.evaluation.evaluate` from the project root
 *   and reads reports/latest.json. `referenceTests` is included only when
 *   `python -m unittest discover -s tests -t .` was run here and reported OK with an observed count.
 * Raw counts only; no false-positive-rate percentages.
 * Exit 0 = written and all checks passed; 1 = written with failures; 2 = SUT unavailable (not written).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkFile, BenchmarkRun } from "../../src/ui-contracts.ts";
import { evaluateParity, evaluateTruth, loadSut, PROJECT_ROOT, readProjectBytes, sha256Node, summarizeFailures, WEB_ROOT } from "./harness.ts";
import type { Manifest } from "./harness.ts";

const COMMAND = "node tests/evaluation/benchmark.ts";
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const sut = await loadSut();
if (!sut.ok) {
  console.error(`SYSTEM UNDER TEST UNAVAILABLE: ${sut.reason}`);
  process.exit(2);
}

// ---- browser-port run ----
const runAt = nowIso();
const truth = evaluateTruth(sut.detector);
const parity = await evaluateParity(sut.detector);
const m = truth.metrics;
if (!m) {
  console.error("main-120 could not be evaluated:\n" + summarizeFailures(truth.checks));
  process.exit(1);
}
const browser: BenchmarkRun = {
  source: "browser-port",
  runAt,
  command: COMMAND,
  checksPassed: truth.checks.passed,
  checksTotal: truth.checks.list.length,
  duplicate: { ...m.duplicate },
  hardNegatives: { pairs: m.hardNegatives.pairs, falseAlerts: m.hardNegatives.falseAlerts },
  mismatch: { ...m.mismatch },
  findings: m.findings,
  affectedRows: m.affectedRows,
};
console.log(`browser-port: truth ${truth.checks.passed}/${truth.checks.list.length} checks passed; `
  + `parity with Python reference ${parity.passed}/${parity.list.length}`);
if (truth.checks.failures.length) console.log(summarizeFailures(truth.checks));
if (parity.failures.length) console.log(summarizeFailures(parity));

// ---- python-reference run ----
function pythonReferenceRun(manifest: Manifest): BenchmarkRun | null {
  const ev = spawnSync("python", ["-m", "tests.evaluation.evaluate"], { cwd: PROJECT_ROOT, encoding: "utf-8", timeout: 600_000 });
  if (ev.error) {
    console.log(`python-reference: not run (${ev.error.message})`);
    return null;
  }
  console.log(`python -m tests.evaluation.evaluate -> exit ${ev.status}; ${(ev.stdout ?? "").trim().split("\n").filter((l) => / checks passed /.test(l)).join(" ")}`);
  if (ev.status !== 0 && ev.status !== 1) {
    console.log(`python-reference: evaluator did not complete (exit ${ev.status}): ${(ev.stderr ?? "").slice(0, 400)}`);
    return null;
  }
  const r = JSON.parse(readFileSync(join(PROJECT_ROOT, "reports", "latest.json"), "utf-8")) as {
    run_utc: string; command: string; checks_passed: number; checks_total: number;
    measured: {
      duplicate_conformance: { expected_groups: number; reported_groups: number; exact_matches: number };
      semantic_pairs: { pairs: number; TP: number; FP: number; FN: number; TN: number };
      hard_negatives: { pairs: number; false_alerts: number };
      mismatch: { TP: number; FP: number; FN: number; TN: number; exact_delta_matches: number };
      counts: { findings: number; distinct_affected_rows: number };
    };
    unmatched_finding_identities: { duplicate_groups_missing: string[][] };
  };
  const ms = r.measured;
  // Genuine / reuse split derived from the report's missing-group list plus manifest labels.
  const missing = new Set(r.unmatched_finding_identities.duplicate_groups_missing.map((g) => [...g].sort().join(",")));
  const found = manifest.main.duplicate_groups.filter((g) => !missing.has([...g.members].sort().join(",")));
  const run: { -readonly [K in keyof BenchmarkRun]: BenchmarkRun[K] } = {
    source: "python-reference",
    runAt: r.run_utc,
    command: r.command,
    checksPassed: r.checks_passed,
    checksTotal: r.checks_total,
    duplicate: {
      groupsExpected: ms.duplicate_conformance.expected_groups, groupsFlagged: ms.duplicate_conformance.reported_groups,
      groupsExact: ms.duplicate_conformance.exact_matches, genuineGroups: found.filter((g) => g.genuine).length,
      legitimateReuseGroups: found.filter((g) => !g.genuine).length, pairTP: ms.semantic_pairs.TP, pairFP: ms.semantic_pairs.FP,
      pairFN: ms.semantic_pairs.FN, pairTN: ms.semantic_pairs.TN, pairTotal: ms.semantic_pairs.pairs,
    },
    hardNegatives: { pairs: ms.hard_negatives.pairs, falseAlerts: ms.hard_negatives.false_alerts },
    mismatch: { tp: ms.mismatch.TP, fp: ms.mismatch.FP, fn: ms.mismatch.FN, tn: ms.mismatch.TN, exactDeltas: ms.mismatch.exact_delta_matches },
    findings: ms.counts.findings,
    affectedRows: ms.counts.distinct_affected_rows,
  };
  const ut = spawnSync("python", ["-m", "unittest", "discover", "-s", "tests", "-t", "."], { cwd: PROJECT_ROOT, encoding: "utf-8", timeout: 600_000 });
  const tail = `${ut.stdout ?? ""}\n${ut.stderr ?? ""}`;
  const ran = /Ran (\d+) tests? in/.exec(tail);
  const ok = /\nOK(\s|$|\s\()/.test(tail);
  console.log(`python -m unittest discover -s tests -t . -> exit ${ut.status}; ${ran ? ran[0] : "no count"}; ${ok ? "OK" : "not OK"}`);
  if (ut.status === 0 && ran && ok) run.referenceTests = Number(ran[1]);
  return run;
}

const manifest = truth.manifest;
const python = pythonReferenceRun(manifest);
const mainRel = manifest.main.file;
const file: BenchmarkFile = {
  fixtureVersion: manifest.version,
  fixtureSeed: manifest.seed,
  datasetSha256: sha256Node(readProjectBytes(mainRel)),
  manifestSha256: truth.manifestSha256,
  runs: python ? [browser, python] : [browser],
  limitations: [
    "Duplicate detection is within one batch only: a duplicate split across two uploaded files is not detected (known limitation, asserted by the split-batch fixtures).",
    "Synthetic, self-constructed benchmark: invented figures generated and labelled within the same AI-assisted build that wrote the rules; it says nothing about real-world accuracy, fraud detection or money saved.",
    "The exact-key duplicate rule cannot tell legitimate invoice-number reuse from a genuine duplicate: the 2 legitimate reuse groups are flagged by design and need a human to dismiss them.",
    "Review history is stored only in this browser (IndexedDB), unauthenticated and per device: it is not an audit trail, is not shared, and can be cleared by the visitor.",
  ],
};
const outDir = join(WEB_ROOT, "public", "results");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "benchmark.json"), JSON.stringify(file, null, 2) + "\n", "utf-8");
console.log(`wrote public/results/benchmark.json (runs: ${file.runs.map((r) => `${r.source} ${r.checksPassed}/${r.checksTotal}`).join(", ")})`);
const allPass = truth.checks.failures.length === 0 && parity.failures.length === 0 && (!python || python.checksPassed === python.checksTotal);
process.exit(allPass ? 0 : 1);
