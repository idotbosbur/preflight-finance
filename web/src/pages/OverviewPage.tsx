import { InterestVote } from "../components/InterestVote.tsx";
import type { ReactNode } from "react";
import type { OverviewProps } from "../ui-contracts.ts";
import { ChromeField } from "../art/ChromeField.tsx";
import { ChromeMark } from "../art/ChromeMark.tsx";
import { MismatchArithmetic } from "../components/Evidence.tsx";
import { useReveal } from "../components/useReveal.ts";
import { useDarkScroll } from "../components/useDarkScroll.ts";

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

type IconName = "dup" | "sum" | "repeat" | "lock" | "cents" | "person" | "scale" | "up" | "list";

const ICON_PATHS: Readonly<Record<IconName, ReactNode>> = {
  dup: <><rect x="4" y="6" width="11" height="14" rx="2" /><path d="M9 3h9a2 2 0 0 1 2 2v12" /></>,
  sum: <><path d="M5 7h14M5 12h14M5 17h8" /><path d="M16 17h3" /></>,
  repeat: <><path d="M4 12a8 8 0 0 1 13.7-5.6L20 9" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15" /><path d="M4 20v-5h5" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  cents: <><circle cx="12" cy="12" r="8" /><path d="M14.5 9.5a3 3 0 1 0 0 5M12 6.5v2M12 15.5v2" /></>,
  person: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  scale: <><path d="M12 4v16M6 20h12M4 8h16" /><path d="M7 8l-3 6h6zM17 8l-3 6h6z" /></>,
  up: <><path d="M4 17l6-6 4 4 6-7" /><path d="M15 8h5v5" /></>,
  list: <><path d="M9 7h11M9 12h11M9 17h11" /><path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" /></>,
};

/** Small line icons (inline SVG, inherit text colour). */
function Icon({ name }: { readonly name: IconName }) {
  return (
    <svg className="ov-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[name]}
    </svg>
  );
}

const CHECKS: readonly (readonly [IconName, string, string])[] = [
  ["dup", "Duplicate bills", "The same bill entered twice, even when the supplier name or number is written differently."],
  ["repeat", "Bills paid twice", "Add a bank or card statement and we find bills paid more than once, and payments with no bill."],
  ["up", "Monthly charges creeping up", "Phone, internet and software charges that rose or were taken twice in a month."],
  ["cents", "Supplier price increases", "Item prices that went up since your first order, from bills with item lines."],
  ["sum", "Totals that don't add up", "Subtotal, tax, shipping and discount, checked to the cent."],
  ["list", "Year-end contractor list", "Who you paid enough to need a 1099, and whose W-9 or insurance is missing."],
];

const PILLARS: readonly (readonly [IconName, string, string])[] = [
  ["lock", "Stays in your browser", "No upload, no account. Delete it all in one click."],
  ["cents", "Exact cents", "A one-cent error is never rounded away."],
  ["person", "A person decides", "Every call has a reason and a history."],
  ["scale", "Honest measurement", "False alarms are counted, not hidden."],
];

const TOOLS = ["QuickBooks Online", "Xero", "Sage Accounting", "Excel"] as const;

const GUIDES = [
  ["/guide-quickbooks-duplicate-bills.html", "Find duplicate bills in QuickBooks Online"],
  ["/guide-xero-export-bills-csv.html", "Export bills from Xero to CSV"],
  ["/guide-excel-duplicate-invoices.html", "Find duplicate invoices in Excel"],
] as const;

const MINE_HREF = "#/mine";

export function OverviewPage({ story, demo, onStartGuide, benchmark = null }: OverviewProps) {
  const busy = demo.kind === "loading";
  const dup = benchmark?.duplicate;
  const root = useDarkScroll<HTMLDivElement>();
  return (
    <div className="overview" ref={root}>
      <ChromeField className="chrome-field" />

      <section className="ov-hero" data-chrome="hero" aria-labelledby="hero-heading">
        <p className="ov-kicker hero-rise">Free · for small businesses and individuals</p>
        <h1 id="hero-heading" className="ov-display hero-rise" tabIndex={-1}>Catch invoice errors before they're paid</h1>
        <p className="ov-lede hero-rise">Drop in your bills and bank statement. See what was paid twice, overcharged or quietly went up. Your files never leave your browser.</p>
        <div className="ov-actions hero-rise">
          <button type="button" className="btn-line btn-line-strong" onClick={onStartGuide} disabled={busy}>
            Try the demo
          </button>
          <a className="btn-line" href={MINE_HREF}>Check your own bills</a>
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
            Six free checks. <span className="ov-soft">You make every decision.</span>
          </p>
        </Reveal>
      </section>

      <section className="ov-section" data-chrome="haze" aria-labelledby="checks-heading">
        <p className="ov-label">What it checks</p>
        <h2 id="checks-heading" className="sr-only">What it checks</h2>
        <ul className="ov-cards">
          {CHECKS.map(([icon, title, text]) => (
            <Reveal as="li" key={title} className="ov-card">
              <Icon name={icon} />
              <h3>{title}</h3>
              <p>{text}</p>
            </Reveal>
          ))}
        </ul>
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

      <section className="ov-statement" data-chrome="statement" aria-labelledby="auto-heading">
        <Reveal>
          <h2 id="auto-heading" className="ov-statement-text">Nothing is paid, blocked or approved automatically.</h2>
        </Reveal>
      </section>

      <section className="ov-vortex" data-chrome="vortex" aria-hidden="true" />

      <section className="ov-dark" data-chrome="dark" aria-labelledby="private-heading">
        <p className="ov-label">Private by design</p>
        <h2 id="private-heading" className="ov-h2 ov-dark-title">Your invoices never leave your browser.</h2>
        <ul className="ov-pillars">
          {PILLARS.map(([icon, title, text]) => (
            <Reveal as="li" key={title} className="ov-pillar">
              <Icon name={icon} />
              <h3>{title}</h3>
              <p>{text}</p>
            </Reveal>
          ))}
        </ul>
        {story ? (
          <>
            <h3 className="sr-only">The demo batch in numbers</h3>
            <dl className="ov-figures">
              <Reveal><dt>Invented invoices</dt><dd>{story.invoiceCount}</dd></Reveal>
              <Reveal><dt>Candidate findings</dt><dd>{story.findingCount}</dd></Reveal>
              {dup ? <Reveal><dt>Genuine duplicates found</dt><dd>{dup.pairTP}</dd></Reveal> : null}
              {dup ? <Reveal><dt>Legitimate reuses flagged</dt><dd>{dup.pairFP}</dd></Reveal> : null}
            </dl>
            <a className="btn-line ov-more" href="#/results">See the measured results →</a>
          </>
        ) : null}
      </section>

      <section className="ov-section ov-after" data-chrome="haze" aria-labelledby="tools-heading">
        <p className="ov-label">Works with your exports</p>
        <div className="ov-split">
          <Reveal className="ov-split-head">
            <h2 id="tools-heading" className="ov-h2">Bring a CSV from the tools you already use</h2>
            <ul className="ov-chips">
              {TOOLS.map((t) => <li key={t}>{t}</li>)}
            </ul>
            <a className="btn-line ov-more" href="/pilot-guide.html">Export steps for each →</a>
          </Reveal>
          <ul className="ov-guides">
            {GUIDES.map(([href, title]) => (
              <Reveal as="li" key={href}>
                <a className="ov-guide" href={href}>
                  <span className="ov-guide-kicker">Guide</span>
                  <span className="ov-guide-title">{title}</span>
                  <span className="ov-guide-arrow" aria-hidden="true">→</span>
                </a>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      <section className="ov-section ov-after" data-chrome="haze" aria-labelledby="later-heading">
        <p className="ov-label">Coming later, if you want it</p>
        <div className="ov-split">
          <Reveal className="ov-split-head">
            <h2 id="later-heading" className="ov-h2">Everything above stays free</h2>
            <p className="ov-later-text">
              These would need servers and paid AI, so they would be part of a paid version later. Tick what you would actually use.
              It decides what gets built next.
            </p>
          </Reveal>
          <Reveal>
            <InterestVote />
          </Reveal>
        </div>
      </section>

      <section className="ov-cta" data-chrome="hero" aria-labelledby="cta-heading">
        <h2 id="cta-heading" className="ov-display ov-display-sm">Try it in three minutes</h2>
        <div className="ov-actions">
          <button type="button" className="btn-line btn-line-strong" onClick={onStartGuide} disabled={busy}>
            Try the demo
          </button>
          <a className="btn-line" href={MINE_HREF}>Check your own bills</a>
        </div>
      </section>
    </div>
  );
}
