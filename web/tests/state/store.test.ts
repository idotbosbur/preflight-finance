import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import type { CandidateFinding, DecisionRequest, Invoice, PreparedBatch } from "../../src/domain/contracts.ts";
import { RULE_DUPLICATE, RULE_MISMATCH } from "../../src/domain/contracts.ts";
import { finalizeBatch } from "../../src/domain/ids.ts";
import { createMemoryStore } from "../../src/state/memoryStore.ts";
import { openIdbStore } from "../../src/state/idbStore.ts";
import type { ReviewStore } from "../../src/state/store.ts";

const NOW = "2026-10-21T12:00:00Z";

function inv(recordId: string, row: number, total: number): Invoice {
  return {
    recordId, rowNumber: row, raw: [recordId, "V-1", "INV-1", "2026-01-15", "USD", "100.00", "8.25", "5.00", "3.00", (total / 100).toFixed(2)],
    vendorNorm: "V-1", invoiceNorm: "INV-1", invoiceDate: "2026-01-15", currency: "USD",
    subtotal: 10000, tax: 825, shipping: 500, discount: 300, total,
  };
}

const INVOICES = [inv("R-1", 1, 11026), inv("R-2", 2, 11025)];
const CANDIDATES: CandidateFinding[] = [
  { ruleId: RULE_DUPLICATE, ruleVersion: "invoice-v1", memberIds: ["R-1", "R-2"],
    evidence: { kind: RULE_DUPLICATE, key: { vendor: "V-1", invoice: "INV-1", currency: "USD" }, members: [] } },
  { ruleId: RULE_MISMATCH, ruleVersion: "invoice-v1", memberIds: ["R-1"],
    evidence: { kind: RULE_MISMATCH, recordId: "R-1", row: 1, subtotal: "100.00", tax: "8.25", shipping: "5.00",
      discount: "3.00", expected: "110.25", declared: "110.26", delta: "+0.01" } },
];

async function prepared(bytes = "file-a"): Promise<PreparedBatch> {
  return finalizeBatch(new TextEncoder().encode(bytes), INVOICES, CANDIDATES);
}

function req(p: PreparedBatch, action: DecisionRequest["action"], sequence: number, resetGeneration = 0, reason = "checked"): DecisionRequest {
  return { batchId: p.batchId, findingId: p.findings[1]!.findingId, action, reason, reviewer: "Demo reviewer",
    expected: { sequence, resetGeneration } };
}

type Factory = () => Promise<ReviewStore>;

function suite(name: string, make: Factory) {
  describe(`${name} store semantics`, () => {
    test("import is idempotent by file hash; changed bytes create a new batch", async () => {
      const s = await make();
      const p = await prepared();
      const a = await s.importPrepared(p, { displayName: "a.csv", source: "upload", now: NOW });
      assert.equal(a.status, "created");
      assert.equal((await s.saveDecision(req(p, "confirm", 0), NOW)).status, "saved");
      const again = await s.importPrepared(p, { displayName: "renamed.csv", source: "upload", now: NOW });
      assert.equal(again.status, "existing");
      if (again.status !== "existing") return;
      assert.equal(again.batch.confirmedCount, 1, "decisions preserved on re-import");
      assert.equal(again.batch.displayName, "a.csv");
      const other = await s.importPrepared(await prepared("file-b"), { displayName: "b.csv", source: "upload", now: NOW });
      assert.equal(other.status, "created");
      assert.equal((await s.listBatches()).length, 2);
      s.close();
    });

    test("confirm -> reopen -> dismiss appends ordered history; case order open first", async () => {
      const s = await make();
      const p = await prepared();
      await s.importPrepared(p, { displayName: "a.csv", source: "demo", now: NOW });
      assert.equal((await s.saveDecision(req(p, "confirm", 0, 0, "one"), NOW)).status, "saved");
      assert.equal((await s.saveDecision(req(p, "reopen", 1, 0, "two"), NOW)).status, "saved");
      const last = await s.saveDecision(req(p, "dismiss", 2, 0, "three"), NOW);
      assert.equal(last.status, "saved");
      const c = await s.getCase(p.batchId, p.findings[1]!.findingId);
      assert.ok(c);
      assert.deepEqual(c.history.map((e) => [e.sequence, e.prevState, e.nextState, e.reason]),
        [[1, "open", "confirmed", "one"], [2, "confirmed", "open", "two"], [3, "open", "dismissed", "three"]]);
      assert.deepEqual(c.members.map((m) => m.total), [11026]);
      const order = await s.listFindings(p.batchId);
      assert.deepEqual(order.map((f) => f.state), ["open", "dismissed"]);
      s.close();
    });

    test("stale token conflicts and keeps state; invalid transition and input rejected", async () => {
      const s = await make();
      const p = await prepared();
      await s.importPrepared(p, { displayName: "a.csv", source: "demo", now: NOW });
      await s.saveDecision(req(p, "confirm", 0, 0, "tab one"), NOW);
      const stale = await s.saveDecision(req(p, "dismiss", 0, 0, "tab two"), NOW);
      assert.equal(stale.status, "conflict");
      if (stale.status === "conflict") {
        assert.equal(stale.cause, "stale");
        assert.equal(stale.latest?.state, "confirmed");
      }
      assert.equal((await s.saveDecision(req(p, "confirm", 1), NOW)).status, "invalid_transition");
      const bad = await s.saveDecision({ ...req(p, "confirm", 1), reason: "  " }, NOW);
      assert.equal(bad.status, "invalid");
      const long = await s.saveDecision({ ...req(p, "reopen", 1), reason: "\u{1F600}".repeat(501) }, NOW);
      assert.equal(long.status, "invalid", "limit counts code points");
      const ok500 = await s.saveDecision({ ...req(p, "reopen", 1), reason: "\u{1F600}".repeat(500) }, NOW);
      assert.equal(ok500.status, "saved");
      assert.equal((await s.saveDecision({ ...req(p, "confirm", 0), findingId: "0000000000000000" }, NOW)).status, "not_found");
      const c = await s.getCase(p.batchId, p.findings[1]!.findingId);
      assert.equal(c?.history.length, 2);
      s.close();
    });

    test("reset bumps generation: stale tab cannot write after reset (no ABA)", async () => {
      const s = await make();
      const p = await prepared();
      await s.importPrepared(p, { displayName: "a.csv", source: "demo", now: NOW });
      await s.saveDecision(req(p, "confirm", 0), NOW); // stale tab now holds {gen 0, seq 1}
      const reset = await s.resetAll();
      assert.deepEqual(reset, { ok: true, resetGeneration: 1 });
      assert.equal((await s.listBatches()).length, 0);
      await s.importPrepared(p, { displayName: "a.csv", source: "demo", now: NOW });
      assert.equal((await s.saveDecision(req(p, "confirm", 0, 1), NOW)).status, "saved"); // fresh tab -> seq 1 again
      const aba = await s.saveDecision(req(p, "reopen", 1, 0), NOW);
      assert.equal(aba.status, "conflict");
      if (aba.status === "conflict") assert.equal(aba.cause, "reset");
      s.close();
    });
  });
}

suite("memory", async () => createMemoryStore());
suite("indexeddb", async () => openIdbStore(new IDBFactory(), "t"));

describe("failure handling", () => {
  test("memory: failed commit reports storage_error and changes nothing", async () => {
    const s = createMemoryStore();
    const p = await prepared();
    s.faults.failNextWrite = "quota";
    const out = await s.importPrepared(p, { displayName: "a.csv", source: "demo", now: NOW });
    assert.equal(out.status, "storage_error");
    assert.equal((await s.listBatches()).length, 0);
    await s.importPrepared(p, { displayName: "a.csv", source: "demo", now: NOW });
    s.faults.failNextWrite = "quota";
    assert.equal((await s.saveDecision(req(p, "confirm", 0), NOW)).status, "storage_error");
    assert.equal((await s.getCase(p.batchId, p.findings[1]!.findingId))?.finding.sequence, 0);
  });

  test("indexeddb: closed connection never reports saved", async () => {
    const s = await openIdbStore(new IDBFactory(), "closed");
    const p = await prepared();
    await s.importPrepared(p, { displayName: "a.csv", source: "demo", now: NOW });
    s.close();
    const out = await s.saveDecision(req(p, "confirm", 0), NOW);
    assert.equal(out.status, "storage_error");
  });

  test("indexeddb: history survives reopening (reload) and two tabs conflict", async () => {
    const factory = new IDBFactory();
    const tabA = await openIdbStore(factory, "shared");
    const tabB = await openIdbStore(factory, "shared");
    const p = await prepared();
    await tabA.importPrepared(p, { displayName: "a.csv", source: "demo", now: NOW });
    assert.equal((await tabA.saveDecision(req(p, "confirm", 0, 0, "from A"), NOW)).status, "saved");
    const fromB = await tabB.saveDecision(req(p, "dismiss", 0, 0, "from B"), NOW);
    assert.equal(fromB.status, "conflict");
    tabA.close();
    tabB.close();
    const reloaded = await openIdbStore(factory, "shared");
    const c = await reloaded.getCase(p.batchId, p.findings[1]!.findingId);
    assert.deepEqual(c?.history.map((e) => e.reason), ["from A"]);
    reloaded.close();
  });
});
