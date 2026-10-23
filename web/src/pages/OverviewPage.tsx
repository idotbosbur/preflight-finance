import type { ReactNode } from "react";
import type { OverviewProps } from "../ui-contracts.ts";
import { ChromeField } from "../art/ChromeField.tsx";
import { ChromeMark } from "../art/ChromeMark.tsx";
import { DuplicateMembers, MismatchArithmetic } from "../components/Evidence.tsx";
import { useReveal } from "../components/useReveal.ts";

function Reveal({ as: Tag = "div", className, children }: { readonly as?: "div" | "li"; readonly className?: string; readonly children: ReactNode }) {
  const ref = useReveal<HTMLDivElement & HTMLLIElement>();
  return <Tag ref={ref} className={className}>{children}</Tag>;
}

function Step({ n, title, children }: { readonly n: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <Reveal as="li" className="ov-step">
      <span className="ov-step-n" aria-hidden="true">0{n}</span>
      <div className="ov-step-body">
        <h3 className="ov-step-title">{title}</h3>
        {children}
      </div>
    </Reveal>
  );
}

const PRINCIPLES = [
  ["Exact cents", "Amounts are parsed digit by digit into whole cents. No floating point, so a one-cent error is never rounded away."],
  ["Atomic validation", "A file with one bad row is rejected whole, with row-and-field reasons. Nothing half-imports."],
  ["Human decisions", "Confirm, dismiss or reopen, each with a reason, appended to a history that is never rewritten."],
  ["Honest measurement", "Results are counted against independent labels, including the false alerts the rule cannot avoid."],
] as const;

export function OverviewPage({ story, demo, onStartGuide, onExplore, benchmark = null }: OverviewProps) {
  const busy = demo.kind === "loading";
  const dup = benchmark?.duplicate;
  return (
    <div className="overview">
      <ChromeField className="chrome-field" />

      <section className="ov-hero" data-chrome="hero" aria-labelledby="hero-heading">
        <p className="ov-kicker hero-rise">Invoice review · working prototype on synthetic data</p>
        <h1 id="hero-heading" className="ov-display hero-rise" tabIndex={-1}>Catch invoice errors before they're paid</h1>
        <p className="ov-lede hero-rise">
          Preflight checks a batch of invoices for possible duplicates and totals that don't add up, shows the exact evidence,
          and records a person's decision with a reason.
        </p>
        <div className="ov-actions hero-rise">
          <button type="button" className="btn-line btn-line-strong" onClick={onStartGuide} disabled={busy}>
            Try the synthetic demo
          </button>
          <button type="button" className="btn-line" onClick={onExplore} disabled={busy}>
            Explore findings
          </button>
        </div>
        {demo.kind === "loading" ? <p className="hero-status" role="status">Loading the synthetic demo batch…</p> : null}
        {demo.kind === "error" ? (
          <p className="hero-status hero-error" role="alert">
            The demo could not be loaded: {demo.message}
          </p>
        ) : null}
        <div className="ov-scroll" aria-hidden="true">
          <ChromeMark className="ov-scroll-mark" />
          <span>Scroll</span>
        </div>
      </section>

      <section className="ov-statement" data-chrome="statement">
        <Reveal>
          <p className="ov-statement-text">
            Two deterministic checks. Exact cents. <span className="ov-soft">A person makes every decision.</span>
          </p>
        </Reveal>
      </section>

      <section className="ov-section" data-chrome="haze" aria-labelledby="workflow-heading">
        <p className="ov-label">The workflow</p>
        <div className="ov-split">
          <Reveal className="ov-split-head">
            <h2 id="workflow-heading" className="ov-h2">From a flagged invoice to a recorded decision</h2>
            {story ? (
              <p className="ov-body">
                The demo batch has {story.invoiceCount} invented invoices and {story.findingCount} candidate findings. These examples
                come from that same batch, computed in your browser.
              </p>
            ) : (
              <p className="ov-body">The worked examples appear once the synthetic batch has been read in your browser.</p>
            )}
          </Reveal>
          {story ? (
            <ol className="ov-steps">
              <Step n="1" title="An invoice is flagged">
                <p className="ov-step-meta">Total mismatch · synthetic</p>
                <p>
                  {story.mismatchVendor} · invoice <code>{story.mismatchInvoice}</code> · record {story.mismatch.recordId}. Declared total{" "}
                  <strong className="num">{story.mismatch.declared}</strong>, but its parts add up to{" "}
                  <strong className="num">{story.mismatch.expected}</strong>.
                </p>
              </Step>
              <Step n="2" title="Why it was flagged">
                <div className="ov-evidence">
                  <MismatchArithmetic evidence={story.mismatch} headingLevel={4} />
                </div>
                <p className="muted">The rule compares exact cents, so even a difference of {story.mismatch.delta} is flagged for review.</p>
              </Step>
              <Step n="3" title="A person decides, with a reason">
                <p>
                  The reviewer chooses <strong>Confirm finding</strong> or <strong>Dismiss candidate</strong> and writes why. Not every flag
                  is an error: these two invoices share a vendor and invoice number. Compare the dates and totals before deciding.
                </p>
                <div className="ov-evidence">
                  <DuplicateMembers evidence={story.reuse} headingLevel={4} />
                </div>
                <p className="muted">Each decision is added to the case history in this browser. A decision never approves, blocks or pays anything.</p>
              </Step>
              <Step n="4" title="Measured on a synthetic benchmark">
                <p className="ov-bench">
                  {dup
                    ? `${dup.groupsFlagged} groups flagged: ${dup.genuineGroups} genuine duplicates, ${dup.legitimateReuseGroups} legitimate invoice-number reuses`
                    : "12 groups flagged: 10 genuine duplicates, 2 legitimate invoice-number reuses"}
                </p>
                <p>
                  In the synthetic benchmark's {story.invoiceCount} invoices, the exact-key duplicate rule cannot tell a legitimate reuse from a real
                  duplicate, so a person reviews every candidate. Raw counts and their denominators are on the{" "}
                  <a href="#/results">Results</a> page.
                </p>
                <p className="muted">A working prototype on synthetic data, not a production finance platform.</p>
              </Step>
            </ol>
          ) : null}
        </div>
      </section>

      <section className="ov-vortex" data-chrome="vortex" aria-hidden="true" />

      <section className="ov-statement" data-chrome="statement" aria-labelledby="vortex-heading">
        <Reveal>
          <h2 id="vortex-heading" className="ov-statement-text">Every candidate is reviewed by a person.</h2>
          <p className="ov-body ov-statement-body">
            Nothing is paid, blocked or approved automatically. A decision records judgement and a reason, and that is all.
          </p>
        </Reveal>
      </section>

      <section className="ov-dark" data-chrome="off" aria-labelledby="principles-heading">
        <p className="ov-label ov-label-dark">Principles</p>
        <h2 id="principles-heading" className="ov-h2">Built like a finance control, not a dashboard</h2>
        <ul className="ov-principles">
          {PRINCIPLES.map(([title, text]) => (
            <Reveal as="li" key={title} className="ov-principle">
              <h3>{title}</h3>
              <p>{text}</p>
            </Reveal>
          ))}
        </ul>
      </section>

      {story ? (
        <section className="ov-section ov-numbers" data-chrome="haze" aria-labelledby="numbers-heading">
          <p className="ov-label">Synthetic benchmark</p>
          <h2 id="numbers-heading" className="sr-only">The demo batch in numbers</h2>
          <dl className="ov-figures">
            <Reveal><dt>Invented invoices</dt><dd>{story.invoiceCount}</dd></Reveal>
            <Reveal><dt>Candidate findings</dt><dd>{story.findingCount}</dd></Reveal>
            {dup ? <Reveal><dt>Genuine duplicates found</dt><dd>{dup.pairTP}</dd></Reveal> : null}
            {dup ? <Reveal><dt>Legitimate reuses flagged</dt><dd>{dup.pairFP}</dd></Reveal> : null}
          </dl>
          <p className="ov-body ov-numbers-note">
            Measured against independent labels. The two legitimate reuses are why a person reviews every candidate.{" "}
            <a href="#/results">See the full results</a>
          </p>
        </section>
      ) : null}

      <section className="ov-cta" data-chrome="hero" aria-labelledby="cta-heading">
        <h2 id="cta-heading" className="ov-display ov-display-sm">Try it in about three minutes</h2>
        <p className="ov-body">Load the synthetic batch, confirm the one-cent mismatch, dismiss the legitimate reuse, then reopen a case to see its history.</p>
        <div className="ov-actions">
          <button type="button" className="btn-line btn-line-strong" onClick={onStartGuide} disabled={busy}>
            Try the synthetic demo
          </button>
          <a className="btn-line" href="#/how">How it works</a>
        </div>
      </section>
    </div>
  );
}
