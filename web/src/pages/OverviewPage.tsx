import type { ReactNode } from "react";
import type { OverviewProps } from "../ui-contracts.ts";
import { ChromeField } from "../art/ChromeField.tsx";
import { ChromeMark } from "../art/ChromeMark.tsx";
import { DuplicateMembers, MismatchArithmetic } from "../components/Evidence.tsx";
import { Info } from "../components/Info.tsx";
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
  ["Exact cents", "Amounts are read digit by digit into whole cents. No floating point, so a one-cent error is never rounded away."],
  ["No silent imports", "The demo rejects a file with any bad row. With your own files, unreadable rows are skipped and each one is listed with a reason."],
  ["Human decisions", "Confirm, dismiss or reopen, each with a reason, added to a history that is never rewritten."],
  ["Honest measurement", "Results are counted against independent labels, including the false alerts the rules cannot avoid."],
] as const;

const MINE_HREF = "#/mine";

export function OverviewPage({ story, demo, onStartGuide, benchmark = null }: OverviewProps) {
  const busy = demo.kind === "loading";
  const dup = benchmark?.duplicate;
  return (
    <div className="overview">
      <ChromeField className="chrome-field" />

      <section className="ov-hero" data-chrome="hero" aria-labelledby="hero-heading">
        <p className="ov-kicker hero-rise">Invoice review · free prototype</p>
        <h1 id="hero-heading" className="ov-display hero-rise" tabIndex={-1}>Catch invoice errors before they're paid</h1>
        <p className="ov-lede hero-rise">Flags duplicate bills and totals that don't add up. Your file never leaves your browser.</p>
        <div className="ov-actions hero-rise">
          <button type="button" className="btn-line btn-line-strong" onClick={onStartGuide} disabled={busy}>
            Try the demo
          </button>
          <a className="btn-line" href={MINE_HREF}>Check your own invoices</a>
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
            Two exact checks. <span className="ov-soft">A person makes every decision.</span>
          </p>
        </Reveal>
      </section>

      <section className="ov-section" data-chrome="haze" aria-labelledby="workflow-heading">
        <p className="ov-label">How it works</p>
        <div className="ov-split">
          <Reveal className="ov-split-head">
            <h2 id="workflow-heading" className="ov-h2">From a flagged invoice to a decision</h2>
            <Info label="About these examples">
              {story ? (
                <p>
                  They come from the demo batch: {story.invoiceCount} invented invoices with {story.findingCount} candidate findings,
                  computed in your browser.
                </p>
              ) : (
                <p>The examples appear once the synthetic batch has been read in your browser.</p>
              )}
            </Info>
          </Reveal>
          {story ? (
            <ol className="ov-steps">
              <Step n="1" title="An invoice is flagged">
                <p>
                  Invoice <code>{story.mismatchInvoice}</code> says <strong className="num">{story.mismatch.declared}</strong>, but its parts add up
                  to <strong className="num">{story.mismatch.expected}</strong>.
                </p>
              </Step>
              <Step n="2" title="You see exactly why">
                <div className="ov-evidence">
                  <MismatchArithmetic evidence={story.mismatch} headingLevel={4} />
                </div>
                <Info label="Why one cent matters">
                  <p>The rule compares exact cents, so even a difference of {story.mismatch.delta} is flagged for a person to check.</p>
                </Info>
              </Step>
              <Step n="3" title="A person decides, with a reason">
                <p>Confirm or dismiss. Not every flag is an error.</p>
                <Info label="See a flag that isn't an error">
                  <p>These two invoices share a vendor and invoice number, but the dates and totals differ: a legitimate reuse.</p>
                  <div className="ov-evidence">
                    <DuplicateMembers evidence={story.reuse} headingLevel={4} />
                  </div>
                  <p className="muted">Each decision is added to the case history. A decision never approves, blocks or pays anything.</p>
                </Info>
              </Step>
              <Step n="4" title="Measured, not claimed">
                <p className="ov-bench">
                  {dup
                    ? `${dup.groupsFlagged} groups flagged: ${dup.genuineGroups} genuine duplicates, ${dup.legitimateReuseGroups} legitimate reuses`
                    : "12 groups flagged: 10 genuine duplicates, 2 legitimate reuses"}
                </p>
                <Info label="How this was measured">
                  <p>
                    On a synthetic benchmark of {story.invoiceCount} invoices with independent labels. The exact-key rule can't tell a
                    legitimate reuse from a real duplicate, so a person reviews every candidate. Full counts are on the{" "}
                    <a href="#/results">Results</a> page. This is a working prototype, not a production finance platform.
                  </p>
                </Info>
              </Step>
            </ol>
          ) : null}
        </div>
      </section>

      <section className="ov-vortex" data-chrome="vortex" aria-hidden="true" />

      <section className="ov-statement" data-chrome="statement" aria-labelledby="vortex-heading">
        <Reveal>
          <h2 id="vortex-heading" className="ov-statement-text">Nothing is paid, blocked or approved automatically.</h2>
        </Reveal>
      </section>

      <section className="ov-dark" data-chrome="off" aria-labelledby="principles-heading">
        <p className="ov-label ov-label-dark">Principles</p>
        <h2 id="principles-heading" className="ov-h2">Built like a finance control</h2>
        <ul className="ov-principles">
          {PRINCIPLES.map(([title, text]) => (
            <Reveal as="li" key={title} className="ov-principle">
              <h3>{title}</h3>
              <Info label="More" className="info-dark"><p>{text}</p></Info>
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
          <Info label="What these numbers mean">
            <p>
              Measured against independent labels. The two legitimate reuses are why a person reviews every candidate.{" "}
              <a href="#/results">See the full results</a>
            </p>
          </Info>
        </section>
      ) : null}

      <section className="ov-cta" data-chrome="hero" aria-labelledby="cta-heading">
        <h2 id="cta-heading" className="ov-display ov-display-sm">Try it in three minutes</h2>
        <div className="ov-actions">
          <button type="button" className="btn-line btn-line-strong" onClick={onStartGuide} disabled={busy}>
            Try the demo
          </button>
          <a className="btn-line" href={MINE_HREF}>Check your own invoices</a>
        </div>
      </section>
    </div>
  );
}
