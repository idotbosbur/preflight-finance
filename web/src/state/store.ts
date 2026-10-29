/**
 * Visitor-state port. Two adapters implement identical semantics:
 * - idbStore.ts (IndexedDB, persistent in this browser), and
 * - memoryStore.ts (this tab only; also used for fault-injection tests).
 *
 * History is browser-local, resettable and unauthenticated, not an enterprise audit log.
 */
import {
  ACTIONS,
  SCHEMA_VERSION,
  WEB_CONTRACTS_VERSION,
  RULE_DUPLICATE,
  OWN_BATCH_ID, RULE_MISMATCH, RULE_NEAR_DUPLICATE,
  assertSafeCents,
} from "../domain/contracts.ts";
import type { OwnInvoice } from "../domain/own/rows.ts";
import type {
  BatchImportOutcome,
  Finding,
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

export const OWN_DELETED_MESSAGE =
  "Your data was deleted while this file was importing, so nothing was imported. Import the file again if you still want it.";

export const OWN_CHANGED_MESSAGE =
  "Your data changed in another tab, so nothing was imported. Import the file again.";

/** Message for a stale own-generation: the own batch is gone (deleted) or was changed elsewhere. */
export const ownStaleMessage = (ownBatch: BatchRecord | undefined): string => (ownBatch ? OWN_CHANGED_MESSAGE : OWN_DELETED_MESSAGE);

export const OWN_RESET_MESSAGE =
  "The demo was reset in this browser while your file was importing, so nothing was imported. Your data is unchanged; import the file again.";

export const STALE_IMPORT_MESSAGE =
  "The demo data was reset while this import was running, so nothing was imported. Import the file again if you still want it.";

/** One imported file in the own-data workspace (rows live in the single own batch). */
export interface OwnFileRecord {
  readonly fileSha256: string;
  readonly displayName: string;
  readonly importedAt: string;
  readonly rowsAdded: number;
  readonly rowsSkipped: number;
}

export type OwnMergeOutcome =
  | { readonly status: "merged"; readonly added: number; readonly alreadySeen: number; readonly batch: BatchSummary }
  | { readonly status: "storage_error"; readonly message: string };

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
  /**
   * Own-data workspace: unions `rows` into the single OWN_BATCH_ID batch by recordId and replaces its
   * findings with `findings` (computed by the caller over the whole workspace), keeping decided ones.
   */
  mergeOwn(rows: readonly Invoice[], findings: readonly Finding[], file: OwnFileRecord, now: string, expectedResetGeneration: number, expectedOwnGeneration: number): Promise<OwnMergeOutcome>;
  /** Bumped by deleteOwnData (the demo reset generation is untouched); lets an in-flight own import notice a delete. */
  getOwnGeneration(): Promise<number>;
  /** Stored own-workspace rows (empty when none), so the caller can rerun the rules over the union. */
  listOwnRows(): Promise<OwnInvoice[]>;
  /** Stored invoices of any batch (empty when the batch is missing), for the at-a-glance headline. */
  listInvoices(batchId: string): Promise<Invoice[]>;
  listOwnFiles(): Promise<OwnFileRecord[]>;
  /** Removes only the own batch, its findings and their events; the demo batch stays. */
  deleteOwnData(): Promise<{ ok: boolean; message?: string }>;
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
  readonly currency: string;
  readonly subtotal: string;
  readonly tax: string;
  readonly shipping: string;
  readonly discount: string;
  readonly total: string;
  /** Own-data rows only: whether the subtotal column was present (totals check applies). */
  readonly hasComponents?: boolean;
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
  /** Own batch only. */
  readonly files?: readonly OwnFileRecord[];
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
    ...("hasComponents" in inv ? { hasComponents: (inv as OwnInvoice).hasComponents } : {}),
  };
}

export function deserializeInvoice(s: SerializedInvoice): Invoice {
  return {
    recordId: s.recordId, rowNumber: s.rowNumber, raw: [...s.raw], vendorNorm: s.vendorNorm,
    invoiceNorm: s.invoiceNorm, invoiceDate: s.invoiceDate, currency: s.currency,
    subtotal: centsFromString(s.subtotal), tax: centsFromString(s.tax), shipping: centsFromString(s.shipping),
    discount: centsFromString(s.discount), total: centsFromString(s.total),
  };
}

export function deserializeOwnInvoice(s: SerializedInvoice): OwnInvoice {
  return { ...deserializeInvoice(s), hasComponents: s.hasComponents ?? false };
}

export interface OwnMergePlan {
  readonly batch: BatchRecord;
  readonly put: readonly FindingRecord[];
  readonly remove: readonly FindingRecord[];
  readonly summary: BatchSummary;
  readonly added: number;
  readonly alreadySeen: number;
}

/**
 * Pure merge step shared by both adapters. Rows union by recordId. Reproduced findings keep their
 * state/sequence; new ones start open; stored findings no longer reproduced survive only if decided.
 */
export function planOwnMerge(
  existing: BatchRecord | undefined,
  oldFindings: readonly FindingRecord[],
  rows: readonly Invoice[],
  findings: readonly Finding[],
  file: OwnFileRecord,
  now: string,
  generation: number,
): OwnMergePlan {
  const invoices = [...(existing?.invoices ?? [])];
  const at = new Map(invoices.map((inv, i) => [inv.recordId, i] as const));
  const values = (i: SerializedInvoice) => JSON.stringify({ ...i, rowNumber: 0 });
  let added = 0;
  for (const r of rows) {
    const s = serializeInvoice(r);
    const i = at.get(r.recordId);
    // Known row with changed values (a corrected re-export): the new row replaces it (R21).
    if (i !== undefined) { if (values(invoices[i]!) !== values(s)) invoices[i] = s; continue; }
    at.set(r.recordId, invoices.length);
    invoices.push(s);
    added += 1;
  }
  // Re-importing a known file keeps its original record (rowsAdded, importedAt).
  const prevFiles = existing?.files ?? [];
  const files = prevFiles.some((f) => f.fileSha256 === file.fileSha256) ? prevFiles : [...prevFiles, { ...file, rowsAdded: added }];
  const batch: BatchRecord = {
    schemaVersion: SCHEMA_VERSION, contractsVersion: WEB_CONTRACTS_VERSION, batchId: OWN_BATCH_ID, fileSha256: "",
    displayName: "Your data", source: "own", ruleset: "invoice-v1", importedAt: now, rowCount: invoices.length,
    resetGeneration: generation, invoices, files,
  };
  const old = new Map(oldFindings.map((f) => [f.findingId, f] as const));
  const keep: FindingRecord[] = [];
  const put: FindingRecord[] = [];
  for (const f of makeFindingRecords({ batchId: OWN_BATCH_ID, fileSha256: "", invoices: [], findings }, generation)) {
    const prior = old.get(f.findingId);
    // Reproduced: keep the review state, refresh the evidence from the current rows.
    const rec = prior ? { ...f, state: prior.state, sequence: prior.sequence, resetGeneration: prior.resetGeneration } : f;
    keep.push(rec);
    put.push(rec);
    old.delete(f.findingId);
  }
  const remove: FindingRecord[] = [];
  for (const f of old.values()) (f.sequence > 0 ? keep : remove).push(f);
  return { batch, put, remove, summary: summarize(batch, keep), added, alreadySeen: rows.length - added };
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
    nearDuplicateCount: count((f) => f.ruleId === RULE_NEAR_DUPLICATE),
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
