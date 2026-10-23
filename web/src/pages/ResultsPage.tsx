import type { BenchmarkRun, ResultsProps } from "../ui-contracts.ts";

const SOURCE_LABEL: Readonly<Record<BenchmarkRun["source"], { readonly title: string; readonly note: string }>> = {
  "browser-port": { title: "Browser port (this TypeScript app)", note: "The rules running in this website." },
  "python-reference": { title: "Reference implementation (Python)", note: "The original prototype it was ported from." },
};

const n = (v: number) => v.toLocaleString("en-US");

function Tile({ big, label, sub }: { readonly big: string; readonly label: string; readonly sub?: string }) {
  return (
    <div className="tile lift">
      <dd className="tile-big">{big}</dd>
      <dt className="tile-label">{label}</dt>
      {sub ? <p className="tile-sub">{sub}</p> : null}
    </div>
  );
}

function Count({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="count">
      <dt>{label}</dt>
      <dd className="num">{n(value)}</dd>
    </div>
  );
}

function RunCard({ run }: { readonly run: BenchmarkRun }) {
  const label = SOURCE_LABEL[run.source];
  const d = run.duplicate;
  return (
    <article className="run lift" aria-labelledby={`run-${run.source}`}>
      <h3 id={`run-${run.source}`} className="run-title">{label.title}</h3>
      <p className="run-note">{label.note}</p>
      <p className="run-checks">
        <strong>{run.checksPassed} of {run.checksTotal}</strong> checks passed
        {run.referenceTests !== undefined ? <> · {run.referenceTests} tests in its own suite</> : null}
      </p>
      <p className="run-line">
        {d.groupsFlagged} groups flagged: {d.genuineGroups} genuine duplicates, {d.legitimateReuseGroups} legitimate invoice-number reuses
      </p>
      <details className="mod-more">
        <summary>
          <span className="mod-info" aria-hidden="true">i</span>
          Full counts<span className="sr-only"> for the {label.title}</span>
        </summary>
        <h4 className="small-title">Duplicate pairs</h4>
        <dl className="counts">
          <Count label="Flagged and truly duplicate (TP)" value={d.pairTP} />
          <Count label="Flagged but not duplicate (FP)" value={d.pairFP} />
          <Count label="Missed duplicate (FN)" value={d.pairFN} />
          <Count label="Correctly not flagged (TN)" value={d.pairTN} />
        </dl>
        <p className="hint">
          Out of {n(d.pairTotal)} possible record pairs. Most pairs are obviously different, so a rate over this number would look
          misleadingly small; raw counts are shown instead. Hard look-alike pairs: {run.hardNegatives.falseAlerts} false alerts among{" "}
          {run.hardNegatives.pairs}.
        </p>
        <h4 className="small-title">Total mismatches (per invoice)</h4>
        <dl className="counts">
          <Count label="Flagged, truly wrong (TP)" value={run.mismatch.tp} />
          <Count label="Flagged, actually correct (FP)" value={run.mismatch.fp} />
          <Count label="Missed (FN)" value={run.mismatch.fn} />
          <Count label="Correctly not flagged (TN)" value={run.mismatch.tn} />
        </dl>
        <p className="hint">
          {run.mismatch.exactDeltas} differences reported exactly as labelled · {run.findings} findings across {run.affectedRows} rows ·
          run <time dateTime={run.runAt}>{run.runAt}</time> with <code>{run.command}</code>
        </p>
      </details>
    </article>
  );
}

export function ResultsPage({ benchmark, benchmarkError, visitor }: ResultsProps) {
  const main = benchmark?.runs.find((r) => r.source === "browser-port") ?? benchmark?.runs[0];
  return (
    <div className="workspace results">
      <header className="page-head">
        <p className="eyebrow">Results</p>
        <h1 className="page-title" tabIndex={-1}>What the checks found</h1>
        <p className="lede">Measured against an answer key, on invented invoices built for testing.</p>
      </header>

      <section aria-labelledby="bench-heading">
        <h2 id="bench-heading" className="sr-only">Fixed synthetic benchmark</h2>
        {benchmarkError ? (
          <p className="notice notice-error" role="alert">
            Benchmark results could not be loaded: {benchmarkError}
          </p>
        ) : !benchmark || !main ? (
          <p className="notice" role="status">Loading benchmark results…</p>
        ) : (
          <>
            <dl className="tiles">
              <Tile
                big={`${main.mismatch.tp} of ${main.mismatch.tp + main.mismatch.fn}`}
                label="Math errors caught"
                sub={main.mismatch.fn === 0 ? "None missed, including one-cent errors" : `${main.mismatch.fn} missed`}
              />
              <Tile
                big={`${main.duplicate.pairTP} of ${main.duplicate.pairTP + main.duplicate.pairFN}`}
                label="Real duplicates caught"
                sub={main.duplicate.pairFN === 0 ? "None missed" : `${main.duplicate.pairFN} missed`}
              />
              <Tile big={String(main.duplicate.pairFP)} label="False alarms" sub="Legitimate reuses a person dismisses" />
              <Tile big={`${main.checksPassed} of ${main.checksTotal}`} label="Automated checks passed" sub="Against the answer key" />
            </dl>
            <p className="results-honesty">
              Fixed synthetic benchmark: 120 invented invoices, labelled by the same AI tool that wrote the rules. It shows the rules
              behave as designed, not accuracy on real invoices.
            </p>

            <h2 className="results-h2">Both versions agree</h2>
            <div className="runs">
              {benchmark.runs.map((run) => (
                <RunCard key={`${run.source}-${run.runAt}`} run={run} />
              ))}
            </div>

            <details className="mod-more results-more">
              <summary>
                <span className="mod-info" aria-hidden="true">i</span>
                Limitations and data fingerprints
              </summary>
              <ul>
                {benchmark.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
              <dl className="kv">
                <div>
                  <dt>Fixture</dt>
                  <dd><code>{benchmark.fixtureVersion}</code>, seed {benchmark.fixtureSeed}</dd>
                </div>
                <div>
                  <dt>Dataset SHA-256</dt>
                  <dd><code className="hash">{benchmark.datasetSha256}</code></dd>
                </div>
                <div>
                  <dt>Manifest SHA-256</dt>
                  <dd><code className="hash">{benchmark.manifestSha256}</code></dd>
                </div>
              </dl>
            </details>
          </>
        )}
      </section>

      <section className="results-visitor" aria-labelledby="visitor-heading">
        <h2 id="visitor-heading" className="results-h2">Your demo batch in this browser</h2>
        {visitor ? (
          <dl className="mini-stats">
            <div className="lift"><dd>{visitor.findingCount}</dd><dt>Findings</dt></div>
            <div className="lift"><dd>{visitor.openCount}</dd><dt>Open</dt></div>
            <div className="lift"><dd>{visitor.confirmedCount}</dd><dt>Confirmed by you</dt></div>
            <div className="lift"><dd>{visitor.dismissedCount}</dd><dt>Dismissed by you</dt></div>
          </dl>
        ) : (
          <p>
            No demo batch in this browser yet. <a href="#/demo">Start the demo</a> to see your own counts here.
          </p>
        )}
      </section>
    </div>
  );
}
