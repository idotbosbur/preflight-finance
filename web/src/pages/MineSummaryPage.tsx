/** Printable pilot summary for the person's own workspace. Counts only unless the box is ticked. */
import { useState } from "react";
import type { BatchSummary, FindingView, Invoice } from "../domain/contracts.ts";
import { RULE_DUPLICATE, RULE_MISMATCH, RULE_NEAR_DUPLICATE, RULE_PAID_TWICE, RULE_PAYMENT_NO_BILL } from "../domain/contracts.ts";
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

export function MineSummaryPage({ batch, findings, files, rows, reasons, mineHref, initialDetails = false, loading = false }: MineSummaryPageProps) {
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
        </>
      )}
    </div>
  );
}
