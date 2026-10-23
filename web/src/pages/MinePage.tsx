import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type { BatchSummary } from "../domain/contracts.ts";
import { OWN_MAX_BYTES } from "../domain/contracts.ts";
import { parseCsvRecords } from "../domain/csv.ts";
import { REQUIRED_FIELDS, guessMapping } from "../domain/own/columns.ts";
import type { ColumnMapping, OwnField } from "../domain/own/columns.ts";
import { buildOwnRows } from "../domain/own/rows.ts";
import type { OwnParseResult, OwnWarning, SkippedRow } from "../domain/own/rows.ts";
import type { DateOrder } from "../domain/own/values.ts";
import type { OwnFileRecord, OwnMergeOutcome } from "../state/store.ts";
import type { OwnParseError } from "../state/ownImporter.ts";
import { OWN_BADGE } from "../components/labels.ts";

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
      <Notes title="Skipped rows" items={skipped.map((s) => ({ where: `Row ${s.row}`, text: s.reason }))} />
      <Notes title="Worth knowing" items={warnings.map((w) => ({ where: w.row === 0 ? "File" : `Row ${w.row}`, text: w.reason }))} />
      {!totalsCheck ? <p className="hint">No subtotal column is mapped, so the total-mismatch check is off for this file.</p> : null}
      <p><button type="button" className="btn btn-primary" onClick={onContinue} disabled={disabled}>{continueLabel(readable, skipped.length)}</button></p>
    </section>
  );
}

// ---- file reading and remembered mapping ----

interface Loaded { readonly name: string; readonly bytes: Uint8Array; readonly headers: string[]; readonly rows: string[][] }

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

export interface MinePageProps {
  readonly ownBatch: BatchSummary | null;
  readonly files: readonly OwnFileRecord[];
  readonly onImport: (bytes: Uint8Array, mapping: ColumnMapping, opts: { displayName: string; dateOrder: DateOrder | null }) => Promise<OwnMergeOutcome | OwnParseError>;
  readonly onDeleteOwn: () => void;
  readonly queueHref: string;
  readonly summaryHref: string;
}

const PARSE_MESSAGE: Readonly<Record<OwnParseError["error"], string>> = {
  "too large": "That file is over 10 MB.", "too many rows": "That file has more than 20,000 rows.",
  "not a CSV": "That file could not be read as a UTF-8 CSV export.", "no header": "That file has no header row.",
  "missing required column": "Choose a column for each required field.", "ambiguous date order": "Choose day first or month first.",
};

export function MinePage({ ownBatch, files, onImport, onDeleteOwn, queueHref, summaryHref }: MinePageProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dateOrder, setDateOrder] = useState<DateOrder | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<{ added: number; alreadySeen: number } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const dry: OwnParseResult | null = useMemo(
    () => (loaded ? buildOwnRows(loaded.bytes, mapping, { dateOrder, fileLabel: loaded.name }) : null),
    [loaded, mapping, dateOrder],
  );
  const ambiguous = !!dry && "error" in dry && dry.error === "ambiguous date order";
  const ok = dry && !("error" in dry) ? dry : null;

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
    if (!loaded || !ok) return;
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
        <h1 className="page-title" tabIndex={-1}>Check your own invoices</h1>
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
            <p>Added {done.added} new invoices ({done.alreadySeen} were already in your data).</p>
            <p><a href={summaryHref}>See your results</a> · <a href={queueHref}>Review the findings</a></p>
          </div>
        ) : null}
      </section>

      {loaded ? (
        <>
          <section className="panel" aria-labelledby="map-heading">
            <h2 id="map-heading" className="section-title">2. Confirm the columns</h2>
            <MappingForm headers={loaded.headers} mapping={mapping} onChange={(m) => { setMapping(m); setDateOrder(null); }} />
            <PreviewTable headers={loaded.headers} rows={loaded.rows} />
            {ambiguous ? <DateOrderQuestion value={dateOrder} onChange={setDateOrder} /> : null}
            {dry && "error" in dry && !ambiguous ? <p className="notice" role="status">{PARSE_MESSAGE[dry.error]}</p> : null}
          </section>
          {ok ? (
            <ImportSummary readable={ok.invoices.length} skipped={ok.skipped} warnings={ok.warnings}
              totalsCheck={ok.checksAvailable.totals} onContinue={() => void onContinue()} disabled={working || ok.invoices.length === 0} />
          ) : null}
        </>
      ) : null}

      <section className="panel" aria-labelledby="files-heading">
        <h2 id="files-heading" className="section-title">Files in this browser</h2>
        {files.length === 0 ? <p className="muted">Nothing imported yet.</p> : (
          <ul className="issues">
            {files.map((f) => (
              <li key={f.fileSha256} className="issue">
                <span className="issue-where">{f.displayName}</span>{" "}
                <span className="muted">{f.rowsAdded} rows added, {f.rowsSkipped} skipped · {f.importedAt}</span>
              </li>
            ))}
          </ul>
        )}
        {ownBatch ? <p><a href={queueHref}>Review the {ownBatch.findingCount} findings</a></p> : null}
        {files.length > 0 || ownBatch ? (confirming ? (
          <div className="confirm-box" role="group" aria-labelledby="delete-q">
            <p id="delete-q">Erase every file, row, finding and decision of yours from this browser? This cannot be undone.</p>
            <div className="row-actions">
              <button type="button" className="btn btn-danger" onClick={() => { setConfirming(false); setLoaded(null); setDone(null); onDeleteOwn(); }}>Yes, delete my data</button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-quiet" onClick={() => setConfirming(true)}>Delete my data</button>
        )) : null}
      </section>
    </div>
  );
}
