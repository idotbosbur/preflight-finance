/** How it works, for people using it: three steps, why it can be trusted, its limits. Engineering detail lives in the README. */

const REPO = "https://github.com/idotbosbur/preflight-finance";

const STEPS: readonly (readonly [string, string])[] = [
  ["Drop in your files", "A bills export from your accounting software, and if you like a bank or card statement. CSV, Excel or your bank's download (.qfx, .ofx, .qbo)."],
  ["We check them in your browser", "Bills entered twice, bills paid twice, payments with no bill, monthly charges and supplier prices that went up, totals that don't add up, and a year-end contractor list."],
  ["You decide", "Each flag shows its evidence. Mark it as needing a fix or as fine, and email the supplier straight from the result if you need to."],
];

const TRUST: readonly (readonly [string, string])[] = [
  ["Exact to the cent", "Amounts are read as whole cents, so a one-cent error is never rounded away."],
  ["AI matches names, rules check money", "A small AI model in your browser recognises that “SQ *ACME SUPPLY 4412” is Acme Supply. Amounts and dates are always checked by exact rules."],
  ["Nothing leaves your browser", "No upload and no account. Your files and answers stay on this device until you delete them."],
];

export function HowPage() {
  return (
    <div className="workspace how">
      <header className="page-head">
        <h1 className="page-title" tabIndex={-1}>How it works</h1>
      </header>

      <ol className="how-steps">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="how-step">
            <span className="how-n" aria-hidden="true">0{i + 1}</span>
            <div><h2 className="section-title">{title}</h2><p>{text}</p></div>
          </li>
        ))}
      </ol>

      <section aria-labelledby="trust-heading">
        <h2 id="trust-heading" className="small-title">Why you can trust the results</h2>
        <ul className="how-trust">
          {TRUST.map(([title, text]) => <li key={title}><strong>{title}.</strong> {text}</li>)}
        </ul>
      </section>

      <section aria-labelledby="limits-heading">
        <h2 id="limits-heading" className="small-title">Limits</h2>
        <ul className="how-trust">
          <li>It flags things to check, not proven mistakes. Some flags will be fine, like a supplier reusing an invoice number.</li>
          <li>PDFs and photos aren't supported yet.</li>
          <li>Your data lives in this browser only, so it won't follow you to another device.</li>
          <li>The contractor list is a starting point, not tax advice.</li>
        </ul>
      </section>

      <p className="how-credit muted">
        Designed by the project owner and built with Claude, Anthropic's AI coding agent. Code, tests and engineering notes are{" "}
        <a href={REPO}>on GitHub</a>.
      </p>
    </div>
  );
}
