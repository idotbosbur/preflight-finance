/**
 * One drop zone for everything: bills exports and bank or card statements together. Each file's type
 * and columns are guessed from its header row; the person confirms with one button and only answers
 * a question when a guess is missing (type unknown, a required column not found, day/month order).
 */
import { useMemo, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { OWN_MAX_BYTES } from "../domain/contracts.ts";
import { classifyHeaders } from "../domain/own/classify.ts";
import type { FileKind } from "../domain/own/classify.ts";
import { REQUIRED_FIELDS } from "../domain/own/columns.ts";
import type { ColumnMapping } from "../domain/own/columns.ts";
import { buildOwnRows } from "../domain/own/rows.ts";
import { buildBankRows, guessBankMapping } from "../domain/own/bank.ts";
import type { BankMapping } from "../domain/own/bank.ts";
import type { DateOrder } from "../domain/own/values.ts";
import type { OwnMergeOutcome } from "../state/store.ts";
import type { MatchReport, OwnParseError } from "../state/ownImporter.ts";
import { plural } from "../components/labels.ts";
import { DateOrderQuestion, FIELD_LABEL, MappingForm, PreviewTable, initialMapping, readPreview, rememberMapping } from "./MinePage.tsx";
import type { Loaded } from "./MinePage.tsx";
import { BankMapForm, MatchResult } from "./BankSection.tsx";
import type { BankImport } from "./BankSection.tsx";

export type BillsImport = (bytes: Uint8Array, mapping: ColumnMapping, opts: { displayName: string; dateOrder: DateOrder | null })
  => Promise<(OwnMergeOutcome & { report?: MatchReport | null }) | OwnParseError>;

interface Item {
  readonly id: number;
  readonly loaded: Loaded;
  readonly kind: FileKind | null;
  readonly bills: ColumnMapping;
  readonly bank: BankMapping;
  readonly dateOrder: DateOrder | null;
  readonly editing: boolean;
}

export type Ready =
  | { readonly ok: true; readonly count: number; readonly skipped: number; readonly prices: boolean }
  | { readonly ok: false; readonly need: "kind" | "dates" | "columns" | "file"; readonly detail: string };

const BANK_LABEL = { date: "Date", description: "Description", amount: "Amount", moneyOut: "Money out" } as const;

const FILE_PROBLEM: Readonly<Record<string, string>> = {
  "too large": "That file is over 10 MB.",
  "too many rows": "That file has more than 20,000 rows. Split it into smaller files and add them one at a time.",
  "not a CSV": "That file could not be read. Save it as “CSV UTF-8 (Comma delimited)” and add it again.",
  "no header": "That file has no header row.",
};

/** Whether a dropped file can be checked as it stands, or what the person must answer first. */
export function checkItem(item: Pick<Item, "loaded" | "kind" | "bills" | "bank" | "dateOrder">): Ready {
  if (item.kind === null) return { ok: false, need: "kind", detail: "" };
  const opts = { dateOrder: item.dateOrder, fileLabel: item.loaded.name };
  const r = item.kind === "bills" ? buildOwnRows(item.loaded.bytes, item.bills, opts) : buildBankRows(item.loaded.bytes, item.bank, opts);
  if ("error" in r) {
    if (r.error === "ambiguous date order") return { ok: false, need: "dates", detail: "" };
    if (r.error !== "missing required column") return { ok: false, need: "file", detail: FILE_PROBLEM[r.error] ?? r.detail };
    if (item.kind === "statement") return { ok: false, need: "columns", detail: "Choose the date, description, and amount (or money out) columns." };
    const missing = REQUIRED_FIELDS.filter((f) => item.bills[f] === undefined).map((f) => FIELD_LABEL[f]);
    return { ok: false, need: "columns", detail: `Choose a column for ${missing.join(", ")}.${item.bills.invoiceNumber === undefined
      ? " If your file has no invoice or bill number, export a report that includes it." : ""}` };
  }
  if ("invoices" in r) {
    if (r.invoices.length === 0) return { ok: false, need: "columns", detail: "No bills could be read with these columns." };
    return { ok: true, count: r.invoices.length, skipped: r.skipped.length, prices: r.checksAvailable.prices };
  }
  if (r.payments.length === 0) return { ok: false, need: "columns", detail: "No money-out lines could be read with these columns." };
  return { ok: true, count: r.payments.length, skipped: r.skipped.length, prices: false };
}

/** "Supplier: Vendor · Total: Amount" from the chosen columns. */
function columnsLine(item: Item): string {
  const h = item.loaded.headers;
  const pairs = item.kind === "bills"
    ? (Object.entries(item.bills) as [keyof typeof FIELD_LABEL, number][]).map(([f, i]) => `${FIELD_LABEL[f]}: ${h[i] ?? ""}`)
    : (Object.entries(item.bank) as [keyof typeof BANK_LABEL, number][]).map(([f, i]) => `${BANK_LABEL[f]}: ${h[i] ?? ""}`);
  return pairs.join(" · ");
}

let nextId = 1;

export function DropFiles({ onImport, onImportBank, queueHref, hero = false, heading = "Add your files" }: {
  readonly onImport: BillsImport; readonly onImportBank: BankImport; readonly queueHref: string; readonly heading?: string;
  /** Landing-page version: no panel or heading, a glass card over the artwork. */
  readonly hero?: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [done, setDone] = useState<{ bills: number; payments: number; report: MatchReport | null; errors: string[] } | null>(null);
  const [over, setOver] = useState(false);
  const ready = useMemo(() => items.map(checkItem), [items]);
  const update = (id: number, change: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...change } : x)));

  async function add(files: readonly File[]) {
    setDone(null);
    const found: Item[] = [];
    const bad: string[] = [];
    for (const file of files) {
      if (file.size > OWN_MAX_BYTES) { bad.push(`${file.name}: over 10 MB, so it was not read.`); continue; }
      let result: Loaded | string;
      try { result = readPreview(file.name, new Uint8Array(await file.arrayBuffer())); } catch { result = "the browser could not read it."; }
      if (typeof result === "string") { bad.push(`${file.name}: ${result}`); continue; }
      const kind = classifyHeaders(result.headers);
      found.push({ id: nextId++, loaded: result, kind, bills: initialMapping(result.headers), bank: guessBankMapping(result.headers), dateOrder: null, editing: false });
    }
    setProblems(bad);
    setItems((xs) => [...xs, ...found]);
  }

  async function checkAll() {
    const errors: string[] = [];
    let bills = 0, payments = 0;
    let report: MatchReport | null = null;
    // Bills first, so a statement in the same drop is matched against them.
    const order = [...items].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "bills" ? -1 : 1));
    for (const item of order) {
      setWorking(item.kind === "bills" ? `Reading ${item.loaded.name}…` : `Matching ${item.loaded.name} against your bills…`);
      try {
        const opts = { displayName: item.loaded.name, dateOrder: item.dateOrder };
        const out = item.kind === "bills"
          ? await onImport(item.loaded.bytes, item.bills, opts)
          : await onImportBank(item.loaded.bytes, item.bank, opts, (p) => setWorking(p < 100 ? `Downloading the name-matching model (once): ${p}%` : `Matching ${item.loaded.name}…`));
        if ("error" in out) errors.push(`${item.loaded.name}: ${out.detail}`);
        else if (out.status === "storage_error") errors.push(`${item.loaded.name}: ${out.message}`);
        else {
          if (item.kind === "bills") { bills += out.added; rememberMapping(item.loaded.headers, item.bills); } else payments += out.added;
          report = out.report ?? report;
        }
      } catch {
        errors.push(`${item.loaded.name}: browser storage failed, so it was not added.`);
      }
    }
    setWorking(null);
    setItems([]);
    setDone({ bills, payments, report, errors });
  }

  const allReady = items.length > 0 && ready.every((r) => r.ok);
  return (
    <section className={hero ? "drop drop-hero" : "panel drop"} aria-labelledby="drop-heading">
      <h2 id="drop-heading" className={hero ? "sr-only" : "section-title"}>{heading}</h2>
      <label htmlFor="own-file" className={`drop-zone${over ? " is-over" : ""}`}
        onDragOver={(e: DragEvent) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e: DragEvent) => { e.preventDefault(); setOver(false); void add([...e.dataTransfer.files]); }}>
        <span className="drop-title">{hero ? "Drop your CSV files here" : "Drop CSV files here, or choose them"}</span>
        <span className="drop-sub">{hero ? "Bills, a bank statement, or both." : "Your bills export, and if you like, a bank or card statement. You can add several at once."}</span>
        {/* The native control can't be centred or styled; it stays focusable but visually hidden behind a real button look. */}
        <input id="own-file" className="sr-only drop-input" type="file" accept=".csv,text/csv" multiple disabled={working !== null}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; void add(fs); }} />
        <span className="btn btn-primary drop-btn" aria-hidden="true">Choose files</span>
      </label>
      {problems.map((p) => <p key={p} className="notice notice-error" role="alert">{p}</p>)}

      {items.length > 0 ? (
        <ul className="drop-list">
          {items.map((item, i) => {
            const r = ready[i]!;
            return (
              <li key={item.id} className="drop-item">
                <p className="drop-item-head">
                  <strong>{item.loaded.name}</strong>{" "}
                  {item.kind ? <span className="badge">{item.kind === "bills" ? "Bills" : "Bank or card statement"}</span> : null}{" "}
                  <button type="button" className="btn btn-quiet" onClick={() => setItems((xs) => xs.filter((x) => x.id !== item.id))} aria-label={`Remove ${item.loaded.name}`}>Remove</button>
                </p>
                {r.ok ? (
                  <p>
                    {item.kind === "bills" ? plural(r.count, "bill") : plural(r.count, "payment") + " going out"}
                    {r.prices ? ", with item lines (we'll also check for price increases)" : ""}
                    {r.skipped ? `, ${r.skipped} unreadable ${r.skipped === 1 ? "row" : "rows"} skipped` : ""}.{" "}
                    <span className="muted">{columnsLine(item)}</span>{" "}
                    <button type="button" className="btn-link" aria-expanded={item.editing} onClick={() => update(item.id, { editing: !item.editing })}>
                      {item.editing ? "Done" : "Change"}
                    </button>
                  </p>
                ) : r.need === "kind" ? (
                  <div className="row-actions" role="group" aria-label={`What is ${item.loaded.name}?`}>
                    <span>What is this file?</span>
                    <button type="button" className="btn btn-secondary" onClick={() => update(item.id, { kind: "bills", editing: true })}>Bills I received</button>
                    <button type="button" className="btn btn-secondary" onClick={() => update(item.id, { kind: "statement", editing: true })}>Bank or card statement</button>
                  </div>
                ) : r.need === "dates" ? (
                  // One answer covers every file in this drop that asks the same question.
                  <DateOrderQuestion name={`dates-${item.id}`} value={item.dateOrder}
                    onChange={(o) => setItems((xs) => xs.map((x, j) => (x.id === item.id || (!ready[j]!.ok && ready[j]!.need === "dates") ? { ...x, dateOrder: o } : x)))} />
                ) : (
                  <p className="notice" role="status">{r.detail}</p>
                )}
                {item.kind && r.ok !== true && r.need === "file" ? null : item.kind && (item.editing || (!r.ok && r.need === "columns")) ? (
                  <div className="drop-edit">
                    {item.kind === "bills"
                      ? <MappingForm headers={item.loaded.headers} mapping={item.bills} onChange={(m) => update(item.id, { bills: m, dateOrder: null })} />
                      : <BankMapForm headers={item.loaded.headers} mapping={item.bank} onChange={(m) => update(item.id, { bank: m, dateOrder: null })} />}
                    <PreviewTable headers={item.loaded.headers} rows={item.loaded.rows} />
                    <button type="button" className="btn-link" onClick={() => update(item.id, { kind: item.kind === "bills" ? "statement" : "bills" })}>
                      {item.kind === "bills" ? "This is actually a bank or card statement" : "These are actually bills"}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {items.length > 0 ? (
        <p>
          <button type="button" className="btn btn-primary btn-big" disabled={!allReady || working !== null} onClick={() => void checkAll()}>
            {working ?? `Check ${items.length === 1 ? "this file" : `these ${items.length} files`}`}
          </button>
          {!allReady && working === null ? <span className="hint"> Answer the question above first.</span> : null}
        </p>
      ) : null}
      {working ? <p className="sr-only" role="status">{working}</p> : null}

      {done ? (
        <div className="notice notice-ok" role="status">
          <p>
            <strong>Done.</strong>{" "}
            {done.bills > 0 ? `Added ${plural(done.bills, "new bill")}. ` : ""}
            {done.payments > 0 ? `Added ${plural(done.payments, "new payment")}. ` : ""}
            {done.bills + done.payments === 0 && done.errors.length === 0 ? "These files were already in your data. " : ""}
          </p>
          {done.errors.map((e) => <p key={e} className="notice-error">{e}</p>)}
          {done.report ? <MatchResult report={done.report} /> : null}
          <p><a className="btn btn-primary btn-big" href={queueHref}>See what we found <span aria-hidden="true">→</span></a></p>
        </div>
      ) : null}
    </section>
  );
}
