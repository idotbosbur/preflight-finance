"""Capture the PYTHON REFERENCE behaviour as a compatibility oracle for the browser port.

Run from the project root:  python web/tests/fixtures/reference-parity/capture_reference.py

For every file under ``files/`` (edge fixtures from make_parity_fixtures.py), the two public demo
files, and every fixture listed in the fixture manifest, this runs
``preflight.imports.validate_bytes`` + ``preflight.rules.run_all`` and records exactly what the
Python reference produced, including ``contracts.make_finding_id`` and ``storage.batch_id_for``.

Output: ``expected.json`` labelled ``"source": "python-reference-parity"``. This is NOT the
independent truth (that is fixtures/manifest/invoice-fixtures-v1.json); it records Python's
observed behaviour so the TypeScript port can be checked for parity. Nothing here is hand-edited.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "src"))

from preflight import contracts  # noqa: E402
from preflight.imports import validate_bytes  # noqa: E402
from preflight.rules import run_all  # noqa: E402
from preflight.storage import batch_id_for  # noqa: E402

MANIFEST_REL = "fixtures/manifest/invoice-fixtures-v1.json"


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def capture(data: bytes) -> dict:
    res = validate_bytes(data)
    out = {
        "sha256": res.sha256,
        "bytes": len(data),
        "batch_id": batch_id_for(res.sha256),
        "ok": res.ok,
        "issue_count": res.issue_count,
        "issues": [{"code": i.code, "row": i.row, "field": i.field} for i in res.issues],
        "accepted_invoice_count": len(res.invoices),
        "invoices": [{
            "record_id": i.record_id, "row_number": i.row_number, "raw": list(i.raw),
            "vendor_norm": i.vendor_norm, "invoice_norm": i.invoice_norm, "invoice_date": i.invoice_date,
            "currency": i.currency, "subtotal_c": i.subtotal_c, "tax_c": i.tax_c, "shipping_c": i.shipping_c,
            "discount_c": i.discount_c, "total_c": i.total_c,
        } for i in res.invoices],
        "findings": [],
    }
    if res.ok:
        for f in run_all(res.invoices):
            assert f.finding_id == contracts.make_finding_id(f.rule_id, f.rule_version, f.member_ids)
            out["findings"].append({
                "rule_id": f.rule_id, "rule_version": f.rule_version, "member_ids": list(f.member_ids),
                "finding_id": f.finding_id, "evidence": f.evidence,
            })
    return out


def main() -> int:
    with open(os.path.join(ROOT, *MANIFEST_REL.split("/")), "rb") as fh:
        manifest_bytes = fh.read()
    manifest = json.loads(manifest_bytes.decode("utf-8"))

    cases = {}
    files_dir = os.path.join(HERE, "files")
    for name in sorted(os.listdir(files_dir)):
        with open(os.path.join(files_dir, name), "rb") as fh:
            cases[name] = capture(fh.read())

    demo = {}
    for name in ("main-120.csv", "mixed-128.csv"):
        with open(os.path.join(ROOT, "web", "public", "demo", name), "rb") as fh:
            data = fh.read()
        want = manifest["files"][f"fixtures/out/{name}"]["sha256"]
        if _sha(data) != want:
            print(f"FATAL: web/public/demo/{name} sha256 {_sha(data)} != manifest {want}", file=sys.stderr)
            return 1
        demo[name] = capture(data)

    manifest_fixtures = {}
    for rel in sorted(manifest["files"]):
        with open(os.path.join(ROOT, *rel.split("/")), "rb") as fh:
            manifest_fixtures[rel] = capture(fh.read())

    doc = {
        "source": "python-reference-parity",
        "note": ("Observed Python reference behaviour (validate_bytes + run_all + make_finding_id + "
                 "batch_id_for). Compatibility oracle only; independent truth labels live in the "
                 "fixture manifest. Issue messages are intentionally not compared (code/row/field only)."),
        "captured_utc": datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "command": "python web/tests/fixtures/reference-parity/capture_reference.py",
        "python": sys.version.split()[0],
        "python_implementation": platform.python_implementation(),
        "ruleset": contracts.RULESET_VERSION,
        "manifest_sha256": _sha(manifest_bytes),
        "cases": cases,
        "demo": demo,
        "manifest_fixtures": manifest_fixtures,
    }
    path = os.path.join(HERE, "expected.json")
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=True) + "\n")
    for name, c in cases.items():
        print(f"{name}: ok={c['ok']} issues={c['issue_count']} "
              f"{[(i['code'], i['row'], i['field']) for i in c['issues'][:3]]} "
              f"invoices={c['accepted_invoice_count']} findings={len(c['findings'])}")
    for name, c in demo.items():
        print(f"demo/{name}: ok={c['ok']} issues={c['issue_count']} invoices={c['accepted_invoice_count']} "
              f"findings={len(c['findings'])} batch_id={c['batch_id']}")
    print(f"manifest fixtures captured: {len(manifest_fixtures)}; wrote {os.path.relpath(path, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
