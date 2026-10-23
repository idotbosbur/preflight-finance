import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, RefObject } from "react";
import type { ImportUiState, QueueFilter, QueueProps } from "../ui-contracts.ts";
import type { ReviewState, RuleId } from "../domain/contracts.ts";
import { CSV_HEADER, MAX_ROWS } from "../domain/contracts.ts";
import { StateBadge } from "../components/Evidence.tsx";
import { RULE_LABEL, STATE_LABEL, caseTitle } from "../components/labels.ts";

const STATE_OPTIONS: readonly (ReviewState | "all")[] = ["all", "open", "confirmed", "dismissed"];
const RULE_OPTIONS: readonly (RuleId | "all")[] = ["all", "DUPLICATE_CANDIDATE", "TOTAL_MISMATCH"];
/** Visible issue rows; the rest are summarized as "N more". */
export const VISIBLE_ISSUES = 25;

function issueLocation(row: number | null, field: string | null): string {
  const where = row === null ? "File" : `Row ${row}`;
  return field ? `${where}, field ${field}` : where;
}

export function ImportStatus({ state, hrefForBatch }: { readonly state: ImportUiState; readonly hrefForBatch: (batchId: string) => string }) {
  if (state.kind === "idle") return null;
  if (state.kind === "working") {
    return <p className="notice" role="status">Checking {state.fileName} in your browser…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="notice notice-error" role="alert">
        <p>
          {state.fileName}: {state.message}
        </p>
      </div>
    );
  }
  const outcome = state.outcome;
  if (outcome.status === "created" || outcome.status === "existing") {
    const b = outcome.batch;
    return (
      <div className="notice notice-ok" role="status">
        <p>
          {outcome.status === "created"
            ? `Imported ${state.fileName}: ${b.rowCount} rows, ${b.findingCount} candidate findings.`
            : `${state.fileName} was already imported (same file hash and ruleset). The existing batch and its decisions are kept.`}
        </p>
        {b.source === "demo" ? <p>This file is the synthetic demo batch.</p> : null}
        <p>
          <a href={hrefForBatch(b.batchId)}>Open {b.displayName}</a>
        </p>
      </div>
    );
  }
  if (outcome.status === "storage_error") {
    return (
      <div className="notice notice-error" role="alert">
        <p>
          {state.fileName} could not be saved in this browser: {outcome.message}. Do not assume it was imported; check the
          batch list after reloading.
        </p>
      </div>
    );
  }
  if (outcome.status !== "rejected") return null;
  const shown = outcome.issues.slice(0, VISIBLE_ISSUES);
  const more = outcome.issueCount - shown.length;
  return (
    <div className="notice notice-error" role="alert">
      <p>
        <strong>{state.fileName} was rejected. Nothing was imported.</strong> {outcome.issueCount}{" "}
        {outcome.issueCount === 1 ? "issue" : "issues"} found; fix them and try the whole file again.
      </p>
      <ul className="issues">
        {shown.map((issue, i) => (
          <li key={i} className="issue">
            <span className="issue-where">{issueLocation(issue.row, issue.field)}</span>
            <code className="issue-code">{issue.code}</code>
            <span className="issue-msg">{issue.message}</span>
          </li>
        ))}
      </ul>
      {more > 0 ? <p>{more} more {more === 1 ? "issue" : "issues"} not listed.</p> : null}
    </div>
  );
}

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

function AdvancedImport({ importState, onImportFile, sampleCsvHref, hrefForBatch }: Pick<QueueProps, "importState" | "onImportFile" | "sampleCsvHref" | "hrefForBatch">) {
  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onImportFile(file);
    event.target.value = "";
  }
  return (
    <details className="advanced">
      <summary>Advanced: try your own synthetic CSV</summary>
      <div className="advanced-body">
        <p>The file is read and checked in this browser only. It is never uploaded.</p>
        <h3 className="small-title">Accepted format</h3>
        <ul className="format-list">
          <li>UTF-8 text (an optional byte-order mark is fine), at most 1 MiB and {MAX_ROWS.toLocaleString("en-US")} data rows.</li>
          <li>Currency USD only; amounts written as plain decimals, as in the sample file.</li>
          <li>Dates as YYYY-MM-DD.</li>
          <li>
            Exact header: <code className="header-code">{CSV_HEADER.join(",")}</code>
          </li>
          <li>One bad row rejects the whole file, with row and field for each issue.</li>
          <li>Importing identical bytes again opens the same batch and keeps its decisions.</li>
        </ul>
        <p>
          <a href={sampleCsvHref} download>
            Download the synthetic sample CSV
          </a>
        </p>
        <label className="field-label" htmlFor="csv-file">
          Choose a synthetic CSV file
        </label>
        <input id="csv-file" className="file-input" type="file" accept=".csv,text/csv" onChange={onChange} disabled={importState.kind === "working"} />
        <div className="import-status">
          <ImportStatus state={importState} hrefForBatch={hrefForBatch} />
        </div>
      </div>
    </details>
  );
}

export function QueuePage(props: QueueProps) {
  const { batch, batches, findings, filter, onFilterChange, hrefForCase, hrefForBatch, demo, onLoadDemo } = props;

  function setFilter(next: Partial<QueueFilter>) {
    onFilterChange({ ...filter, ...next });
  }

  return (
    <div className="workspace">
      <header className="page-head">
        <p className="eyebrow">Review queue</p>
        <h1 id={QUEUE_HEADING_ID} className="page-title" tabIndex={-1}>
          {batch ? batch.displayName : "Findings to review"}
        </h1>
        {batch ? (
          <p className="lede">
            {batch.rowCount} invoices checked · {batch.findingCount} candidate findings ({batch.duplicateCount} possible duplicate
            groups, {batch.mismatchCount} total mismatches) · {batch.openCount} open, {batch.confirmedCount} confirmed,{" "}
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
                  ({b.source === "demo" ? "demo" : "your file"}, {b.findingCount} findings)
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
                {RULE_OPTIONS.map((r) => (
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
              {findings.map((f) => (
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
        </section>
      )}

      <section className="tools" aria-label="Import and reset">
        <AdvancedImport importState={props.importState} onImportFile={props.onImportFile} sampleCsvHref={props.sampleCsvHref} hrefForBatch={hrefForBatch} />
        <div className="reset">
          <ResetControl onResetDemo={props.onResetDemo} />
        </div>
      </section>
    </div>
  );
}
