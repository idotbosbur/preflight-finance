/** Printable pilot summary for the person's own workspace. Counts only unless the box is ticked. */
import { useMemo, useState } from "react";
import { STATUS_TEXT, contractorCsv, contractorTotals, yearsIn } from "../domain/contractors.ts";
import type { ContractorTotals } from "../domain/contractors.ts";
import { formatMoney } from "../domain/glance.ts";
import type { NameScorer } from "../domain/reconcile.ts";
import type { BatchSummary, FindingView, Invoice } from "../domain/contracts.ts";
import { RULE_DUPLICATE, RULE_MISMATCH, RULE_NEAR_DUPLICATE, RULE_PAID_TWICE, RULE_PAYMENT_NO_BILL, RULE_PRICE_INCREASE } from "../domain/contracts.ts";
import { buildPilotSummary, summaryCsv } from "../domain/own/summary.ts";
import type { OwnFileRecord } from "../state/store.ts";
import { OWN_BADGE, RULE_LABEL } from "../components/labels.ts";

export interface MineSummaryPageProps {
  readonly batch: BatchSummary | null;
  readonly findings: readonly FindingView[];
  readonly files: readonly OwnFileRecord[];
  readonly rows: readonly Invoice[];
  readonly reasons: ReadonlyMap<string, string>;
  readonly mineHref: string;
  readonly initialDetails?: boolean;
  /** True until findings, rows and reasons have all been read. */
  readonly loading?: boolean;
  /** Name scorer for grouping payee spellings (the in-browser AI one in the app). */
  readonly scoreNames?: (names: readonly string[]) => Promise<{ scorer: NameScorer; ai: boolean }>;
}

/** Year-end contractor totals for 1099-NEC preparation. Built on request, since it may download the AI model. */
export function ContractorList({ rows, scoreNames }: { readonly rows: readonly Invoice[]; readonly scoreNames: NonNullable<MineSummaryPageProps["scoreNames"]> }) {
  const years = useMemo(() => yearsIn(rows), [rows]);
  const [year, setYear] = useState<number | null>(null);
  const [built, setBuilt] = useState<{ totals: ContractorTotals; ai: boolean; year: number } | null>(null);
  const [working, setWorking] = useState(false);
  const chosen = year ?? years[0] ?? null;
  if (chosen === null) return null;
  async function build(y: number) {
    setWorking(true);
    try {
      const names = [...new Set(rows.map((r) => (r.raw[1] ?? "").trim() || r.vendorNorm))];
      const { scorer, ai } = await scoreNames(names);
      setBuilt({ totals: contractorTotals(rows, y, scorer), ai, year: y });
    } finally { setWorking(false); }
  }
  const t = built?.year === chosen ? built.totals : null;
  return (
    <section className="panel contractors" aria-labelledby="contractors-heading">
      <h2 id="contractors-heading" className="section-title">Year-end contractor list (1099)</h2>
      <p>Totals what you were billed by each payee in one year, groups different spellings of the same name, and marks who may need a Form 1099-NEC.</p>
      <div className="row-actions no-print">
        <label className="field-label" htmlFor="contractor-year">Year</label>
        <select id="contractor-year" value={chosen} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button type="button" className="btn btn-primary" disabled={working} onClick={() => void build(chosen)}>
          {working ? "Building…" : t ? "Rebuild the list" : "Build the contractor list"}
        </button>
      </div>
      {t ? (
        <>
          <p className="hint">
            Threshold for {chosen}: {formatMoney(t.threshold, "USD")}. {built!.ai ? "Name spellings were grouped by an AI model in this browser and by matching words." : "Name spellings were grouped by matching words."}
            {t.otherCurrencyBills ? ` ${t.otherCurrencyBills} non-USD bills left out.` : ""}{t.undatedBills ? ` ${t.undatedBills} bills without a date left out.` : ""}
          </p>
          <div className="dup-scroll">
            <table className="summary-table">
              <thead><tr><th scope="col">Payee</th><th scope="col">Bills</th><th scope="col" className="num">Total</th><th scope="col">1099</th></tr></thead>
              <tbody>
                {t.payees.map((p) => (
                  <tr key={p.name} className={`payee-${p.status}`}>
                    <td>{p.name}{p.names.length > 1 ? <span className="hint"> Also written as {p.names.filter((n) => n !== p.name).join(", ")}</span> : null}</td>
                    <td>{p.bills}</td>
                    <td className="num">{formatMoney(p.cents, "USD")}</td>
                    <td>{STATUS_TEXT[p.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {t.maybeSame.length ? (
            <div className="notice" role="note">
              <p><strong>Possibly the same payee.</strong> Together these reach the threshold. Check whether they are one person or business:</p>
              <ul>{t.maybeSame.map((m) => <li key={m.a + m.b}>{m.a} and {m.b}: {formatMoney(m.cents, "USD")} together</li>)}</ul>
            </div>
          ) : null}
          <p className="no-print"><button type="button" className="btn btn-secondary" onClick={() => download(`preflight-contractors-${chosen}.csv`, contractorCsv(t, chosen))}>Download the list (.csv)</button></p>
          <p className="hint">
            Not tax advice. Only payments for services count, not goods. Totals use bill dates, but the IRS counts payments by the date paid, so check bills near January 1.
            Payments made by card or PayPal are reported by the processor and usually need no 1099 from you. Ask each payee
            who may need one for a Form W-9.
          </p>
        </>
      ) : null}
    </section>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MineSummaryPage({ batch, findings, files, rows, reasons, mineHref, initialDetails = false, loading = false, scoreNames }: MineSummaryPageProps) {
  const [details, setDetails] = useState(initialDetails);
  const s = batch ? buildPilotSummary(batch, findings, files, rows, reasons, details) : null;
  const stat = (label: string, value: string | number) => <div className="summary-stat"><dt>{label}</dt><dd>{value}</dd></div>;
  return (
    <div className="workspace">
      <header className="page-head">
        <p className="eyebrow">Your data</p>
        <h1 className="page-title" tabIndex={-1}>Pilot summary</h1>
        <p><span className="badge badge-synthetic">{OWN_BADGE}</span></p>
      </header>
      {loading ? (
        <p className="app-loading" role="status">Reading your results…</p>
      ) : !s ? (
        <p className="muted">Nothing to summarise yet. <a href={mineHref}>Add a CSV file</a> first.</p>
      ) : (
        <>
          <dl className="summary-grid">
            {stat("Invoices checked", s.invoices)}
            {stat("Files", s.files)}
            {stat("Invoice dates", s.dateFrom ? `${s.dateFrom} to ${s.dateTo}` : "not available")}
            {stat(RULE_LABEL[RULE_DUPLICATE], s.byRule.duplicate)}
            {stat(RULE_LABEL[RULE_MISMATCH], s.byRule.mismatch)}
            {stat(RULE_LABEL[RULE_NEAR_DUPLICATE], s.byRule.nearDuplicate)}
            {stat(RULE_LABEL[RULE_PAID_TWICE], s.byRule.paidTwice)}
            {stat(RULE_LABEL[RULE_PAYMENT_NO_BILL], s.byRule.noBill)}
            {stat(RULE_LABEL[RULE_PRICE_INCREASE], s.byRule.priceUp)}
            {stat("Confirmed", s.confirmed)}
            {stat("Dismissed", s.dismissed)}
            {stat("Open", s.open)}
          </dl>
          <p className="hint">Findings are candidates for a person to review, not conclusions.</p>
          <p className="no-print">
            <input id="summary-details" type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />{" "}
            <label htmlFor="summary-details">Include vendor names, invoice numbers and decision reasons</label>
          </p>
          {details ? (
            <table className="summary-table">
              <thead><tr><th>Finding</th><th>Status</th><th>Vendor</th><th>Invoice</th><th>Reason</th></tr></thead>
              <tbody>
                {s.details.map((d, i) => <tr key={i}><td>{d.rule}</td><td>{d.state}</td><td>{d.vendor}</td><td>{d.invoice}</td><td>{d.reason}</td></tr>)}
              </tbody>
            </table>
          ) : null}
          <p className="no-print">
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print</button>{" "}
            <button type="button" className="btn btn-secondary" onClick={() => download("preflight-pilot-summary.csv", summaryCsv(s))}>Download (.csv)</button>
          </p>
          {scoreNames ? <ContractorList rows={rows} scoreNames={scoreNames} /> : null}
        </>
      )}
    </div>
  );
}
