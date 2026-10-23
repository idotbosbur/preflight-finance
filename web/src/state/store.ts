/**
 * Visitor-state port. Two adapters implement identical semantics:
 * - idbStore.ts (IndexedDB, persistent in this browser), and
 * - memoryStore.ts (this tab only; also used for fault-injection tests).
 *
 * History is browser-local, resettable and unauthenticated — not an enterprise audit log.
 */
import {
  ACTIONS,
  SCHEMA_VERSION,
  WEB_CONTRACTS_VERSION,
  RULE_DUPLICATE,
  RULE_MISMATCH,
  assertSafeCents,
} from "../domain/contracts.ts";
import type {
  BatchImportOutcome,
  BatchSource,
  BatchSummary,
  CaseView,
  DecisionRequest,
  Durability,
  Evidence,
  FindingView,
  Invoice,
  PreparedBatch,
  ReviewEvent,
  ReviewResult,
  ReviewState,
  RuleId,
} from "../domain/contracts.ts";

export interface ImportMeta {
  readonly displayName: string;
  readonly source: BatchSource;
  readonly now: string;
  /** Reset generation observed when the import STARTED; checked inside the import transaction. */
  readonly expectedResetGeneration?: number;
}

export const STALE_IMPORT_MESSAGE =
  "The demo data was reset while this import was running, so nothing was imported. Import the file again if you still want it.";

export type StoreChange = { readonly type: "changed" | "reset" };

export interface ReviewStore {
  readonly durability: Durability;
  importPrepared(batch: PreparedBatch, meta: ImportMeta): Promise<BatchImportOutcome>;
  listBatches(): Promise<BatchSummary[]>;
  getBatch(batchId: string): Promise<BatchSummary | null>;
  /** In transparent case order. */
  listFindings(batchId: string): Promise<FindingView[]>;
  getCase(batchId: string, findingId: string): Promise<CaseView | null>;
  saveDecision(req: DecisionRequest, now: string): Promise<ReviewResult>;
  /** Clears every batch/decision this visitor stored in this browser and bumps the reset generation. */
  resetAll(): Promise<{ ok: true; resetGeneration: number } | { ok: false; message: string }>;
  getResetGeneration(): Promise<number>;
  /** Changes made by OTHER tabs (BroadcastChannel). Returns an unsubscribe function. */
  subscribe(listener: (change: StoreChange) => void): () => void;
  close(): void;
}

// ---- Serialized records (shared by both adapters) ----

export interface SerializedInvoice {
  readonly recordId: string;
  readonly rowNumber: number;
  readonly raw: readonly string[];
  readonly vendorNorm: string;
  readonly invoiceNorm: string;
  readonly invoiceDate: string;
  readonly currency: "USD";
  readonly subtotal: string;
  readonly tax: string;
  readonly shipping: string;
  readonly discount: string;
  readonly total: string;
}

export interface BatchRecord {
  readonly schemaVersion: number;
  readonly contractsVersion: string;
  readonly batchId: string;
  readonly fileSha256: string;
  readonly displayName: string;
  readonly source: BatchSource;
  readonly ruleset: string;
  readonly importedAt: string;
  readonly rowCount: number;
  readonly resetGeneration: number;
  readonly invoices: readonly SerializedInvoice[];
}

export interface FindingRecord {
  readonly schemaVersion: number;
  readonly batchId: string;
  readonly findingId: string;
  readonly ruleId: RuleId;
  readonly ruleVersion: "invoice-v1";
  readonly memberIds: readonly string[];
  readonly evidence: Evidence;
  readonly state: ReviewState;
  readonly sequence: number;
  readonly resetGeneration: number;
}

const CENTS_STRING = /^-?(0|[1-9][0-9]*)$/;

export function centsToString(value: number): string {
  return String(assertSafeCents(value));
}

export function centsFromString(text: string): number {
  if (typeof text !== "string" || !CENTS_STRING.test(text)) throw new RangeError(`bad stored cents: ${text}`);
  return assertSafeCents(Number(text));
}

export function serializeInvoice(inv: Invoice): SerializedInvoice {
  return {
    recordId: inv.recordId, rowNumber: inv.rowNumber, raw: [...inv.raw], vendorNorm: inv.vendorNorm,
    invoiceNorm: inv.invoiceNorm, invoiceDate: inv.invoiceDate, currency: inv.currency,
    subtotal: centsToString(inv.subtotal), tax: centsToString(inv.tax), shipping: centsToString(inv.shipping),
    discount: centsToString(inv.discount), total: centsToString(inv.total),
  };
}

export function deserializeInvoice(s: SerializedInvoice): Invoice {
  return {
    recordId: s.recordId, rowNumber: s.rowNumber, raw: [...s.raw], vendorNorm: s.vendorNorm,
    invoiceNorm: s.invoiceNorm, invoiceDate: s.invoiceDate, currency: "USD",
    subtotal: centsFromString(s.subtotal), tax: centsFromString(s.tax), shipping: centsFromString(s.shipping),
    discount: centsFromString(s.discount), total: centsFromString(s.total),
  };
}

export function makeBatchRecord(batch: PreparedBatch, meta: ImportMeta, resetGeneration: number): BatchRecord {
  return {
    schemaVersion: SCHEMA_VERSION, contractsVersion: WEB_CONTRACTS_VERSION, batchId: batch.batchId,
    fileSha256: batch.fileSha256, displayName: meta.displayName, source: meta.source, ruleset: "invoice-v1",
    importedAt: meta.now, rowCount: batch.invoices.length, resetGeneration,
    invoices: batch.invoices.map(serializeInvoice),
  };
}

export function makeFindingRecords(batch: PreparedBatch, resetGeneration: number): FindingRecord[] {
  return batch.findings.map((f) => ({
    schemaVersion: SCHEMA_VERSION, batchId: batch.batchId, findingId: f.findingId, ruleId: f.ruleId,
    ruleVersion: f.ruleVersion, memberIds: [...f.memberIds], evidence: f.evidence, state: "open",
    sequence: 0, resetGeneration,
  }));
}

export function toFindingView(r: FindingRecord): FindingView {
  return {
    batchId: r.batchId, findingId: r.findingId, ruleId: r.ruleId, ruleVersion: r.ruleVersion,
    memberIds: r.memberIds, evidence: r.evidence, state: r.state, sequence: r.sequence,
    resetGeneration: r.resetGeneration,
  };
}

export function summarize(b: BatchRecord, findings: readonly FindingRecord[]): BatchSummary {
  const count = (pred: (f: FindingRecord) => boolean) => findings.filter(pred).length;
  return {
    batchId: b.batchId, fileSha256: b.fileSha256, displayName: b.displayName, source: b.source,
    ruleset: b.ruleset, importedAt: b.importedAt, rowCount: b.rowCount, findingCount: findings.length,
    duplicateCount: count((f) => f.ruleId === RULE_DUPLICATE),
    mismatchCount: count((f) => f.ruleId === RULE_MISMATCH),
    openCount: count((f) => f.state === "open"),
    confirmedCount: count((f) => f.state === "confirmed"),
    dismissedCount: count((f) => f.state === "dismissed"),
  };
}

export function buildCase(b: BatchRecord, f: FindingRecord, all: readonly FindingRecord[], events: readonly ReviewEvent[]): CaseView {
  const byId = new Map(b.invoices.map((i) => [i.recordId, i] as const));
  const members = f.memberIds.map((id) => byId.get(id)).filter((i): i is SerializedInvoice => i !== undefined)
    .map(deserializeInvoice);
  const history = [...events].filter((e) => e.resetGeneration === f.resetGeneration).sort((x, y) => x.sequence - y.sequence);
  return { batch: summarize(b, all), finding: toFindingView(f), members, history };
}

/**
 * Pure decision step used inside each adapter's single write transaction.
 * Token = {resetGeneration, sequence}; a reset bumps the generation, so a stale tab holding
 * {old generation, 1} can never write after reset + one new decision (no ABA).
 */
export function decide(
  current: FindingRecord | undefined,
  currentGeneration: number,
  req: DecisionRequest,
  clean: { action: DecisionRequest["action"]; reason: string; reviewer: string },
  now: string,
): { result: ReviewResult; write?: { finding: FindingRecord; event: ReviewEvent } } {
  if (req.expected.resetGeneration !== currentGeneration) {
    return { result: { status: "conflict", cause: "reset", latest: current ? toFindingView(current) : null } };
  }
  if (!current) return { result: { status: "not_found" } };
  if (current.resetGeneration !== currentGeneration) {
    return { result: { status: "conflict", cause: "reset", latest: toFindingView(current) } };
  }
  if (current.sequence !== req.expected.sequence) {
    return { result: { status: "conflict", cause: "stale", latest: toFindingView(current) } };
  }
  const rule = ACTIONS[clean.action];
  if (!rule.from.includes(current.state)) {
    return { result: { status: "invalid_transition", latest: toFindingView(current) } };
  }
  const sequence = current.sequence + 1;
  const finding: FindingRecord = { ...current, state: rule.to, sequence };
  const event: ReviewEvent = {
    batchId: current.batchId, findingId: current.findingId, sequence, prevState: current.state,
    nextState: rule.to, action: clean.action, reason: clean.reason, reviewer: clean.reviewer, at: now,
    resetGeneration: currentGeneration,
  };
  return { result: { status: "saved", finding: toFindingView(finding), event }, write: { finding, event } };
}

export const CHANNEL_NAME = "preflight-demo-state";

/** Cross-tab notifications; silently unavailable where BroadcastChannel is missing. */
export function createChannel(): { post(change: StoreChange): void; subscribe(l: (c: StoreChange) => void): () => void; close(): void } {
  const BC = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
  if (!BC) return { post() {}, subscribe: () => () => {}, close() {} };
  const channel = new BC(CHANNEL_NAME);
  const listeners = new Set<(c: StoreChange) => void>();
  channel.onmessage = (ev: MessageEvent) => {
    const data = ev.data as StoreChange | undefined;
    if (data && (data.type === "changed" || data.type === "reset")) listeners.forEach((l) => l(data));
  };
  return {
    post: (change) => { try { channel.postMessage(change); } catch { /* ignore */ } },
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    close: () => channel.close(),
  };
}
