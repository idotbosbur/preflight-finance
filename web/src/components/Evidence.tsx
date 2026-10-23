import type { DuplicateEvidence, MismatchEvidence, NearDuplicateEvidence, ReviewState, RuleId } from "../domain/contracts.ts";
import { RULE_LABEL, STATE_LABEL } from "./labels.ts";

export function StateBadge({ state }: { readonly state: ReviewState }) {
  // key={state} remounts on change so the ≤150ms highlight (CSS, off under reduced motion) replays.
  return (
    <span key={state} className={`badge badge-state badge-${state}`}>
      <span className="sr-only">Review state: </span>
      {STATE_LABEL[state]}
    </span>
  );
}

export function RuleBadge({ rule }: { readonly rule: RuleId }) {
  return (
    <span className={`badge badge-rule ${rule === "TOTAL_MISMATCH" ? "badge-mismatch" : "badge-duplicate"}`}>
      <span className="sr-only">Rule: </span>
      {RULE_LABEL[rule]}
    </span>
  );
}

/**
 * Plain-English receipt for a total mismatch. Every amount is an evidence string rendered verbatim;
 * nothing is computed here.
 */
export function MismatchArithmetic({ evidence, headingLevel = 3, currency = "USD" }: { readonly evidence: MismatchEvidence; readonly headingLevel?: 2 | 3 | 4; readonly currency?: string }) {
  const H = headingLevel === 2 ? "h2" : headingLevel === 4 ? "h4" : "h3";
  const lower = evidence.delta.startsWith("-");
  return (
    <div className="calc">
      <H className="calc-ref">{evidence.recordId} · row {evidence.row}</H>
      <p className="calc-say">
        The invoice says <strong className="num">{evidence.declared}</strong>, but its parts add up to{" "}
        <strong className="num">{evidence.expected}</strong>.
      </p>
      <p className="calc-diff">
        <span className="calc-diff-num num">{evidence.delta}</span>
        <span className="calc-diff-text">{lower ? "The invoice total is lower than it should be." : "The invoice total is higher than it should be."}</span>
      </p>
      <dl className="calc-lines">
        <div><dt>Subtotal</dt><dd className="num">{evidence.subtotal}</dd></div>
        <div><dt><span aria-hidden="true">+ </span>Tax</dt><dd className="num">{evidence.tax}</dd></div>
        <div><dt><span aria-hidden="true">+ </span>Shipping</dt><dd className="num">{evidence.shipping}</dd></div>
        <div><dt><span aria-hidden="true">− </span>Discount</dt><dd className="num">{evidence.discount}</dd></div>
        <div className="calc-total"><dt>Should total</dt><dd className="num">{evidence.expected}</dd></div>
        <div className="calc-declared"><dt>Invoice says</dt><dd className="num">{evidence.declared}</dd></div>
      </dl>
      <p className="calc-check">
        <span className="sr-only">Formula: </span>
        <code>{evidence.subtotal} + {evidence.tax} + {evidence.shipping} − {evidence.discount} = {evidence.expected}</code>
        <span> · {currency}, compared in exact cents</span>
      </p>
    </div>
  );
}

/** Side-by-side comparison of a duplicate group; values that differ between members are emphasised. */
export function DuplicateMembers({ evidence, headingLevel = 3, currency = "USD" }: { readonly evidence: DuplicateEvidence; readonly headingLevel?: 2 | 3 | 4; readonly currency?: string }) {
  const H = headingLevel === 2 ? "h2" : headingLevel === 4 ? "h4" : "h3";
  const rows: ReadonlyArray<readonly [string, (m: DuplicateEvidence["members"][number]) => string, boolean]> = [
    ["Invoice date", (m) => m.invoiceDate, false],
    [`Total (${currency})`, (m) => m.total, true],
    ["Vendor as written", (m) => m.rawVendor, false],
    ["Invoice no. as written", (m) => m.rawInvoice, false],
  ];
  return (
    <div className="dup">
      <p className="dup-key">
        Same vendor and invoice number: <code>{evidence.key.vendor}</code> · <code>{evidence.key.invoice}</code>{" "}
        <span className="muted">({evidence.key.currency})</span>
      </p>
      <div className="dup-scroll">
        <table className="dup-table">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Field</span></th>
              {evidence.members.map((m) => (
                <th key={m.recordId} scope="col">
                  <H className="dup-member-title">{m.recordId}</H>
                  <span className="muted">row {m.row}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, get, num]) => {
              const values = evidence.members.map(get);
              const differs = new Set(values).size > 1;
              return (
                <tr key={label} className={differs ? "is-different" : undefined}>
                  <th scope="row">{label}{differs ? <span className="dup-diff-tag">differs</span> : null}</th>
                  {values.map((v, i) => (
                    <td key={evidence.members[i]!.recordId} className={num ? "num" : undefined}>{num ? v : <code>{v}</code>}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Lower-confidence pair: same vendor and total a few days apart. Currency comes from the member invoices. */
export function NearDuplicateMembers({ evidence, currency, headingLevel = 3 }: { readonly evidence: NearDuplicateEvidence; readonly currency: string; readonly headingLevel?: 2 | 3 | 4 }) {
  const H = headingLevel === 2 ? "h2" : headingLevel === 4 ? "h4" : "h3";
  return (
    <div className="dup">
      <p className="dup-key">
        Same vendor <code>{evidence.vendor}</code> and total <strong className="num">{evidence.total}</strong>{" "}
        <span className="muted">({currency})</span>, <strong>{evidence.daysApart} days</strong> apart.
      </p>
      <div className="dup-scroll">
        <table className="dup-table">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Field</span></th>
              {evidence.members.map((m) => (
                <th key={m.recordId} scope="col">
                  <H className="dup-member-title">{m.recordId}</H>
                  <span className="muted">row {m.row}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr><th scope="row">Invoice date</th>{evidence.members.map((m) => <td key={m.recordId}><code>{m.invoiceDate}</code></td>)}</tr>
            <tr><th scope="row">Total ({currency})</th>{evidence.members.map((m) => <td key={m.recordId} className="num">{m.total}</td>)}</tr>
            <tr className="is-different"><th scope="row">Invoice no. as written<span className="dup-diff-tag">differs</span></th>{evidence.members.map((m) => <td key={m.recordId}><code>{m.rawInvoice}</code></td>)}</tr>
            <tr><th scope="row">Vendor as written</th>{evidence.members.map((m) => <td key={m.recordId}><code>{m.rawVendor}</code></td>)}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
