/**
 * In-memory adapter: used when browser storage is unavailable ("this tab only") and in tests.
 * `faults` lets tests simulate a failing commit (quota/blocked/aborted) without faking success.
 */
import { OWN_BATCH_ID } from "../domain/contracts.ts";
import type { BatchImportOutcome, DecisionRequest, ReviewEvent, ReviewResult } from "../domain/contracts.ts";
import { validateDecision, compareCases } from "./review.ts";
import {
  OWN_RESET_MESSAGE, STALE_IMPORT_MESSAGE, ownStaleMessage, buildCase, decide, deserializeOwnInvoice, makeBatchRecord, makeFindingRecords, planOwnMerge,
  summarize, toFindingView,
} from "./store.ts";
import type { BatchRecord, FindingRecord, ImportMeta, OwnMergeOutcome, ReviewStore, StoreChange } from "./store.ts";
import type { PreparedBatch } from "../domain/contracts.ts";

export interface MemoryFaults {
  /** When set, the next write commit fails with this message (then clears). */
  failNextWrite?: string;
}

export function createMemoryStore(faults: MemoryFaults = {}): ReviewStore & { faults: MemoryFaults } {
  let generation = 0;
  let ownGeneration = 0;
  let batches = new Map<string, BatchRecord>();
  let findings = new Map<string, FindingRecord>(); // key `${batchId}/${findingId}`
  let events: ReviewEvent[] = [];
  const listeners = new Set<(c: StoreChange) => void>();
  const key = (b: string, f: string) => `${b}/${f}`;
  const findingsOf = (batchId: string) => [...findings.values()].filter((f) => f.batchId === batchId);

  /** Commit a write atomically: build the next state, then swap only if no fault fires. */
  function commit(apply: () => void): string | null {
    if (faults.failNextWrite) {
      const msg = faults.failNextWrite;
      faults.failNextWrite = undefined;
      return msg;
    }
    apply();
    return null;
  }

  return {
    durability: "memory",
    faults,
    async importPrepared(batch: PreparedBatch, meta: ImportMeta): Promise<BatchImportOutcome> {
      if (meta.expectedResetGeneration !== undefined && meta.expectedResetGeneration !== generation) {
        return { status: "storage_error", fileSha256: batch.fileSha256, message: STALE_IMPORT_MESSAGE };
      }
      const existing = batches.get(batch.batchId);
      if (existing) return { status: "existing", batch: summarize(existing, findingsOf(batch.batchId)) };
      const record = makeBatchRecord(batch, meta, generation);
      const recs = makeFindingRecords(batch, generation);
      const error = commit(() => {
        batches.set(record.batchId, record);
        for (const r of recs) findings.set(key(r.batchId, r.findingId), r);
      });
      if (error) return { status: "storage_error", fileSha256: batch.fileSha256, message: error };
      return { status: "created", batch: summarize(record, recs) };
    },
    async listBatches() {
      return [...batches.values()].map((b) => summarize(b, findingsOf(b.batchId)))
        .sort((a, b) => (a.importedAt < b.importedAt ? 1 : a.importedAt > b.importedAt ? -1 : a.batchId < b.batchId ? -1 : 1));
    },
    async getBatch(batchId) {
      const b = batches.get(batchId);
      return b ? summarize(b, findingsOf(batchId)) : null;
    },
    async listFindings(batchId) {
      return findingsOf(batchId).map(toFindingView).sort(compareCases);
    },
    async getCase(batchId, findingId) {
      const b = batches.get(batchId);
      const f = findings.get(key(batchId, findingId));
      if (!b || !f) return null;
      return buildCase(b, f, findingsOf(batchId), events.filter((e) => e.batchId === batchId && e.findingId === findingId));
    },
    async saveDecision(req: DecisionRequest, now: string): Promise<ReviewResult> {
      const v = validateDecision(req);
      if (!v.ok) return { status: "invalid", errors: v.errors };
      const step = decide(findings.get(key(req.batchId, req.findingId)), generation, req, v.value, now);
      if (!step.write) return step.result;
      const { finding, event } = step.write;
      const error = commit(() => {
        findings.set(key(finding.batchId, finding.findingId), finding);
        events = [...events, event];
      });
      if (error) return { status: "storage_error", message: error };
      return step.result;
    },
    async resetAll() {
      const error = commit(() => {
        // Demo reset keeps the own workspace, re-stamped with the new generation (R22).
        const next = generation + 1;
        const ownBatch = batches.get(OWN_BATCH_ID);
        const ownFindings = findingsOf(OWN_BATCH_ID);
        batches = new Map();
        findings = new Map();
        if (ownBatch) batches.set(OWN_BATCH_ID, { ...ownBatch, resetGeneration: next });
        for (const f of ownFindings) findings.set(key(f.batchId, f.findingId), { ...f, resetGeneration: next });
        events = events.filter((e) => e.batchId === OWN_BATCH_ID).map((e) => ({ ...e, resetGeneration: next }));
        generation = next;
      });
      if (error) return { ok: false, message: error };
      return { ok: true, resetGeneration: generation };
    },
    async mergeOwn(rows, newFindings, file, now, expectedResetGeneration, expectedOwnGeneration): Promise<OwnMergeOutcome> {
      if (expectedResetGeneration !== generation) return { status: "storage_error", message: OWN_RESET_MESSAGE };
      if (expectedOwnGeneration !== ownGeneration) return { status: "storage_error", message: ownStaleMessage(batches.get(OWN_BATCH_ID)) };
      const plan = planOwnMerge(batches.get(OWN_BATCH_ID), findingsOf(OWN_BATCH_ID), rows, newFindings, file, now, generation);
      const error = commit(() => {
        ownGeneration += 1; // a stale import from another tab now refuses (R23)
        batches.set(OWN_BATCH_ID, plan.batch);
        for (const r of plan.put) findings.set(key(r.batchId, r.findingId), r);
        for (const r of plan.remove) findings.delete(key(r.batchId, r.findingId));
      });
      if (error) return { status: "storage_error", message: error };
      return { status: "merged", added: plan.added, alreadySeen: plan.alreadySeen, batch: plan.summary };
    },
    async getOwnGeneration() {
      return ownGeneration;
    },
    async listOwnRows() {
      return (batches.get(OWN_BATCH_ID)?.invoices ?? []).map(deserializeOwnInvoice);
    },
    async listInvoices(batchId) {
      return (batches.get(batchId)?.invoices ?? []).map(deserializeOwnInvoice);
    },
    async listOwnFiles() {
      return [...(batches.get(OWN_BATCH_ID)?.files ?? [])];
    },
    async deleteOwnData() {
      const error = commit(() => {
        ownGeneration += 1;
        batches.delete(OWN_BATCH_ID);
        for (const f of findingsOf(OWN_BATCH_ID)) findings.delete(key(f.batchId, f.findingId));
        events = events.filter((e) => e.batchId !== OWN_BATCH_ID);
      });
      return error ? { ok: false, message: error } : { ok: true };
    },
    async getResetGeneration() {
      return generation;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {},
  };
}
