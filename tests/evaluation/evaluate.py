"""Independent evaluator for invoice-fixtures-v1 (synthetic benchmark).

Run from the project root::

    python -m tests.evaluation.evaluate

System under test: ``preflight.imports.validate_bytes`` and
``preflight.rules.run_all``. Truth comes ONLY from
``fixtures/manifest/invoice-fixtures-v1.json`` (generated independently);
detector output is never used to create or adjust labels.

Writes ``reports/eval-<UTC>.json|.md`` and ``reports/latest.json|.md``.
Exit code 0 only if every check passes; 1 if any check fails; 2 if the system
under test is unavailable.
"""

from __future__ import annotations

import hashlib
import importlib
import itertools
import json
import os
import platform
import sqlite3
import sys
import traceback
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import tests  # noqa: F401  (puts src/ on sys.path)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST_REL = "fixtures/manifest/invoice-fixtures-v1.json"
REPORTS = os.path.join(ROOT, "reports")
LABEL = "synthetic benchmark; planned targets shown separately from measured values"
DUP = "DUPLICATE_CANDIDATE"
MISMATCH = "TOTAL_MISMATCH"


def _abs(rel: str) -> str:
    return os.path.join(ROOT, *rel.split("/"))


def _read(rel: str) -> bytes:
    with open(_abs(rel), "rb") as fh:
        return fh.read()


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def ratio(num: int, den: int) -> Optional[float]:
    return None if den == 0 else num / den


def pct(x: Optional[float]) -> str:
    return "N/A" if x is None else f"{100 * x:.4f}%"


class Evaluator:
    def __init__(self) -> None:
        self.checks: List[Dict[str, Any]] = []
        self.metrics: Dict[str, Any] = {}
        self.unmatched: Dict[str, Any] = {}
        self.manifest = json.loads(_read(MANIFEST_REL).decode("utf-8"))
        self.manifest_sha = _sha(_read(MANIFEST_REL))
        self.sut_status: Dict[str, str] = {}
        self.imports = self.rules = self.contracts = None

    # ---- bookkeeping ----
    def check(self, cid: str, passed: bool, detail: Any = "") -> bool:
        self.checks.append({"id": cid, "passed": bool(passed), "detail": detail})
        return bool(passed)

    def load_sut(self) -> None:
        for name in ("preflight.contracts", "preflight.imports", "preflight.rules"):
            try:
                mod = importlib.import_module(name)
                self.sut_status[name] = "available"
                setattr(self, name.split(".")[1], mod)
            except Exception as exc:  # ImportError or a crash at import time
                self.sut_status[name] = f"unavailable: {type(exc).__name__}: {exc}"
        if self.imports is not None and not hasattr(self.imports, "validate_bytes"):
            self.sut_status["preflight.imports"] = "unavailable: validate_bytes missing"
            self.imports = None
        if self.rules is not None and not hasattr(self.rules, "run_all"):
            self.sut_status["preflight.rules"] = "unavailable: run_all missing"
            self.rules = None

    # ---- SUT calls ----
    def validate(self, rel: str):
        try:
            return self.imports.validate_bytes(_read(rel)), None
        except Exception:
            return None, traceback.format_exc(limit=5)

    def run_rules(self, invoices):
        try:
            return list(self.rules.run_all(invoices)), None
        except Exception:
            return None, traceback.format_exc(limit=5)

    # ---- generic comparisons ----
    @staticmethod
    def match_issues(expected: List[dict], actual) -> Tuple[bool, dict]:
        remaining = [{"row": i.row, "field": i.field, "code": i.code} for i in actual]
        missing = []
        for exp in expected:
            hit = None
            for j, act in enumerate(remaining):
                if all(act[k] == exp[k] for k in exp["check"]):
                    hit = j
                    break
            if hit is None:
                missing.append({k: exp[k] for k in ("code", "row", "field")})
            else:
                remaining.pop(hit)
        return (not missing and not remaining), {"missing": missing, "unexpected": remaining}

    def eval_file(self, rel: str, meta: dict) -> None:
        exp = meta["expected"]
        data = _read(rel)
        self.check(f"{rel}: fixture hash matches manifest", _sha(data) == meta["sha256"])
        res, err = self.validate(rel)
        if not self.check(f"{rel}: validate_bytes did not raise", err is None, err or ""):
            return
        self.check(f"{rel}: result sha256 is SHA-256 of original bytes", res.sha256 == _sha(data),
                   {"got": res.sha256})
        if not exp["accepted"]:
            self.check(f"{rel}: rejected (ok=False)", res.ok is False)
            self.check(f"{rel}: zero invoices returned", len(res.invoices) == 0, {"got": len(res.invoices)})
            ok, detail = self.match_issues(exp["issues"], res.issues)
            detail["got"] = [i.as_dict() for i in res.issues][:20]
            self.check(f"{rel}: issues match exactly ({', '.join(i['code'] for i in exp['issues'])})", ok, detail)
            self.check(f"{rel}: issue_count == {exp['issue_count']}", res.issue_count == exp["issue_count"],
                       {"got": res.issue_count})
            return
        self.check(f"{rel}: accepted (ok=True, no issues)", res.ok is True and len(res.issues) == 0,
                   {"issues": [i.as_dict() for i in res.issues][:20]})
        self.check(f"{rel}: invoice count == {exp['invoice_count']}", len(res.invoices) == exp["invoice_count"],
                   {"got": len(res.invoices)})
        if not res.ok:
            return
        self.eval_findings(rel, res.invoices, exp)
        return res

    def eval_findings(self, rel: str, invoices, exp: dict):
        if self.rules is None:
            self.check(f"{rel}: rules available", False, self.sut_status.get("preflight.rules"))
            return None
        findings, err = self.run_rules(invoices)
        if not self.check(f"{rel}: run_all did not raise", err is None, err or ""):
            return None
        groups = sorted(sorted(f.member_ids) for f in findings if f.rule_id == DUP)
        mism = {}
        for f in findings:
            if f.rule_id == MISMATCH:
                mism[",".join(f.member_ids)] = f.evidence.get("delta") if hasattr(f.evidence, "get") else None
        exp_groups = exp["duplicate_groups"]
        exp_mm = {m["record_id"]: m["delta"] for m in exp["mismatches"]}
        other = sorted({f.rule_id for f in findings} - {DUP, MISMATCH})
        self.check(f"{rel}: duplicate groups exact membership", groups == exp_groups,
                   {"missing": [g for g in exp_groups if g not in groups],
                    "extra": [g for g in groups if g not in exp_groups]})
        self.check(f"{rel}: mismatch findings + deltas exact", mism == exp_mm,
                   {"missing": sorted(set(exp_mm) - set(mism)), "extra": sorted(set(mism) - set(exp_mm)),
                    "delta_diff": {k: {"expected": exp_mm[k], "got": mism[k]}
                                   for k in set(mism) & set(exp_mm) if mism[k] != exp_mm[k]}})
        self.check(f"{rel}: no unknown rule ids", not other, other)
        return findings

    # ---- main benchmark ----
    def eval_main(self) -> None:
        main = self.manifest["main"]
        rel = main["file"]
        meta = self.manifest["files"][rel]
        labels = main["rows"]
        pt = main["planned_targets"]
        self.check(f"{rel}: fixture hash matches manifest", _sha(_read(rel)) == meta["sha256"])
        res, err = self.validate(rel)
        if not self.check(f"{rel}: validate_bytes did not raise", err is None, err or ""):
            return
        self.check(f"{rel}: accepted, 120 invoices, no issues",
                   res.ok and len(res.invoices) == len(labels) and not res.issues,
                   {"ok": res.ok, "invoices": len(res.invoices), "issues": [i.as_dict() for i in res.issues][:20]})
        if not res.ok:
            return
        inv = {i.record_id: i for i in res.invoices}
        bad = []
        for lab in labels:
            i = inv.get(lab["record_id"])
            k = lab["intended_key"]
            want_exp = int(lab["expected_total"].replace(".", ""))
            if (i is None or i.row_number != lab["row_number"] or i.vendor_norm != k["vendor"]
                    or i.invoice_norm != k["invoice"] or i.currency != k["currency"]
                    or i.total_c != int(lab["declared_total"].replace(".", ""))
                    or i.expected_total_c != want_exp or i.invoice_date != lab["invoice_date"]):
                bad.append(lab["record_id"])
        self.check(f"{rel}: parsed invoices match labels (row, normalized key, date, cents)", not bad, bad[:20])

        if self.rules is None:
            self.check(f"{rel}: rules available", False, self.sut_status.get("preflight.rules"))
            return
        findings, err = self.run_rules(res.invoices)
        if not self.check(f"{rel}: run_all did not raise", err is None, err or ""):
            return
        ruleset = getattr(self.contracts, "RULESET_VERSION", None)
        dup_f = [f for f in findings if f.rule_id == DUP]
        mm_f = [f for f in findings if f.rule_id == MISMATCH]
        other = [f.rule_id for f in findings if f.rule_id not in (DUP, MISMATCH)]
        self.check(f"{rel}: no unknown rule ids", not other, other)
        self.check(f"{rel}: every finding rule_version == {ruleset}",
                   all(f.rule_version == ruleset for f in findings),
                   sorted({f.rule_version for f in findings}))
        self.check(f"{rel}: member_ids sorted tuples", all(tuple(sorted(f.member_ids)) == tuple(f.member_ids)
                                                            for f in findings))
        ids_bad = [f.finding_id for f in findings
                   if f.finding_id != self.contracts.make_finding_id(f.rule_id, f.rule_version, f.member_ids)]
        self.check(f"{rel}: finding_id == contracts.make_finding_id", not ids_bad, ids_bad[:10])
        order = [(f.rule_id, tuple(f.member_ids)) for f in findings]
        self.check(f"{rel}: findings sorted by (rule_id, member_ids)", order == sorted(order))

        # duplicate conformance
        exp_groups = {tuple(g["members"]): g for g in main["duplicate_groups"]}
        got_groups = Counter(tuple(f.member_ids) for f in dup_f)
        matched = [g for g in got_groups if g in exp_groups]
        missing = [list(g) for g in exp_groups if g not in got_groups]
        extra = [list(g) for g in got_groups if g not in exp_groups]
        dups = [list(g) for g, n in got_groups.items() if n > 1]
        self.metrics["duplicate_conformance"] = {
            "unit": "expected normalized-key groups, exact membership",
            "expected_groups": len(exp_groups), "reported_groups": len(dup_f),
            "exact_matches": len(matched), "missing": len(missing), "extra_or_partial": len(extra)}
        self.unmatched["duplicate_groups_missing"] = missing
        self.unmatched["duplicate_groups_extra_or_partial"] = extra
        self.check(f"{rel}: duplicate groups exact ({len(exp_groups)} expected)",
                   not missing and not extra and not dups, {"missing": missing, "extra": extra, "repeated": dups})
        ev_bad = []
        for f in dup_f:
            ev = f.evidence
            try:
                g = exp_groups.get(tuple(f.member_ids))
                if g and (ev["key"]["vendor"] != g["key"]["vendor"] or ev["key"]["invoice"] != g["key"]["invoice"]
                          or [m["record_id"] for m in ev["members"]] != g["members"]):
                    ev_bad.append(f.finding_id)
            except Exception as exc:
                ev_bad.append(f"{f.finding_id}: {type(exc).__name__}: {exc}")
        self.check(f"{rel}: duplicate evidence key/members match labels", not ev_bad, ev_bad[:10])

        # semantic pairs
        obl = {x["record_id"]: x["obligation_id"] for x in labels}
        pred_pairs = set()
        for f in dup_f:
            pred_pairs.update(itertools.combinations(sorted(f.member_ids), 2))
        tp = fp = fn = tn = 0
        for a, b in itertools.combinations(sorted(obl), 2):
            pos, pred = obl[a] == obl[b], (a, b) in pred_pairs
            tp += pos and pred
            fp += pred and not pos
            fn += pos and not pred
            tn += not pos and not pred
        self.metrics["semantic_pairs"] = {
            "unit": "unordered pairs among 120 valid records; positive = same hidden obligation; "
                    "predicted = both in one DUPLICATE_CANDIDATE group",
            "pairs": tp + fp + fn + tn, "TP": tp, "FP": fp, "FN": fn, "TN": tn,
            "precision": ratio(tp, tp + fp), "recall": ratio(tp, tp + fn), "fpr": ratio(fp, fp + tn)}
        self.check(f"{rel}: semantic pair counts equal planned targets",
                   (tp, fp, fn, tn) == (pt["pair_TP"], pt["pair_FP"], pt["pair_FN"], pt["pair_TN"]),
                   {"measured": [tp, fp, fn, tn],
                    "planned": [pt["pair_TP"], pt["pair_FP"], pt["pair_FN"], pt["pair_TN"]]})
        neg = main["designated_negative_pairs"]
        alerts = [p["pair_id"] for p in neg if tuple(sorted(p["members"])) in pred_pairs]
        hn_alerts = [p["pair_id"] for p in main["hard_negative_pairs"] if tuple(sorted(p["members"])) in pred_pairs]
        self.metrics["hard_negatives"] = {
            "unit": "14 designated negative pairs (12 near-duplicates + 2 legitimate same-key reuse)",
            "pairs": len(neg), "false_alerts": len(alerts), "false_alert_rate": ratio(len(alerts), len(neg)),
            "alerted_pair_ids": alerts, "near_duplicate_false_alerts": hn_alerts}
        self.check(f"{rel}: hard-negative false alerts == planned {pt['hard_negative_false_alerts']}"
                   f"/{pt['designated_negative_pairs']}, none among the 12 near-duplicates",
                   len(alerts) == pt["hard_negative_false_alerts"] and not hn_alerts,
                   {"alerted": alerts})

        # mismatches
        exp_mm = {m["record_id"]: m["delta"] for m in main["mismatches"]}
        got_mm: Dict[str, Any] = {}
        multi = []
        for f in mm_f:
            if len(f.member_ids) != 1:
                multi.append(list(f.member_ids))
                continue
            got_mm[f.member_ids[0]] = f.evidence.get("delta") if hasattr(f.evidence, "get") else None
        allids = [x["record_id"] for x in labels]
        mtp = sum(1 for r in allids if r in exp_mm and r in got_mm)
        mfp = sum(1 for r in allids if r not in exp_mm and r in got_mm)
        mfn = sum(1 for r in allids if r in exp_mm and r not in got_mm)
        mtn = len(allids) - mtp - mfp - mfn
        delta_bad = {r: {"expected": exp_mm[r], "got": got_mm[r]} for r in exp_mm if r in got_mm
                     and got_mm[r] != exp_mm[r]}
        self.metrics["mismatch"] = {
            "unit": "120 valid records", "TP": mtp, "FP": mfp, "FN": mfn, "TN": mtn,
            "precision": ratio(mtp, mtp + mfp), "recall": ratio(mtp, mtp + mfn), "fpr": ratio(mfp, mfp + mtn),
            "exact_delta_matches": mtp - len(delta_bad)}
        self.unmatched["mismatch_missing"] = sorted(set(exp_mm) - set(got_mm))
        self.unmatched["mismatch_extra"] = sorted(set(got_mm) - set(exp_mm))
        self.unmatched["mismatch_delta_differs"] = delta_bad
        self.check(f"{rel}: mismatch confusion equals planned TP{pt['mismatch_TP']}/FP0/FN0/TN{pt['mismatch_TN']}",
                   (mtp, mfp, mfn, mtn) == (pt["mismatch_TP"], pt["mismatch_FP"], pt["mismatch_FN"], pt["mismatch_TN"])
                   and not multi, {"measured": [mtp, mfp, mfn, mtn], "multi_member": multi})
        self.check(f"{rel}: mismatch deltas exact", not delta_bad, delta_bad)
        lab_by = {x["record_id"]: x for x in labels}
        ev_bad = []
        for f in mm_f:
            lab = lab_by.get(f.member_ids[0]) if f.member_ids else None
            if not lab:
                continue
            ev = f.evidence
            try:
                if (ev["expected"] != lab["expected_total"] or ev["declared"] != lab["declared_total"]
                        or any(ev[k] != lab[k] for k in ("subtotal", "tax", "shipping", "discount"))):
                    ev_bad.append(f.member_ids[0])
            except Exception as exc:
                ev_bad.append(f"{f.member_ids[0]}: {type(exc).__name__}: {exc}")
        self.check(f"{rel}: mismatch evidence components/expected/declared match labels", not ev_bad, ev_bad[:10])

        affected = {m for f in findings for m in f.member_ids}
        self.metrics["counts"] = {"findings": len(findings), "duplicate_findings": len(dup_f),
                                  "mismatch_findings": len(mm_f), "distinct_affected_rows": len(affected)}
        self.check(f"{rel}: {pt['total_findings']} findings over {pt['distinct_affected_rows']} distinct rows",
                   len(findings) == pt["total_findings"] and len(affected) == pt["distinct_affected_rows"],
                   self.metrics["counts"])

        # row-order independence (reversed data rows, same bytes otherwise)
        lines = _read(rel).split(b"\n")
        body = [ln for ln in lines[1:] if ln]
        rev = b"\n".join([lines[0]] + body[::-1]) + b"\n"
        try:
            r2 = self.imports.validate_bytes(rev)
            f2 = self.rules.run_all(r2.invoices)
            same = sorted((f.rule_id, tuple(f.member_ids)) for f in f2) == sorted(order)
            self.check(f"{rel}: reversed row order gives identical rule/member sets", r2.ok and same)
        except Exception:
            self.check(f"{rel}: reversed row order gives identical rule/member sets", False,
                       traceback.format_exc(limit=3))

    # ---- boundary extras ----
    def eval_bom_crlf(self) -> None:
        a, ea = self.validate("fixtures/out/boundary/small-lf.csv")
        b, eb = self.validate("fixtures/out/boundary/small-bom-crlf.csv")
        if ea or eb or not (a and b and a.ok and b.ok):
            self.check("boundary: BOM+CRLF copy parses identically to LF copy", False, ea or eb or "not accepted")
            return
        proj = lambda r: [(i.record_id, i.row_number, i.raw, i.vendor_norm, i.invoice_norm, i.invoice_date,
                           i.currency, i.subtotal_c, i.tax_c, i.shipping_c, i.discount_c, i.total_c)
                          for i in r.invoices]
        self.check("boundary: BOM+CRLF copy parses identically to LF copy", proj(a) == proj(b))
        self.check("boundary: BOM+CRLF copy has a different batch hash", a.sha256 != b.sha256)

    def run(self) -> int:
        if not self.sut_status:
            self.load_sut()
        for rel, meta in self.manifest["files"].items():
            if not os.path.exists(_abs(rel)):
                self.check(f"{rel}: fixture present", False, "missing; run fixtures/generator/make_fixtures.py")
        if self.imports is None:
            self.check("system under test available", False,
                       f"UNAVAILABLE: {self.sut_status}")
            return 2
        if self.contracts is None:
            self.check("contracts available", False, self.sut_status["preflight.contracts"])
            return 2
        self.eval_main()
        for rel, meta in self.manifest["files"].items():
            if meta["kind"] != "main":
                self.eval_file(rel, meta)
        self.eval_bom_crlf()
        return 0 if all(c["passed"] for c in self.checks) else 1


def source_hashes() -> Dict[str, str]:
    out = {}
    src = os.path.join(ROOT, "src")
    for dirpath, dirnames, names in os.walk(src):
        dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
        for name in sorted(names):
            p = os.path.join(dirpath, name)
            with open(p, "rb") as fh:
                out[os.path.relpath(p, ROOT).replace(os.sep, "/")] = _sha(fh.read())
    return dict(sorted(out.items()))


def write_reports(ev: Evaluator, code: int, now: datetime) -> Tuple[str, str]:
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    failures = [c for c in ev.checks if not c["passed"]]
    status = {0: "PASS", 1: "FAIL", 2: "UNAVAILABLE"}[code]
    report = {
        "label": LABEL,
        "synthetic": "SYNTHETIC DATA - invented figures, not real financial records",
        "status": status,
        "exit_code": code,
        "run_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "command": "python -m tests.evaluation.evaluate" + ("" if len(sys.argv) <= 1 else " " + " ".join(sys.argv[1:])),
        "python": sys.version.split()[0],
        "python_implementation": platform.python_implementation(),
        "sqlite": sqlite3.sqlite_version,
        "fixture_version": ev.manifest["version"],
        "fixture_seed": ev.manifest["seed"],
        "manifest": {"path": MANIFEST_REL, "sha256": ev.manifest_sha},
        "fixture_hashes": {p: m["sha256"] for p, m in ev.manifest["files"].items()},
        "ruleset": getattr(ev.contracts, "RULESET_VERSION", None),
        "source_tree": {"status": "unversioned (no git)", "excluded": "__pycache__ directories",
                        "sha256": source_hashes()},
        "system_under_test": ev.sut_status,
        "planned_targets": ev.manifest["main"]["planned_targets"],
        "measured": ev.metrics,
        "unmatched_finding_identities": ev.unmatched,
        "checks_total": len(ev.checks),
        "checks_passed": len(ev.checks) - len(failures),
        "failures": failures,
        "checks": ev.checks,
    }
    os.makedirs(REPORTS, exist_ok=True)
    js = json.dumps(report, indent=2, sort_keys=True, ensure_ascii=True, default=str) + "\n"
    md = render_md(report)
    paths = (os.path.join(REPORTS, f"eval-{stamp}.json"), os.path.join(REPORTS, f"eval-{stamp}.md"))
    for path, text in ((paths[0], js), (paths[1], md), (os.path.join(REPORTS, "latest.json"), js),
                       (os.path.join(REPORTS, "latest.md"), md)):
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
    return paths


def render_md(r: dict) -> str:
    pt, m = r["planned_targets"], r["measured"]
    L = [f"# Evaluation report: {r['fixture_version']}", "",
         f"**{r['label']}.** {r['synthetic']}. No result here supports real-world fraud detection, "
         "money saved, or private-customer accuracy.", "",
         f"- Status: **{r['status']}** ({r['checks_passed']}/{r['checks_total']} checks passed, exit {r['exit_code']})",
         f"- Run (UTC): {r['run_utc']}",
         f"- Command: `{r['command']}`",
         f"- Python {r['python']}, SQLite {r['sqlite']}",
         f"- Ruleset: {r['ruleset']}",
         f"- Manifest `{r['manifest']['path']}` sha256 `{r['manifest']['sha256']}`",
         f"- Main fixture sha256 `{r['fixture_hashes'].get('fixtures/out/main-120.csv')}`",
         f"- Source tree: {r['source_tree']['status']}; {len(r['source_tree']['sha256'])} file hashes in JSON report",
         f"- System under test: " + "; ".join(f"{k}: {v}" for k, v in r["system_under_test"].items()), ""]
    L += ["## Planned targets (from independent labels)", "",
          "| Evaluation | Planned |", "| --- | --- |",
          f"| Duplicate groups (exact membership) | {pt['duplicate_groups']} |",
          f"| Semantic pairs ({pt['pairs_total']}) TP/FP/FN/TN | {pt['pair_TP']}/{pt['pair_FP']}/{pt['pair_FN']}/{pt['pair_TN']} |",
          f"| Hard-negative false alerts | {pt['hard_negative_false_alerts']}/{pt['designated_negative_pairs']} |",
          f"| Mismatch TP/FP/FN/TN | {pt['mismatch_TP']}/{pt['mismatch_FP']}/{pt['mismatch_FN']}/{pt['mismatch_TN']} |",
          f"| Findings / distinct rows | {pt['total_findings']}/{pt['distinct_affected_rows']} |", ""]
    L += ["## Measured values", ""]
    if not m:
        L += ["Not measured (system under test unavailable or main import failed).", ""]
    else:
        L += ["| Evaluation | Unit | Measured |", "| --- | --- | --- |"]
        if "duplicate_conformance" in m:
            d = m["duplicate_conformance"]
            L.append(f"| Duplicate conformance | {d['unit']} | {d['exact_matches']}/{d['expected_groups']} exact; "
                     f"missing {d['missing']}, extra/partial {d['extra_or_partial']} |")
        if "semantic_pairs" in m:
            s = m["semantic_pairs"]
            L.append(f"| Semantic pairs | {s['pairs']} unordered pairs | TP {s['TP']}, FP {s['FP']}, FN {s['FN']}, "
                     f"TN {s['TN']}; precision {pct(s['precision'])}, recall {pct(s['recall'])}, FPR {pct(s['fpr'])} |")
        if "hard_negatives" in m:
            h = m["hard_negatives"]
            L.append(f"| Hard negatives | {h['pairs']} designated pairs | {h['false_alerts']} false alerts "
                     f"({pct(h['false_alert_rate'])}): {', '.join(h['alerted_pair_ids']) or 'none'} |")
        if "mismatch" in m:
            x = m["mismatch"]
            L.append(f"| Total mismatch | {x['unit']} | TP {x['TP']}, FP {x['FP']}, FN {x['FN']}, TN {x['TN']}; "
                     f"precision {pct(x['precision'])}, recall {pct(x['recall'])}; exact deltas {x['exact_delta_matches']} |")
        if "counts" in m:
            c = m["counts"]
            L.append(f"| Findings | main-120 | {c['findings']} ({c['duplicate_findings']} dup + "
                     f"{c['mismatch_findings']} mismatch), {c['distinct_affected_rows']} distinct rows |")
        L.append("")
    L += ["The two legitimate same-key reuse pairs are intentional semantic false alerts for human dismissal; "
          "the split-across-batches pair is a documented known limitation (batch-scoped rule).", ""]
    L += ["## Unmatched finding identities", ""]
    um = {k: v for k, v in r["unmatched_finding_identities"].items() if v}
    L += ([f"- {k}: `{json.dumps(v)}`" for k, v in um.items()] or ["None."]) + [""]
    L += ["## Failures", ""]
    if r["failures"]:
        for f in r["failures"]:
            detail = json.dumps(f["detail"], default=str)
            L.append(f"- FAIL {f['id']}: `{detail[:600]}`")
    else:
        L.append("None.")
    L.append("")
    return "\n".join(L)


def main() -> int:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    ev = Evaluator()
    try:
        code = ev.run()
    except Exception:
        ev.check("evaluator completed without crashing", False, traceback.format_exc(limit=8))
        code = 1
    if code == 0 and not all(c["passed"] for c in ev.checks):
        code = 1
    js, md = write_reports(ev, code, now)
    failures = [c for c in ev.checks if not c["passed"]]
    print(LABEL)
    if code == 2:
        print("SYSTEM UNDER TEST UNAVAILABLE:", json.dumps(ev.sut_status))
    for c in failures:
        print(f"FAIL {c['id']}: {json.dumps(c['detail'], default=str)[:400]}")
    for k, v in ev.metrics.items():
        print(f"{k}: {json.dumps(v, default=str)}")
    print(f"{len(ev.checks) - len(failures)}/{len(ev.checks)} checks passed -> "
          f"{ {0: 'PASS', 1: 'FAIL', 2: 'UNAVAILABLE'}[code] }")
    print(f"reports: {os.path.relpath(js, ROOT)}, {os.path.relpath(md, ROOT)}, reports/latest.json, reports/latest.md")
    return code


if __name__ == "__main__":
    sys.exit(main())
