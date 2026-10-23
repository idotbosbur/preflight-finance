"""Deterministic explanation templates (no AI model; plain strings).

Values returned here are *plain text*; callers escape them before rendering.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence, Tuple

from preflight import contracts

RULE_LABELS = {
    contracts.RULE_DUPLICATE: "Duplicate candidate",
    contracts.RULE_MISMATCH: "Total mismatch",
}

RULE_DESCRIPTIONS = {
    contracts.RULE_DUPLICATE: (
        "Two or more records in this batch share the same normalized vendor ID, "
        "invoice number and currency. Dates and amounts are shown as evidence; they are "
        "not part of the matching key."
    ),
    contracts.RULE_MISMATCH: (
        "The declared total differs from subtotal + tax + shipping − discount, "
        "computed exactly in integer cents. Any nonzero difference, including one cent, "
        "is reported. No tolerance is applied."
    ),
}

ACTION_LABELS = {
    "confirm": "Confirm finding",
    "dismiss": "Dismiss finding",
    "reopen": "Reopen finding",
}

ACTION_PAST = {"confirm": "Confirmed", "dismiss": "Dismissed", "reopen": "Reopened"}

ORDERING_NOTE = (
    "Ordering: open first, then rule, then record ID — no risk score, probability "
    "or savings estimate is used."
)

MEANS: Tuple[str, ...] = (
    "A deterministic rule matched the source values shown on this page.",
    "A person should compare the evidence with the original documents before deciding.",
)

DOES_NOT_MEAN: Tuple[str, ...] = (
    "A candidate is not proof of a duplicate payment, an overcharge, or fraud.",
    "The tool does not choose which record is the original or which one should be paid.",
    "Confirming or dismissing records a review judgement only; it never approves, blocks "
    "or releases a payment.",
    "Results describe synthetic data only and say nothing about accuracy on real invoices.",
)

STEPS = {
    contracts.RULE_DUPLICATE: (
        "Compare the source documents for every member record side by side (dates, line "
        "items, amounts, purchase order references).",
        "Check whether each obligation is genuine — for example a legitimate reuse of the "
        "same invoice number in a different period, a credit/re-bill, or an instalment.",
        "Verify with the vendor using an independently known contact (not details taken from "
        "the invoice itself).",
        "Check whether any member has already been paid before deciding what happens next "
        "outside this tool.",
        "Record your conclusion and the evidence you relied on in the reason field.",
    ),
    contracts.RULE_MISMATCH: (
        "Recompute the total from the source invoice: subtotal + tax + shipping − discount.",
        "Check whether shipping or a discount was omitted, double-applied or keyed incorrectly.",
        "Check for transcription errors in the declared total (transposed or dropped digits).",
        "If the source invoice itself is inconsistent, request a corrected invoice from the "
        "vendor through an independently known contact.",
        "Record your conclusion and the evidence you relied on in the reason field.",
    ),
}

GENERIC_STEPS: Tuple[str, ...] = (
    "Compare the evidence shown with the original source documents.",
    "Record your conclusion and the evidence you relied on in the reason field.",
)

HISTORY_NOTE = (
    "Application-level history; the local database owner can alter it. "
    "This is not a tamper-proof audit log."
)


def text_state(state: str) -> str:
    return {"open": "open", "confirmed": "confirmed", "dismissed": "dismissed"}.get(state, state)


def rule_label(rule_id: str) -> str:
    return RULE_LABELS.get(rule_id, rule_id)


def _ev(evidence: Mapping[str, Any], key: str, default: str = "?") -> str:
    value = evidence.get(key) if isinstance(evidence, Mapping) else None
    return default if value is None else str(value)


def delta_explanation(delta: str) -> str:
    base = "Delta = declared − expected; positive means declared total is higher."
    if delta.startswith("+"):
        return f"{base} Here the declared total is higher than expected by {delta[1:]}."
    if delta.startswith("-"):
        return f"{base} Here the declared total is lower than expected by {delta[1:]}."
    return base


def summary(rule_id: str, evidence: Mapping[str, Any], member_ids: Sequence[str]) -> str:
    """One-line plain-text summary of a finding's evidence."""
    if not isinstance(evidence, Mapping):
        evidence = {}
    if rule_id == contracts.RULE_DUPLICATE:
        key = evidence.get("key") if isinstance(evidence.get("key"), Mapping) else {}
        members = evidence.get("members")
        count = len(members) if isinstance(members, (list, tuple)) else len(member_ids)
        return (
            f"{count} records share vendor {_ev(key, 'vendor')} / invoice {_ev(key, 'invoice')}"
        )
    if rule_id == contracts.RULE_MISMATCH:
        return (
            f"Declared {_ev(evidence, 'declared')} vs expected {_ev(evidence, 'expected')} "
            f"({_ev(evidence, 'delta')})"
        )
    return f"{len(member_ids)} record(s) flagged by rule {rule_id}"


def allowed_actions(state: str) -> Tuple[str, ...]:
    """Actions permitted from ``state`` per ``contracts.ACTIONS`` (declaration order)."""
    return tuple(a for a, (prev, _next) in contracts.ACTIONS.items() if state in prev)
