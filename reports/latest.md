# Evaluation report: invoice-fixtures-v1

**synthetic benchmark; planned targets shown separately from measured values.** SYNTHETIC DATA - invented figures, not real financial records. No result here supports real-world fraud detection, money saved, or private-customer accuracy.

- Status: **PASS** (263/263 checks passed, exit 0)
- Run (UTC): 2026-10-23T18:30:33Z
- Command: `python -m tests.evaluation.evaluate`
- Python 3.12.10, SQLite 3.49.1
- Ruleset: invoice-v1
- Manifest `fixtures/manifest/invoice-fixtures-v1.json` sha256 `1ced051872486e9dd61c2f36e07f5ecdb6de1a9c089a6b94454590c1e07dc1c4`
- Main fixture sha256 `c7bb7b84c452f308aa3530a8986e65ddd07266bb3463a15c8741e2f433b3428b`
- Source tree: unversioned (no git); 21 file hashes in JSON report
- System under test: preflight.contracts: available; preflight.imports: available; preflight.rules: available

## Planned targets (from independent labels)

| Evaluation | Planned |
| --- | --- |
| Duplicate groups (exact membership) | 12 |
| Semantic pairs (7140) TP/FP/FN/TN | 10/2/0/7128 |
| Hard-negative false alerts | 2/14 |
| Mismatch TP/FP/FN/TN | 20/0/0/100 |
| Findings / distinct rows | 32/40 |

## Measured values

| Evaluation | Unit | Measured |
| --- | --- | --- |
| Duplicate conformance | expected normalized-key groups, exact membership | 12/12 exact; missing 0, extra/partial 0 |
| Semantic pairs | 7140 unordered pairs | TP 10, FP 2, FN 0, TN 7128; precision 83.3333%, recall 100.0000%, FPR 0.0281% |
| Hard negatives | 14 designated pairs | 2 false alerts (14.2857%): DG-11, DG-12 |
| Total mismatch | 120 valid records | TP 20, FP 0, FN 0, TN 100; precision 100.0000%, recall 100.0000%; exact deltas 20 |
| Findings | main-120 | 32 (12 dup + 20 mismatch), 40 distinct rows |

The two legitimate same-key reuse pairs are intentional semantic false alerts for human dismissal; the split-across-batches pair is a documented known limitation (batch-scoped rule).

## Unmatched finding identities

None.

## Failures

None.
