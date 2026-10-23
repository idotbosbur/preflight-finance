"""Write the reference-parity edge fixtures with exact bytes (synthetic data only).

Run from anywhere:  python web/tests/fixtures/reference-parity/make_parity_fixtures.py

These files exercise CPython ``csv.reader(strict=True)`` / ``validate_bytes`` edge behaviour.
Their expected outputs are NOT hand-written: ``capture_reference.py`` runs the Python reference
on them and records what it does (source "python-reference-parity"). They are a compatibility
oracle for the browser port, separate from the independent truth labels in the fixture manifest.
"""

from __future__ import annotations

import os

HERE = os.path.dirname(os.path.abspath(__file__))
FILES_DIR = os.path.join(HERE, "files")

HEADER = "record_id,vendor_id,invoice_number,invoice_date,currency,subtotal,tax,shipping,discount,total"
BOM = "﻿"

# A small accepted base batch: one duplicate group (P-0001/P-0002, case differs) that is also a
# one-cent mismatch on P-0002, plus a 0.10 + 0.20 = 0.30 control.
BASE_ROWS = [
    "P-0001,V-1,INV-1,2026-01-15,USD,100.00,8.00,0.00,0.00,108.00",
    "P-0002,v-1,inv-1,2026-02-15,usd,100.00,8.00,0.00,0.00,108.01",
    "P-0003,V-2,INV-9,2026-03-01,USD,0.10,0.20,0.00,0.00,0.30",
]


def lines(rows, eol="\n", trailing=True, header=HEADER):
    text = eol.join([header] + list(rows))
    return text + (eol if trailing else "")


def row(rid, vendor="V-7", number="INV-7", date="2026-04-01", cur="USD",
        sub="10.00", tax="0.00", ship="0.00", disc="0.00", total="10.00"):
    return ",".join([rid, vendor, number, date, cur, sub, tax, ship, disc, total])


def build() -> dict:
    f: dict = {}
    f["single-bom.csv"] = (BOM + lines(BASE_ROWS)).encode("utf-8")
    f["double-bom.csv"] = (BOM + BOM + lines(BASE_ROWS)).encode("utf-8")
    f["crlf.csv"] = lines(BASE_ROWS, eol="\r\n").encode("utf-8")
    f["cr-only.csv"] = lines(BASE_ROWS, eol="\r").encode("utf-8")
    f["crlf-no-trailing-newline.csv"] = lines(BASE_ROWS, eol="\r\n", trailing=False).encode("utf-8")
    # Quoted CRLF inside a field: trailing CRLF is outer ASCII whitespace (trimmed for the key),
    # but the raw cell keeps it (visible in duplicate evidence raw_vendor).
    f["quoted-crlf-in-field.csv"] = lines([
        BASE_ROWS[0],
        'P-0002,"v-1\r\n",inv-1,2026-02-15,usd,100.00,8.00,0.00,0.00,108.01',
        BASE_ROWS[2],
    ], eol="\r\n").encode("utf-8")
    f["quoted-comma.csv"] = lines([
        BASE_ROWS[0],
        'P-0002,V-3,"INV,2",2026-02-15,USD,1.00,0.00,0.00,0.00,1.00',
        '"P-0004","V-4","INV-4","2026-02-16","USD","1.00","0.00","0.00","0.00","1.00"',
    ]).encode("utf-8")
    f["blank-line-mid.csv"] = lines([BASE_ROWS[0], "", BASE_ROWS[2]]).encode("utf-8")
    f["blank-line-trailing.csv"] = (lines(BASE_ROWS) + "\n").encode("utf-8")
    f["eof-inside-quotes.csv"] = (lines(BASE_ROWS[:2]) + 'P-0003,V-2,"INV-9,2026-03-01,USD,0.10,0.20,0.00,0.00,0.30\n').encode("utf-8")
    f["char-after-closing-quote.csv"] = lines([
        BASE_ROWS[0], 'P-0002,V-1,"INV-2"x,2026-02-15,USD,1.00,0.00,0.00,0.00,1.00']).encode("utf-8")
    f["bare-quote-unquoted-field.csv"] = lines([
        BASE_ROWS[0], 'P-0002,V-1,INV"2,2026-02-15,USD,1.00,0.00,0.00,0.00,1.00']).encode("utf-8")
    f["nul-in-field.csv"] = lines([
        BASE_ROWS[0], "P-0002,V-1,INV-2\x00,2026-02-15,USD,1.00,0.00,0.00,0.00,1.00"]).encode("utf-8")
    # Field limits in CODE POINTS (U+1F600 is 4 UTF-8 bytes, 2 UTF-16 units).
    astral = "\U0001F600"
    f["field-at-limit-astral.csv"] = lines([
        BASE_ROWS[0], row("P-0002", number=astral * 131072)]).encode("utf-8")
    f["field-over-limit-astral.csv"] = lines([
        BASE_ROWS[0], row("P-0002", number=astral * 131073)]).encode("utf-8")
    f["field-over-limit-ascii.csv"] = lines([
        BASE_ROWS[0], row("P-0002", number="A" * 131073)]).encode("utf-8")
    f["bad-header-then-unterminated-quote.csv"] = (lines(BASE_ROWS[:1], header=HEADER.replace("tax", "vat"))
                                                   + 'P-0002,"V-1,INV-2\n').encode("utf-8")
    f["bad-header-only-error.csv"] = lines(BASE_ROWS[:1], header=HEADER.replace("tax", "vat")).encode("utf-8")
    many = [row(f"N-{i:04d}", number=f"INV-{i:04d}") for i in range(1, 1001)]
    f["rows-1001-malformed-after-1000.csv"] = lines(
        many + ['N-1001,V-7,"INV-1001"x,2026-04-01,USD,10.00,0.00,0.00,0.00,10.00']).encode("utf-8")
    f["rows-1001-well-formed.csv"] = lines(
        many + [row("N-1001", number="INV-1001")]).encode("utf-8")
    f["rows-1000-exact.csv"] = lines(many).encode("utf-8")
    f["negative-zero.csv"] = lines([BASE_ROWS[0], row("P-0002", disc="-0.00")]).encode("utf-8")
    f["plus-sign.csv"] = lines([BASE_ROWS[0], row("P-0002", ship="+1.00", total="11.00")]).encode("utf-8")
    f["year-0000.csv"] = lines([BASE_ROWS[0], row("P-0002", date="0000-01-01")]).encode("utf-8")
    f["year-0001.csv"] = lines([BASE_ROWS[0], row("P-0002", date="0001-01-01")]).encode("utf-8")
    f["feb-30.csv"] = lines([BASE_ROWS[0], row("P-0002", date="2026-02-30")]).encode("utf-8")
    f["leap-days.csv"] = lines([row("P-0001", date="2024-02-29"), row("P-0002", date="2025-02-29", number="INV-8"),
                                row("P-0003", date="1900-02-29", number="INV-9"),
                                row("P-0004", date="2000-02-29", number="INV-10")]).encode("utf-8")
    f["date-whitespace.csv"] = lines([row("P-0001", date=" 2026-04-01")]).encode("utf-8")
    f["dup-id-after-row-shape.csv"] = lines([
        "P-0001,V-1,INV-1,2026-01-15,USD,100.00,8.00,0.00,108.00",  # 9 cells
        BASE_ROWS[0],
    ]).encode("utf-8")
    f["unicode-digit-amount.csv"] = lines([
        row("P-0001", sub="١٠.٠٠"),        # Arabic-Indic digits
        row("P-0002", number="INV-8", tax="１.００"),  # full-width digits
    ]).encode("utf-8")
    f["nbsp-padded-identifier.csv"] = lines([
        row("P-0001", vendor=" V-1"),
        row("P-0002", number="INV-8 "),
        row(" P-0003", number="INV-9"),
    ]).encode("utf-8")
    # Ordering: code-unit order, case-sensitive, shorter prefix first ("B" < "a" < "a-1" < "b").
    f["sort-order.csv"] = lines([
        row("b", vendor="K", number="X1"),
        row("B", vendor="k", number="x1"),
        row("a-1", vendor="K", number="X1", total="10.01"),
        row("a", vendor="K", number=" X1 "),
        row("Z9", vendor="Q", number="Q1", total="9.99"),
        row("Z10", vendor="Q", number="Q1"),
        row("A", vendor="A", number="A1", total="0.00"),
    ]).encode("utf-8")
    f["issue-cap-600.csv"] = lines([row(f"C-{i:04d}", vendor="", number=f"INV-{i}") for i in range(1, 601)]
                                   ).encode("utf-8")
    f["multi-issue-row.csv"] = lines([
        "P-0001,,,2026-13-01,EUR,1.0,,x,-1.00,",
        "P-0002,V-1,INV-1,2026-01-01,USD,1.00,0.00,0.00,1.01,0.00",
    ]).encode("utf-8")
    f["discount-equals-charges.csv"] = lines([row("P-0001", sub="5.00", tax="3.00", ship="2.00",
                                                  disc="10.00", total="0.00")]).encode("utf-8")
    f["only-bom.csv"] = BOM.encode("utf-8")
    f["only-newline.csv"] = b"\n"
    return f


def main() -> None:
    os.makedirs(FILES_DIR, exist_ok=True)
    for name, data in build().items():
        assert len(data) <= 1_048_576, (name, len(data))
        with open(os.path.join(FILES_DIR, name), "wb") as fh:
            fh.write(data)
        print(f"{name}: {len(data)} bytes")


if __name__ == "__main__":
    main()
