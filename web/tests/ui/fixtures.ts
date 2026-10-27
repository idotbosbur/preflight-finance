/** Hand-built fixture props matching web-contracts-v1. Values are illustrative test data only. */
import type {
  BatchSummary,
  CaseView,
  DuplicateEvidence,
  FindingView,
  Invoice,
  MismatchEvidence,
  ReviewEvent,
  ReviewState,
} from "../../src/domain/contracts.ts";
import type { BenchmarkFile, GuideView, QueueProps, StoryData } from "../../src/ui-contracts.ts";

export const XSS = "<script>alert(1)</script>";

export const batch: BatchSummary = {
  batchId: "b1b2c3d4e5f60718",
  fileSha256: "a".repeat(64),
  displayName: "Synthetic demo batch",
  source: "demo",
  ruleset: "invoice-v1",
  importedAt: "2026-10-21T12:00:00Z",
  rowCount: 120,
  findingCount: 32,
  duplicateCount: 12,
  mismatchCount: 20,
  nearDuplicateCount: 0,
  openCount: 31,
  confirmedCount: 1,
  dismissedCount: 0,
};

export const mismatchEvidence: MismatchEvidence = {
  kind: "TOTAL_MISMATCH",
  recordId: "R-0009",
  row: 9,
  subtotal: "1234.50",
  tax: "98.76",
  shipping: "15.00",
  discount: "0.00",
  expected: "1348.26",
  declared: "1348.27",
  delta: "+0.01",
};

export const dupEvidence: DuplicateEvidence = {
  kind: "DUPLICATE_CANDIDATE",
  key: { vendor: "V-ACME", invoice: "INV-7781", currency: "USD" },
  members: [
    { recordId: "R-0005", row: 5, rawVendor: " v-acme", rawInvoice: "inv-7781", invoiceDate: "2026-03-02", total: "410.00" },
    { recordId: "R-0032", row: 32, rawVendor: "V-ACME", rawInvoice: "INV-7781", invoiceDate: "2026-09-14", total: "512.40" },
  ],
};

export function finding(over: Partial<FindingView> & { state: ReviewState }): FindingView {
  return {
    ruleId: "TOTAL_MISMATCH",
    ruleVersion: "invoice-v1",
    memberIds: ["R-0009"],
    evidence: mismatchEvidence,
    findingId: "f00000000000mm09",
    batchId: batch.batchId,
    sequence: 0,
    resetGeneration: 0,
    ...over,
  };
}

export const dupFinding = (state: ReviewState): FindingView =>
  finding({ state, ruleId: "DUPLICATE_CANDIDATE", memberIds: ["R-0005", "R-0032"], evidence: dupEvidence, findingId: "f0000000000dg012" });

function invoice(recordId: string, raw: string[]): Invoice {
  return {
    recordId,
    rowNumber: 9,
    raw,
    vendorNorm: "V-ACME",
    invoiceNorm: "INV-1",
    invoiceDate: "2026-01-01",
    currency: "USD",
    subtotal: 123450,
    tax: 9876,
    shipping: 1500,
    discount: 0,
    total: 134827,
  };
}

export const mismatchInvoice = invoice("R-0009", ["R-0009", XSS, "INV-1", "2026-01-01", "USD", "1234.50", "98.76", "15.00", "0.00", "1348.27"]);

export function event(seq: number, action: ReviewEvent["action"], prev: ReviewState, next: ReviewState, reason: string, reviewer = "Demo reviewer"): ReviewEvent {
  return {
    batchId: batch.batchId,
    findingId: "f00000000000mm09",
    sequence: seq,
    prevState: prev,
    nextState: next,
    action,
    reason,
    reviewer,
    at: `2026-10-21T12:0${seq}:00Z`,
    resetGeneration: 0,
  };
}

export function caseView(state: ReviewState, history: readonly ReviewEvent[] = []): CaseView {
  return { batch, finding: finding({ state, sequence: history.length }), members: [mismatchInvoice], history };
}

export const story: StoryData = {
  mismatch: mismatchEvidence,
  mismatchVendor: "V-NORTHWIND",
  mismatchInvoice: "NW-0042",
  reuse: dupEvidence,
  invoiceCount: 120,
  findingCount: 32,
};

export const guide: GuideView = {
  active: true,
  currentIndex: 1,
  complete: false,
  steps: [
    { id: "load", title: "Load the demo", instruction: "Load the synthetic batch.", status: "done", href: "#/demo", note: null },
    { id: "confirm-mismatch", title: "Confirm the one-cent mismatch", instruction: "Open R-0009 and confirm it with a reason.", status: "current", href: "#/case/b/f", note: "Already confirmed earlier, reopen to replay this step." },
    { id: "dismiss-reuse", title: "Dismiss the legitimate reuse", instruction: "Dismiss DG-12.", status: "upcoming", href: null, note: null },
    { id: "reopen-history", title: "Reopen and read history", instruction: "Reopen a case.", status: "upcoming", href: null, note: null },
    { id: "results", title: "See results", instruction: "Open Results.", status: "upcoming", href: "#/results", note: null },
  ],
};

export const benchmark: BenchmarkFile = {
  fixtureVersion: "invoice-fixtures-v1",
  fixtureSeed: 20261021,
  datasetSha256: "d".repeat(64),
  manifestSha256: "e".repeat(64),
  runs: [
    {
      source: "python-reference",
      runAt: "2026-10-21T21:21:23Z",
      command: "python -m tests.evaluation.evaluate",
      checksPassed: 263,
      checksTotal: 263,
      duplicate: { groupsExpected: 12, groupsFlagged: 12, groupsExact: 12, genuineGroups: 10, legitimateReuseGroups: 2, pairTP: 10, pairFP: 2, pairFN: 0, pairTN: 7128, pairTotal: 7140 },
      hardNegatives: { pairs: 14, falseAlerts: 2 },
      mismatch: { tp: 20, fp: 0, fn: 0, tn: 100, exactDeltas: 20 },
      findings: 32,
      affectedRows: 40,
      referenceTests: 110,
    },
    {
      source: "browser-port",
      runAt: "2026-10-21T23:00:00Z",
      command: "npm run evaluate",
      checksPassed: 250,
      checksTotal: 250,
      duplicate: { groupsExpected: 12, groupsFlagged: 12, groupsExact: 12, genuineGroups: 10, legitimateReuseGroups: 2, pairTP: 10, pairFP: 2, pairFN: 0, pairTN: 7128, pairTotal: 7140 },
      hardNegatives: { pairs: 14, falseAlerts: 2 },
      mismatch: { tp: 20, fp: 0, fn: 0, tn: 100, exactDeltas: 20 },
      findings: 32,
      affectedRows: 40,
    },
  ],
  limitations: ["Synthetic USD only."],
};

const noop = () => {};

export function queueProps(over: Partial<QueueProps> = {}): QueueProps {
  return {
    batch,
    batches: [batch],
    findings: [finding({ state: "open" }), dupFinding("dismissed")],
    filter: { state: "all", rule: "all" },
    onFilterChange: noop,
    hrefForCase: (id) => `#/case/${batch.batchId}/${id}`,
    hrefForBatch: (id) => `#/queue/${id}`,
    demo: { kind: "ready", batchId: batch.batchId },
    onLoadDemo: noop,
    onResetDemo: noop,
    ...over,
  };
}
