# Stage 1 implementation plan (Preflight-Lead, Claude)

Status: approved plan, preserved 2026-10-21. **Implemented and verified** on the synthetic benchmark; see [stage1-verification-report.md](stage1-verification-report.md). The plan text is kept as written, except for the referrer correction in §5. In the implementation, the rules tests live in `tests/rules/` and the import/storage tests in `tests/unit/`. The full twelve-module roadmap in [enterprise-roadmap.md](enterprise-roadmap.md) stays in force. Stage 1 is the first slice, not a reduction of scope.

## 1. Scope and hard limits
- A local, single-operator browser prototype over **synthetic** USD invoice CSVs. It has deterministic `DUPLICATE_CANDIDATE` and `TOTAL_MISMATCH` rules, source-backed evidence, human confirm/dismiss/reopen decisions with reasons, append-only review history, and an independent labeled evaluation.
- No installs or new runtime dependencies. No credentials, paid services, plugins, remote access, real data or integrations, AI model calls, or deployment. No access outside this folder.
- A finding is not fraud proof, exposure is not savings, confirming a finding never authorizes or blocks a payment, and no model approves money movement.

## 2. Verified environment (read-only probe, 2026-10-21)
Python 3.12.10, SQLite 3.49.1, Node v24.21.0. FastAPI, Starlette, Jinja2, uvicorn, pytest, httpx, pydantic and python-multipart are **not installed**. Git is not initialised; that is deferred by user instruction. Reports record per-file SHA-256 hashes and state "unversioned" instead of a commit.

## 3. Stack: Python 3.12 standard library only
| Concern | Choice |
| --- | --- |
| HTTP | `http.server.ThreadingHTTPServer`, bound to `127.0.0.1` only |
| Storage | `sqlite3`, **one new connection per request/operation** (never shared across threads); `PRAGMA foreign_keys=ON`, `busy_timeout=5000`, WAL journal; writes in `BEGIN IMMEDIATE` transactions |
| CSV | `csv.reader(strict=True)` over the UTF-8 decoded bytes (optional BOM removed only for parsing; hash covers original bytes) |
| Templates | Pure Python render functions + `html.escape` on every interpolated value |
| Money | ASCII-only regex `[0-9]{1,9}\.[0-9]{2}` (`re.ASCII` + `fullmatch`; never `\d`, which matches Unicode digits) → integer cents; no float, no `Decimal` rounding |
| Tests | `unittest` (`python -m unittest discover -s tests -t . -v`) |
| CSRF | `secrets.token_urlsafe(32)` per server process; `hmac.compare_digest` |

**Growth path.** `contracts.py` and the pure `rules/` package move unchanged into a later Python analysis service (FastAPI if installs are approved). Routes map onto a JSON API for a future Next.js/TypeScript UI, and amounts already cross every interface as decimal strings. The SQLite tables (batch, vendor, invoice, finding, review_event) use stable text IDs and normalized relations. These carry over to PostgreSQL and become the first nodes of the financial knowledge graph (contracts, POs, bank details, approvals, projects and accounting entries are added in later stages). Each of those moves is a separately gated Stage 2+ decision.

## 4. Upload design (no multipart, byte-exact hashing)
The Command Center has a real `<input type="file" accept=".csv,text/csv">`. A small static script (`/static/upload.js`, no inline script) reads the chosen file as an `ArrayBuffer` and sends it with:
```
fetch('/import', {method:'POST', body: <ArrayBuffer>, headers:{
  'Content-Type':'application/octet-stream',
  'X-CSRF-Token': <token from <meta name="csrf-token">>,
  'X-Filename': encodeURIComponent(file.name)}})
```
The bytes reach the server exactly as stored on disk, including any BOM and CRLF, so SHA-256 is computed over the original file. The server rejects any `Content-Length` above 1,048,576 (`FILE_TOO_LARGE`) without reading the body, and never reads more than that. A missing or invalid length gets `411`/`400`. The JSON response is shown with `textContent` only.

## 5. Local server security
- Bind `127.0.0.1` only. `Host` must be exactly `127.0.0.1:<port>` or `localhost:<port>`, otherwise 400 (DNS-rebinding guard).
- Every POST: if `Origin` is present it must equal `http://127.0.0.1:<port>` or `http://localhost:<port>`. `Sec-Fetch-Site: cross-site` is rejected. The CSRF token must match (header `X-CSRF-Token` for `/import`; hidden form field `csrf` for review forms). Failure → 403.
- Response headers: `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` (and the same value in a meta tag), `Cache-Control: no-store`. *Correction:* the plan originally said `no-referrer`. Under that policy, browsers send `Origin: null` on form POSTs, which the Origin allowlist rejects; Codex browser QA found this as a 403. `same-origin` fixes it without loosening the Origin, Sec-Fetch-Site or CSRF checks.
- No CORS headers. Static files are served from a fixed allowlist only. Reviewer labels are self-declared attribution, not identity.

## 6. Shared contracts (`src/preflight/contracts.py`, version `contracts-v1`, lead-owned)
See the module docstrings; summary:
- `RULESET_VERSION = "invoice-v1"`, `CSV_HEADER` (10 columns), `MAX_BYTES = 1_048_576`, `MAX_ROWS = 1000`.
- `Invoice` (frozen): record_id, row_number (1-based data row), raw (10 original strings), vendor_norm, invoice_norm, invoice_date, currency, subtotal_c, tax_c, shipping_c, discount_c, total_c, plus `expected_total_c`.
- `Finding` (frozen): finding_id, rule_id, rule_version, member_ids (sorted tuple), evidence (JSON-safe dict, amounts as decimal strings). `make_finding_id()` = first 16 hex of SHA-256 of `rule_id|rule_version|member1|member2…`.
- `ValidationIssue(row, field, code, message)`. Codes: `EMPTY_FILE, FILE_TOO_LARGE, ENCODING, MALFORMED_CSV, HEADER_MISMATCH, NO_DATA_ROWS, TOO_MANY_ROWS, ROW_SHAPE, FIELD_REQUIRED, ID_FORMAT, DUPLICATE_RECORD_ID, INVOICE_NUMBER_FORMAT, DATE_FORMAT, DATE_INVALID, CURRENCY_UNSUPPORTED, AMOUNT_REQUIRED, AMOUNT_FORMAT, DISCOUNT_EXCEEDS_CHARGES`.
- View models: `BatchSummary`, `FindingView`, `ReviewEventView`, and `case_sort_key()` (open first, then rule ID, then member IDs; no invented risk scores).
- `MODULES`: all twelve roadmap modules with their Stage 1 status and limit note, rendered in the UI.

## 7. Rules (`invoice-v1`, pure, no I/O)
- `DUPLICATE_CANDIDATE`: group by `(vendor_norm, invoice_norm, currency)` within the batch. Each group of 2+ gives one finding, with members sorted by record ID. Date and amounts are evidence only.
- `TOTAL_MISMATCH`: `delta = total − (subtotal + tax + shipping − discount)` in cents. Any nonzero delta gives one finding.
- A row can be in both. `rules.run_all()` returns findings sorted by `(rule_id, member_ids)`.

## 8. Validation decisions (from spec review)
Identifiers are trimmed of outer ASCII whitespace; normalisation uppercases ASCII letters only. Amounts and dates are **not** trimmed. Empty cell → `FIELD_REQUIRED` (identifiers/date/currency) or `AMOUNT_REQUIRED` (amounts). Signs (`-0.00`, `+1.00`), symbols, separators, exponents and wrong precision → `AMOUNT_FORMAT`. `discount > subtotal+tax+shipping` → `DISCOUNT_EXCEEDS_CHARGES`. An expected total above 999,999,999.99 is still a valid row, and its mismatch is reported (Python ints and SQLite 64-bit integers). Any invalid row rejects the whole file. All row errors are reported (capped at 500 listed issues, with a total count).

## 9. File ownership
| Role | Exclusive paths |
| --- | --- |
| Preflight-Lead | `src/preflight/{__init__,contracts,money,imports,storage,review,app,routes}.py`, `src/preflight/schema.sql`, `run.py`, `tests/__init__.py`, `tests/unit/`, `tests/integration/`, docs, README |
| Rules worker | `src/preflight/rules/`, `tests/rules/` |
| Interface worker | `src/preflight/views/`, `src/preflight/static/`, `tests/ui/` |
| Fixture/evaluator (independent) | `fixtures/`, `tests/evaluation/`, `reports/` — never imports `preflight.rules` to create labels |
| Independent reviewer (after integration) | read-only review notes returned to lead |

Workers request contract changes from the lead via SendMessage and never edit another role's files.

## 10. Fixture and evaluation targets (planned, not measured)
`invoice-fixtures-v1`, seed `20261021`. The main file has 120 valid rows: 80 clean (with 12 hard-negative pairs that must have distinct normalized keys; punctuation/leading-zero pairs share a vendor; hard-negative rows are never mismatches), 16 standalone mismatches (4 one-cent-high, 4 one-cent-low, 4 omitted-shipping with shipping > 0, 4 discount-added with discount > 0), 10 genuine duplicate pairs (2 pairs where both members are one-cent-high), and 2 legitimate same-key reuse pairs. Expected: 12 groups, 20 mismatch findings, 32 findings, 40 affected rows. Pair metrics over 7,140 pairs: TP10/FP2/FN0/TN7128. Hard-negative false-alert rate: 2/14. Mismatch: TP20/FP0/FN0/TN100. Rejection fixtures: 8 one-row invalid files, a mixed 128-row file (all 8 errors reported, nothing persisted), discount-exceeds, `-0.00`, `+1.00`, and structural cases (malformed quote, header missing/duplicate/extra, duplicate record ID, 1,001 rows, >1 MiB, empty). Boundary files: max amount, a triple group, a case/whitespace positive duplicate, and a split-across-batches known limitation.

## 11. Verification
1. `python -m unittest discover -s tests -t . -v`
2. `python -m tests.evaluation.evaluate` writes `reports/` JSON and Markdown with fixture/label hashes, source-file hashes (unversioned), runtime, command, counts and metrics.
3. Integration tests run an in-process loopback server through the full flow: import → evidence → confirm → reopen → dismiss → restart → history. Also covered: a 409 on a stale tab, idempotent reimport, a byte-changed file creating a new batch, a mixed file persisting nothing, escaped `<script>`, and Host/Origin/CSRF rejections.
4. An independent read-only review pass.
5. Manual demo: `python run.py` → `http://127.0.0.1:8765`.

## 12. Twelve-module phase map
| # | Module | Stage 1 | Stage 2 | Stage 3 | Stage 4 |
|---|---|---|---|---|---|
| 1 | Financial Loss Firewall | duplicate/total rules, evidence, decisions | pending-action feed | shadow recommendations | validated, human-gated interventions |
| 2 | Contract Intelligence | — | synthetic clause scenarios | pilot | coverage |
| 3 | Vendor Risk Intelligence | vendor key/table | synthetic bank-change scenarios, vendor feed | shadow | coverage |
| 4 | Cross-System Reconciliation | stable IDs, provenance, batch hash | one adapter | shadow | multiple systems |
| 5 | Financial Investigation AI | deterministic explanation templates | optional gated model layer | wider cases | wider cases |
| 6 | Predictive Budget Monitoring | — | synthetic feasibility | — | build |
| 7 | Cash Flow Intelligence | — | — | — | build |
| 8 | Revenue Leakage Detection | — | — | — | build |
| 9 | Accounting Audit Agent | — | — | — | build |
| 10 | Financial Scenario Simulator | — | — | — | build |
| 11 | Autonomous Finance Workflows | review state machine + append-only history | — | design after validation | controlled, human-overseen workflows |
| 12 | Executive AI Advisor | synthetic summary report | — | — | authorized-data Q&A / CFO reports |

Cross-cutting Stage 4 work: tenant isolation, granular permissions, SSO, immutable audit logs, secure document storage, and SOC 2 / NIST assessment *goals*.
