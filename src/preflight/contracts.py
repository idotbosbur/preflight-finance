"""Frozen shared contracts for Stage 1 (version ``contracts-v1``).

Owned by Preflight-Lead. Workers must not edit this file; request changes via
SendMessage. Everything here is pure data / pure functions with no I/O.

Money: every ``*_c`` field is integer cents. Anything crossing an interface
boundary (evidence JSON, HTML, reports) carries amounts as decimal strings
produced by :func:`preflight.money.format_cents` / ``format_delta``.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Sequence, Tuple

CONTRACTS_VERSION = "contracts-v1"
RULESET_VERSION = "invoice-v1"

CSV_HEADER: Tuple[str, ...] = (
    "record_id",
    "vendor_id",
    "invoice_number",
    "invoice_date",
    "currency",
    "subtotal",
    "tax",
    "shipping",
    "discount",
    "total",
)
AMOUNT_FIELDS: Tuple[str, ...] = ("subtotal", "tax", "shipping", "discount", "total")
MAX_BYTES = 1_048_576
MAX_ROWS = 1000
MAX_LISTED_ISSUES = 500

RULE_DUPLICATE = "DUPLICATE_CANDIDATE"
RULE_MISMATCH = "TOTAL_MISMATCH"

STATE_OPEN = "open"
STATE_CONFIRMED = "confirmed"
STATE_DISMISSED = "dismissed"
STATES = (STATE_OPEN, STATE_CONFIRMED, STATE_DISMISSED)

# action -> (allowed previous states, next state)
ACTIONS: Mapping[str, Tuple[Tuple[str, ...], str]] = {
    "confirm": ((STATE_OPEN,), STATE_CONFIRMED),
    "dismiss": ((STATE_OPEN,), STATE_DISMISSED),
    "reopen": ((STATE_CONFIRMED, STATE_DISMISSED), STATE_OPEN),
}
REASON_MAX = 500
REVIEWER_MAX = 80

SYNTHETIC_LABEL = "SYNTHETIC DATA — invented figures, not real financial records"

# Validation issue codes (see docs/stage1-implementation-plan.md §8).
ISSUE_CODES = (
    "EMPTY_FILE",
    "FILE_TOO_LARGE",
    "ENCODING",
    "MALFORMED_CSV",
    "HEADER_MISMATCH",
    "NO_DATA_ROWS",
    "TOO_MANY_ROWS",
    "ROW_SHAPE",
    "FIELD_REQUIRED",
    "ID_FORMAT",
    "DUPLICATE_RECORD_ID",
    "INVOICE_NUMBER_FORMAT",
    "DATE_FORMAT",
    "DATE_INVALID",
    "CURRENCY_UNSUPPORTED",
    "AMOUNT_REQUIRED",
    "AMOUNT_FORMAT",
    "DISCOUNT_EXCEEDS_CHARGES",
)

ASCII_WHITESPACE = " \t\n\r\x0b\x0c"


def normalize_identifier(raw: str) -> str:
    """Trim outer ASCII whitespace and uppercase ASCII letters only.

    Punctuation and leading zeros are preserved: ``INV-01``, ``INV01`` and
    ``INV-1`` stay distinct.
    """
    trimmed = raw.strip(ASCII_WHITESPACE)
    return "".join(chr(ord(c) - 32) if "a" <= c <= "z" else c for c in trimmed)


@dataclass(frozen=True)
class Invoice:
    """One validated synthetic invoice row (immutable)."""

    record_id: str
    row_number: int  # 1-based data row (header excluded)
    raw: Tuple[str, ...]  # the 10 original cell strings, CSV_HEADER order
    vendor_norm: str
    invoice_norm: str
    invoice_date: str  # ISO YYYY-MM-DD
    currency: str  # always "USD" in Stage 1
    subtotal_c: int
    tax_c: int
    shipping_c: int
    discount_c: int
    total_c: int

    def raw_field(self, name: str) -> str:
        return self.raw[CSV_HEADER.index(name)]

    @property
    def expected_total_c(self) -> int:
        return self.subtotal_c + self.tax_c + self.shipping_c - self.discount_c


def make_finding_id(rule_id: str, rule_version: str, member_ids: Sequence[str]) -> str:
    """Stable finding identity within a batch."""
    material = "|".join([rule_id, rule_version, *member_ids])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class Finding:
    """Rule output. ``member_ids`` sorted ascending; ``evidence`` JSON-safe.

    DUPLICATE_CANDIDATE evidence::

        {"key": {"vendor": str, "invoice": str, "currency": str},
         "members": [{"record_id", "row": int, "raw_vendor", "raw_invoice",
                      "invoice_date", "total"}...]}   # sorted by record_id

    TOTAL_MISMATCH evidence::

        {"record_id", "row": int, "subtotal", "tax", "shipping", "discount",
         "expected", "declared", "delta"}   # decimal strings; delta signed
    """

    finding_id: str
    rule_id: str
    rule_version: str
    member_ids: Tuple[str, ...]
    evidence: Mapping[str, Any] = field(hash=False, compare=False)


@dataclass(frozen=True)
class ValidationIssue:
    row: Optional[int]  # 1-based data row; None for file-level issues
    field: Optional[str]
    code: str
    message: str

    def as_dict(self) -> dict:
        return {"row": self.row, "field": self.field, "code": self.code, "message": self.message}


@dataclass(frozen=True)
class ImportResult:
    ok: bool
    sha256: str
    issues: Tuple[ValidationIssue, ...]
    invoices: Tuple[Invoice, ...]
    issue_count: int = 0  # total issues found (issues list may be capped)


# ---- View models handed to src/preflight/views (lead builds them from storage) ----


@dataclass(frozen=True)
class BatchSummary:
    batch_id: str
    display_name: str
    sha256: str
    imported_at_utc: str  # ISO 8601, e.g. 2026-10-21T12:00:00Z
    ruleset: str
    row_count: int
    finding_count: int
    duplicate_count: int
    mismatch_count: int
    open_count: int
    confirmed_count: int
    dismissed_count: int


@dataclass(frozen=True)
class FindingView:
    batch_id: str
    finding_id: str
    rule_id: str
    rule_version: str
    member_ids: Tuple[str, ...]
    state: str
    seq: int  # number of review events so far (0 = never reviewed)
    evidence: Mapping[str, Any] = field(hash=False, compare=False)


@dataclass(frozen=True)
class ReviewEventView:
    seq: int
    prev_state: str
    next_state: str
    action: str
    reason: str
    reviewer: str
    at_utc: str


def case_sort_key(f: FindingView) -> tuple:
    """Transparent ordering: open first, then rule ID, then member IDs."""
    return (0 if f.state == STATE_OPEN else 1, f.rule_id, f.member_ids)


# ---- Roadmap modules (all twelve retained; shown in the UI) ----


@dataclass(frozen=True)
class ModuleStatus:
    number: int
    name: str
    stage1: str  # what exists in Stage 1 ("Not in Stage 1" if nothing)
    limit: str  # honest limitation / guardrail


MODULES: Tuple[ModuleStatus, ...] = (
    ModuleStatus(1, "Financial Loss Firewall", "Duplicate-candidate and total-mismatch checks with human decisions",
                 "Review aid only; never blocks, approves or releases a payment"),
    ModuleStatus(2, "Contract Intelligence", "Not in Stage 1 (synthetic clause scenarios planned for Stage 2)",
                 "Future findings must cite exact clauses and dated calculations"),
    ModuleStatus(3, "Vendor Risk Intelligence", "Stable vendor identifiers only",
                 "A flag is not fraud proof; bank-detail changes need independent verification"),
    ModuleStatus(4, "Cross-System Reconciliation", "Source-row provenance and batch file hashes",
                 "No accounting, bank or PO system is connected"),
    ModuleStatus(5, "Financial Investigation AI", "Deterministic evidence and arithmetic explanations",
                 "No AI model is used in Stage 1; a model may never change findings or approve money"),
    ModuleStatus(6, "Predictive Budget Monitoring", "Not in Stage 1", "Planned for Stage 4 after synthetic feasibility"),
    ModuleStatus(7, "Cash Flow Intelligence", "Not in Stage 1", "Planned for Stage 4; forecasts must be separated from observed cash"),
    ModuleStatus(8, "Revenue Leakage Detection", "Not in Stage 1", "Planned for Stage 4"),
    ModuleStatus(9, "Accounting Audit Agent", "Not in Stage 1", "Planned for Stage 4; no statutory-audit claim"),
    ModuleStatus(10, "Financial Scenario Simulator", "Not in Stage 1", "Planned for Stage 4; assumptions separated from actuals"),
    ModuleStatus(11, "Autonomous Finance Workflows", "Review state machine with append-only history",
                 "Human oversight required; no autonomous money approval"),
    ModuleStatus(12, "Executive AI Advisor", "Synthetic batch summary report",
                 "Counts of synthetic findings only; no savings or accuracy claims"),
)
