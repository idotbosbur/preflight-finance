import { MAX_ROWS, RULESET_VERSION } from "../domain/contracts.ts";

interface Principle {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly example: string;
}

const PRINCIPLES: readonly Principle[] = [
  {
    id: "cents",
    title: "Exact cents, never floating point",
    body: "Every amount is parsed from its text digits into a whole number of cents, and all checks add and compare whole cents.",
    example:
      "In ordinary binary floating point, 0.1 + 0.2 is 0.30000000000000004. Preflight reads \"110.25\" as 11025 cents, so a one-cent gap such as a difference of +0.01 is reported exactly, not rounded away.",
  },
  {
    id: "atomic",
    title: "Atomic validation",
    body: "A file is checked completely before anything is stored. If any row is invalid, nothing from that file is imported, and every issue is listed by row and field.",
    example:
      "The test file mixed-128.csv has 120 valid rows followed by 8 invalid ones (rows 121–128). It is rejected as a whole with 8 issues, and no batch is created.",
  },
  {
    id: "idempotent",
    title: "Idempotent import by file hash",
    body: `The batch ID comes from the SHA-256 of the file's original bytes plus the ruleset (${RULESET_VERSION}). Importing the same bytes again opens the same batch.`,
    example:
      "Import the sample, confirm a finding, then import the identical file again: you land on the same batch with your decision intact. Change line endings from LF to CRLF and the bytes differ, so it becomes a separate batch.",
  },
  {
    id: "stale",
    title: "Stale-review conflicts",
    body: "Each decision is saved against the case version you were looking at. If the case changed in the meantime, the save is refused instead of silently overwriting.",
    example:
      "Open the same case in two tabs and confirm it in the first. Dismissing it from the second tab shows a conflict; the reason you typed there is kept so you can reconsider.",
  },
  {
    id: "local",
    title: "Browser-local, resettable, unauthenticated history",
    body: "Batches and decisions live only in this browser's storage. There are no accounts and no server; reviewer names are self-declared.",
    example:
      "Open the demo on another device and it starts empty. \"Reset this browser's demo data\" in the queue erases this browser's batches and history. It is a review record for the demo, not a tamper-proof audit log.",
  },
];

export function HowPage() {
  return (
    <div className="workspace how">
      <header className="page-head">
        <p className="eyebrow">How it works</p>
        <h1 className="page-title" tabIndex={-1}>Small, checkable guarantees</h1>
        <p className="lede">
          Two deterministic rules (possible duplicates within one batch and total mismatches), a human review step and a measured
          synthetic benchmark. No AI model is used, and nothing leaves your browser.
        </p>
      </header>

      <ul className="principles">
        {PRINCIPLES.map((p) => (
          <li key={p.id} className="panel principle">
            <h2 className="section-title">{p.title}</h2>
            <p>{p.body}</p>
            <p className="example">
              <strong>Example: </strong>
              {p.example}
            </p>
          </li>
        ))}
      </ul>

      <section className="panel" aria-labelledby="limits-heading">
        <h2 id="limits-heading" className="section-title">Limits</h2>
        <ul>
          <li>Synthetic USD invoices only; at most 1 MiB and {MAX_ROWS.toLocaleString("en-US")} rows per file.</li>
          <li>Duplicates are found within one batch only, by exact normalized vendor + invoice number + currency; there is no fuzzy matching.</li>
          <li>Legitimate invoice-number reuse looks the same as a duplicate to this rule; a person must decide.</li>
          <li>No real integrations, payments or accounts.</li>
        </ul>
      </section>

      <section className="panel history-note" aria-labelledby="ref-heading">
        <p className="eyebrow">Python reference history</p>
        <h2 id="ref-heading" className="section-title">A defect found in real-browser testing</h2>
        <p>
          This browser app is a port of an earlier local Python prototype. In that Python reference, submitting a review returned
          HTTP 403 in a real browser. The cause was the header <code>Referrer-Policy: no-referrer</code>, which makes Chromium send{" "}
          <code>Origin: null</code> on form posts, so the server's origin check rejected them. The fix changed the policy to{" "}
          <code>same-origin</code> while keeping the strict origin allowlist and CSRF checks, and added a regression test that
          submits the real rendered form.
        </p>
        <p className="muted">
          Codex found the defect during browser QA and reported a successful retest; Claude fixed the code. This history belongs
          to the Python reference, not to this browser port.
        </p>
      </section>

      <section className="panel" aria-labelledby="credit-heading">
        <h2 id="credit-heading" className="section-title">Who did what</h2>
        <ul>
          <li>The project owner originated the invoice-control concept and made the scope and product decisions.</li>
          <li>An earlier assistant elaborated the concept into the twelve-module roadmap.</li>
          <li>Claude (Anthropic's AI coding agent) wrote the application code and tests.</li>
          <li>Codex coordinated the work, reviewed it and ran browser QA.</li>
        </ul>
        <p className="muted">The owner does not claim to have written this code.</p>
      </section>
    </div>
  );
}
