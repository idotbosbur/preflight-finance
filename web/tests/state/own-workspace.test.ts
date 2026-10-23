import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { OWN_BATCH_ID, RULE_DUPLICATE } from "../../src/domain/contracts.ts";
import type { Invoice } from "../../src/domain/contracts.ts";
import { finalizeBatch } from "../../src/domain/ids.ts";
import { createMemoryStore } from "../../src/state/memoryStore.ts";
import { openIdbStore } from "../../src/state/idbStore.ts";
import { importOwnFile } from "../../src/state/ownImporter.ts";
import type { OwnMergeOutcome, ReviewStore } from "../../src/state/store.ts";

const NOW = "2026-10-23T12:00:00Z";
const MAPPING = { vendor: 0, invoiceNumber: 1, date: 2, total: 3 };
const enc = (s: string) => new TextEncoder().encode(s);

const JAN = "Vendor,Invoice,Date,Total\nAcme,INV-1,2026-01-05,100.00\nAcme,INV-1,2026-01-05,100.00\nBeta,INV-9,2026-01-10,50.00\n";
// January again, plus: the same Acme bill re-entered with another date/total, and a new vendor.
const FEB = JAN + "Acme,INV-1,2026-02-03,120.00\nGamma,INV-5,2026-02-04,70.00\n";

async function own(s: ReviewStore, csv: string, name: string): Promise<Extract<OwnMergeOutcome, { status: "merged" }>> {
  const out = await importOwnFile(s, enc(csv), MAPPING, {
    displayName: name, dateOrder: null, now: NOW, expectedResetGeneration: await s.getResetGeneration(),
  });
  assert.ok("status" in out && out.status === "merged", JSON.stringify(out));
  return out as Extract<OwnMergeOutcome, { status: "merged" }>;
}

function suite(name: string, make: () => Promise<ReviewStore>) {
  describe(`${name} own workspace`, () => {
    test("second file adds only new rows and keeps a confirmed finding with its history", async () => {
      const s = await make();
      const jan = await own(s, JAN, "jan.csv");
      assert.equal(jan.added, 3);
      assert.equal(jan.alreadySeen, 0);
      const [pair] = (await s.listFindings(OWN_BATCH_ID)).filter((f) => f.ruleId === RULE_DUPLICATE);
      assert.ok(pair, "January has an exact duplicate");
      const saved = await s.saveDecision({
        batchId: OWN_BATCH_ID, findingId: pair.findingId, action: "confirm", reason: "checked", reviewer: "Me",
        expected: { sequence: 0, resetGeneration: 0 },
      }, NOW);
      assert.equal(saved.status, "saved");

      const feb = await own(s, FEB, "feb.csv");
      assert.equal(feb.added, 2);
      assert.equal(feb.alreadySeen, 3);
      assert.equal(feb.batch.rowCount, 5);
      const kept = await s.getCase(OWN_BATCH_ID, pair.findingId);
      assert.equal(kept?.finding.state, "confirmed");
      assert.equal(kept?.finding.sequence, 1);
      assert.equal(kept?.history.length, 1);
      assert.deepEqual((await s.listOwnFiles()).map((f) => [f.displayName, f.rowsAdded]), [["jan.csv", 3], ["feb.csv", 2]]);
      // Re-importing the same file adds nothing.
      const again = await own(s, FEB, "feb.csv");
      assert.equal(again.added, 0);
      assert.equal(again.alreadySeen, 5);
      assert.equal((await s.listOwnFiles()).length, 2);
      s.close();
    });

    test("a duplicate that spans two files is found", async () => {
      const s = await make();
      await own(s, JAN, "jan.csv");
      await own(s, FEB, "feb.csv");
      const febRow = (await s.listOwnRows()).find((r) => r.invoiceDate === "2026-02-03");
      assert.ok(febRow);
      const dups = (await s.listFindings(OWN_BATCH_ID)).filter((f) => f.ruleId === RULE_DUPLICATE);
      assert.ok(dups.some((f) => f.memberIds.includes(febRow.recordId) && f.memberIds.length >= 2));
      s.close();
    });

    test("deleteOwnData removes own batch, findings and events but leaves the demo batch", async () => {
      const s = await make();
      const demoRow = (id: string): Invoice => ({
        recordId: id, rowNumber: 1, raw: [], vendorNorm: "V", invoiceNorm: "I", invoiceDate: "2026-01-01",
        currency: "USD", subtotal: 0, tax: 0, shipping: 0, discount: 0, total: 100,
      });
      const demo = await finalizeBatch(enc("demo"), [demoRow("R-1"), demoRow("R-2")], [
        { ruleId: RULE_DUPLICATE, ruleVersion: "invoice-v1", memberIds: ["R-1", "R-2"],
          evidence: { kind: RULE_DUPLICATE, key: { vendor: "V", invoice: "I", currency: "USD" }, members: [] } },
      ]);
      assert.equal((await s.importPrepared(demo, { displayName: "demo.csv", source: "demo", now: NOW })).status, "created");
      assert.equal((await s.saveDecision({
        batchId: demo.batchId, findingId: demo.findings[0]!.findingId, action: "confirm", reason: "demo", reviewer: "Me",
        expected: { sequence: 0, resetGeneration: 0 },
      }, NOW)).status, "saved");
      await own(s, JAN, "jan.csv");
      const f = (await s.listFindings(OWN_BATCH_ID))[0]!;
      await s.saveDecision({
        batchId: OWN_BATCH_ID, findingId: f.findingId, action: "dismiss", reason: "ok", reviewer: "Me",
        expected: { sequence: 0, resetGeneration: 0 },
      }, NOW);

      assert.deepEqual(await s.deleteOwnData(), { ok: true });
      assert.deepEqual((await s.listBatches()).map((b) => b.batchId), [demo.batchId]);
      const demoCase = await s.getCase(demo.batchId, demo.findings[0]!.findingId);
      assert.equal(demoCase?.finding.state, "confirmed");
      assert.equal(demoCase?.history.length, 1);
      assert.deepEqual(await s.listFindings(OWN_BATCH_ID), []);
      assert.equal(await s.getCase(OWN_BATCH_ID, f.findingId), null);
      assert.deepEqual(await s.listOwnRows(), []);
      assert.deepEqual(await s.listOwnFiles(), []);
      // A fresh import after deleting starts over: the old decision is gone.
      await own(s, JAN, "jan.csv");
      assert.equal((await s.listFindings(OWN_BATCH_ID))[0]!.state, "open");
      s.close();
    });

    test("a reset between start and merge is a storage_error and stores nothing", async () => {
      const s = await make();
      const expectedResetGeneration = await s.getResetGeneration();
      await s.resetAll();
      const out = await importOwnFile(s, enc(JAN), MAPPING, { displayName: "jan.csv", dateOrder: null, now: NOW, expectedResetGeneration });
      assert.ok("status" in out && out.status === "storage_error");
      assert.deepEqual(await s.listOwnRows(), []);
      s.close();
    });

    test("a finding that is reproduced keeps its state, sequence and history", async () => {
      const s = await make();
      await own(s, JAN, "jan.csv");
      await own(s, FEB, "feb.csv");
      const febRow = (await s.listOwnRows()).find((r) => r.invoiceDate === "2026-02-03")!;
      const group = (await s.listFindings(OWN_BATCH_ID)).find((f) => f.ruleId === RULE_DUPLICATE && f.memberIds.includes(febRow.recordId))!;
      assert.equal((await s.saveDecision({
        batchId: OWN_BATCH_ID, findingId: group.findingId, action: "dismiss", reason: "fine", reviewer: "Me",
        expected: { sequence: 0, resetGeneration: 0 },
      }, NOW)).status, "saved");
      // Third import reproduces the same group; it must stay dismissed (also in the summary).
      const again = await own(s, FEB + "Delta,INV-7,2026-02-09,10.00\n", "feb2.csv");
      assert.equal(again.batch.dismissedCount, 1);
      const kept = await s.getCase(OWN_BATCH_ID, group.findingId);
      assert.equal(kept?.finding.state, "dismissed");
      assert.equal(kept?.finding.sequence, 1);
      assert.equal(kept?.history.length, 1);
      s.close();
    });

    test("an open finding that is no longer reproduced is dropped", async () => {
      const s = await make();
      await own(s, JAN, "jan.csv");
      const pair = (await s.listFindings(OWN_BATCH_ID)).find((f) => f.ruleId === RULE_DUPLICATE)!;
      await own(s, FEB, "feb.csv"); // the pair becomes a 3-member group; the open pair is gone
      assert.equal(await s.getCase(OWN_BATCH_ID, pair.findingId), null);
      assert.ok(!(await s.listFindings(OWN_BATCH_ID)).some((f) => f.findingId === pair.findingId));
      s.close();
    });

    test("deleting own data while a file is importing stores nothing", async () => {
      const s = await make();
      const racing: ReviewStore = {
        ...s,
        listOwnRows: async () => { const rows = await s.listOwnRows(); await s.deleteOwnData(); return rows; },
      };
      const out = await importOwnFile(racing, enc(JAN), MAPPING, {
        displayName: "jan.csv", dateOrder: null, now: NOW, expectedResetGeneration: await s.getResetGeneration(),
      });
      assert.ok("status" in out && out.status === "storage_error");
      assert.match((out as { message: string }).message, /deleted while this file was importing/);
      assert.deepEqual(await s.listOwnRows(), []);
      assert.deepEqual(await s.listFindings(OWN_BATCH_ID), []);
      assert.equal((await s.listBatches()).length, 0);
      s.close();
    });

    test("re-importing a known file keeps its original file record", async () => {
      const s = await make();
      await own(s, JAN, "jan.csv");
      await importOwnFile(s, enc(JAN), MAPPING, {
        displayName: "jan.csv", dateOrder: null, now: "2026-11-01T00:00:00Z", expectedResetGeneration: 0,
      });
      const [f] = await s.listOwnFiles();
      assert.equal(f?.rowsAdded, 3);
      assert.equal(f?.importedAt, NOW);
      s.close();
    });

    test("parse errors are returned without touching storage", async () => {
      const s = await make();
      const out = await importOwnFile(s, enc("Vendor,Invoice,Date,Total\n"), { vendor: 0 }, {
        displayName: "x.csv", dateOrder: null, now: NOW, expectedResetGeneration: 0,
      });
      assert.ok("error" in out);
      assert.deepEqual(await s.listBatches(), []);
      s.close();
    });
  });
}

suite("memory", async () => createMemoryStore());
suite("indexeddb", () => openIdbStore(new IDBFactory()));
