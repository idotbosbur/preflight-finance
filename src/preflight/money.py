"""Integer-cent money handling.

Amounts enter as strings with exactly two fractional ASCII digits and are held
as integer cents. No float or rounding is ever applied. ``re.ASCII`` and an
explicit ``[0-9]`` class keep Unicode digits (e.g. Arabic-Indic or full-width)
from being accepted.
"""

from __future__ import annotations

import re

AMOUNT_PATTERN = re.compile(r"[0-9]{1,9}\.[0-9]{2}", re.ASCII)
MAX_AMOUNT_CENTS = 99_999_999_999  # 999,999,999.99


class AmountError(ValueError):
    """Raised when a string is not a valid Stage 1 amount."""


def parse_cents(text: str) -> int:
    """Parse ``"123.45"`` into ``12345``. Raises :class:`AmountError`."""
    if not isinstance(text, str) or AMOUNT_PATTERN.fullmatch(text) is None:
        raise AmountError(f"not a nonnegative amount with exactly two decimals: {text!r}")
    whole, frac = text.split(".")
    return int(whole) * 100 + int(frac)


def format_cents(cents: int) -> str:
    """Format integer cents as a plain decimal string (``-5`` -> ``"-0.05"``)."""
    if not isinstance(cents, int) or isinstance(cents, bool):
        raise TypeError("cents must be int")
    sign = "-" if cents < 0 else ""
    whole, frac = divmod(abs(cents), 100)
    return f"{sign}{whole}.{frac:02d}"


def format_delta(cents: int) -> str:
    """Format a signed difference: ``1`` -> ``"+0.01"``, ``-1`` -> ``"-0.01"``, ``0`` -> ``"0.00"``."""
    if cents > 0:
        return "+" + format_cents(cents)
    return format_cents(cents)
