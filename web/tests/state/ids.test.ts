import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBatchId, makeFindingId, sha256Hex } from "../../src/domain/ids.ts";
import { compareTuples, normalizeIdentifier, asciiTrim, codePointLength } from "../../src/domain/contracts.ts";

test("sha256 matches known vectors", async () => {
  assert.equal(await sha256Hex(new Uint8Array()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("finding id parity with Python make_finding_id", async () => {
  assert.equal(await makeFindingId("TOTAL_MISMATCH", "invoice-v1", ["R-1"]), PY.mismatchR1);
  assert.equal(await makeFindingId("DUPLICATE_CANDIDATE", "invoice-v1", ["R-1", "R-2"]), PY.dupR1R2);
  assert.equal(await makeBatchId("0".repeat(64)), PY.batchZeros);
});

test("tuple comparator matches Python tuple order", () => {
  const items = [["A-1"], ["A", "Z"], ["a"], ["A"], ["B"]];
  items.sort(compareTuples);
  assert.deepEqual(items, [["A"], ["A", "Z"], ["A-1"], ["B"], ["a"]]);
});

test("ascii trim and normalize do not touch non-ASCII space", () => {
  assert.equal(asciiTrim("  x \t"), "  x");
  assert.equal(normalizeIdentifier("  inv-01 "), "INV-01");
  assert.equal(normalizeIdentifier("éa"), "éA");
  assert.equal(codePointLength("\u{1F600}a"), 2);
});

// From an actual run of the Python reference (preflight.contracts.make_finding_id /
// preflight.storage.batch_id_for), 2026-10-21; never guessed.
const PY = {
  mismatchR1: "e96f011396fddc6d",
  dupR1R2: "f960e583c66f6c22",
  batchZeros: "5ccb7f638952b3d8",
};
