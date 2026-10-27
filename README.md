# Preflight: catch invoice errors before they're paid

**Live demo:** https://preflight-finance-portfolio.vercel.app/ · works in the browser, no sign-up · all data is synthetic

Preflight is a working prototype of a pre-payment control for accounts payable. It checks a batch of invoices for
**possible duplicates** and **totals that don't add up**, shows the exact evidence and arithmetic, and records a
person's **confirm / dismiss / reopen** decision with a reason and an append-only history. It never approves, blocks
or pays anything; it helps a reviewer decide.

It is a portfolio prototype on invented data, not a production finance platform.

## Results (synthetic benchmark)

Measured against an answer key on 120 invented invoices built for testing:

| | Result |
|---|---|
| Arithmetic errors caught (down to one cent) | **20 of 20** |
| Real duplicate pairs caught | **10 of 10** |
| False alarms | **2**, both legitimate invoice-number reuses, which is why a person reviews every flag |
| Automated checks passed | **233 of 233** (browser app) · **263 of 263** (Python reference) |
| Browser app vs Python reference, output parity | **813 of 813** checks match |
| Unit, UI and integration tests | **210** (web) · **110** (Python) |

The benchmark and its labels were written as part of the same AI-assisted build, so these numbers show the rules
behave as designed. They are not evidence of accuracy on real invoices.

## What's interesting under the hood

- **Exact money:** amounts are parsed digit by digit into whole cents. There is no floating point anywhere, so a one-cent
  error is never rounded away.
- **All-or-nothing import:** a CSV with one bad row is rejected whole, with row and field reasons. Importing identical
  bytes again recognises the same batch (SHA-256 of the original file) and keeps its decisions.
- **Safe concurrent review:** decisions use a version token, so a stale browser tab can't silently overwrite a newer
  decision, even across a reset.
- **Parity with a reference:** the TypeScript rules reproduce a Python reference implementation byte for byte,
  including CSV edge cases, verified by captured fixtures.
- **No backend:** everything runs in the browser (IndexedDB for history, Web Crypto for hashing), so the demo can be
  hosted as static files.

## How it was built

The concept, scope and product and design decisions are the project owner's. The application code and tests were
written by **Claude (Anthropic's AI coding agent)** working as a lead with parallel worker agents and independent
reviewers. **Codex** coordinated the work and ran browser QA. The owner did not hand-write the code.

## Tech

React 19 · TypeScript 6 · Vite 7 · IndexedDB · WebGL (hand-written shader for the landing visuals) · Node's built-in
test runner · Python 3.12 standard library for the reference app. No other runtime dependencies.

## Run it locally

```bash
cd web
npm ci
npm test          # typecheck + domain/state/evaluation tests + UI tests
npm run build     # static site in web/dist
npm run dev       # http://127.0.0.1:5173
```

Python reference (from the repository root): `python -m unittest discover -s tests -t .` and
`python -m tests.evaluation.evaluate`.

## Repository layout

| Path | What it is |
|---|---|
| `web/` | The browser app (what the live demo runs), its tests and evaluation harness |
| `src/`, `tests/`, `run.py` | The original Python reference prototype and its tests |
| `fixtures/` | The synthetic invoice data and its answer key |
| `reports/latest.*` | The latest Python benchmark report |
| `docs/` | Architecture, evaluation plan and the twelve-module roadmap |

## Roadmap

One of twelve planned modules works today (the loss-firewall checks above). The others, including contract
intelligence, vendor risk, reconciliation, cash flow and AI-assisted investigation, are labelled honestly as
foundations or plans on the [Roadmap page](https://preflight-finance-portfolio.vercel.app/#/roadmap). No real financial
data, connections, payments or AI model calls are used.

Font: Instrument Sans, SIL Open Font License 1.1 (`web/public/fonts/OFL.txt`).
