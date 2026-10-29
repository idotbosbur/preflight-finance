import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { QueueFilter, QueueProps, RouteHref } from "../ui-contracts.ts";
import type { ReviewState, RuleId } from "../domain/contracts.ts";
import { RULE_NEAR_DUPLICATE, RULE_PAID_TWICE, RULE_PAYMENT_NO_BILL, RULE_PRICE_INCREASE, RULE_RECURRING_INCREASE, RULE_CHARGED_TWICE } from "../domain/contracts.ts";
import { StateBadge } from "../components/Evidence.tsx";
import { RULE_LABEL, sourceBadge, STATE_LABEL, caseTitle, plural } from "../components/labels.ts";
import type { Glance, GlanceItem } from "../domain/glance.ts";
import { formatMoney, supplierEmail } from "../domain/glance.ts";

const STATE_OPTIONS: readonly (ReviewState | "all")[] = ["all", "open", "confirmed", "dismissed"];
const RULE_OPTIONS: readonly (RuleId | "all")[] = ["all", "DUPLICATE_CANDIDATE", "TOTAL_MISMATCH"];
const OWN_RULE_OPTIONS: readonly (RuleId | "all")[] = [...RULE_OPTIONS, RULE_NEAR_DUPLICATE, RULE_PAID_TWICE, RULE_PAYMENT_NO_BILL, RULE_PRICE_INCREASE, RULE_RECURRING_INCREASE, RULE_CHARGED_TWICE];
const STATE_OPTION_LABEL: Readonly<Record<ReviewState | "all", string>> = { all: "All states", ...STATE_LABEL };
const OWN_STATE_OPTION: Readonly<Record<ReviewState | "all", string>> = { all: "Everything", open: "Not answered yet", confirmed: "Needs fixing", dismissed: "Fine" };
/** Findings shown per page of the queue. */
export const PAGE_SIZE = 50;

export const QUEUE_HEADING_ID = "queue-heading";

/** Presentational confirmation; exported for SSR tests. */
export function ResetConfirmation({ onConfirm, onCancel, cancelRef }: { readonly onConfirm: () => void; readonly onCancel: () => void; readonly cancelRef?: RefObject<HTMLButtonElement | null> }) {
  return (
    <div className="confirm-box" role="group" aria-labelledby="reset-q">
      <p id="reset-q">
        Erase every batch and decision stored by this demo in this browser? This cannot be undone and affects nobody else.
      </p>
      <div className="row-actions">
        <button type="button" className="btn btn-danger" onClick={onConfirm}>
          Yes, reset demo data
        </button>
        <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

type FocusAfter = "cancel" | "trigger" | "heading" | null;

function ResetControl({ onResetDemo }: { readonly onResetDemo: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const focusAfter = useRef<FocusAfter>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === "cancel") cancelRef.current?.focus();
    else if (target === "trigger") triggerRef.current?.focus();
    else if (target === "heading") {
      // A stable destination that survives the reset re-render: the queue page h1.
      requestAnimationFrame(() => document.getElementById(QUEUE_HEADING_ID)?.focus());
    }
  }, [confirming]);

  if (!confirming) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-quiet"
        onClick={() => {
          focusAfter.current = "cancel";
          setConfirming(true);
        }}
      >
        Reset this browser's demo data
      </button>
    );
  }
  return (
    <ResetConfirmation
      cancelRef={cancelRef}
      onCancel={() => {
        focusAfter.current = "trigger";
        setConfirming(false);
      }}
      onConfirm={() => {
        focusAfter.current = "heading";
        setConfirming(false);
        onResetDemo();
      }}
    />
  );
}

/** One of the biggest findings, with a ready-to-copy supplier email. */
function GlanceRow({ item, href }: { readonly item: GlanceItem; readonly href: RouteHref }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const mail = supplierEmail(item);
  const id = `email-${item.finding.findingId}`;
  const amount = formatMoney(item.cents, item.currency);
  return (
    <li className="glance-item">
      <p className="glance-item-title">
        <strong>{item.vendor} · {item.finding.ruleId === "TOTAL_MISMATCH" ? `${amount} off` : amount}</strong>
        <span>{item.reason}</span>
      </p>
      <div className="row-actions">
        <a className="btn btn-secondary" href={href}>Review</a>
        <button type="button" className="btn btn-quiet" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          Email supplier
        </button>
      </div>
      {open ? (
        <div className="glance-email" id={id}>
          <label className="field-label" htmlFor={`${id}-text`}>Draft email</label>
          <textarea id={`${id}-text`} readOnly rows={8} value={`Subject: ${mail.subject}

${mail.body}`} />
          <div className="row-actions">
            <button type="button" className="btn btn-secondary" onClick={() => {
              navigator.clipboard?.writeText(`${mail.subject}

${mail.body}`).then(() => setCopied(true), () => setCopied(false));
            }}>{copied ? "Copied" : "Copy"}</button>
            <a className="btn btn-quiet" href={`mailto:?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`}>Open in your email app</a>
          </div>
          <p className="hint">Preflight never sends anything. Add the supplier's address in your own email app.</p>
        </div>
      ) : null}
    </li>
  );
}

/** The headline: how much money needs a second look, and the three biggest problems. */
export function AtAGlance({ glance, rowCount, hrefForCase }: { readonly glance: Glance; readonly rowCount: number; readonly hrefForCase: (findingId: string) => RouteHref }) {
  if (glance.items.length === 0) {
    return (
      <section className="glance glance-clear" aria-label="At a glance">
        <p className="glance-eyebrow">Before you pay</p>
        <p className="glance-ok">Nothing needs a second look. All {plural(rowCount, "bill")} passed the checks.</p>
      </section>
    );
  }
  return (
    <section className="glance" aria-labelledby="glance-heading">
      <p className="glance-eyebrow">Before you pay</p>
      <h2 id="glance-heading" className="glance-amount">{formatMoney(glance.cents, glance.currency)}</h2>
      <p className="glance-what">may have been overpaid, or needs a second look</p>
      <p className="glance-sub">
        {glance.bills} of {plural(rowCount, "bill")} need a look · everything else looks fine
        {glance.otherCurrencies.length ? ` · more flagged in ${glance.otherCurrencies.join(", ")}` : ""}
      </p>
      <p>
        <button type="button" className="btn btn-primary" onClick={() => document.getElementById("findings")?.scrollIntoView({ behavior: "smooth" })}>
          Review all {glance.items.length}
        </button>
      </p>
      <h3 className="small-title">Biggest first</h3>
      <ul className="glance-list">
        {glance.items.slice(0, 3).map((i) => <GlanceRow key={i.finding.findingId} item={i} href={hrefForCase(i.finding.findingId)} />)}
      </ul>
      <p className="hint">These are things to check, not proof of a mistake. Anything you mark as fine drops out of the total.</p>
    </section>
  );
}

export function QueuePage(props: QueueProps) {
  const { batch, batches, findings, filter, onFilterChange, hrefForCase, hrefForBatch, demo, onLoadDemo, glance } = props;
  const [shown, setShown] = useState(PAGE_SIZE);
  const own = batch?.source === "own";
  useEffect(() => setShown(PAGE_SIZE), [batch?.batchId]);

  function setFilter(next: Partial<QueueFilter>) {
    setShown(PAGE_SIZE);
    onFilterChange({ ...filter, ...next });
  }

  return (
    <div className="workspace">
      <header className="page-head">
        <p className="eyebrow">Review queue</p>
        {batch ? <p><span className="badge badge-synthetic">{sourceBadge(batch.source)}</span></p> : null}
        <h1 id={QUEUE_HEADING_ID} className="page-title" tabIndex={-1}>
          {batch ? batch.displayName : "Findings to review"}
        </h1>
        {batch && own ? (
          <p className="lede">{plural(batch.rowCount, "bill")} checked · {plural(batch.openCount, "thing")} to look at{batch.findingCount > batch.openCount ? ` · ${batch.findingCount - batch.openCount} answered` : ""}</p>
        ) : batch ? (
          <p className="lede">
            {plural(batch.rowCount, "invoice")} checked · {plural(batch.findingCount, "candidate finding")} ({plural(batch.duplicateCount, "possible duplicate group")},{" "}
            {plural(batch.mismatchCount, "total mismatch", "total mismatches")}{own ? `, ${batch.nearDuplicateCount} lower-confidence` : ""}
            {own && batch.findingCount > batch.duplicateCount + batch.mismatchCount + batch.nearDuplicateCount
              ? `, ${batch.findingCount - batch.duplicateCount - batch.mismatchCount - batch.nearDuplicateCount} from your bank statement or price changes` : ""}) · {batch.openCount} open, {batch.confirmedCount} confirmed,{" "}
            {batch.dismissedCount} dismissed
          </p>
        ) : null}
      </header>

      {batches.length > 1 ? (
        <nav className="batch-switch" aria-label="Batches in this browser">
          <h2 className="small-title">Batches in this browser</h2>
          <ul>
            {batches.map((b) => (
              <li key={b.batchId}>
                <a href={hrefForBatch(b.batchId)} aria-current={batch?.batchId === b.batchId ? "page" : undefined}>
                  {b.displayName}
                </a>{" "}
                <span className="muted">
                  ({b.source === "demo" ? "demo" : b.source === "upload" ? "older upload" : "your data"}, {b.findingCount} findings)
                </span>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {!batch ? (
        <section className="empty" aria-labelledby="empty-heading">
          <h2 id="empty-heading" className="section-title">No batch loaded yet</h2>
          {demo.kind === "loading" ? (
            <p role="status">Loading the sample invoices…</p>
          ) : (
            <>
              <p>Load the synthetic demo batch of invented invoices to see its candidate findings.</p>
              {demo.kind === "error" ? (
                <p className="notice notice-error" role="alert">
                  The demo could not be loaded: {demo.message}
                </p>
              ) : null}
              <button type="button" className="btn btn-primary" onClick={onLoadDemo}>
                Load demo
              </button>
            </>
          )}
        </section>
      ) : (
        <>
        {glance ? <AtAGlance glance={glance} rowCount={batch.rowCount} hrefForCase={hrefForCase} /> : null}
        <section id="findings" aria-labelledby="findings-heading">
          <h2 id="findings-heading" className="sr-only">Findings</h2>
          <div className="filters" role="group" aria-label="Filter findings">
            <div className="filter">
              <label htmlFor="filter-state" className="field-label">{own ? "Show" : "Review state"}</label>
              <select id="filter-state" value={filter.state} onChange={(e) => setFilter({ state: e.target.value as ReviewState | "all" })}>
                {STATE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{(own ? OWN_STATE_OPTION : STATE_OPTION_LABEL)[s]}</option>
                ))}
              </select>
            </div>
            <div className="filter">
              <label htmlFor="filter-rule" className="field-label">{own ? "Kind" : "Rule"}</label>
              <select id="filter-rule" value={filter.rule} onChange={(e) => setFilter({ rule: e.target.value as RuleId | "all" })}>
                {(own ? OWN_RULE_OPTIONS : RULE_OPTIONS).map((r) => (
                  <option key={r} value={r}>{r === "all" ? (own ? "Every kind" : "All rules") : RULE_LABEL[r]}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="order-note">
            {own ? `Showing ${findings.length}. Ones you haven't answered come first.` : (
              <>Showing {findings.length} {findings.length === 1 ? "finding" : "findings"}. Order: open first, then rule, then record ID. No risk score.</>
            )}
          </p>
          {findings.length === 0 ? (
            <p className="empty-inline">No findings match these filters.</p>
          ) : (
            <ul className="case-rows">
              {findings.slice(0, shown).map((f) => (
                <li key={f.findingId} className={`case-row is-${f.state}`}>
                  <a className="case-row-link" href={hrefForCase(f.findingId)}>
                    <span className="case-row-kind">{RULE_LABEL[f.ruleId]}</span>
                    <span className="case-row-main">
                      <span className="case-row-title">{caseTitle(f, own)}</span>
                      {own ? null : <span className="case-row-meta">Records {f.memberIds.join(", ")}</span>}
                    </span>
                    <StateBadge state={f.state} />
                    <span className="case-row-go">{own ? "Look" : "Investigate"}<span aria-hidden="true"> →</span></span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {findings.length > shown ? (
            <p>
              <button type="button" className="btn btn-secondary" onClick={() => setShown(shown + PAGE_SIZE)}>
                Show {PAGE_SIZE} more
              </button>{" "}
              <span className="muted">Showing {shown} of {findings.length}</span>
            </p>
          ) : null}
        </section>
        </>
      )}

      <section className="tools" aria-label={own ? "Your data" : "Reset"}>
        {own ? <p><a href="#/mine">Add files or delete your data</a></p> : (
          <div className="reset">
            <ResetControl onResetDemo={props.onResetDemo} />
          </div>
        )}
      </section>
    </div>
  );
}
