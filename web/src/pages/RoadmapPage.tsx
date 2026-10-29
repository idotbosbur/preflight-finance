/** Where Catchfold is going: what exists today, ideas being explored, and what might come later. Honest labels, no prices. */
import { InterestVote } from "../components/InterestVote.tsx";

const COLUMNS: readonly (readonly [string, string, readonly string[]])[] = [
  ["Now", "Free and live today", [
    "Six checks: bills entered twice, bills paid twice, payments with no bill, monthly charges and supplier prices that went up, totals that don't add up",
    "A year-end contractor (1099) list",
    "CSV, Excel and bank downloads (.qfx, .ofx, .qbo)",
    "One total of money to look at, with draft emails to suppliers",
    "Everything runs in your browser; nothing is uploaded",
  ]],
  ["Next", "Ideas we're exploring, not built yet", [
    "Read PDF invoices and receipts, still privately on your device",
    "A checkup report you can hand to your accountant",
    "Compare what you were billed with what you agreed in a quote or contract",
    "Help chasing refunds: track supplier replies until the money is back",
  ]],
  ["Later", "If people want it", [
    "A version for bookkeepers who check many clients",
    "A reminder for your quarterly or year-end checkup",
  ]],
];

export function RoadmapPage() {
  return (
    <div className="workspace roadmap-plain">
      <header className="page-head">
        <h1 className="page-title" tabIndex={-1}>Where Catchfold is going</h1>
        <p className="lede">A private, independent money checkup for people without a finance team. The core checks stay free, and your files stay on your device, whatever gets built next.</p>
      </header>

      <div className="plan">
        {COLUMNS.map(([title, sub, items]) => (
          <section key={title} className="plan-col" aria-labelledby={`plan-${title}`}>
            <h2 id={`plan-${title}`} className="section-title">{title}</h2>
            <p className="muted">{sub}</p>
            <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
          </section>
        ))}
      </div>

      <section className="panel" aria-labelledby="vote-heading">
        <h2 id="vote-heading" className="section-title">Help decide what's next</h2>
        <p>Tick what you'd actually use. Every answer is read.</p>
        <InterestVote />
        <p className="hint">Something else on your mind? <a href="#/feedback">Tell us what to change</a>.</p>
      </section>
    </div>
  );
}
