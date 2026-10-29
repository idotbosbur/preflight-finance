import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { OWN_BATCH_ID, RULE_PAID_TWICE, RULE_PAYMENT_NO_BILL } from "../../src/domain/contracts.ts";
import { createMemoryStore } from "../../src/state/memoryStore.ts";
import { openIdbStore } from "../../src/state/idbStore.ts";
import { importBankFile, importOwnFile } from "../../src/state/ownImporter.ts";
import type { ReviewStore } from "../../src/state/store.ts";

const NOW = "2026-10-29T12:00:00Z";
const enc = (s: string) => new TextEncoder().encode(s);
const BILLS = "Vendor,Invoice,Date,Total\nAcme Supply Co.,INV-1,2026-03-01,1850.00\nCity Electric,E-77,2026-03-05,42.10\n";
const BANK = "Date,Description,Amount\n2026-03-04,ACH ACME SUPPLY,-1850.00\n2026-03-18,SQ *ACME SUPPLY 4412,-1850.00\n"
  + "2026-03-09,CITY ELECTRIC,-42.10\n2026-03-20,ACME SUPPLY HOUSTON,-300.00\n2026-03-21,STARBUCKS,-6.50\n2026-03-22,DEPOSIT,900.00\n";
const BANK_MAP = { date: 0, description: 1, amount: 2 };
const opts = async (s: ReviewStore, name: string) => ({ displayName: name, dateOrder: null, now: NOW, expectedResetGeneration: await s.getResetGeneration() });

function suite(name: string, make: () => Promise<ReviewStore>) {
  describe(`${name} bank vs bills`, () => {
    test("a statement finds the double payment and the payment with no bill; re-adding it changes nothing", async () => {
      const s = await make();
      const bills = await importOwnFile(s, enc(BILLS), { vendor: 0, invoiceNumber: 1, date: 2, total: 3 }, await opts(s, "bills.csv"));
      assert.ok("status" in bills && bills.status === "merged");
      const out = await importBankFile(s, enc(BANK), BANK_MAP, await opts(s, "bank.csv"));
      assert.ok("status" in out && out.status === "merged", JSON.stringify(out));
      assert.equal(out.added, 5, "five money-out lines, the deposit is ignored");
      assert.deepEqual(out.report, { payments: 5, matched: 3, unpaidBills: 0, ai: false, paidTwice: 1, noBill: 1 });
      const kinds = (await s.listFindings(OWN_BATCH_ID)).map((f) => f.ruleId).sort();
      assert.deepEqual(kinds, [RULE_PAID_TWICE, RULE_PAYMENT_NO_BILL]);
      assert.equal((await s.listOwnPayments()).length, 5);
      assert.equal((await s.listOwnFiles()).find((f) => f.displayName === "bank.csv")?.kind, "bank");

      const again = await importBankFile(s, enc(BANK), BANK_MAP, await opts(s, "bank.csv"));
      assert.ok("status" in again && again.status === "merged");
      assert.deepEqual([again.added, again.alreadySeen], [0, 5]);
      assert.equal((await s.listFindings(OWN_BATCH_ID)).length, 2);

      // Adding more bills keeps the statement in play.
      const more = await importOwnFile(s, enc(BILLS + "Acme Supply Co.,INV-2,2026-03-15,300.00\n"), { vendor: 0, invoiceNumber: 1, date: 2, total: 3 }, await opts(s, "bills2.csv"));
      assert.ok("status" in more && more.status === "merged");
      assert.deepEqual((await s.listFindings(OWN_BATCH_ID)).map((f) => f.ruleId), [RULE_PAID_TWICE]);

      assert.ok((await s.deleteOwnData()).ok);
      assert.deepEqual(await s.listOwnPayments(), []);
      s.close();
    });
  });
}

suite("memory", async () => createMemoryStore());
suite("indexeddb", () => openIdbStore(new IDBFactory()));
