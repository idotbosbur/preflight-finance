import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { QueueFilter, QueueProps } from "../ui-contracts.ts";
import type { ReviewState, RuleId } from "../domain/contracts.ts";
import { StateBadge } from "../components/Evidence.tsx";
import { DEMO_BADGE, OWN_BADGE, RULE_LABEL, STATE_LABEL, caseTitle } from "../components/labels.ts";

const STATE_OPTIONS: readonly (ReviewState | "all")[] = ["all", "open", "confirmed", "dismissed"];
const RULE_OPTIONS: readonly (RuleId | "all")[] = ["all", "DUPLICATE_CANDIDATE", "TOTAL_MISMATCH"];
const OWN_RULE_OPTIONS: readonly (RuleId | "all")[] = [...RULE_OPTIONS, "NEAR_DUPLICATE"];
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

export function QueuePage(props: QueueProps) {
  const { batch, batches, findings, filter, onFilterChange, hrefForCase, hrefForBatch, demo, onLoadDemo } = props;
  const [shown, setShown] = useState(PAGE_SIZE);
  const own = batch?.source === "own";

  function setFilter(next: Partial<QueueFilter>) {
    setShown(PAGE_SIZE);
    onFilterChange({ ...filter, ...next });
  }

  return (
    <div className="workspace">
      <header className="page-head">
        <p className="eyebrow">Review queue</p>
        {batch ? <p><span className="badge badge-synthetic">{own ? OWN_BADGE : DEMO_BADGE}</span></p> : null}
        <h1 id={QUEUE_HEADING_ID} className="page-title" tabIndex={-1}>
          {batch ? batch.displayName : "Findings to review"}
        </h1>
        {batch ? (
          <p className="lede">
            {batch.rowCount} invoices checked · {batch.findingCount} candidate findings ({batch.duplicateCount} possible duplicate
            groups, {batch.mismatchCount} total mismatches{own ? `, ${batch.nearDuplicateCount} lower-confidence` : ""}) · {batch.openCount} open, {batch.confirmedCount} confirmed,{" "}
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
                  ({b.source === "demo" ? "demo" : "your data"}, {b.findingCount} findings)
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
            <p role="status">Loading the synthetic demo batch…</p>
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
        <section aria-labelledby="findings-heading">
          <h2 id="findings-heading" className="sr-only">Findings</h2>
          <div className="filters" role="group" aria-label="Filter findings">
            <div className="filter">
              <label htmlFor="filter-state" className="field-label">Review state</label>
              <select id="filter-state" value={filter.state} onChange={(e) => setFilter({ state: e.target.value as ReviewState | "all" })}>
                {STATE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s === "all" ? "All states" : STATE_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <div className="filter">
              <label htmlFor="filter-rule" className="field-label">Rule</label>
              <select id="filter-rule" value={filter.rule} onChange={(e) => setFilter({ rule: e.target.value as RuleId | "all" })}>
                {(own ? OWN_RULE_OPTIONS : RULE_OPTIONS).map((r) => (
                  <option key={r} value={r}>{r === "all" ? "All rules" : RULE_LABEL[r]}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="order-note">
            Showing {findings.length} {findings.length === 1 ? "finding" : "findings"}. Order: open first, then rule, then record
            ID — no risk score.
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
                      <span className="case-row-title">{caseTitle(f)}</span>
                      <span className="case-row-meta">Records {f.memberIds.join(", ")}</span>
                    </span>
                    <StateBadge state={f.state} />
                    <span className="case-row-go">Investigate<span aria-hidden="true"> →</span></span>
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
