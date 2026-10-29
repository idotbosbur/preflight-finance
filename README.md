# Preflight: find the bills you paid twice

**Live:** https://preflight-finance-portfolio.vercel.app/ · free · no sign-up · your files never leave your browser

Preflight is a free web tool for small businesses and individuals. You drop in a bills export from your accounting
software and, if you like, a bank or card statement. In a few seconds it shows what may have been paid twice,
overcharged or quietly gone up, with the evidence for each, and you decide what to do about it. It never pays, blocks
or approves anything.

It is a portfolio project that is now being tested with real small businesses. It is not a production finance platform.

## What it checks

| Check | Needs | How |
|---|---|---|
| Bills entered twice | Bills | Same supplier and invoice number after normalising case, spaces and punctuation |
| Same amount twice in 14 days | Bills | Same supplier and amount, different invoice numbers (lower confidence) |
| Totals that don't add up | Bills with subtotal and tax | Subtotal + tax + shipping − discount, in exact cents |
| Bills paid twice / payments with no bill | Bills + a statement | Exact amount, payment 0 to 90 days after the bill, payee name matched to the supplier |
| Monthly charges creeping up / charged twice | A statement | A payee seen about once a month whose amount rose, or was taken twice in one month |
| Supplier price increases | Bills with item lines (e.g. Xero) | Same item from the same supplier, unit price up more than 2% |
| Year-end contractor (1099) list | Bills | Totals per payee per year, spellings grouped, over-threshold payees and missing W-9 or insurance flagged |

The results page adds them up into one figure, lists the biggest first, and drafts a polite email to the supplier for
each one.

**File formats:** CSV, Excel (.xlsx), bank downloads (.qfx, .ofx, .qbo), and semicolon- or tab-separated text. File type
and columns are recognised from the header row; the person only answers a question when it is genuinely unclear
(for example whether 03/04 is March 4 or April 3). PDFs and photos are not supported; reading them well needs a stronger
AI than a free browser tool can run, so they are on the list for a possible paid version.

## How the AI is used, honestly

A small sentence-embedding model (all-MiniLM-L6-v2, 8-bit, about 23 MB) runs **in the browser** through
`@huggingface/transformers`. It scores how alike two names are, so a bank line like `SQ *ACME SUPPLY 4412` can be
matched to the supplier `Acme Supply Co.`, and differently written item names can be grouped. Only the model files are
downloaded; no invoice or statement text leaves the device.

It is deliberately limited:

- **AI matches names; exact rules check the money.** A match also needs the exact amount and a date window, so the AI
  alone cannot create a "paid twice" finding.
- **Measured, not assumed.** On test pairs the model was good at brand names (`COMCAST CABLE` vs `Xfinity`: 0.57) and
  weak on abbreviations (`AMZN` vs `Amazon`: 0.19) and item names, so the thresholds are set high and word matching
  does most of the work. A larger model is the obvious next experiment.
- If the model cannot load, matching falls back to word overlap and the page says so.

## Under the hood

- **Exact money:** amounts are parsed digit by digit into whole cents. There is no floating point in any check, so a
  one-cent error is never rounded away.
- **No backend:** everything runs in the browser. Files are read locally, results and review decisions are kept in
  IndexedDB, hashing uses Web Crypto, and the ONNX runtime for the AI model is served from this site, not a CDN.
- **Re-importing is safe:** rows are identified by a hash of their content, so adding the same file again changes
  nothing and keeps your decisions; a corrected re-export updates the changed rows.
- **Safe concurrent review:** decisions carry a version token, so a stale browser tab cannot silently overwrite a newer
  decision.
- **Junk is refused, not guessed:** pictures, empty files and text with no columns are rejected with a plain reason;
  rows whose amounts are not numbers are skipped and counted.
- **Parity with a reference:** the original duplicate and total rules reproduce a Python reference implementation byte
  for byte, verified by captured fixtures.

## Tests and measurements

- **363 automated tests** in the web app (domain rules, storage, file formats, UI rendering, static pages) and
  **110** in the Python reference.
- **End-to-end test set** in `docs/samples/test-set` (kept out of the repository) with the expected result for every
  file: all nine expected findings appear, nothing else is flagged, and the dollar total matches a hand calculation.
- **Synthetic benchmark** for the original two rules, on 120 invented invoices with an answer key: 20 of 20 arithmetic
  errors and 10 of 10 duplicate pairs caught, 2 false alarms (legitimate invoice-number reuse). The benchmark and its
  labels were written as part of the same AI-assisted build, so these numbers show the rules behave as designed, not
  accuracy on real invoices. The newer checks are covered by tests, not by a benchmark yet.

## Engineering note: a bug found in real-browser testing

The browser app is a port of an earlier local Python prototype. In that prototype, submitting a review returned HTTP 403
in a real browser even though every automated test passed. The cause was the header `Referrer-Policy: no-referrer`,
which makes Chromium send `Origin: null` on form posts, so the server's origin check rejected them. The fix changed the
policy to `same-origin` while keeping the strict origin allowlist and CSRF checks, and added a regression test that
submits the real rendered form. Codex found it during browser QA; Claude fixed it.

## How it was built

The concept, scope, product and design decisions are the project owner's. An earlier assistant elaborated the concept
into the twelve-module roadmap. The application code and tests were written by **Claude (Anthropic's AI coding agent)**,
working as a lead with worker agents and independent reviewers. **Codex** coordinated the early work and ran browser QA.
The owner did not hand-write the code.

## Tech

React 19 · TypeScript 6 · Vite 7 · IndexedDB · Web Crypto · WebGL (hand-written raymarching shaders for the 3D logo and
background) · `@huggingface/transformers` 4.3.1 (in-browser AI) · `read-excel-file` 9.3.12 (Excel) · Node's built-in
test runner · Python 3.12 standard library for the reference prototype.

## Run it locally

```bash
cd web
npm ci
npm test          # typecheck + domain/state/evaluation tests + UI tests + static pages
npm run build     # static site in web/dist
npm run dev       # http://127.0.0.1:5173
```

Python reference (from the repository root): `python -m unittest discover -s tests -t .` and
`python -m tests.evaluation.evaluate`.

## Repository layout

| Path | What it is |
|---|---|
| `web/` | The browser app (what the live site runs), its tests and evaluation harness |
| `src/`, `tests/`, `run.py` | The original Python reference prototype and its tests |
| `fixtures/` | The synthetic invoice data and its answer key |
| `reports/latest.*` | The latest Python benchmark report |
| `docs/` | Architecture, evaluation plan and the twelve-module roadmap |

## What's next

The free version stays free. Ideas that would need servers and paid AI (connecting QuickBooks, Xero or a bank,
reading PDFs, a stronger AI, chasing refunds, a bookkeeper mode) are listed on the site, where visitors vote on what
they would use. The longer-term twelve-module vision is on the
[Roadmap page](https://preflight-finance-portfolio.vercel.app/#/roadmap).
