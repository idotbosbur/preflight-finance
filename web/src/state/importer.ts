/**
 * Import orchestration: pure sync parse + rules, then async native SHA-256 ID finalization,
 * then ONE store transaction. A rejected file never touches storage (atomic rejection).
 * File bytes never leave the browser.
 */
import type { BatchImportOutcome, BatchSource } from "../domain/contracts.ts";
import { MAX_BYTES } from "../domain/contracts.ts";
import { parseInvoiceCsv } from "../domain/csv.ts";
import { runInvoiceRules } from "../domain/rules.ts";
import { finalizeBatch, sha256Hex } from "../domain/ids.ts";
import type { ReviewStore } from "./store.ts";

export async function importBytes(
  store: ReviewStore,
  bytes: Uint8Array,
  meta: { displayName: string; source: BatchSource; now: string; expectedResetGeneration: number },
): Promise<BatchImportOutcome> {
  let fileSha256: string | null = null;
  try {
    fileSha256 = await sha256Hex(bytes);
    const parsed = parseInvoiceCsv(bytes);
    if (!parsed.ok) {
      return { status: "rejected", fileSha256, issues: parsed.issues, issueCount: parsed.issueCount };
    }
    const prepared = await finalizeBatch(bytes, parsed.invoices, runInvoiceRules(parsed.invoices));
    return await store.importPrepared(prepared, { ...meta, displayName: safeDisplayName(meta.displayName) });
  } catch (err) {
    return { status: "storage_error", fileSha256, message: err instanceof Error ? err.message : "Import failed." };
  }
}

/** Read a user-selected File as raw bytes (never as text), refusing oversize files before reading. */
export async function readFileBytes(file: File): Promise<Uint8Array | { tooLarge: true; size: number }> {
  if (file.size > MAX_BYTES) return { tooLarge: true, size: file.size };
  return new Uint8Array(await file.arrayBuffer());
}

/** A label only, never a path: basename, printable, at most 200 characters. */
export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean.slice(0, 200) || "upload.csv";
}
