import type { RoadmapProps } from "../ui-contracts.ts";
import type { ModuleLabel } from "../domain/contracts.ts";

const LABEL_CLASS: Readonly<Record<ModuleLabel, string>> = {
  "Working in this demo": "badge-working",
  "Implemented foundation": "badge-foundation",
  "Next synthetic scenario": "badge-next",
  Planned: "badge-planned",
};

const TALLY: readonly (readonly [ModuleLabel, string])[] = [
  ["Working in this demo", "working"],
  ["Implemented foundation", "foundations"],
  ["Next synthetic scenario", "next up"],
  ["Planned", "planned"],
];

export function RoadmapPage({ modules }: RoadmapProps) {
  return (
    <div className="workspace roadmap">
      <header className="page-head">
        <p className="eyebrow">Roadmap</p>
        <h1 className="page-title" tabIndex={-1}>Twelve modules, built in tested steps</h1>
        <p className="lede">Only module 1 works today. Every other module is labelled honestly.</p>
        <p className="roadmap-tally">
          {TALLY.map(([label, word], i) => (
            <span key={label}>
              {i > 0 ? <span aria-hidden="true"> · </span> : null}
              <strong>{modules.filter((m) => m.label === label).length}</strong> {word}
            </span>
          ))}
        </p>
      </header>

      <ol className="mods">
        {modules.map((m) => (
          <li key={m.number} className={`mod lift ${m.label === "Working in this demo" ? "is-live" : ""}`}>
            <span className="mod-n" aria-hidden="true">{String(m.number).padStart(2, "0")}</span>
            <h2 className="mod-name">
              <span className="sr-only">{m.number}. </span>
              {m.name}
            </h2>
            <p className="mod-summary">{m.summary}</p>
            <div className="mod-tags">
              <span className={`badge ${LABEL_CLASS[m.label]}`}>{m.label}</span>
              <span className="badge badge-phase">Phase {m.phase}</span>
            </div>
            <details className="mod-more">
              <summary>
                <span className="mod-info" aria-hidden="true">i</span>
                Details<span className="sr-only"> about {m.name}</span>
              </summary>
              <dl className="mod-kv">
                <div><dt>Today</dt><dd>{m.exists}</dd></div>
                <div><dt>Next</dt><dd>{m.next}</dd></div>
                <div><dt>Proof required</dt><dd>{m.validation}</dd></div>
              </dl>
              {m.qualifier ? <p className="mod-qualifier">{m.qualifier}</p> : null}
            </details>
          </li>
        ))}
      </ol>

      <p className="roadmap-note">
        After these synthetic phases come separate, gated stages: real connections, accounts and audit. AI features need an approved
        backend, so they stay planned.
      </p>
    </div>
  );
}
