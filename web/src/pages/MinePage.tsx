import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { BatchSummary } from "../domain/contracts.ts";
import { FEEDBACK_URL } from "../domain/contracts.ts";
import { parseCsvRecords } from "../domain/csv.ts";
import { REQUIRED_FIELDS, guessMapping } from "../domain/own/columns.ts";
import type { ColumnMapping, OwnField } from "../domain/own/columns.ts";
import type { DateOrder } from "../domain/own/values.ts";
import type { OwnFileRecord } from "../state/store.ts";
import { OWN_BADGE, plural } from "../components/labels.ts";
import { FeedbackLink } from "../components/AppShell.tsx";
import { DropFiles } from "./DropFiles.tsx";
import type { BillsImport } from "./DropFiles.tsx";
import type { BankImport } from "./BankSection.tsx";

export const FIELD_LABEL: Readonly<Record<OwnField, string>> = {
  vendor: "Vendor", invoiceNumber: "Invoice number", date: "Invoice date", total: "Total", subtotal: "Subtotal",
  tax: "Tax", shipping: "Shipping", discount: "Discount", currency: "Currency",
};
const FIELD_ORDER = Object.keys(FIELD_LABEL) as OwnField[];
const PREVIEW_ROWS = 5;
const MAP_KEY = "preflight.ownMapping:";

export function MappingForm({ headers, mapping, onChange }: { readonly headers: readonly string[]; readonly mapping: ColumnMapping; readonly onChange: (next: ColumnMapping) => void }) {
  return (
    <div className="mapping">
      {FIELD_ORDER.map((f) => {
        const required = REQUIRED_FIELDS.includes(f);
        return (
          <div className="field" key={f}>
            <label className="field-label" htmlFor={`map-${f}`}>
              {FIELD_LABEL[f]}{required ? " (required)" : ""}
            </label>
            <select
              id={`map-${f}`} value={mapping[f] ?? ""} aria-required={required || undefined}
              onChange={(e) => {
                const next = { ...mapping };
                if (e.target.value === "") delete next[f];
                else next[f] = Number(e.target.value);
                onChange(next);
              }}
            >
              <option value="">{required ? "Choose a column" : "Not in my file"}</option>
              {headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}
            </select>
          </div>
        );
      })}
    </div>
  );
}

export function PreviewTable({ headers, rows }: { readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] }) {
  return (
    <div className="dup-scroll" tabIndex={0} role="region" aria-label={`First ${PREVIEW_ROWS} rows of your file`}>
      <table className="dup-table">
        <caption className="sr-only">First {PREVIEW_ROWS} rows of your file</caption>
        <thead><tr>{headers.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
            <tr key={i}>{headers.map((_, c) => <td key={c}>{r[c] ?? ""}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DateOrderQuestion({ value, onChange, name = "date-order" }: { readonly value: DateOrder | null; readonly onChange: (o: DateOrder) => void; readonly name?: string }) {
  return (
    <fieldset className="date-order">
      <legend className="field-label">Are the dates day first or month first?</legend>
      <p className="hint">Some dates, like 03/04/2025, could be read both ways. Choose how your file writes them.</p>
      {([["DMY", "Day first (31/12/2025)"], ["MDY", "Month first (12/31/2025)"]] as const).map(([o, text]) => (
        <label key={o} className="radio">
          <input type="radio" name={name} checked={value === o} onChange={() => onChange(o)} /> {text}
        </label>
      ))}
    </fieldset>
  );
}

// ---- file reading and remembered mapping ----

export interface Loaded { readonly name: string; readonly bytes: Uint8Array; readonly headers: string[]; readonly rows: string[][] }

const NOT_UTF8 = "This file is not saved as UTF-8 text. In Excel, choose Save As, then “CSV UTF-8 (Comma delimited)”, and choose the new file.";

export function readPreview(name: string, bytes: Uint8Array): Loaded | string {
  // The two commonest wrong picks: a PDF, or the spreadsheet itself instead of its CSV export.
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (/\.pdf$/i.test(name) || starts(0x25, 0x50, 0x44, 0x46)) {
    return "That is a PDF. Export your bills from your accounting software as a CSV file instead (the pilot guide shows how).";
  }
  if (/\.(xlsx|xlsm|xls|numbers|ods)$/i.test(name) || starts(0x50, 0x4b, 0x03, 0x04) || starts(0xd0, 0xcf, 0x11, 0xe0)) {
    return "That is a spreadsheet file, not a CSV. In Excel, choose File, then Save As, then “CSV UTF-8 (Comma delimited)”, and choose the new file.";
  }
  let text: string;
  try {
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
  } catch {
    return NOT_UTF8;
  }
  try {
    const [headers, ...rows] = parseCsvRecords(text);
    if (!headers || headers.every((h) => h.trim() === "")) return "This file has no header row.";
    if (headers.length === 1 && headers[0]!.includes(";")) {
      return "This file looks semicolon-separated. Export it again with commas as the separator (in Excel: “CSV UTF-8 (Comma delimited)”).";
    }
    return { name, bytes, headers, rows: rows.filter((r) => r.some((c) => c.trim() !== "")).slice(0, PREVIEW_ROWS) };
  } catch {
    return "This file could not be read as a CSV export.";
  }
}

/** "Delete my data" also forgets remembered column choices (they are kept per header layout). */
export function forgetOwnMappings(storage: Storage | undefined): void {
  try {
    if (!storage) return;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith(MAP_KEY)) keys.push(k); }
    for (const k of keys) storage.removeItem(k);
  } catch { /* remembering is a convenience only */ }
}

const readableTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

const signature = (headers: readonly string[]) => MAP_KEY + headers.map((h) => h.trim().toLowerCase()).join("|");

export function initialMapping(headers: readonly string[]): ColumnMapping {
  try {
    const saved = JSON.parse(window.localStorage.getItem(signature(headers)) ?? "null") as ColumnMapping | null;
    if (saved && Object.values(saved).every((i) => Number.isInteger(i) && i >= 0 && i < headers.length)) return saved;
  } catch { /* remembering is a convenience only */ }
  return guessMapping(headers);
}
export function rememberMapping(headers: readonly string[], mapping: ColumnMapping): void {
  try { window.localStorage.setItem(signature(headers), JSON.stringify(mapping)); } catch { /* ignore */ }
}

// ---- page ----

export function DeleteConfirmation({ onConfirm, onCancel, busy, cancelRef }: {
  readonly onConfirm: () => void; readonly onCancel: () => void; readonly busy: boolean; readonly cancelRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="confirm-box" role="group" aria-labelledby="delete-q">
      <p id="delete-q">Erase every file, row, finding and decision of yours, and your remembered column choices, from this browser? The demo is separate and stays. This cannot be undone.</p>
      <div className="row-actions">
        <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>Yes, delete my data</button>
        <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

export interface MinePageProps {
  readonly ownBatch: BatchSummary | null;
  readonly files: readonly OwnFileRecord[];
  readonly onImport: BillsImport;
  readonly onDeleteOwn: () => Promise<{ ok: boolean; message?: string }>;
  readonly queueHref: string;
  readonly summaryHref: string;
  readonly feedbackUrl?: string;
  readonly onImportBank?: BankImport;
}

const noBank: BankImport = async () => ({ status: "storage_error", message: "Bank statements are not available here." });

export function MinePage({ ownBatch, files, onImport, onImportBank = noBank, onDeleteOwn, queueHref, summaryHref, feedbackUrl = FEEDBACK_URL }: MinePageProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const focusAfter = useRef<"cancel" | "trigger" | "heading" | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    const t = focusAfter.current;
    focusAfter.current = null;
    if (t === "cancel") cancelRef.current?.focus();
    else if (t === "trigger") triggerRef.current?.focus();
    else if (t === "heading") headingRef.current?.focus();
  }, [confirming, deleting, deleteError]);

  async function onDelete() {
    setDeleting(true);
    setDeleteError(null);
    let out: { ok: boolean; message?: string };
    try { out = await onDeleteOwn(); } catch { out = { ok: false, message: "Browser storage failed" }; }
    setDeleting(false);
    if (out.ok) {
      forgetOwnMappings(typeof window === "undefined" ? undefined : window.localStorage);
      focusAfter.current = "heading";
      setConfirming(false);
    } else {
      focusAfter.current = "cancel";
      setDeleteError(`Your data was not deleted: ${out.message ?? "storage error"}. Nothing was changed.`);
    }
  }

  return (
    <div className="workspace">
      <header className="page-head">
        <p className="eyebrow">Your data</p>
        <h1 ref={headingRef} className="page-title" tabIndex={-1}>Check your bills</h1>
        <p><span className="badge badge-synthetic">{OWN_BADGE}</span></p>
        <p className="lede">Drop in a CSV export of your bills. Add a bank or card statement too and we also check for bills paid twice.</p>
      </header>

      <DropFiles onImport={onImport} onImportBank={onImportBank} queueHref={queueHref} />

      <section className="panel" aria-labelledby="files-heading">
        <h2 id="files-heading" className="section-title">Files in this browser</h2>
        {files.length === 0 ? <p className="muted">Nothing added yet.</p> : (
          <ul className="issues">
            {files.map((f) => (
              <li key={f.fileSha256} className="issue">
                <span className="issue-where">{f.displayName}</span>{" "}
                <span className="muted">{plural(f.rowsAdded, f.kind === "bank" ? "payment" : "row")} added, {f.rowsSkipped} skipped · <time dateTime={f.importedAt}>{readableTime(f.importedAt)}</time></span>
              </li>
            ))}
          </ul>
        )}
        {ownBatch ? <p><a href={queueHref}>See what we found</a> · <a href={summaryHref}>Summary and contractor list</a></p> : null}
        {deleteError ? <p className="notice notice-error" role="alert">{deleteError}</p> : null}
        {files.length > 0 || ownBatch ? (confirming ? (
          <DeleteConfirmation busy={deleting} cancelRef={cancelRef} onCancel={() => { focusAfter.current = "trigger"; setDeleteError(null); setConfirming(false); }}
            onConfirm={() => void onDelete()} />
        ) : (
          <button ref={triggerRef} type="button" className="btn btn-quiet"
            onClick={() => { focusAfter.current = "cancel"; setDeleteError(null); setConfirming(true); }}>Delete my data</button>
        )) : null}
        {feedbackUrl ? <p className="hint"><FeedbackLink url={feedbackUrl} /></p> : null}
      </section>
    </div>
  );
}
