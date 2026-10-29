/** "Check against your bank statement": pick a statement CSV, confirm columns, match payments to bills. */
import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { OWN_MAX_BYTES } from "../domain/contracts.ts";
import { buildBankRows, guessBankMapping } from "../domain/own/bank.ts";
import type { BankField, BankMapping, BankParseResult } from "../domain/own/bank.ts";
import type { DateOrder } from "../domain/own/values.ts";
import type { OwnMergeOutcome } from "../state/store.ts";
import type { BankParseError, MatchReport } from "../state/ownImporter.ts";
import { plural } from "../components/labels.ts";
import { DateOrderQuestion, PreviewTable, readPreview } from "./MinePage.tsx";
import type { Loaded } from "./MinePage.tsx";

const BANK_LABEL: Readonly<Record<BankField, string>> = {
  date: "Date", description: "Description", amount: "Amount", moneyOut: "Money out (debit)",
};
const BANK_HINT: Readonly<Record<BankField, string>> = {
  date: "", description: "", amount: "Use this if one column holds both money in and out.",
  moneyOut: "Use this instead of Amount if money out has its own column.",
};

export type BankImport = (
  bytes: Uint8Array, mapping: BankMapping, opts: { displayName: string; dateOrder: DateOrder | null }, onProgress: (percent: number) => void,
) => Promise<(OwnMergeOutcome & { report?: MatchReport | null }) | BankParseError>;

export function BankMapForm({ headers, mapping, onChange }: { readonly headers: readonly string[]; readonly mapping: BankMapping; readonly onChange: (m: BankMapping) => void }) {
  return (
    <div className="mapping">
      {(Object.keys(BANK_LABEL) as BankField[]).map((f) => (
        <div className="field" key={f}>
          <label className="field-label" htmlFor={`bank-map-${f}`}>{BANK_LABEL[f]}{f === "date" || f === "description" ? " (required)" : ""}</label>
          <select id={`bank-map-${f}`} value={mapping[f] ?? ""} onChange={(e) => {
            const next = { ...mapping };
            if (e.target.value === "") delete next[f];
            else next[f] = Number(e.target.value);
            onChange(next);
          }}>
            <option value="">Not in my file</option>
            {headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}
          </select>
          {BANK_HINT[f] ? <p className="hint">{BANK_HINT[f]}</p> : null}
        </div>
      ))}
    </div>
  );
}

/** What the match found, in plain words. */
export function MatchResult({ report, queueHref }: { readonly report: MatchReport; readonly queueHref: string }) {
  return (
    <div className="notice notice-ok" role="status">
      <p>
        Matched {report.matched} of {plural(report.payments, "payment")} to your bills.{" "}
        {report.paidTwice + report.noBill === 0 ? "Nothing looks paid twice." : (
          <>Found {plural(report.paidTwice, "bill")} paid more than once and {plural(report.noBill, "payment")} to your suppliers with no matching bill.</>
        )}
      </p>
      {report.unpaidBills > 0 ? <p>{plural(report.unpaidBills, "bill")} dated within this statement {report.unpaidBills === 1 ? "has" : "have"} no payment on it yet.</p> : null}
      <p className="hint">
        {report.ai
          ? "Payee names were matched by an AI model running in this browser. Amounts and dates are checked exactly."
          : "The AI model could not load, so payee names were matched by their words only. Amounts and dates are checked exactly."}
      </p>
      <p><a href={queueHref}>Review the findings</a></p>
    </div>
  );
}

export function BankSection({ hasBills, onImport, queueHref }: { readonly hasBills: boolean; readonly onImport: BankImport; readonly queueHref: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<BankMapping>({});
  const [dateOrder, setDateOrder] = useState<DateOrder | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [report, setReport] = useState<MatchReport | null>(null);

  const dry: BankParseResult | null = useMemo(
    () => (loaded ? buildBankRows(loaded.bytes, mapping, { dateOrder, fileLabel: loaded.name }) : null), [loaded, mapping, dateOrder]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setReport(null); setLoaded(null); setDateOrder(null);
    if (file.size > OWN_MAX_BYTES) { setProblem("That file is over 10 MB. Nothing was read."); return; }
    try {
      const result = readPreview(file.name, new Uint8Array(await file.arrayBuffer()));
      if (typeof result === "string") { setProblem(result.replace("your bills from your accounting software", "your statement from your bank's website")); return; }
      setProblem(null);
      setMapping(guessBankMapping(result.headers));
      setLoaded(result);
    } catch {
      setProblem("The browser could not read this file. Nothing was imported.");
    }
  }

  async function onContinue() {
    if (!loaded) return;
    setWorking(true); setProblem(null); setProgress(null);
    try {
      const out = await onImport(loaded.bytes, mapping, { displayName: loaded.name, dateOrder }, setProgress);
      if ("error" in out) setProblem(out.detail);
      else if (out.status === "storage_error") setProblem(out.message);
      else { setReport(out.report ?? null); setLoaded(null); }
    } catch {
      setProblem("Browser storage failed, so nothing was imported.");
    } finally { setWorking(false); setProgress(null); }
  }

  const error = dry && "error" in dry ? dry.error : null;
  return (
    <section className="panel" aria-labelledby="bank-heading">
      <h2 id="bank-heading" className="section-title">Check against your bank statement</h2>
      <p>Add a bank or card statement CSV to find bills paid twice and payments to your suppliers with no bill. Optional.</p>
      {!hasBills ? <p className="hint">Add your bills above first, so there is something to match against.</p> : null}
      <label className="field-label" htmlFor="bank-file">Statement CSV (up to 10 MB)</label>
      <input id="bank-file" className="file-input" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e)} disabled={working || !hasBills} />
      <p className="hint">Read on this device and never uploaded. The first match downloads a small AI model (about 30 MB, once; none of your data is sent) that recognises payee names like “SQ *ACME SUPPLY 4412” as “Acme Supply”.</p>
      {problem ? <p className="notice notice-error" role="alert">{problem}</p> : null}
      {report ? <MatchResult report={report} queueHref={queueHref} /> : null}
      {loaded && dry ? (
        <>
          <h3 className="small-title">Confirm the columns</h3>
          <BankMapForm headers={loaded.headers} mapping={mapping} onChange={(m) => { setMapping(m); setDateOrder(null); }} />
          <PreviewTable headers={loaded.headers} rows={loaded.rows} />
          {error === "ambiguous date order" || dateOrder !== null ? <DateOrderQuestion value={dateOrder} onChange={setDateOrder} /> : null}
          {"error" in dry ? (error !== "ambiguous date order" ? <p className="notice" role="status">{dry.detail}.</p> : null) : (
            <>
              <p>
                {plural(dry.payments.length, "payment")} going out{dry.credits > 0 ? `, ${dry.credits} money-in ${dry.credits === 1 ? "line" : "lines"} ignored` : ""}
                {dry.skipped.length > 0 ? `, ${dry.skipped.length} skipped (${[...new Set(dry.skipped.map((s) => s.reason))].join(", ")})` : ""}.
              </p>
              <p>
                <button type="button" className="btn btn-primary" onClick={() => void onContinue()} disabled={working || dry.payments.length === 0}>
                  {working ? "Matching…" : `Match ${plural(dry.payments.length, "payment")} against your bills`}
                </button>
              </p>
              {working ? <p role="status" className="hint">{progress !== null && progress < 100 ? `Downloading the AI model: ${progress}%` : "Matching payee names…"}</p> : null}
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
