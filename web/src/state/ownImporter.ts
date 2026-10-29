/**
 * Own-data import: parse tolerantly, give rows content IDs, rerun the rules over the stored workspace
 * plus the new rows, then ONE store merge. Async hashing happens here, outside any IndexedDB
 * transaction (idbStore forbids `await` inside one).
 * Two tabs importing at once: every mergeOwn bumps the own generation, so the later one refuses (R23).
 */
import type { CandidateFinding, Finding, Invoice } from "../domain/contracts.ts";
import { CSV_HEADER, RULE_PAID_TWICE, RULE_PAYMENT_NO_BILL } from "../domain/contracts.ts";
import { buildBankRows } from "../domain/own/bank.ts";
import type { BankMapping, BankParseResult, BankPayment } from "../domain/own/bank.ts";
import { reconcile, tokenScore } from "../domain/reconcile.ts";
import { priceIncreases } from "../domain/prices.ts";
import { recurringChecks } from "../domain/recurring.ts";
import type { NameScorer } from "../domain/reconcile.ts";
import type { ColumnMapping } from "../domain/own/columns.ts";
import { buildOwnRows } from "../domain/own/rows.ts";
import type { OwnInvoice, OwnParseResult } from "../domain/own/rows.ts";
import type { DateOrder } from "../domain/own/values.ts";
import { makeFindingId, sha256Hex } from "../domain/ids.ts";
import { runOwnRules } from "../domain/rules.ts";
import { safeDisplayName } from "./importer.ts";
import type { OwnMergeOutcome, ReviewStore } from "./store.ts";

const STORAGE_MESSAGE = "Browser storage failed, so nothing was imported.";

export type OwnParseError = Extract<OwnParseResult, { error: unknown }>;
export type BankParseError = Extract<BankParseResult, { error: unknown }>;

/** Builds the name scorer for one run; the app passes the in-browser AI one (aiMatch.ts). */
export type ScorerFactory = (descriptions: readonly string[], vendors: readonly string[]) => Promise<{ scorer: NameScorer; ai: boolean }>;
export const wordScorer: ScorerFactory = async () => ({ scorer: (d, v) => ({ score: tokenScore(d, v), how: "name words" }), ai: false });

/** Bank-vs-bills outcome shown after an import. */
export interface MatchReport {
  readonly payments: number; readonly matched: number; readonly unpaidBills: number; readonly ai: boolean;
  readonly paidTwice: number; readonly noBill: number;
}

const VENDOR_INDEX = CSV_HEADER.indexOf("vendor_id");

/** Every own-data finding, recomputed over the whole workspace: invoice rules plus bank vs bills. */
async function ownFindings(invoices: readonly OwnInvoice[], payments: readonly BankPayment[], scorers: ScorerFactory): Promise<{ findings: Finding[]; report: MatchReport | null }> {
  const candidates = runOwnRules(invoices);
  let report: MatchReport | null = null;
  const items = [...new Set(invoices.flatMap((i) => (i.lines ?? []).map((l) => l.description)))];
  const reconciling = payments.length > 0 && invoices.length > 0;
  if (!reconciling && items.length === 0) return { findings: await withIds([...candidates, ...recurringChecks(payments, new Set())]), report };
  const vendors = [...new Set(invoices.map((i: Invoice) => (i.raw[VENDOR_INDEX] ?? "").trim() || i.vendorNorm))];
  const { scorer, ai } = await scorers([...payments.map((p) => p.description), ...items], vendors);
  candidates.push(...priceIncreases(invoices, scorer));
  if (reconciling) {
    const r = reconcile(invoices, payments, scorer);
    candidates.push(...r.findings);
    const count = (id: string) => r.findings.filter((f) => f.ruleId === id).length;
    report = { payments: payments.length, matched: r.matched, unpaidBills: r.unpaidBills, ai, paidTwice: count(RULE_PAID_TWICE), noBill: count(RULE_PAYMENT_NO_BILL) };
  }
  // Payments already shown as paying a bill twice are not reported again as a monthly charge taken twice.
  const inPaidTwice = new Set(candidates.filter((c) => c.ruleId === RULE_PAID_TWICE).flatMap((c) => c.memberIds));
  candidates.push(...recurringChecks(payments, inPaidTwice));
  return { findings: await withIds(candidates), report };
}

async function withIds(candidates: readonly CandidateFinding[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const c of candidates) findings.push({ ...c, findingId: await makeFindingId(c.ruleId, c.ruleVersion, c.memberIds) });
  return findings;
}

const encoder = new TextEncoder();

/** "O-" + sha256(vendor|invoice|date|totalCents|currency|occurrence)[:12]; occurrence counts identical content within one file. */
export async function contentRecordId(inv: OwnInvoice, occurrence: number): Promise<string> {
  const text = [inv.vendorNorm, inv.invoiceNorm, inv.invoiceDate, inv.total, inv.currency, occurrence].join("|");
  return "O-" + (await sha256Hex(encoder.encode(text))).slice(0, 12);
}

export async function importOwnFile(
  store: ReviewStore,
  bytes: Uint8Array,
  mapping: ColumnMapping,
  opts: { displayName: string; dateOrder: DateOrder | null; now: string; expectedResetGeneration: number },
  scorers: ScorerFactory = wordScorer,
): Promise<(OwnMergeOutcome & { report?: MatchReport | null }) | OwnParseError> {
  const displayName = safeDisplayName(opts.displayName);
  const parsed = buildOwnRows(bytes, mapping, { dateOrder: opts.dateOrder, fileLabel: displayName });
  if ("error" in parsed) return parsed;
  const fileSha256 = await sha256Hex(bytes);
  const seenInFile = new Map<string, number>();
  const rows: OwnInvoice[] = [];
  for (const inv of parsed.invoices) {
    const content = [inv.vendorNorm, inv.invoiceNorm, inv.invoiceDate, inv.total, inv.currency].join("|");
    const occurrence = seenInFile.get(content) ?? 0;
    seenInFile.set(content, occurrence + 1);
    const recordId = await contentRecordId(inv, occurrence);
    const raw = [...inv.raw];
    raw[0] = recordId;
    rows.push({ ...inv, recordId, raw });
  }
  // Capture the own generation BEFORE reading rows: a delete or another import in between makes mergeOwn refuse.
  let ownGeneration: number;
  const all = new Map<string, OwnInvoice>();
  let payments: BankPayment[];
  try {
    ownGeneration = await store.getOwnGeneration();
    for (const r of await store.listOwnRows()) all.set(r.recordId, r);
    payments = await store.listOwnPayments();
  } catch {
    return { status: "storage_error", message: STORAGE_MESSAGE };
  }
  // A known recordId with new values (corrected re-export) replaces the stored row (R21).
  for (const r of rows) all.set(r.recordId, r);
  const { findings, report } = await ownFindings([...all.values()], payments, scorers);
  const out = await store.mergeOwn(rows, findings,
    { fileSha256, displayName, importedAt: opts.now, rowsAdded: 0, rowsSkipped: parsed.skipped.length },
    opts.now, opts.expectedResetGeneration, ownGeneration);
  return { ...out, report };
}

/** "P-" + sha256(date|description|cents|occurrence)[:12]; occurrence counts identical lines within one file. */
export async function paymentId(p: BankPayment, occurrence: number): Promise<string> {
  return "P-" + (await sha256Hex(encoder.encode([p.date, p.description, p.cents, occurrence].join("|")))).slice(0, 12);
}

/** Bank or card statement import: store its money-out lines, then rerun every check with them. */
export async function importBankFile(
  store: ReviewStore,
  bytes: Uint8Array,
  mapping: BankMapping,
  opts: { displayName: string; dateOrder: DateOrder | null; now: string; expectedResetGeneration: number },
  scorers: ScorerFactory = wordScorer,
): Promise<(OwnMergeOutcome & { report?: MatchReport | null }) | BankParseError> {
  const displayName = safeDisplayName(opts.displayName);
  const parsed = buildBankRows(bytes, mapping, { dateOrder: opts.dateOrder, fileLabel: displayName });
  if ("error" in parsed) return parsed;
  const fileSha256 = await sha256Hex(bytes);
  const seen = new Map<string, number>();
  const fresh: BankPayment[] = [];
  for (const p of parsed.payments) {
    const k = [p.date, p.description, p.cents].join("|");
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    fresh.push({ ...p, paymentId: await paymentId(p, n) });
  }
  let ownGeneration: number;
  let rows: OwnInvoice[];
  let stored: BankPayment[];
  try {
    ownGeneration = await store.getOwnGeneration();
    rows = await store.listOwnRows();
    stored = await store.listOwnPayments();
  } catch {
    return { status: "storage_error", message: STORAGE_MESSAGE };
  }
  const known = new Set(stored.map((p) => p.paymentId));
  const { findings, report } = await ownFindings(rows, [...stored, ...fresh.filter((p) => !known.has(p.paymentId))], scorers);
  const out = await store.mergeOwn([], findings,
    { fileSha256, displayName, importedAt: opts.now, rowsAdded: 0, rowsSkipped: parsed.skipped.length, kind: "bank" },
    opts.now, opts.expectedResetGeneration, ownGeneration, fresh);
  return { ...out, report };
}
