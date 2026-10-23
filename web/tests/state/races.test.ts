/**
 * Regression tests for the two integration races in docs/portfolio-integration-review.md.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import type { CandidateFinding, Invoice } from "../../src/domain/contracts.ts";
import { RULE_MISMATCH } from "../../src/domain/contracts.ts";
import { finalizeBatch } from "../../src/domain/ids.ts";
import { createMemoryStore } from "../../src/state/memoryStore.ts";
import { openIdbStore } from "../../src/state/idbStore.ts";
import { STALE_IMPORT_MESSAGE } from "../../src/state/store.ts";
import type { ReviewStore } from "../../src/state/store.ts";
import { importBytes } from "../../src/state/importer.ts";
import { onCaseLoaded, onConflictShown, onSaved } from "../../src/state/draft.ts";
import { withTimeout } from "../../src/state/openStore.ts";

test("final review #11: a store that opens after the timeout is closed, not leaked", async () => {
  let closed = 0;
  const late = new Promise<{ close(): void }>((resolve) => setTimeout(() => resolve({ close: () => { closed++; } }), 30));
  await assert.rejects(withTimeout(late, 5, (s) => s.close()), /did not respond/);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(closed, 1);
});

const NOW = "2026-10-21T12:00:00Z";
const CSV = new TextEncoder().encode(
  "record_id,vendor_id,invoice_number,invoice_date,currency,subtotal,tax,shipping,discount,total\n" +
  "R-1,V-1,INV-1,2026-01-15,USD,100.00,8.25,5.00,3.00,110.26\n",
);

const inv: Invoice = {
  recordId: "R-1", rowNumber: 1, raw: [], vendorNorm: "V-1", invoiceNorm: "INV-1", invoiceDate: "2026-01-15",
  currency: "USD", subtotal: 10000, tax: 825, shipping: 500, discount: 300, total: 11026,
};
const cand: CandidateFinding = {
  ruleId: RULE_MISMATCH, ruleVersion: "invoice-v1", memberIds: ["R-1"],
  evidence: { kind: RULE_MISMATCH, recordId: "R-1", row: 1, subtotal: "100.00", tax: "8.25", shipping: "5.00",
    discount: "3.00", expected: "110.25", declared: "110.26", delta: "+0.01" },
};

describe("race 1: reset during an in-flight import", () => {
  for (const [name, make] of [
    ["memory", async () => createMemoryStore()],
    ["indexeddb", async () => openIdbStore(new IDBFactory(), "race1")],
  ] as Array<[string, () => Promise<ReviewStore>]>) {
    test(`${name}: import started before a same-tab reset is rejected atomically`, async () => {
      const s = await make();
      const started = await s.getResetGeneration(); // captured before reading/hashing
      await s.resetAll(); // reset commits while the import is "pending"
      const out = await importBytes(s, CSV, { displayName: "late.csv", source: "upload", now: NOW, expectedResetGeneration: started });
      assert.equal(out.status, "storage_error");
      if (out.status === "storage_error") assert.equal(out.message, STALE_IMPORT_MESSAGE);
      assert.equal((await s.listBatches()).length, 0, "no batch recreated after reset");
      const fresh = await importBytes(s, CSV, { displayName: "again.csv", source: "upload", now: NOW, expectedResetGeneration: await s.getResetGeneration() });
      assert.equal(fresh.status, "created");
      s.close();
    });
  }

  test("indexeddb: cross-tab reset while tab A's import is pending", async () => {
    const factory = new IDBFactory();
    const tabA = await openIdbStore(factory, "race1x");
    const tabB = await openIdbStore(factory, "race1x");
    const started = await tabA.getResetGeneration();
    assert.deepEqual(await tabB.resetAll(), { ok: true, resetGeneration: 1 });
    const out = await importBytes(tabA, CSV, { displayName: "a.csv", source: "upload", now: NOW, expectedResetGeneration: started });
    assert.equal(out.status, "storage_error");
    assert.equal((await tabB.listBatches()).length, 0);
    tabA.close();
    tabB.close();
  });

  test("a rejected (invalid) file never touches storage", async () => {
    const s = createMemoryStore();
    const out = await importBytes(s, new TextEncoder().encode("nope\n"), { displayName: "bad.csv", source: "upload", now: NOW, expectedResetGeneration: 0 });
    assert.equal(out.status, "rejected");
    assert.equal((await s.listBatches()).length, 0);
  });
});

describe("race 2: cross-tab refresh must not rebase an existing draft", () => {
  test("stale draft conflicts first, keeps the reason, then submits after explicit rebind", async () => {
    const factory = new IDBFactory();
    const tabA = await openIdbStore(factory, "race2");
    const tabB = await openIdbStore(factory, "race2");
    const p = await finalizeBatch(CSV, [inv], [cand]);
    await tabA.importPrepared(p, { displayName: "a.csv", source: "demo", now: NOW });
    const id = { batchId: p.batchId, findingId: p.findings[0]!.findingId };

    // Tab A opens the unresolved case and starts typing.
    const opened = await tabA.getCase(id.batchId, id.findingId);
    let draft = onCaseLoaded(null, opened!.finding, true, false);
    const reason = "Tab A's reasoning";

    // Tab B confirms then reopens: same state ("open"), different version.
    await tabB.saveDecision({ ...id, action: "confirm", reason: "b1", reviewer: "B", expected: { sequence: 0, resetGeneration: 0 } }, NOW);
    await tabB.saveDecision({ ...id, action: "reopen", reason: "b2", reviewer: "B", expected: { sequence: 1, resetGeneration: 0 } }, NOW);

    // Broadcast refresh in tab A: evidence/history update, draft stays bound to the old version.
    const refreshed = await tabA.getCase(id.batchId, id.findingId);
    draft = onCaseLoaded(draft, refreshed!.finding, false, true);
    assert.equal(draft.stale, true);
    assert.deepEqual(draft.token, { sequence: 0, resetGeneration: 0 });
    assert.equal(refreshed!.history.length, 2);

    const first = await tabA.saveDecision({ ...id, action: "confirm", reason, reviewer: "A", expected: draft.token }, NOW);
    assert.equal(first.status, "conflict", "stale draft must not save silently");
    if (first.status !== "conflict") return;
    const rebound = onConflictShown(first.latest, draft);
    assert.ok(rebound);
    assert.deepEqual(rebound.token, { sequence: 2, resetGeneration: 0 });

    const second = await tabA.saveDecision({ ...id, action: "confirm", reason, reviewer: "A", expected: rebound.token }, NOW);
    assert.equal(second.status, "saved");
    if (second.status === "saved") assert.deepEqual(onSaved(second.finding).token, { sequence: 3, resetGeneration: 0 });
    tabA.close();
    tabB.close();
  });

  test("final review #1: reset + re-import in another tab marks a typed draft stale, never rebinds silently", async () => {
    const factory = new IDBFactory();
    const tabA = await openIdbStore(factory, "race2b");
    const tabB = await openIdbStore(factory, "race2b");
    const p = await finalizeBatch(CSV, [inv], [cand]);
    await tabA.importPrepared(p, { displayName: "a.csv", source: "demo", now: NOW });
    const id = { batchId: p.batchId, findingId: p.findings[0]!.findingId };
    let draft = onCaseLoaded(null, (await tabA.getCase(id.batchId, id.findingId))!.finding, true, false);

    await tabB.resetAll();
    assert.equal(await tabA.getCase(id.batchId, id.findingId), null); // A briefly sees "missing"; binding is kept
    await tabB.importPrepared(p, { displayName: "a.csv", source: "demo", now: NOW, expectedResetGeneration: 1 });
    const back = await tabA.getCase(id.batchId, id.findingId);
    draft = onCaseLoaded(draft, back!.finding, false, true);
    assert.equal(draft.stale, true);
    const out = await tabA.saveDecision({ ...id, action: "confirm", reason: "typed before reset", reviewer: "A", expected: draft.token }, NOW);
    assert.equal(out.status, "conflict");
    if (out.status === "conflict") assert.equal(out.cause, "reset");
    tabA.close();
    tabB.close();
  });

  test("an empty draft simply follows the latest version", () => {
    const f = (sequence: number) => ({ sequence, resetGeneration: 0 }) as never;
    const d = onCaseLoaded(onCaseLoaded(null, f(0), true, false), f(2), false, false);
    assert.deepEqual(d, { token: { sequence: 2, resetGeneration: 0 }, stale: false });
  });
});
