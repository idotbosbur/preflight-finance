import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ChangeEvent } from "react";
import type { BatchSummary } from "../domain/contracts.ts";
import { FEEDBACK_URL, OWN_MAX_BYTES } from "../domain/contracts.ts";
import { parseCsvRecords } from "../domain/csv.ts";
import { REQUIRED_FIELDS, guessMapping } from "../domain/own/columns.ts";
import type { ColumnMapping, OwnField } from "../domain/own/columns.ts";
import { buildOwnRows } from "../domain/own/rows.ts";
import type { OwnParseResult, OwnWarning, SkippedRow } from "../domain/own/rows.ts";
import type { DateOrder } from "../domain/own/values.ts";
import type { OwnFileRecord, OwnMergeOutcome } from "../state/store.ts";
import type { OwnParseError } from "../state/ownImporter.ts";
import { OWN_BADGE, plural } from "../components/labels.ts";
import { FeedbackLink } from "../components/AppShell.tsx";

const FIELD_LABEL: Readonly<Record<OwnField, string>> = {
  vendor: "Vendor", invoiceNumber: "Invoice number", date: "Invoice date", total: "Total", subtotal: "Subtotal",
  tax: "Tax", shipping: "Shipping", discount: "Discount", currency: "Currency",
};
const FIELD_ORDER = Object.keys(FIELD_LABEL) as OwnField[];
const SHOWN = 25;
const PREVIEW_ROWS = 5;
const MAP_KEY = "preflight.ownMapping:";

export const continueLabel = (readable: number, skipped: number) =>
  `Continue with ${readable} readable rows${skipped > 0 ? ` (${skipped} skipped)` : ""}`;

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
    <div className="dup-scroll">
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

export function DateOrderQuestion({ value, onChange }: { readonly value: DateOrder | null; readonly onChange: (o: DateOrder) => void }) {
  return (
    <fieldset className="date-order">
      <legend className="field-label">Are the dates day first or month first?</legend>
      <p className="hint">Some dates, like 03/04/2025, could be read both ways. Choose how your file writes them.</p>
      {([["DMY", "Day first (31/12/2025)"], ["MDY", "Month first (12/31/2025)"]] as const).map(([o, text]) => (
        <label key={o} className="radio">
          <input type="radio" name="date-order" checked={value === o} onChange={() => onChange(o)} /> {text}
        </label>
      ))}
    </fieldset>
  );
}

function Notes({ title, items }: { readonly title: string; readonly items: readonly { readonly where: string; readonly text: string }[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h3 className="small-title">{title}</h3>
      <ul className="issues">
        {items.slice(0, SHOWN).map((n, i) => (
          <li key={i} className="issue"><span className="issue-where">{n.where}</span> <span className="issue-msg">{n.text}</span></li>
        ))}
      </ul>
      {items.length > SHOWN ? <p className="muted">{items.length - SHOWN} more not listed.</p> : null}
    </>
  );
}

export function ImportSummary({ readable, skipped, warnings, totalsCheck, onContinue, disabled }: {
  readonly readable: number; readonly skipped: readonly SkippedRow[]; readonly warnings: readonly OwnWarning[];
  readonly totalsCheck: boolean; readonly onContinue: () => void; readonly disabled: boolean;
}) {
  return (
    <section className="panel" aria-labelledby="summary-heading">
      <h2 id="summary-heading" className="section-title">What we can read</h2>
      <p>{readable} readable rows{skipped.length > 0 ? `, ${skipped.length} skipped` : ""}.</p>
      {readable === 0 ? <p className="hint">No rows can be imported from this file. Check that the columns above are right and that the file has data rows.</p> : null}
      <Notes title="Skipped rows" items={skipped.map((s) => ({ where: `Row ${s.row}`, text: s.reason }))} />
      <Notes title="Worth knowing" items={warnings.map((w) => ({ where: w.row === 0 ? "File" : `Row ${w.row}`, text: w.reason }))} />
      {!totalsCheck ? <p className="hint">No subtotal column is mapped, so the total-mismatch check is off for this file.</p> : null}
      <p><button type="button" className="btn btn-primary" onClick={onContinue} disabled={disabled}>{continueLabel(readable, skipped.length)}</button></p>
    </section>
  );
}

// ---- file reading and remembered mapping ----

export interface Loaded { readonly name: string; readonly bytes: Uint8Array; readonly headers: string[]; readonly rows: string[][] }

function readPreview(name: string, bytes: Uint8Array): Loaded | string {
  try {
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
    const [headers, ...rows] = parseCsvRecords(text);
    if (!headers || headers.every((h) => h.trim() === "")) return "This file has no header row.";
    return { name, bytes, headers, rows: rows.filter((r) => r.some((c) => c.trim() !== "")).slice(0, PREVIEW_ROWS) };
  } catch {
    return "This file could not be read as a UTF-8 CSV export.";
  }
}

const readableTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

const signature = (headers: readonly string[]) => MAP_KEY + headers.map((h) => h.trim().toLowerCase()).join("|");

function initialMapping(headers: readonly string[]): ColumnMapping {
  try {
    const saved = JSON.parse(window.localStorage.getItem(signature(headers)) ?? "null") as ColumnMapping | null;
    if (saved && Object.values(saved).every((i) => Number.isInteger(i) && i >= 0 && i < headers.length)) return saved;
  } catch { /* remembering is a convenience only */ }
  return guessMapping(headers);
}
function rememberMapping(headers: readonly string[], mapping: ColumnMapping): void {
  try { window.localStorage.setItem(signature(headers), JSON.stringify(mapping)); } catch { /* ignore */ }
}

// ---- page ----

/** Mapping, preview, date question and summary for a loaded file. */
export function MapStep({ loaded, mapping, dateOrder, working, onMapping, onDateOrder, onContinue }: {
  readonly loaded: Loaded; readonly mapping: ColumnMapping; readonly dateOrder: DateOrder | null; readonly working: boolean;
  readonly onMapping: (m: ColumnMapping) => void; readonly onDateOrder: (o: DateOrder) => void; readonly onContinue: () => void;
}) {
  // ponytail: synchronous dry run on the main thread (20k rows measured ~58 ms); move to a worker if it ever janks.
  const dry: OwnParseResult = useMemo(
    () => buildOwnRows(loaded.bytes, mapping, { dateOrder, fileLabel: loaded.name }),
    [loaded, mapping, dateOrder],
  );
  const error = "error" in dry ? dry.error : null;
  // Once answered, the dry run is no longer ambiguous; keep the question so the answer stays visible and changeable.
  const askOrder = error === "ambiguous date order" || dateOrder !== null;
  return (
    <>
      <section className="panel" aria-labelledby="map-heading">
        <h2 id="map-heading" className="section-title">2. Confirm the columns</h2>
        <MappingForm headers={loaded.headers} mapping={mapping} onChange={onMapping} />
        <PreviewTable headers={loaded.headers} rows={loaded.rows} />
        {askOrder ? <DateOrderQuestion value={dateOrder} onChange={onDateOrder} /> : null}
        {error && error !== "ambiguous date order" ? <p className="notice" role="status">{PARSE_MESSAGE[error]}</p> : null}
      </section>
      {!("error" in dry) ? (
        <ImportSummary readable={dry.invoices.length} skipped={dry.skipped} warnings={dry.warnings}
          totalsCheck={dry.checksAvailable.totals} onContinue={onContinue} disabled={working || dry.invoices.length === 0} />
      ) : null}
    </>
  );
}

export function DeleteConfirmation({ onConfirm, onCancel, busy, cancelRef }: {
  readonly onConfirm: () => void; readonly onCancel: () => void; readonly busy: boolean; readonly cancelRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="confirm-box" role="group" aria-labelledby="delete-q">
      <p id="delete-q">Erase every file, row, finding and decision of yours from this browser? This cannot be undone.</p>
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
  readonly onImport: (bytes: Uint8Array, mapping: ColumnMapping, opts: { displayName: string; dateOrder: DateOrder | null }) => Promise<OwnMergeOutcome | OwnParseError>;
  readonly onDeleteOwn: () => Promise<{ ok: boolean; message?: string }>;
  readonly queueHref: string;
  readonly summaryHref: string;
  readonly feedbackUrl?: string;
}

const PARSE_MESSAGE: Readonly<Record<OwnParseError["error"], string>> = {
  "too large": "That file is over 10 MB.", "too many rows": "That file has more than 20,000 rows. Split it into smaller files and import them one at a time.",
  "not a CSV": "That file could not be read as a UTF-8 CSV export.", "no header": "That file has no header row.",
  "missing required column": "Choose a column for each required field.", "ambiguous date order": "Choose day first or month first.",
};

export function MinePage({ ownBatch, files, onImport, onDeleteOwn, queueHref, summaryHref, feedbackUrl = FEEDBACK_URL }: MinePageProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dateOrder, setDateOrder] = useState<DateOrder | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<{ added: number; alreadySeen: number } | null>(null);
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
      focusAfter.current = "heading";
      setLoaded(null); setDone(null); setProblem(null);
      setConfirming(false);
    } else {
      focusAfter.current = "cancel";
      setDeleteError(`Your data was not deleted: ${out.message ?? "storage error"}. Nothing was changed.`);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setDone(null); setLoaded(null); setDateOrder(null);
    // Size is checked before the file is read into memory.
    if (file.size > OWN_MAX_BYTES) { setProblem("That file is over 10 MB. Nothing was read."); return; }
    try {
      const result = readPreview(file.name, new Uint8Array(await file.arrayBuffer()));
      if (typeof result === "string") { setProblem(result); return; }
      setProblem(null);
      setMapping(initialMapping(result.headers));
      setLoaded(result);
    } catch {
      setProblem("The browser could not read this file. Nothing was imported.");
    }
  }

  async function onContinue() {
    if (!loaded) return;
    setWorking(true);
    setProblem(null);
    try {
      const out = await onImport(loaded.bytes, mapping, { displayName: loaded.name, dateOrder });
      if ("error" in out) setProblem(PARSE_MESSAGE[out.error]);
      else if (out.status === "storage_error") setProblem(out.message);
      else {
        rememberMapping(loaded.headers, mapping);
        setDone({ added: out.added, alreadySeen: out.alreadySeen });
        setLoaded(null);
      }
    } catch {
      setProblem("Browser storage failed, so nothing was imported.");
    } finally { setWorking(false); }
  }

  return (
    <div className="workspace">
      <header className="page-head">
        <p className="eyebrow">Your data</p>
        <h1 ref={headingRef} className="page-title" tabIndex={-1}>Check your own invoices</h1>
        <p><span className="badge badge-synthetic">{OWN_BADGE}</span></p>
        <p className="lede">Choose a CSV export from your accounting tool. Findings are candidates for a person to review.</p>
      </header>

      <section className="panel" aria-labelledby="pick-heading">
        <h2 id="pick-heading" className="section-title">1. Choose a file</h2>
        <label className="field-label" htmlFor="own-file">CSV file (up to 10 MB, 20,000 rows)</label>
        <input id="own-file" className="file-input" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e)} disabled={working} />
        <p className="hint">Your file is read on this device. It is never uploaded.</p>
        {problem ? <p className="notice notice-error" role="alert">{problem}</p> : null}
        {done ? (
          <div className="notice notice-ok" role="status">
            <p>Added {plural(done.added, "new invoice")} ({done.alreadySeen} already in your data).</p>
            <p><a href={summaryHref}>See your results</a> · <a href={queueHref}>Review the findings</a></p>
          </div>
        ) : null}
      </section>

      {loaded ? (
        <MapStep loaded={loaded} mapping={mapping} dateOrder={dateOrder} working={working}
          onMapping={(m) => { setMapping(m); setDateOrder(null); }} onDateOrder={setDateOrder} onContinue={() => void onContinue()} />
      ) : null}

      <section className="panel" aria-labelledby="files-heading">
        <h2 id="files-heading" className="section-title">Files in this browser</h2>
        {files.length === 0 ? <p className="muted">Nothing imported yet.</p> : (
          <ul className="issues">
            {files.map((f) => (
              <li key={f.fileSha256} className="issue">
                <span className="issue-where">{f.displayName}</span>{" "}
                <span className="muted">{plural(f.rowsAdded, "row")} added, {f.rowsSkipped} skipped · <time dateTime={f.importedAt}>{readableTime(f.importedAt)}</time></span>
              </li>
            ))}
          </ul>
        )}
        {ownBatch ? <p><a href={queueHref}>Review the {plural(ownBatch.findingCount, "finding")}</a></p> : null}
        {deleteError ? <p className="notice notice-error" role="alert">{deleteError}</p> : null}
        {files.length > 0 || ownBatch ? (confirming ? (
          <DeleteConfirmation busy={deleting} cancelRef={cancelRef} onCancel={() => { focusAfter.current = "trigger"; setConfirming(false); }}
            onConfirm={() => void onDelete()} />
        ) : (
          <button ref={triggerRef} type="button" className="btn btn-quiet" disabled={working}
            onClick={() => { focusAfter.current = "cancel"; setDeleteError(null); setConfirming(true); }}>Delete my data</button>
        )) : null}
        {feedbackUrl ? <p className="hint"><FeedbackLink url={feedbackUrl} /></p> : null}
      </section>
    </div>
  );
}
