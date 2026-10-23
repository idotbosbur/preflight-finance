"""TOTAL_MISMATCH rule (``invoice-v1``): exact integer-cent arithmetic check."""

from __future__ import annotations

from typing import List, Sequence

from preflight import contracts
from preflight.contracts import Finding, Invoice
from preflight.money import format_cents, format_delta


def run(invoices: Sequence[Invoice]) -> List[Finding]:
    """One finding per row whose declared total differs from
    ``subtotal + tax + shipping - discount`` by any amount (no tolerance)."""
    findings = []
    for inv in invoices:
        expected = inv.expected_total_c
        delta = inv.total_c - expected
        if delta == 0:
            continue
        member_ids = (inv.record_id,)
        findings.append(Finding(
            finding_id=contracts.make_finding_id(
                contracts.RULE_MISMATCH, contracts.RULESET_VERSION, member_ids),
            rule_id=contracts.RULE_MISMATCH,
            rule_version=contracts.RULESET_VERSION,
            member_ids=member_ids,
            evidence={
                "record_id": inv.record_id,
                "row": inv.row_number,
                "subtotal": format_cents(inv.subtotal_c),
                "tax": format_cents(inv.tax_c),
                "shipping": format_cents(inv.shipping_c),
                "discount": format_cents(inv.discount_c),
                "expected": format_cents(expected),
                "declared": format_cents(inv.total_c),
                "delta": format_delta(delta),
            },
        ))
    findings.sort(key=lambda f: f.member_ids)
    return findings
