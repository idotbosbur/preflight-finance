"""Deterministic invoice rules (``invoice-v1``). Pure functions, no I/O."""

from __future__ import annotations

from typing import List, Sequence

from preflight.contracts import Finding, Invoice
from preflight.rules import duplicates, totals

RULES = (duplicates, totals)


def run_all(invoices: Sequence[Invoice]) -> List[Finding]:
    """Run every rule; findings sorted by ``(rule_id, member_ids)``."""
    findings = [f for rule in RULES for f in rule.run(invoices)]
    return sorted(findings, key=lambda f: (f.rule_id, f.member_ids))
