/**
 * Proves the evaluator can fail. A replay of the captured Python reference must PASS every truth
 * and parity check; deliberately broken variants (of the replay and, when available, of the real TS
 * detector) must be reported as failures by the same comparison functions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateParity, evaluateTruth, loadParity, loadSut, summarizeFailures } from "./harness.ts";
import type { Checks } from "./harness.ts";
import { BREAKERS, pythonReplayDetector } from "./oracle.ts";

const doc = loadParity();
const replay = pythonReplayDetector(doc);
const sut = await loadSut();

const failedIds = (c: Checks) => c.failures.map((f) => f.id);

test("control: replay of the Python reference passes all manifest truth checks", () => {
  // Row-order check needs a real parser (reversed bytes were never captured).
  const { checks, metrics } = evaluateTruth(replay, { rowOrderCheck: false });
  assert.equal(checks.failures.length, 0, summarizeFailures(checks));
  assert.ok(checks.list.length > 100, `only ${checks.list.length} checks ran`);
  assert.deepEqual([metrics?.findings, metrics?.affectedRows], [32, 40]);
});

test("control: replay of the Python reference passes all parity checks", async () => {
  const checks = await evaluateParity(replay);
  assert.equal(checks.failures.length, 0, summarizeFailures(checks));
});

const EXPECT: Readonly<Record<string, RegExp>> = {
  "drops one mismatch finding": /main-120\.csv: mismatch confusion/,
  "one-cent tolerance on totals": /main-120\.csv: mismatch confusion/,
  "drops a member from a duplicate group": /main-120\.csv: duplicate groups exact/,
  "flips mismatch delta sign": /main-120\.csv: mismatch delta strings exact/,
  "partially accepts a file with bad rows": /mixed-128\.csv: rejected/,
};

for (const [name, brk] of Object.entries(BREAKERS)) {
  test(`defective replay detector "${name}" is reported as failing (truth and parity)`, async () => {
    const truth = evaluateTruth(brk(replay), { rowOrderCheck: false }).checks;
    assert.ok(truth.failures.length > 0, "truth evaluator did not fail");
    assert.ok(failedIds(truth).some((id) => EXPECT[name]!.test(id)), `expected failure matching ${EXPECT[name]}; got ${failedIds(truth).slice(0, 5).join(" | ")}`);
    const parity = await evaluateParity(brk(replay));
    assert.ok(parity.failures.length > 0, "parity evaluator did not fail");
  });
}

for (const [name, brk] of Object.entries(BREAKERS)) {
  test(`defective TS detector "${name}" (wrapping the real port in-process) is reported as failing`, async () => {
    if (!sut.ok) assert.fail(sut.reason);
    const truth = evaluateTruth(brk(sut.detector)).checks;
    assert.ok(failedIds(truth).some((id) => EXPECT[name]!.test(id)), `expected failure matching ${EXPECT[name]}; got ${failedIds(truth).slice(0, 5).join(" | ")}`);
    const parity = await evaluateParity(brk(sut.detector));
    assert.ok(parity.failures.length > 0, "parity evaluator did not fail");
  });
}
