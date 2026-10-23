# Enterprise roadmap — all twelve Preflight modules

Status update 2026-10-21: **only Stage 1 is built** (synthetic, local), and it is verified on a synthetic benchmark only ([report](stage1-verification-report.md)). All twelve module rows below are retained unchanged. In Stage 1, module 1's checks exist, along with foundations for modules 3, 4, 5, 11 and 12; these are listed in-app. Modules 2 and 6–10 are not built. Stages 2–4 each still require separate authorization.

Original status: retained requirements and staged proposal for Claude to refine. The user accepted the synthetic invoice workflow as the first working prototype and required the complete earlier enterprise concept to remain. **Claude is the implementation agent.** Nothing below is implemented or measured yet. These modules were an earlier assistant's proposed realization of the user's goal, not delivered software.

## Delivery stages

Later 2026-10-21 scope update: the user requested a polished recruiter-facing public web demo and eventual implementation of all modules. The [portfolio brief](superpowers/specs/2026-10-21-portfolio-web-demo.md) adds P1/P2/P3 synthetic delivery increments before real integrations. It preserves every module below. Only the original local Stage 1 is implemented; the new UI/public package is a prepared plan, with Claude ownership and dependency gates outstanding. Historical authorization statements below describe the earlier delivery scope, not a cancellation of the new request.

1. **Synthetic local prototype:** CSV input; Financial Risk Command Center/dashboard; prioritized cases; investigation UI with source evidence, calculations and recommended review actions; duplicate/amount checks; human decisions/history; repeatable labeled tests. All financial metrics visibly synthetic. No real integrations or payments.
2. **One read-only platform integration, separately authorized:** select a platform after discovery, agree fields/access/privacy/retention and representative labels, measure precision, false positives and review effort. NetSuite and Microsoft Business Central are candidates, not commitments. Other modules can be exercised synthetically before connection.
3. **Human-supervised shadow pilot:** controller/AP team evaluates recommendations without changing or blocking real transactions. Measure errors, misses, workload and usefulness. Approval interventions follow validation and explicit authorization, with hard human approval restrictions.
4. **Enterprise expansion:** more integrations and all retained modules, tenant isolation, granular permissions, SSO, immutable audit logs, secure document storage, operational assurance and security/compliance assessment. SOC 2/NIST references are assessment goals, not credentials or proof of compliance.

Only the bounded local synthetic Stage 1 is authorized for eventual implementation after a technical plan is written and Claude is usable under normal permissions. Later phases require their own design/data/access approval.

## Complete module map

| Module | Phases and dependencies | Acceptance evidence to retain |
| --- | --- | --- |
| 1. Financial Loss Firewall | Stage 1 duplicate/amount checks; Stage 2 pending-action feed; Stage 3 shadow recommendations; Stage 4 validated interventions. Needs typed events, rules, evidence and approvals | Seeded pending-payment/accounting errors and valid controls, exact rule traces, measured false positives; no unauthorized transaction changes |
| 2. Contract Intelligence | Synthetic scenarios planned early; selected Stage 2/3 pilot; Stage 4 coverage. Needs contracts/clauses, invoice/PO joins, dates and terms | Overbilling, missed discounts, unfavorable renewals and contract violations cite exact clauses and dated calculations; ambiguous conditions require review |
| 3. Vendor Risk Intelligence | Synthetic scenarios first, selected vendor feed in Stage 2/3, Stage 4 coverage. Needs vendor identities, approved bank-detail baseline, change approvals and payment history | Suspicious bank-detail changes, duplicate vendors and unusual payment behavior tested against benign controls; independent verification of changes; no fraud claim from a flag |
| 4. Cross-System Reconciliation | Stage 1 identifier/evidence foundation; Stage 2 one adapter plus authorized comparison records; Stage 3 shadow; Stage 4 multiple systems | Accounting/bank/PO/invoice discrepancies include unmatched, duplicate, amount, partial and one-to-many cases; source records and unresolved cases preserved |
| 5. Financial Investigation AI | Stage 1 investigation UI with deterministic explanation; optional model layer after measured core; wider Stage 2–4 cases | Evidence-backed explanations, checked calculations and recommended review actions; model statements cite evidence or abstain; never approves money movement |
| 6. Predictive Budget Monitoring | Stage 4; synthetic feasibility beforehand. Needs budgets, department/project mapping, commitments and actuals | Overrun warnings evaluated on labeled scenarios with explicit horizon, uncertainty, assumptions and baseline comparisons |
| 7. Cash Flow Intelligence | Stage 4. Needs authorized receivables/payables/balances and timing assumptions | Shortage and working-capital scenarios reconcile to sources; forecasts distinguished from observed cash; sensitivity visible |
| 8. Revenue Leakage Detection | Stage 4. Needs delivery/service records, pricing/contracts, invoices and collections | Delivered-but-unbilled work, missing collections and wrong pricing seeded with legitimate timing controls and source evidence |
| 9. Accounting Audit Agent | Stage 4. Needs journal entries, periods, approvals and reconciliation evidence | Unusual adjustments and reconciliation gaps traced to stated rules/baselines; retained review outcomes; no statutory-audit claim |
| 10. Financial Scenario Simulator | Stage 4. Needs versioned assumptions, budget/cash models, staffing/capex and contract inputs | Hiring, capital expenditure and contract-change effects have reproducible calculations; assumptions/counterfactuals separated from actuals |
| 11. Autonomous Finance Workflows | Stage 3 design after validation; Stage 4 controlled workflows. Needs identity/permissions, approved actions, idempotency and hard gates | Draft corrections, route approvals and gather evidence under human oversight; unauthorized actions rejected; no independent LLM payment approval |
| 12. Executive AI Advisor | Stage 1 reporting surface concept; Stage 4 authorized-data Q&A/CFO reports. Needs scoped retrieval, deterministic metrics, graph and provenance | Every answer/report respects access and cites data; synthetic/actual/forecast values distinguished; unsupported conclusions withheld |

## Shared architecture retained

Maintain a connected financial knowledge graph linking contracts, purchase orders, vendors, bank details, approvals, projects and accounting entries. This is an explicit entity/relationship model; a separate graph database is not necessary in Stage 1. Stable IDs and normalized relationships can establish the foundation. Choose later graph infrastructure from workload evidence.

Place prevention at purchase, supplier-change and payment decisions. Keep deterministic financial rules and hard approval restrictions separate from ML anomaly scoring and LLM document interpretation/explanations. Financial-consequence modeling must display assumptions and arithmetic. A flag is not fraud proof, exposure is not savings, and bank-detail changes require independent verification.

Retain the original technical direction as an option: Next.js/TypeScript UI, Python analysis services, PostgreSQL normalized data and secure document storage. The smaller local Python/SQLite proposal in this packet is only a Stage 1 option. Claude should explain the stack choice and growth path. No stack was installed or locked in.

Shared modules need provenance, versioned rules, findings, cases and review/approval history. A local SQLite history table is not immutable enterprise audit logging. Real multi-user use requires tenant/access/identity controls and assurance before deployment.

## UI and commercial context

Retain Financial Risk Command Center, prioritized cases, source-backed investigations, calculations, recommended actions, review/approval history, and executive reporting. Priorities must state assumptions; no invented probabilities or savings. Label all sample financial metrics synthetic.

Proposed sectors: upper-middle-market construction, energy services, manufacturing, logistics. Proposed buyers: CFOs, controllers, internal audit, finance transformation. Enterprise subscription and implementation pricing remain hypotheses. Do not build billing or claim customers, revenue or commercial validation now. Vigil Finance, Cabinet and trading projects remain separate.

Every module requires a versioned scenario manifest, independent truth labels, known limitations, detection/false-positive counts and review-effort measures. Distinguish proposed, implemented, tested synthetically and validated with authorized real data. Passing Stage 1 does not complete the roadmap or establish enterprise accuracy.
