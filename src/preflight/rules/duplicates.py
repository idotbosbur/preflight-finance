"""DUPLICATE_CANDIDATE rule (``invoice-v1``): exact normalized-key grouping."""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Sequence, Tuple

from preflight import contracts
from preflight.contracts import Finding, Invoice
from preflight.money import format_cents


def _member(inv: Invoice) -> dict:
    return {
        "record_id": inv.record_id,
        "row": inv.row_number,
        "raw_vendor": inv.raw_field("vendor_id"),
        "raw_invoice": inv.raw_field("invoice_number"),
        "invoice_date": inv.invoice_date,
        "total": format_cents(inv.total_c),
    }


def run(invoices: Sequence[Invoice]) -> List[Finding]:
    """One finding per (vendor, invoice number, currency) group of 2+ rows.

    Date and amounts are evidence only, never part of the key.
    """
    groups: Dict[Tuple[str, str, str], List[Invoice]] = defaultdict(list)
    for inv in invoices:
        groups[(inv.vendor_norm, inv.invoice_norm, inv.currency)].append(inv)

    findings = []
    for (vendor, invoice, currency), members in groups.items():
        if len(members) < 2:
            continue
        members = sorted(members, key=lambda m: m.record_id)
        member_ids = tuple(m.record_id for m in members)
        findings.append(Finding(
            finding_id=contracts.make_finding_id(
                contracts.RULE_DUPLICATE, contracts.RULESET_VERSION, member_ids),
            rule_id=contracts.RULE_DUPLICATE,
            rule_version=contracts.RULESET_VERSION,
            member_ids=member_ids,
            evidence={
                "key": {"vendor": vendor, "invoice": invoice, "currency": currency},
                "members": [_member(m) for m in members],
            },
        ))
    findings.sort(key=lambda f: f.member_ids)
    return findings
