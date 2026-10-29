import { InterestVote } from "../components/InterestVote.tsx";
import type { ReactNode } from "react";
import type { OverviewProps } from "../ui-contracts.ts";
import { ChromeField } from "../art/ChromeField.tsx";
import { useReveal } from "../components/useReveal.ts";
import { useDarkScroll } from "../components/useDarkScroll.ts";

function Reveal({ as: Tag = "div", className, children }: { readonly as?: "div" | "li"; readonly className?: string; readonly children: ReactNode }) {
  const ref = useReveal<HTMLDivElement & HTMLLIElement>();
  return <Tag ref={ref} className={className}>{children}</Tag>;
}

const CHECKS: readonly string[] = [
  "Bills entered twice",
  "Bills paid twice",
  "Monthly charges creeping up",
  "Supplier price increases",
  "Totals that don't add up",
  "Year-end 1099 contractor list",
];

export function OverviewPage({ demo, onStartGuide, drop }: OverviewProps & { readonly drop?: ReactNode }) {
  const busy = demo.kind === "loading";
  const root = useDarkScroll<HTMLDivElement>();
  return (
    <div className="overview" ref={root}>
      <ChromeField className="chrome-field" />

      <section className="ov-hero ov-hero-drop" data-chrome="hero" aria-labelledby="hero-heading">
        <h1 id="hero-heading" className="ov-display hero-rise" tabIndex={-1}>Find the bills you paid twice</h1>
        <p className="ov-lede hero-rise">Drop in your bills or a bank statement. Free, and your files never leave your browser.</p>
        <div className="hero-rise hero-drop">{drop}</div>
        <p className="ov-hero-links hero-rise">
          <button type="button" className="btn-line" onClick={onStartGuide} disabled={busy}>Try the demo</button>
          <a className="btn-line" href="#/how">How it works</a>
        </p>
        {demo.kind === "loading" ? <p className="hero-status" role="status">Loading the synthetic demo batch…</p> : null}
        {demo.kind === "error" ? <p className="hero-status hero-error" role="alert">The demo could not be loaded: {demo.message}</p> : null}
      </section>

      <section className="ov-statement" data-chrome="statement">
        <Reveal>
          <p className="ov-statement-text">Paid twice. Overcharged. <span className="ov-soft">Quietly went up.</span></p>
        </Reveal>
      </section>

      <section className="ov-section ov-checks" data-chrome="haze" aria-labelledby="checks-heading">
        <h2 id="checks-heading" className="ov-label">Six free checks</h2>
        <ol className="ov-list">
          {CHECKS.map((title, i) => (
            <Reveal as="li" key={title}><span className="ov-list-n" aria-hidden="true">0{i + 1}</span>{title}</Reveal>
          ))}
        </ol>
      </section>

      <section className="ov-dark" data-chrome="dark" aria-labelledby="private-heading">
        <Reveal>
          <h2 id="private-heading" className="ov-h2 ov-dark-title">Your files never leave your browser.</h2>
          <p className="ov-dark-points">No upload · No account · Delete everything in one click</p>
        </Reveal>
      </section>

      <section className="ov-section ov-after" data-chrome="haze" aria-labelledby="later-heading">
        <div className="ov-split">
          <Reveal className="ov-split-head">
            <h2 id="later-heading" className="ov-h2">Want more?</h2>
            <p className="ov-later-text">These would need a paid version later. Tick what you'd use.</p>
          </Reveal>
          <Reveal>
            <InterestVote />
          </Reveal>
        </div>
      </section>
    </div>
  );
}
