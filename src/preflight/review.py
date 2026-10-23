"""Validation of human review submissions (confirm / dismiss / reopen).

A decision records that the reviewer agrees a finding merits attention (or
not). It never approves, blocks or releases a payment.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Mapping, Optional

from . import contracts as c

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


@dataclass(frozen=True)
class ReviewInput:
    action: str
    reason: str
    reviewer: str
    expected_seq: int


def parse_review_form(form: Mapping[str, str]) -> tuple[Optional[ReviewInput], List[str]]:
    """Return ``(ReviewInput, [])`` or ``(None, [error messages])``."""
    errors: List[str] = []
    action = form.get("action", "")
    if action not in c.ACTIONS:
        errors.append("Choose confirm, dismiss or reopen.")

    reason = form.get("reason", "").replace("\r\n", "\n").replace("\r", "\n").strip(c.ASCII_WHITESPACE)
    if not reason:
        errors.append("A reason is required for every decision.")
    elif len(reason) > c.REASON_MAX:
        errors.append(f"The reason must be at most {c.REASON_MAX} characters.")
    elif _CONTROL.search(reason):
        errors.append("The reason contains unsupported control characters.")

    reviewer = form.get("reviewer", "").strip(c.ASCII_WHITESPACE)
    if not reviewer:
        errors.append("Enter your name or initials (self-declared).")
    elif len(reviewer) > c.REVIEWER_MAX:
        errors.append(f"The reviewer label must be at most {c.REVIEWER_MAX} characters.")
    elif _CONTROL.search(reviewer) or "\n" in reviewer or "\t" in reviewer:
        errors.append("The reviewer label must be a single line of text.")

    seq_text = form.get("expected_seq", "")
    expected_seq = int(seq_text) if re.fullmatch(r"[0-9]{1,9}", seq_text, re.ASCII) else -1
    if expected_seq < 0:
        errors.append("The form is missing its review sequence; reload the page and try again.")

    if errors:
        return None, errors
    return ReviewInput(action, reason, reviewer, expected_seq), []
