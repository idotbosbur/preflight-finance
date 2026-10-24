import type { ReactNode } from "react";
import type { OverviewProps } from "../ui-contracts.ts";
import { ChromeField } from "../art/ChromeField.tsx";
import { ChromeMark } from "../art/ChromeMark.tsx";
import { MismatchArithmetic } from "../components/Evidence.tsx";
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
  ["Exact cents", "A one-cent error is never rounded away."],
  ["No silent imports", "Rows it can't read are listed, never guessed."],
  ["Human decisions", "Every call has a reason and a history."],
  ["Honest measurement", "False alarms are counted, not hidden."],
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
            <a className="btn-line ov-more" href="#/how">How it works →</a>
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
              </Step>
              <Step n="3" title="A person decides">
                <p>Confirm or dismiss, with a reason. Not every flag is an error.</p>
              </Step>
              <Step n="4" title="Measured, not claimed">
                <p className="ov-bench">
                  {dup
                    ? `${dup.groupsFlagged} groups flagged: ${dup.genuineGroups} genuine duplicates, ${dup.legitimateReuseGroups} legitimate reuses`
                    : "12 groups flagged: 10 genuine duplicates, 2 legitimate reuses"}
                </p>
                <p className="muted">On {story.invoiceCount} invented invoices. <a href="#/results">See the results</a></p>
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
              <p>{text}</p>
            </Reveal>
          ))}
        </ul>
      </section>

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
