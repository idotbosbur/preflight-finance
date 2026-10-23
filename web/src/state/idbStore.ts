/**
 * IndexedDB adapter. Rules (see docs/portfolio-p1-plan-revision.md):
 * - one transaction per operation, built only from request callbacks (no `await` inside, which
 *   would let the transaction auto-commit early);
 * - success is reported only on transaction `complete`; `error`/`abort` -> storage_error;
 * - `versionchange` closes this connection so another tab's upgrade/reset is never stuck.
 */
import { OWN_BATCH_ID } from "../domain/contracts.ts";
import type {
  BatchImportOutcome, DecisionRequest, PreparedBatch, ReviewEvent, ReviewResult,
} from "../domain/contracts.ts";
import { compareCases, validateDecision } from "./review.ts";
import {
  OWN_DELETED_MESSAGE, STALE_IMPORT_MESSAGE, buildCase, createChannel, decide, deserializeOwnInvoice, makeBatchRecord, makeFindingRecords,
  planOwnMerge, summarize, toFindingView,
} from "./store.ts";
import type { BatchRecord, FindingRecord, ImportMeta, OwnMergeOutcome, ReviewStore } from "./store.ts";

export const DB_NAME = "preflight-demo";
export const DB_VERSION = 1;
const META_KEY = "resetGeneration";
const OWN_META_KEY = "ownGeneration";

function friendly(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === "QuotaExceededError") return "Browser storage is full, so this was not saved.";
  if (name === "VersionError" || name === "InvalidStateError") return "Browser storage changed in another tab; reload this page.";
  return "Browser storage failed, so this was not saved.";
}

export function openIdbStore(factory: IDBFactory, name: string = DB_NAME): Promise<ReviewStore> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("batches")) db.createObjectStore("batches", { keyPath: "batchId" });
      if (!db.objectStoreNames.contains("findings")) {
        db.createObjectStore("findings", { keyPath: ["batchId", "findingId"] }).createIndex("byBatch", "batchId");
      }
      if (!db.objectStoreNames.contains("events")) {
        db.createObjectStore("events", { keyPath: ["batchId", "findingId", "sequence"] })
          .createIndex("byFinding", ["batchId", "findingId"]);
      }
    };
    request.onblocked = () => reject(new Error("Browser storage is blocked by another open Preflight tab."));
    request.onerror = () => reject(request.error ?? new Error("Could not open browser storage."));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(wrap(db));
    };
  });
}

function wrap(db: IDBDatabase): ReviewStore {
  const channel = createChannel();

  /** Run one transaction; `body` calls `set(value)` from request callbacks. Resolves on complete. */
  function run<T>(names: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction, set: (v: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(names, mode);
      } catch (err) {
        reject(err);
        return;
      }
      let value: T | undefined;
      let assigned = false;
      tx.oncomplete = () => (assigned ? resolve(value as T) : reject(new Error("transaction produced no result")));
      tx.onerror = () => reject(tx.error ?? new Error("transaction error"));
      tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
      try {
        body(tx, (v) => { value = v; assigned = true; });
      } catch (err) {
        try { tx.abort(); } catch { /* already finished */ }
        reject(err);
      }
    });
  }

  const readOwnBatch = () => run<BatchRecord | undefined>(["batches"], "readonly", (tx, set) => {
    const r = tx.objectStore("batches").get(OWN_BATCH_ID);
    r.onsuccess = () => set(r.result as BatchRecord | undefined);
  });

  const genOf = (row: unknown): number => (row as { value?: number } | undefined)?.value ?? 0;

  return {
    durability: "persistent",

    async importPrepared(batch: PreparedBatch, meta: ImportMeta): Promise<BatchImportOutcome> {
      try {
        const outcome = await run<BatchImportOutcome>(["meta", "batches", "findings"], "readwrite", (tx, set) => {
          const metaReq = tx.objectStore("meta").get(META_KEY);
          metaReq.onsuccess = () => {
            const generation = genOf(metaReq.result);
            // Atomic stale-import guard: a reset committed after this import started wins.
            if (meta.expectedResetGeneration !== undefined && meta.expectedResetGeneration !== generation) {
              set({ status: "storage_error", fileSha256: batch.fileSha256, message: STALE_IMPORT_MESSAGE });
              return;
            }
            const existingReq = tx.objectStore("batches").get(batch.batchId);
            existingReq.onsuccess = () => {
              const existing = existingReq.result as BatchRecord | undefined;
              if (existing) {
                const all = tx.objectStore("findings").index("byBatch").getAll(batch.batchId);
                all.onsuccess = () => set({ status: "existing", batch: summarize(existing, all.result as FindingRecord[]) });
                return;
              }
              const record = makeBatchRecord(batch, meta, generation);
              const recs = makeFindingRecords(batch, generation);
              tx.objectStore("batches").add(record);
              const fs = tx.objectStore("findings");
              for (const r of recs) fs.add(r);
              set({ status: "created", batch: summarize(record, recs) });
            };
          };
        });
        if (outcome.status === "created") channel.post({ type: "changed" });
        return outcome;
      } catch (err) {
        return { status: "storage_error", fileSha256: batch.fileSha256, message: friendly(err) };
      }
    },

    listBatches() {
      return run(["batches", "findings"], "readonly", (tx, set) => {
        const b = tx.objectStore("batches").getAll();
        const f = tx.objectStore("findings").getAll();
        f.onsuccess = () => {
          const findings = f.result as FindingRecord[];
          const out = (b.result as BatchRecord[]).map((rec) => summarize(rec, findings.filter((x) => x.batchId === rec.batchId)));
          out.sort((x, y) => (x.importedAt < y.importedAt ? 1 : x.importedAt > y.importedAt ? -1 : x.batchId < y.batchId ? -1 : 1));
          set(out);
        };
      });
    },

    getBatch(batchId) {
      return run(["batches", "findings"], "readonly", (tx, set) => {
        const b = tx.objectStore("batches").get(batchId);
        const f = tx.objectStore("findings").index("byBatch").getAll(batchId);
        f.onsuccess = () => {
          const rec = b.result as BatchRecord | undefined;
          set(rec ? summarize(rec, f.result as FindingRecord[]) : null);
        };
      });
    },

    listFindings(batchId) {
      return run(["findings"], "readonly", (tx, set) => {
        const f = tx.objectStore("findings").index("byBatch").getAll(batchId);
        f.onsuccess = () => set((f.result as FindingRecord[]).map(toFindingView).sort(compareCases));
      });
    },

    getCase(batchId, findingId) {
      return run(["batches", "findings", "events"], "readonly", (tx, set) => {
        const b = tx.objectStore("batches").get(batchId);
        const one = tx.objectStore("findings").get([batchId, findingId]);
        const all = tx.objectStore("findings").index("byBatch").getAll(batchId);
        const ev = tx.objectStore("events").index("byFinding").getAll([batchId, findingId]);
        ev.onsuccess = () => {
          const rec = b.result as BatchRecord | undefined;
          const f = one.result as FindingRecord | undefined;
          set(rec && f ? buildCase(rec, f, all.result as FindingRecord[], ev.result as ReviewEvent[]) : null);
        };
      });
    },

    async saveDecision(req: DecisionRequest, now: string): Promise<ReviewResult> {
      const v = validateDecision(req);
      if (!v.ok) return { status: "invalid", errors: v.errors };
      try {
        const result = await run<ReviewResult>(["meta", "findings", "events"], "readwrite", (tx, set) => {
          const metaReq = tx.objectStore("meta").get(META_KEY);
          const cur = tx.objectStore("findings").get([req.batchId, req.findingId]);
          cur.onsuccess = () => {
            const step = decide(cur.result as FindingRecord | undefined, genOf(metaReq.result), req, v.value, now);
            if (step.write) {
              tx.objectStore("findings").put(step.write.finding);
              tx.objectStore("events").add(step.write.event); // add() aborts on a duplicate sequence
            }
            set(step.result);
          };
        });
        if (result.status === "saved") channel.post({ type: "changed" });
        return result;
      } catch (err) {
        return { status: "storage_error", message: friendly(err) };
      }
    },

    async resetAll() {
      try {
        const generation = await run<number>(["meta", "batches", "findings", "events"], "readwrite", (tx, set) => {
          const metaReq = tx.objectStore("meta").get(META_KEY);
          metaReq.onsuccess = () => {
            const next = genOf(metaReq.result) + 1;
            tx.objectStore("batches").clear();
            tx.objectStore("findings").clear();
            tx.objectStore("events").clear();
            tx.objectStore("meta").put({ key: META_KEY, value: next });
            set(next);
          };
        });
        channel.post({ type: "reset" });
        return { ok: true as const, resetGeneration: generation };
      } catch (err) {
        return { ok: false as const, message: friendly(err) };
      }
    },

    async mergeOwn(rows, newFindings, file, now, expectedResetGeneration, expectedOwnGeneration): Promise<OwnMergeOutcome> {
      try {
        const outcome = await run<OwnMergeOutcome>(["meta", "batches", "findings"], "readwrite", (tx, set) => {
          const metaReq = tx.objectStore("meta").get(META_KEY);
          const ownMetaReq = tx.objectStore("meta").get(OWN_META_KEY);
          const batchReq = tx.objectStore("batches").get(OWN_BATCH_ID);
          const oldReq = tx.objectStore("findings").index("byBatch").getAll(OWN_BATCH_ID);
          oldReq.onsuccess = () => {
            const generation = genOf(metaReq.result);
            if (expectedResetGeneration !== generation) {
              set({ status: "storage_error", message: STALE_IMPORT_MESSAGE });
              return;
            }
            if (expectedOwnGeneration !== genOf(ownMetaReq.result)) {
              set({ status: "storage_error", message: OWN_DELETED_MESSAGE });
              return;
            }
            const plan = planOwnMerge(batchReq.result as BatchRecord | undefined, oldReq.result as FindingRecord[],
              rows, newFindings, file, now, generation);
            tx.objectStore("batches").put(plan.batch);
            const fs = tx.objectStore("findings");
            for (const r of plan.put) fs.put(r);
            for (const r of plan.remove) fs.delete([r.batchId, r.findingId]);
            set({ status: "merged", added: plan.added, alreadySeen: plan.alreadySeen, batch: plan.summary });
          };
        });
        if (outcome.status === "merged") channel.post({ type: "changed" });
        return outcome;
      } catch (err) {
        return { status: "storage_error", message: friendly(err) };
      }
    },

    getOwnGeneration() {
      return run<number>(["meta"], "readonly", (tx, set) => {
        const r = tx.objectStore("meta").get(OWN_META_KEY);
        r.onsuccess = () => set(genOf(r.result));
      });
    },

    async listOwnRows() {
      return ((await readOwnBatch())?.invoices ?? []).map(deserializeOwnInvoice);
    },

    async listOwnFiles() {
      return [...((await readOwnBatch())?.files ?? [])];
    },

    async deleteOwnData() {
      try {
        await run<true>(["meta", "batches", "findings", "events"], "readwrite", (tx, set) => {
          const metaReq = tx.objectStore("meta").get(OWN_META_KEY);
          tx.objectStore("batches").delete(OWN_BATCH_ID);
          const keys = tx.objectStore("findings").index("byBatch").getAllKeys(OWN_BATCH_ID);
          keys.onsuccess = () => {
            tx.objectStore("meta").put({ key: OWN_META_KEY, value: genOf(metaReq.result) + 1 });
            const evIndex = tx.objectStore("events").index("byFinding");
            for (const k of keys.result) {
              tx.objectStore("findings").delete(k);
              const evKeys = evIndex.getAllKeys(k);
              evKeys.onsuccess = () => { for (const ek of evKeys.result) tx.objectStore("events").delete(ek); };
            }
            set(true);
          };
        });
        channel.post({ type: "changed" });
        return { ok: true };
      } catch (err) {
        return { ok: false, message: friendly(err) };
      }
    },

    getResetGeneration() {
      return run<number>(["meta"], "readonly", (tx, set) => {
        const r = tx.objectStore("meta").get(META_KEY);
        r.onsuccess = () => set(genOf(r.result));
      });
    },

    subscribe: (listener) => channel.subscribe(listener),
    close() {
      channel.close();
      db.close();
    },
  };
}
