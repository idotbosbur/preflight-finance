/**
 * Frozen shared contracts for the Preflight browser port, version `web-contracts-v1`.
 *
 * Owned by Preflight-Lead. Workers must not edit this file; request changes via SendMessage.
 * Pure types/constants/functions only: no DOM, storage, network or Node APIs.
 *
 * Parity source: the Python reference (`src/preflight/contracts.py`, `imports.py`, `rules/`).
 * Decisions: docs/portfolio-p1-plan-revision.md ("Contract-freeze amendments").
 *
 * Money: `Cents` is a JS number restricted to safe integers (guarded). Never compute cents with
 * `Number(text) * 100`. Storage/serialization uses `CentsString` ("11025"); evidence/display uses
 * Python-identical decimal strings from money.formatCents / formatDelta ("110.25", "+0.01").
 */

export const WEB_CONTRACTS_VERSION = "web-contracts-v1";
export const RULESET_VERSION = "invoice-v1";
export const SCHEMA_VERSION = 1;

/** Where visitors send feedback. Empty = no feedback link is shown anywhere. */
export const FEEDBACK_URL = "#/feedback";

export const CSV_HEADER = [
  "record_id",
  "vendor_id",
  "invoice_number",
  "invoice_date",
  "currency",
  "subtotal",
  "tax",
  "shipping",
  "discount",
  "total",
] as const;
export type CsvField = (typeof CSV_HEADER)[number];
export const AMOUNT_FIELDS = ["subtotal", "tax", "shipping", "discount", "total"] as const;
export type AmountField = (typeof AMOUNT_FIELDS)[number];

export const MAX_BYTES = 1_048_576;
export const MAX_ROWS = 1000;
export const MAX_LISTED_ISSUES = 500;
/** CPython csv default field_size_limit, counted in code points. */
export const CSV_FIELD_LIMIT = 131_072;
export const MAX_AMOUNT_CENTS = 99_999_999_999;

export const RULE_DUPLICATE = "DUPLICATE_CANDIDATE";
export const RULE_MISMATCH = "TOTAL_MISMATCH";
export const RULE_NEAR_DUPLICATE = "NEAR_DUPLICATE";
/** Bank statement vs bills (own data only). */
export const RULE_PAID_TWICE = "PAID_TWICE";
export const RULE_PAYMENT_NO_BILL = "PAYMENT_NO_BILL";
/** Supplier unit price rose (own data with line items only). */
export const RULE_PRICE_INCREASE = "PRICE_INCREASE";
export type RuleId = typeof RULE_DUPLICATE | typeof RULE_MISMATCH | typeof RULE_NEAR_DUPLICATE | typeof RULE_PAID_TWICE | typeof RULE_PAYMENT_NO_BILL
  | typeof RULE_PRICE_INCREASE | typeof RULE_RECURRING_INCREASE | typeof RULE_CHARGED_TWICE;
/** Monthly charges on a bank or card statement (own data only). */
export const RULE_RECURRING_INCREASE = "RECURRING_INCREASE";
export const RULE_CHARGED_TWICE = "CHARGED_TWICE";

export const OWN_BATCH_ID = "00000000000000a1";
export const OWN_MAX_BYTES = 10_485_760;
export const OWN_MAX_ROWS = 20_000;
export const NEAR_DUP_WINDOW_DAYS = 14;
/** A payment matches a bill dated up to this many days before it. */
export const PAY_WINDOW_DAYS = 90;

export type ReviewState = "open" | "confirmed" | "dismissed";
export type ReviewAction = "confirm" | "dismiss" | "reopen";
export const ACTIONS: Readonly<Record<ReviewAction, { readonly from: readonly ReviewState[]; readonly to: ReviewState }>> = {
  confirm: { from: ["open"], to: "confirmed" },
  dismiss: { from: ["open"], to: "dismissed" },
  reopen: { from: ["confirmed", "dismissed"], to: "open" },
};
/** Limits counted in Unicode code points (Python len parity), after ASCII trim. */
export const REASON_MAX = 500;
export const REVIEWER_MAX = 80;

export const SYNTHETIC_LABEL = "Synthetic demo: invented figures, not real financial records";

export type IssueCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "ENCODING"
  | "MALFORMED_CSV"
  | "HEADER_MISMATCH"
  | "NO_DATA_ROWS"
  | "TOO_MANY_ROWS"
  | "ROW_SHAPE"
  | "FIELD_REQUIRED"
  | "ID_FORMAT"
  | "DUPLICATE_RECORD_ID"
  | "INVOICE_NUMBER_FORMAT"
  | "DATE_FORMAT"
  | "DATE_INVALID"
  | "CURRENCY_UNSUPPORTED"
  | "AMOUNT_REQUIRED"
  | "AMOUNT_FORMAT"
  | "DISCOUNT_EXCEEDS_CHARGES";

/** Cents as a safe integer number. */
export type Cents = number;
/** Cents serialized as a base-10 integer string, e.g. "11025" or "-1". */
export type CentsString = string;

// ---------------------------------------------------------------------------
// Pure helpers shared by every layer
// ---------------------------------------------------------------------------

/** Python `str.strip(" \t\n\r\x0b\x0c")`, never JS trim() (which strips NBSP/U+FEFF/U+2028). */
export function asciiTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isAsciiSpace(text.charCodeAt(start))) start++;
  while (end > start && isAsciiSpace(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}
function isAsciiSpace(code: number): boolean {
  return code === 0x20 || (code >= 0x09 && code <= 0x0d);
}

/** Trim outer ASCII whitespace and uppercase ASCII a-z only (punctuation and leading zeros kept). */
export function normalizeIdentifier(raw: string): string {
  const trimmed = asciiTrim(raw);
  let out = "";
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    out += code >= 0x61 && code <= 0x7a ? String.fromCharCode(code - 32) : trimmed[i];
  }
  return out;
}

/** Python code-point length (not UTF-16 length). */
export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/** Python `<` on str: code-unit order is correct for the ASCII identifiers accepted here. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Python tuple ordering: element-wise, case-sensitive, shorter prefix first. */
export function compareTuples(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = compareStrings(a[i]!, b[i]!);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

export function assertSafeCents(value: number, label = "cents"): Cents {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} is not a safe integer: ${value}`);
  return value;
}

// ---------------------------------------------------------------------------
// Import / validation (domain/csv.ts implements parseInvoiceCsv)
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  /** 1-based data row (header excluded; counts CSV records, not physical lines); null = file-level. */
  readonly row: number | null;
  readonly field: CsvField | null;
  readonly code: IssueCode;
  readonly message: string;
}

export interface Invoice {
  readonly recordId: string;
  readonly rowNumber: number;
  /** The 10 original cell strings in CSV_HEADER order (quoted CRLF preserved). */
  readonly raw: readonly string[];
  readonly vendorNorm: string;
  readonly invoiceNorm: string;
  /** ISO YYYY-MM-DD exactly as supplied (dates are not trimmed). */
  readonly invoiceDate: string;
  readonly currency: string;
  readonly subtotal: Cents;
  readonly tax: Cents;
  readonly shipping: Cents;
  readonly discount: Cents;
  readonly total: Cents;
}

export type ValidationResult =
  | { readonly ok: true; readonly invoices: readonly Invoice[]; readonly issues: readonly []; readonly issueCount: 0 }
  | { readonly ok: false; readonly invoices: readonly []; readonly issues: readonly ValidationIssue[]; readonly issueCount: number };

/** Implemented in domain/csv.ts. Synchronous and pure. */
export type ParseInvoiceCsv = (bytes: Uint8Array) => ValidationResult;

// ---------------------------------------------------------------------------
// Rules (domain/rules.ts implements runInvoiceRules)
// ---------------------------------------------------------------------------

export interface DuplicateMemberEvidence {
  readonly recordId: string;
  readonly row: number;
  readonly rawVendor: string;
  readonly rawInvoice: string;
  readonly invoiceDate: string;
  /** Decimal string, e.g. "110.25". */
  readonly total: string;
}
export interface DuplicateEvidence {
  readonly kind: typeof RULE_DUPLICATE;
  readonly key: { readonly vendor: string; readonly invoice: string; readonly currency: string };
  /** Sorted by recordId (compareStrings). */
  readonly members: readonly DuplicateMemberEvidence[];
}
export interface MismatchEvidence {
  readonly kind: typeof RULE_MISMATCH;
  readonly recordId: string;
  readonly row: number;
  readonly subtotal: string;
  readonly tax: string;
  readonly shipping: string;
  readonly discount: string;
  readonly expected: string;
  readonly declared: string;
  /** declared - expected, signed: "+0.01", "-0.01" (never "0.00", no finding then). */
  readonly delta: string;
}
export interface NearDuplicateEvidence {
  readonly kind: typeof RULE_NEAR_DUPLICATE;
  readonly vendor: string;
  readonly total: string;
  readonly daysApart: number;
  readonly members: readonly DuplicateMemberEvidence[];
}
/** One money-out line from a bank or card statement, as evidence. */
export interface PaymentEvidence {
  readonly paymentId: string;
  readonly row: number;
  /** ISO YYYY-MM-DD, or "" when unreadable. */
  readonly date: string;
  readonly description: string;
  /** Decimal string, e.g. "110.25". */
  readonly amount: string;
  /** How the supplier was recognised: "name words" or "AI similarity 0.82". */
  readonly match: string;
}
export interface PaidTwiceEvidence {
  readonly kind: typeof RULE_PAID_TWICE;
  readonly bill: DuplicateMemberEvidence;
  readonly currency: string;
  /** Date order. */
  readonly payments: readonly PaymentEvidence[];
}
export interface PaymentNoBillEvidence {
  readonly kind: typeof RULE_PAYMENT_NO_BILL;
  /** Supplier name as written on the user's bills. */
  readonly vendor: string;
  readonly payment: PaymentEvidence;
}
/** One purchase of an item, from a bill's line. */
export interface PurchaseEvidence {
  readonly recordId: string;
  readonly invoice: string;
  readonly date: string;
  readonly description: string;
  /** As written, e.g. "2" or "1.5". */
  readonly quantity: string;
  /** Unit price, decimal string. */
  readonly unit: string;
}
export interface PriceIncreaseEvidence {
  readonly kind: typeof RULE_PRICE_INCREASE;
  readonly vendor: string;
  readonly currency: string;
  /** Date order; the first is the baseline price. */
  readonly purchases: readonly PurchaseEvidence[];
  readonly from: string;
  readonly to: string;
  /** Rise of the latest unit price over the first, e.g. "18.2". */
  readonly percent: string;
  /** Paid above the first price across the later purchases, decimal string. */
  readonly extra: string;
  /** How differently written item names were grouped: "same name", "name words" or "AI similarity 0.84". */
  readonly match: string;
}
export interface RecurringIncreaseEvidence {
  readonly kind: typeof RULE_RECURRING_INCREASE;
  /** Latest statement description. */
  readonly payee: string;
  /** Date order. */
  readonly payments: readonly PaymentEvidence[];
  readonly from: string;
  readonly to: string;
  readonly percent: string;
  /** Paid above the first amount so far. */
  readonly extra: string;
  /** (to - from) x 12. */
  readonly perYear: string;
}
export interface ChargedTwiceEvidence {
  readonly kind: typeof RULE_CHARGED_TWICE;
  readonly payee: string;
  /** YYYY-MM. */
  readonly month: string;
  readonly amount: string;
  readonly payments: readonly PaymentEvidence[];
}
export type Evidence = DuplicateEvidence | MismatchEvidence | NearDuplicateEvidence | PaidTwiceEvidence | PaymentNoBillEvidence | PriceIncreaseEvidence
  | RecurringIncreaseEvidence | ChargedTwiceEvidence;

/** Rule output before ID finalization. memberIds sorted ascending (compareStrings). */
export interface CandidateFinding {
  readonly ruleId: RuleId;
  readonly ruleVersion: typeof RULESET_VERSION;
  readonly memberIds: readonly string[];
  readonly evidence: Evidence;
}

/** Implemented in domain/rules.ts. Synchronous, pure; result sorted by (ruleId, memberIds) via compareTuples. */
export type RunInvoiceRules = (invoices: readonly Invoice[]) => readonly CandidateFinding[];

// ---------------------------------------------------------------------------
// Identity finalization (domain/ids.ts, lead), native async Web Crypto SHA-256
// ---------------------------------------------------------------------------

export interface Finding extends CandidateFinding {
  /** sha256("ruleId|ruleVersion|member1|member2…").hex[:16], Python make_finding_id parity. */
  readonly findingId: string;
}

export interface PreparedBatch {
  /** sha256 of the ORIGINAL bytes (BOM/CRLF intact). */
  readonly fileSha256: string;
  /** sha256(`${fileSha256}|invoice-v1`).hex[:16], Python batch_id_for parity. */
  readonly batchId: string;
  readonly invoices: readonly Invoice[];
  readonly findings: readonly Finding[];
}

// ---------------------------------------------------------------------------
// Visitor state (src/state, lead): store port + views
// ---------------------------------------------------------------------------

export type BatchSource = "demo" | "upload" | "own";

export interface BatchSummary {
  readonly batchId: string;
  readonly fileSha256: string;
  readonly displayName: string;
  readonly source: BatchSource;
  readonly ruleset: string;
  readonly importedAt: string; // ISO 8601 UTC
  readonly rowCount: number;
  readonly findingCount: number;
  readonly duplicateCount: number;
  readonly mismatchCount: number;
  readonly nearDuplicateCount: number;
  readonly openCount: number;
  readonly confirmedCount: number;
  readonly dismissedCount: number;
}

export interface FindingView extends Finding {
  readonly batchId: string;
  readonly state: ReviewState;
  /** Number of review events so far in this reset generation (0 = never reviewed). */
  readonly sequence: number;
  readonly resetGeneration: number;
}

export interface ReviewEvent {
  readonly batchId: string;
  readonly findingId: string;
  readonly sequence: number;
  readonly prevState: ReviewState;
  readonly nextState: ReviewState;
  readonly action: ReviewAction;
  readonly reason: string;
  readonly reviewer: string;
  readonly at: string; // ISO 8601 UTC
  readonly resetGeneration: number;
}

export interface CaseView {
  readonly batch: BatchSummary;
  readonly finding: FindingView;
  /** Member invoices in memberIds order. */
  readonly members: readonly Invoice[];
  /** Oldest first. */
  readonly history: readonly ReviewEvent[];
}

/** Token the UI captured when it rendered the case; stale tokens are rejected. */
export interface ExpectedToken {
  readonly resetGeneration: number;
  readonly sequence: number;
}

export interface DecisionRequest {
  readonly batchId: string;
  readonly findingId: string;
  readonly action: ReviewAction;
  readonly reason: string;
  readonly reviewer: string;
  readonly expected: ExpectedToken;
}

export type ReviewResult =
  | { readonly status: "saved"; readonly finding: FindingView; readonly event: ReviewEvent }
  | { readonly status: "invalid"; readonly errors: readonly string[] }
  | { readonly status: "conflict"; readonly cause: "stale" | "reset"; readonly latest: FindingView | null }
  | { readonly status: "invalid_transition"; readonly latest: FindingView }
  | { readonly status: "not_found" }
  | { readonly status: "storage_error"; readonly message: string };

export type BatchImportOutcome =
  | { readonly status: "created" | "existing"; readonly batch: BatchSummary }
  | { readonly status: "rejected"; readonly fileSha256: string; readonly issues: readonly ValidationIssue[]; readonly issueCount: number }
  | { readonly status: "storage_error"; readonly fileSha256: string | null; readonly message: string };

/** "memory" = storage unavailable: decisions live only in this tab and are lost on reload. */
export type Durability = "persistent" | "memory";

// ---------------------------------------------------------------------------
// Roadmap: all twelve modules (single public scheme: P1/P2/P3, then gated enterprise stages)
// ---------------------------------------------------------------------------

export type ModuleLabel = "Working in this demo" | "Implemented foundation" | "Next synthetic scenario" | "Planned";

export interface ModuleStatus {
  readonly number: number;
  readonly name: string;
  /** One short line for the roadmap card (details live behind an info toggle). */
  readonly summary: string;
  readonly label: ModuleLabel;
  readonly phase: "P1" | "P2" | "P3";
  readonly exists: string;
  readonly next: string;
  readonly validation: string;
  readonly qualifier?: string;
}

export const MODULES: readonly ModuleStatus[] = [
  { number: 1, name: "Financial Loss Firewall", summary: "Flags duplicate and mismatched invoices for review", label: "Working in this demo", phase: "P1",
    exists: "Duplicate-candidate and total-mismatch checks with source evidence and human review",
    next: "Cross-batch and near-match duplicate scenarios (P2)",
    validation: "Independent synthetic labels; raw true/false-positive counts",
    qualifier: "Review aid only. Never blocks, approves or releases a payment" },
  { number: 2, name: "Contract Intelligence", summary: "Checks invoices against contract terms", label: "Next synthetic scenario", phase: "P2",
    exists: "Not built",
    next: "Overbilling, missed discounts, renewal deadlines and violations citing synthetic clauses and dated calculations",
    validation: "Valid controls alongside every seeded issue" },
  { number: 3, name: "Vendor Risk Intelligence", summary: "Spots risky vendor and bank-detail changes", label: "Implemented foundation", phase: "P2",
    exists: "Stable normalized vendor identifiers",
    next: "Bank-detail change vs approved baseline, duplicate vendors, unusual payments with benign controls",
    validation: "Independent-verification action; no fraud certainty from a flag" },
  { number: 4, name: "Cross-System Reconciliation", summary: "Matches invoices, orders, receipts and bank records", label: "Implemented foundation", phase: "P2",
    exists: "Source-row provenance, file hashes, and bank or card statements matched to bills (paid twice, payment with no bill)",
    next: "Linked invoice/PO/receipt/accounting records: unmatched, partial and one-to-many",
    validation: "Arithmetic and source IDs on every case",
    qualifier: "AI matches payee names in your browser; amounts and dates are exact rules" },
  { number: 5, name: "Financial Investigation AI", summary: "Explains exactly why each case was flagged", label: "Implemented foundation", phase: "P1",
    exists: "Deterministic why-flagged evidence and exact arithmetic",
    next: "Linked multi-record investigations (P2); model interpretation only with an approved backend",
    validation: "Citations or abstention; deterministic money logic stays authoritative",
    qualifier: "Deterministic. No AI model is used" },
  { number: 6, name: "Predictive Budget Monitoring", summary: "Warns before budgets overrun", label: "Planned", phase: "P3",
    exists: "Not built",
    next: "Department/project budgets, actuals and commitments with dated overrun scenarios",
    validation: "Stated assumptions; not a validated predictor" },
  { number: 7, name: "Cash Flow Intelligence", summary: "Projects cash shortfalls and working capital", label: "Planned", phase: "P3",
    exists: "Not built",
    next: "Dated payables/receivables and working-capital sensitivity",
    validation: "Opening/closing cash reconciles; assumptions labelled" },
  { number: 8, name: "Revenue Leakage Detection", summary: "Finds work delivered but never billed", label: "Planned", phase: "P3",
    exists: "Not built",
    next: "Delivered-but-unbilled work, missing collections, wrong pricing (after contracts and reconciliation)",
    validation: "Timing controls and source records" },
  { number: 9, name: "Accounting Audit Agent", summary: "Reviews journal entries and adjustments", label: "Planned", phase: "P3",
    exists: "Not built",
    next: "Journal/adjustment rules and reconciliation gaps with thresholds and review trail",
    validation: "No statutory-audit claim",
    qualifier: "Deterministic rules, no AI agent" },
  { number: 10, name: "Financial Scenario Simulator", summary: "Models hiring, capex and contract changes", label: "Planned", phase: "P3",
    exists: "Not built",
    next: "Hiring, capex and contract-change inputs producing reproducible deltas (after budget and cash)",
    validation: "Scenario figures kept separate from observed figures" },
  { number: 11, name: "Autonomous Finance Workflows", summary: "Routes reviews with human sign-off", label: "Implemented foundation", phase: "P1",
    exists: "Human review state machine with reasons and append-only local history",
    next: "Simulated draft corrections, evidence collection and approval routing with hard gates",
    validation: "No external writes; no autonomous money approval",
    qualifier: "Human decisions only, nothing autonomous" },
  { number: 12, name: "Executive AI Advisor", summary: "Source-backed summaries for leadership", label: "Implemented foundation", phase: "P1",
    exists: "Measured synthetic benchmark and results view",
    next: "Source-backed synthetic reports and preset questions (P3); model Q&A only with an approved backend",
    validation: "Every figure cites its source; synthetic labelled",
    qualifier: "Deterministic. No AI model is used" },
];
