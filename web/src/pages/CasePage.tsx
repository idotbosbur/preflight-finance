import type { CaseProps, SaveStatus } from "../ui-contracts.ts";
import type { Invoice, ReviewAction } from "../domain/contracts.ts";
import { ACTIONS, CSV_HEADER, OWN_BATCH_ID, PAY_WINDOW_DAYS, REASON_MAX, REVIEWER_MAX, RULE_DUPLICATE, RULE_NEAR_DUPLICATE, RULE_PAID_TWICE, RULE_PAYMENT_NO_BILL, RULE_PRICE_INCREASE, RULE_RECURRING_INCREASE, RULE_CHARGED_TWICE, codePointLength } from "../domain/contracts.ts";
import type { PaymentEvidence } from "../domain/contracts.ts";
import { DuplicateMembers, MismatchArithmetic, NearDuplicateMembers, RuleBadge, StateBadge } from "../components/Evidence.tsx";
import { ACTION_LABEL, OWN_ACTION_LABEL, ACTION_ORDER, ACTION_PAST, OWN_BADGE, STATE_LABEL, caseTitle, sourceBadge } from "../components/labels.ts";

const ERRORS_ID = "decision-errors";
const STATUS_ID = "decision-status";

function SaveMessage({ save }: { readonly save: SaveStatus }) {
  switch (save.kind) {
    case "idle":
      return null;
    case "saving":
      return <p className="notice">Saving “{ACTION_LABEL[save.action]}”…</p>;
    case "saved":
      return <p className="notice notice-ok">{save.message}</p>;
    case "invalid":
      return (
        <div className="notice notice-error" id={ERRORS_ID}>
          <p>Not saved. Please fix:</p>
          <ul>
            {save.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      );
    case "conflict":
      return (
        <div className="notice notice-error" id={ERRORS_ID}>
          {/* Rendered verbatim: conflict is also a pre-emptive notice before any submit. */}
          <p>{save.message}</p>
          <p>Your reviewer name and reason are kept below.</p>
        </div>
      );
    case "error":
      return (
        <div className="notice notice-error" id={ERRORS_ID}>
          <p>Not saved: {save.message}</p>
        </div>
      );
  }
}

function RawFields({ invoice }: { readonly invoice: Invoice }) {
  return (
    <div className="raw">
      <h4 className="small-title">
        {invoice.recordId} · source row {invoice.rowNumber}
      </h4>
      <dl className="kv kv-raw">
        {CSV_HEADER.map((field, i) => (
          <div key={field}>
            <dt><code>{field}</code></dt>
            <dd><code>{invoice.raw[i] ?? ""}</code></dd>
          </div>
        ))}
        <div>
          <dt>Normalized vendor</dt>
          <dd><code>{invoice.vendorNorm}</code></dd>
        </div>
        <div>
          <dt>Normalized invoice number</dt>
          <dd><code>{invoice.invoiceNorm}</code></dd>
        </div>
      </dl>
    </div>
  );
}

/** Statement lines behind a bank-vs-bills finding, with how each payee name was matched. */
function PaymentsTable({ payments }: { readonly payments: readonly PaymentEvidence[] }) {
  return (
    <div className="dup-scroll">
      <table className="dup-table">
        <caption className="sr-only">Payments from your statement</caption>
        <thead><tr><th scope="col">Paid on</th><th scope="col">Statement description</th><th scope="col" className="num">Amount</th><th scope="col">Name matched by</th></tr></thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.paymentId}><td><code>{p.date}</code></td><td><code>{p.description}</code></td><td className="num">{p.amount}</td><td>{p.match}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CasePage({ view, form, onFormChange, onAction, save, durability, guideHint, queueHref, prevHref, nextHref, suggestedReasons }: CaseProps) {
  const { batch, finding, members, history } = view;
  const ev = finding.evidence;
  const allowed: readonly ReviewAction[] = ACTION_ORDER.filter((a) => ACTIONS[a].from.includes(finding.state));
  const saving = save.kind === "saving";
  const hasErrors = save.kind === "invalid" || save.kind === "conflict" || save.kind === "error";
  const describedBy = hasErrors ? `${ERRORS_ID} reason-hint` : "reason-hint";
  const isDup = ev.kind === RULE_DUPLICATE;
  const own = batch.source === "own" || batch.batchId === OWN_BATCH_ID;
  const currency = members[0]?.currency ?? "USD";

  return (
    <div className="workspace case">
      <nav className="case-nav" aria-label="Case navigation">
        <a href={queueHref}>Back to queue</a>
        <span className="case-nav-step">
          {prevHref ? <a href={prevHref}>Previous case</a> : <span className="muted">Previous case</span>}
          {" · "}
          {nextHref ? <a href={nextHref}>Next case</a> : <span className="muted">Next case</span>}
        </span>
      </nav>

      <header className="page-head">
        <div className="case-card-badges">
          <RuleBadge rule={finding.ruleId} />
          <StateBadge state={finding.state} />
          <span className="badge badge-synthetic">{own ? OWN_BADGE : sourceBadge(batch.source)}</span>
        </div>
        <h1 id="case-heading" className="page-title case-title" tabIndex={-1}>
          {caseTitle(finding, own)}
        </h1>
        {own ? null : (
          <p className="muted">
            Batch {batch.displayName} · finding <code>{finding.findingId}</code>
          </p>
        )}
      </header>

      {guideHint ? (
        <p className="guide-hint">
          <strong>Guide: </strong>
          {guideHint}
        </p>
      ) : null}

      <section className="panel" aria-labelledby="why-heading">
        <h2 id="why-heading" className="section-title">Why this was flagged</h2>
        {isDup ? (
          <>
            <p>
              These invoices have the same vendor, invoice number and currency after normalization (outer spaces trimmed, letters
              upper-cased). That can mean the same invoice was entered twice, or that a vendor legitimately reused an invoice
              number. The rule cannot tell which, so a person decides.
            </p>
            <DuplicateMembers evidence={ev} currency={currency} />
          </>
        ) : ev.kind === RULE_PAID_TWICE ? (
          <>
            <p>
              More than one payment on your bank or card statement matches this one bill: the same amount, paid on or up to{" "}
              {PAY_WINDOW_DAYS} days after the bill date, to a payee whose name matches the supplier. Each match says how the name
              was recognised. It may be a real double payment, or a second bill with the same amount that is missing from your
              file, so a person decides.
            </p>
            <p>
              Bill: <strong>{ev.bill.rawVendor}</strong> · invoice <code>{ev.bill.rawInvoice}</code> · {ev.bill.invoiceDate || "no date"} ·{" "}
              {ev.bill.total} {ev.currency}
            </p>
            <PaymentsTable payments={ev.payments} />
          </>
        ) : ev.kind === RULE_RECURRING_INCREASE ? (
          <>
            <p>
              This looks like a monthly charge (it appears about once a month, at the same few amounts). It went from{" "}
              <strong className="num">{ev.from}</strong> to <strong className="num">{ev.to}</strong> (+{ev.percent}%). That is{" "}
              <strong className="num">{ev.extra}</strong> more than the first price so far, and about <strong className="num">{ev.perYear}</strong> a year
              if it stays. The plan may have changed on purpose, so a person decides.
            </p>
            <PaymentsTable payments={ev.payments} />
          </>
        ) : ev.kind === RULE_CHARGED_TWICE ? (
          <>
            <p>
              This payee is normally charged once a month, but in {ev.month} the same amount ({ev.amount}) was taken {ev.payments.length} times.
              One may be a mistake or a duplicate subscription, so a person decides.
            </p>
            <PaymentsTable payments={ev.payments} />
          </>
        ) : ev.kind === RULE_PRICE_INCREASE ? (
          <>
            <p>
              The unit price of this item from <strong>{ev.vendor}</strong> went from <strong className="num">{ev.from}</strong> to{" "}
              <strong className="num">{ev.to}</strong> {ev.currency} (+{ev.percent}%) between the first and the latest bill. Across the later
              purchases that is <strong className="num">{ev.extra}</strong> above the first price.{" "}
              {ev.match === "same name"
                ? "The bills use the same item name (capitals and spacing ignored)."
                : `Item names written differently were treated as one item by ${ev.match}, and only because their sizes and counts match exactly.`}{" "}
              The supplier may have raised prices on purpose, so a person decides.
            </p>
            <div className="dup-scroll">
              <table className="dup-table">
                <caption className="sr-only">Purchases of this item</caption>
                <thead><tr><th scope="col">Bill date</th><th scope="col">Invoice</th><th scope="col">Item as written</th><th scope="col" className="num">Quantity</th><th scope="col" className="num">Unit price</th></tr></thead>
                <tbody>
                  {ev.purchases.map((p, i) => (
                    <tr key={`${p.recordId}-${i}`}><td><code>{p.date}</code></td><td><code>{p.invoice}</code></td><td>{p.description}</td><td className="num">{p.quantity}</td><td className="num">{p.unit}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : ev.kind === RULE_PAYMENT_NO_BILL ? (
          <>
            <p>
              This payment's description looks like your supplier <strong>{ev.vendor}</strong>, but none of their bills in your file has
              this exact amount with a bill date up to {PAY_WINDOW_DAYS} days before the payment. The bill may be missing from your
              export, or the payment may be a mistake, so a person decides.
            </p>
            <PaymentsTable payments={[ev.payment]} />
          </>
        ) : ev.kind === RULE_NEAR_DUPLICATE ? (
          <>
            <p>
              Same vendor and total amount a few days apart, but different invoice numbers. Lower confidence: this
              may be a repeat charge or two genuine invoices, so a person decides.
            </p>
            <NearDuplicateMembers evidence={ev} currency={currency} />
          </>
        ) : (
          <>
            <p>
              The total declared on this invoice does not equal subtotal + tax + shipping − discount, checked in exact cents. Even a
              one-cent difference is flagged.
            </p>
            <MismatchArithmetic evidence={ev} currency={currency} />
          </>
        )}
      </section>

      <section className="panel decision" aria-labelledby="decision-heading">
        <h2 id="decision-heading" className="section-title">Your decision</h2>
        <p className="muted">
          A decision records your judgment on this candidate only. It never approves, blocks or pays anything.
        </p>
        {durability === "memory" ? (
          <p className="notice notice-warn">Browser storage is unavailable: decisions in this tab will be lost on reload.</p>
        ) : null}
        <div className="field">
          <label className="field-label" htmlFor="reviewer">{own ? "Your name or initials" : "Reviewer (fictional demo name)"}</label>
          <input
            id="reviewer"
            className="text-input"
            type="text"
            autoComplete="off"
            value={form.reviewer}
            aria-invalid={save.kind === "invalid" ? true : undefined}
            aria-describedby={hasErrors ? `${ERRORS_ID} reviewer-hint` : "reviewer-hint"}
            onChange={(e) => onFormChange({ ...form, reviewer: e.target.value })}
          />
          <p id="reviewer-hint" className="hint">
            1 to {REVIEWER_MAX} characters. Self-declared; there are no accounts.
          </p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="reason">{own ? "Note (what you found out)" : "Reason"}</label>
          <textarea
            id="reason"
            className="text-input"
            rows={4}
            value={form.reason}
            aria-invalid={save.kind === "invalid" ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => onFormChange({ ...form, reason: e.target.value })}
          />
          <p id="reason-hint" className="hint">
            Required, 1 to {REASON_MAX} characters ({codePointLength(form.reason)} used).
          </p>
          {suggestedReasons.length > 0 ? (
            <div className="chips" role="group" aria-label="Suggested reasons (fills the reason box; you can edit it)">
              {suggestedReasons.map((r) => (
                <button key={r} type="button" className="chip" onClick={() => onFormChange({ ...form, reason: r })}>
                  {r}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="row-actions">
          {allowed.map((a) => (
            <button
              key={a}
              type="button"
              className={a === "confirm" ? "btn btn-primary" : "btn btn-secondary"}
              disabled={saving}
              onClick={() => onAction(a)}
            >
              {(own ? OWN_ACTION_LABEL : ACTION_LABEL)[a]}
            </button>
          ))}
        </div>
        <div id={STATUS_ID} className="save-status" role="status" aria-live="polite">
          <SaveMessage save={save} />
        </div>
      </section>

      <section className="panel" aria-labelledby="history-heading">
        <h2 id="history-heading" className="section-title">History</h2>
        {history.length === 0 ? (
          <p className="muted">No decisions yet. Current state: {STATE_LABEL[finding.state]}.</p>
        ) : (
          <ol className="timeline">
            {history.map((e) => (
              <li key={`${e.resetGeneration}-${e.sequence}`} className="timeline-item">
                <p className="timeline-head">
                  <strong>{ACTION_PAST[e.action]}</strong> by {e.reviewer}{" "}
                  <span className="muted">
                    · <time dateTime={e.at}>{e.at}</time> · {STATE_LABEL[e.prevState]} → {STATE_LABEL[e.nextState]} · decision{" "}
                    {e.sequence}
                  </span>
                </p>
                <p className="timeline-reason">{e.reason}</p>
              </li>
            ))}
          </ol>
        )}
        <p className="hint">
          {durability === "memory"
            ? "Browser storage is unavailable, so this history is kept only in this tab and will be lost on reload. It is not an audit log."
            : `History is kept in this browser only, until you ${own ? "delete your data" : "reset the demo data"}. It is not an audit log.`}
        </p>
      </section>

      <details className="panel source-details">
        <summary>Source details</summary>
        <dl className="kv">
          <div>
            <dt>Ruleset</dt>
            <dd><code>{finding.ruleVersion}</code> (batch: <code>{batch.ruleset}</code>)</dd>
          </div>
          <div>
            <dt>Rule</dt>
            <dd><code>{finding.ruleId}</code></dd>
          </div>
          <div>
            <dt>Finding ID</dt>
            <dd><code>{finding.findingId}</code></dd>
          </div>
          <div>
            <dt>Batch ID</dt>
            <dd><code>{batch.batchId}</code></dd>
          </div>
          <div>
            <dt>File SHA-256</dt>
            <dd><code className="hash">{batch.fileSha256}</code></dd>
          </div>
          {isDup ? (
            <div>
              <dt>Normalized key</dt>
              <dd>
                <code>
                  {ev.key.vendor} | {ev.key.invoice} | {ev.key.currency}
                </code>
              </dd>
            </div>
          ) : null}
        </dl>
        <h3 className="small-title">Raw fields</h3>
        <div className="raw-list">
          {members.map((m) => (
            <RawFields key={m.recordId} invoice={m} />
          ))}
        </div>
      </details>
    </div>
  );
}
