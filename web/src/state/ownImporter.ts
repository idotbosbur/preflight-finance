/**
 * Own-data import: parse tolerantly, give rows content IDs, rerun the rules over the stored workspace
 * plus the new rows, then ONE store merge. Async hashing happens here, outside any IndexedDB
 * transaction (idbStore forbids `await` inside one).
 * ponytail: two tabs importing at the same instant may compute findings over a partial set; the next import recomputes.
 */
import type { Finding } from "../domain/contracts.ts";
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

const encoder = new TextEncoder();

/** "O-" + sha256(vendor|invoice|date|totalCents|occurrence)[:12]; occurrence counts identical content within one file. */
export async function contentRecordId(inv: OwnInvoice, occurrence: number): Promise<string> {
  const text = [inv.vendorNorm, inv.invoiceNorm, inv.invoiceDate, inv.total, occurrence].join("|");
  return "O-" + (await sha256Hex(encoder.encode(text))).slice(0, 12);
}

export async function importOwnFile(
  store: ReviewStore,
  bytes: Uint8Array,
  mapping: ColumnMapping,
  opts: { displayName: string; dateOrder: DateOrder | null; now: string; expectedResetGeneration: number },
): Promise<OwnMergeOutcome | OwnParseError> {
  const displayName = safeDisplayName(opts.displayName);
  const parsed = buildOwnRows(bytes, mapping, { dateOrder: opts.dateOrder, fileLabel: displayName });
  if ("error" in parsed) return parsed;
  const fileSha256 = await sha256Hex(bytes);
  const seenInFile = new Map<string, number>();
  const rows: OwnInvoice[] = [];
  for (const inv of parsed.invoices) {
    const content = [inv.vendorNorm, inv.invoiceNorm, inv.invoiceDate, inv.total].join("|");
    const occurrence = seenInFile.get(content) ?? 0;
    seenInFile.set(content, occurrence + 1);
    const recordId = await contentRecordId(inv, occurrence);
    const raw = [...inv.raw];
    raw[0] = recordId;
    rows.push({ ...inv, recordId, raw });
  }
  // Capture the own generation BEFORE reading rows: a delete in between makes mergeOwn refuse.
  let ownGeneration: number;
  const all = new Map<string, OwnInvoice>();
  try {
    ownGeneration = await store.getOwnGeneration();
    for (const r of await store.listOwnRows()) all.set(r.recordId, r);
  } catch {
    return { status: "storage_error", message: STORAGE_MESSAGE };
  }
  for (const r of rows) if (!all.has(r.recordId)) all.set(r.recordId, r);
  const findings: Finding[] = [];
  for (const c of runOwnRules([...all.values()])) {
    findings.push({ ...c, findingId: await makeFindingId(c.ruleId, c.ruleVersion, c.memberIds) });
  }
  return store.mergeOwn(rows, findings,
    { fileSha256, displayName, importedAt: opts.now, rowsAdded: 0, rowsSkipped: parsed.skipped.length },
    opts.now, opts.expectedResetGeneration, ownGeneration);
}
