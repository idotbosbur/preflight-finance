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

describe("price increases across two Xero line-item files", () => {
  test("the second file's higher unit price is found and kept with its bills", async () => {
    const s = createMemoryStore();
    const head = "*ContactName,*InvoiceNumber,*InvoiceDate,Total,Description,*Quantity,*UnitAmount,Currency\n";
    const jan = head + "Acme Supply,A-1,2026-01-10,170.00,Nitrile gloves L 100ct,10,12.00,USD\nAcme Supply,A-1,2026-01-10,170.00,Freight,1,50.00,USD\n";
    const jun = head + "Acme Supply,A-7,2026-06-10,166.00,NITRILE GLOVES L 100CT,8,14.50,USD\nAcme Supply,A-7,2026-06-10,166.00,Freight,1,50.00,USD\n";
    const m = { vendor: 0, invoiceNumber: 1, date: 2, total: 3, currency: 7 };
    for (const [csv, name] of [[jan, "jan.csv"], [jun, "jun.csv"]] as const) {
      const out = await importOwnFile(s, enc(csv), m, await opts(s, name));
      assert.ok("status" in out && out.status === "merged", JSON.stringify(out));
    }
    const [f] = await s.listFindings(OWN_BATCH_ID);
    assert.ok(f && f.evidence.kind === "PRICE_INCREASE");
    assert.deepEqual([f.evidence.from, f.evidence.to, f.evidence.extra], ["12.00", "14.50", "20.00"]);
    assert.equal((await s.listOwnRows()).every((r) => r.lines?.length === 2), true);
  });
});

describe("a card statement on its own", () => {
  test("finds a monthly charge that went up and one taken twice, with no bills at all", async () => {
    const s = createMemoryStore();
    const card = "Transaction Date,Description,Amount\n2026-01-05,COMCAST BUSINESS 123,99.00\n2026-02-05,COMCAST BUSINESS 456,99.00\n"
      + "2026-03-05,COMCAST BUSINESS 789,119.00\n2026-01-10,ADOBE *CREATIVE CLD,59.99\n2026-02-10,ADOBE *CREATIVE CLD,59.99\n"
      + "2026-03-10,ADOBE *CREATIVE CLD,59.99\n2026-03-12,ADOBE *CREATIVE CLD,59.99\n";
    const out = await importBankFile(s, enc(card), { date: 0, description: 1, amount: 2 }, await opts(s, "card.csv"));
    assert.ok("status" in out && out.status === "merged", JSON.stringify(out));
    assert.deepEqual((await s.listFindings(OWN_BATCH_ID)).map((f) => f.ruleId).sort(), ["CHARGED_TWICE", "RECURRING_INCREASE"]);
  });
});
