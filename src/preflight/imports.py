"""Strict, atomic validation of one synthetic invoice CSV batch.

``validate_bytes`` takes the original uploaded bytes (BOM and line endings
intact, so the SHA-256 identifies the exact file) and returns an
:class:`~preflight.contracts.ImportResult`. If any problem exists, ``ok`` is
False and ``invoices`` is empty: the whole file is rejected, never partially
accepted.
"""

from __future__ import annotations

import csv
import datetime as _dt
import hashlib
import io
import re
from typing import List, Optional

from . import contracts as c
from .money import AmountError, parse_cents

ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}", re.ASCII)
INVOICE_NUMBER_PATTERN = re.compile(r"[A-Za-z0-9_\-/.]{1,64}", re.ASCII)
DATE_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", re.ASCII)
BOM = b"\xef\xbb\xbf"


class _Issues:
    def __init__(self) -> None:
        self.items: List[c.ValidationIssue] = []
        self.count = 0

    def add(self, row: Optional[int], field: Optional[str], code: str, message: str) -> None:
        self.count += 1
        if len(self.items) < c.MAX_LISTED_ISSUES:
            self.items.append(c.ValidationIssue(row, field, code, message))


def _reject(sha: str, issues: _Issues) -> c.ImportResult:
    return c.ImportResult(ok=False, sha256=sha, issues=tuple(issues.items), invoices=(), issue_count=issues.count)


def _check_header(header: List[str], issues: _Issues) -> None:
    if tuple(header) == c.CSV_HEADER:
        return
    seen, problems = set(), []
    for name in header:
        if name in seen:
            problems.append(f"duplicate column {name!r}")
        seen.add(name)
    missing = [h for h in c.CSV_HEADER if h not in seen]
    extra = [h for h in header if h not in c.CSV_HEADER]
    if missing:
        problems.append("missing " + ", ".join(missing))
    if extra:
        problems.append("unexpected " + ", ".join(repr(e) for e in extra))
    if not problems:
        problems.append("columns are out of order")
    issues.add(None, None, "HEADER_MISMATCH",
               "Header must be exactly: " + ",".join(c.CSV_HEADER) + " (" + "; ".join(problems) + ")")


def _identifier(value: str, row: int, field: str, pattern: re.Pattern, code: str, issues: _Issues) -> Optional[str]:
    trimmed = value.strip(c.ASCII_WHITESPACE)
    if trimmed == "":
        issues.add(row, field, "FIELD_REQUIRED", f"{field} is required")
        return None
    if pattern.fullmatch(trimmed) is None:
        allowed = "letters, digits, '-', '_'" if pattern is ID_PATTERN else "letters, digits, '-', '_', '/', '.'"
        issues.add(row, field, code, f"{field} must be 1-64 ASCII {allowed}")
        return None
    return trimmed


def _row(cells: List[str], row: int, issues: _Issues) -> Optional[c.Invoice]:
    start = issues.count
    values = dict(zip(c.CSV_HEADER, cells))

    record_id = _identifier(values["record_id"], row, "record_id", ID_PATTERN, "ID_FORMAT", issues)
    vendor = _identifier(values["vendor_id"], row, "vendor_id", ID_PATTERN, "ID_FORMAT", issues)
    number = _identifier(values["invoice_number"], row, "invoice_number", INVOICE_NUMBER_PATTERN,
                         "INVOICE_NUMBER_FORMAT", issues)

    date_text = values["invoice_date"]
    if date_text == "":
        issues.add(row, "invoice_date", "FIELD_REQUIRED", "invoice_date is required")
    elif DATE_PATTERN.fullmatch(date_text) is None:
        issues.add(row, "invoice_date", "DATE_FORMAT", "invoice_date must be YYYY-MM-DD")
    else:
        try:
            _dt.date.fromisoformat(date_text)
        except ValueError:
            issues.add(row, "invoice_date", "DATE_INVALID", f"{date_text} is not a real calendar date")

    currency = values["currency"].strip(c.ASCII_WHITESPACE)
    if currency == "":
        issues.add(row, "currency", "FIELD_REQUIRED", "currency is required")
    elif c.normalize_identifier(currency) != "USD":
        issues.add(row, "currency", "CURRENCY_UNSUPPORTED", "Only USD is supported in Stage 1")

    cents = {}
    for name in c.AMOUNT_FIELDS:
        text = values[name]
        if text == "":
            issues.add(row, name, "AMOUNT_REQUIRED", f"{name} is required")
            continue
        try:
            cents[name] = parse_cents(text)
        except AmountError:
            issues.add(row, name, "AMOUNT_FORMAT",
                       f"{name} must be a nonnegative amount like 1234.56 (two decimals, no sign, "
                       f"symbol, separator or spaces; max 999999999.99)")

    if all(k in cents for k in ("subtotal", "tax", "shipping", "discount")):
        if cents["discount"] > cents["subtotal"] + cents["tax"] + cents["shipping"]:
            issues.add(row, "discount", "DISCOUNT_EXCEEDS_CHARGES",
                       "discount must not exceed subtotal + tax + shipping")

    if issues.count != start:
        return None
    return c.Invoice(
        record_id=record_id,
        row_number=row,
        raw=tuple(cells),
        vendor_norm=c.normalize_identifier(vendor),
        invoice_norm=c.normalize_identifier(number),
        invoice_date=date_text,
        currency="USD",
        subtotal_c=cents["subtotal"],
        tax_c=cents["tax"],
        shipping_c=cents["shipping"],
        discount_c=cents["discount"],
        total_c=cents["total"],
    )


def validate_bytes(data: bytes) -> c.ImportResult:
    """Validate an uploaded CSV file. Pure: no I/O, no persistence."""
    sha = hashlib.sha256(data).hexdigest()
    issues = _Issues()

    if len(data) == 0:
        issues.add(None, None, "EMPTY_FILE", "The file is empty")
        return _reject(sha, issues)
    if len(data) > c.MAX_BYTES:
        issues.add(None, None, "FILE_TOO_LARGE", f"The file exceeds {c.MAX_BYTES} bytes (1 MiB)")
        return _reject(sha, issues)

    body = data[len(BOM):] if data.startswith(BOM) else data
    try:
        text = body.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        issues.add(None, None, "ENCODING", f"The file is not valid UTF-8 (byte offset {exc.start})")
        return _reject(sha, issues)

    try:
        rows = list(csv.reader(io.StringIO(text, newline=""), strict=True))
    except csv.Error as exc:
        issues.add(None, None, "MALFORMED_CSV", f"CSV could not be parsed: {exc}")
        return _reject(sha, issues)

    if not rows:
        issues.add(None, None, "NO_DATA_ROWS", "The file has no header or data rows")
        return _reject(sha, issues)
    _check_header(rows[0], issues)
    if issues.count:
        return _reject(sha, issues)

    data_rows = rows[1:]
    if not data_rows:
        issues.add(None, None, "NO_DATA_ROWS", "The file has a header but no invoice rows")
        return _reject(sha, issues)
    if len(data_rows) > c.MAX_ROWS:
        issues.add(None, None, "TOO_MANY_ROWS", f"{len(data_rows)} rows; at most {c.MAX_ROWS} allowed per batch")
        return _reject(sha, issues)

    invoices: List[c.Invoice] = []
    first_seen = {}
    for index, cells in enumerate(data_rows, start=1):
        # Register the source key first so duplicates are reported even next to malformed rows.
        record_id = cells[0].strip(c.ASCII_WHITESPACE) if cells else ""  # case-sensitive
        duplicate_of = None
        if record_id and ID_PATTERN.fullmatch(record_id):
            duplicate_of = first_seen.get(record_id)
            first_seen.setdefault(record_id, index)
        if not cells:
            issues.add(index, None, "ROW_SHAPE",
                       "Row is a blank line; remove blank lines (including at the end of the file)")
            continue
        if len(cells) != len(c.CSV_HEADER):
            issues.add(index, None, "ROW_SHAPE",
                       f"Row has {len(cells)} cells; expected {len(c.CSV_HEADER)}")
            continue
        invoice = _row(cells, index, issues)
        if duplicate_of is not None:
            issues.add(index, "record_id", "DUPLICATE_RECORD_ID",
                       f"record_id {record_id!r} already used on row {duplicate_of}")
            continue
        if invoice is not None:
            invoices.append(invoice)

    if issues.count:
        return _reject(sha, issues)
    return c.ImportResult(ok=True, sha256=sha, issues=(), invoices=tuple(invoices), issue_count=0)
