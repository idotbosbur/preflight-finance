#!/usr/bin/env python3
"""Deterministic synthetic fixture generator, version ``invoice-fixtures-v1``.

Run from the project root::

    python fixtures/generator/make_fixtures.py

SYNTHETIC DATA: every vendor, invoice and amount is invented. This is a
synthetic benchmark; planned targets are labels, not measured results.

Independence: this module never imports ``preflight`` (neither the rules nor
the importer). Normalisation, arithmetic and labels are specified here from
docs/architecture-proposal.md and docs/stage1-implementation-plan.md §8/§10
and computed with plain integer cents.

Determinism: one ``random.Random(20261021)`` drawn in a fixed order, fixed
dates, no wall clock, UTF-8, LF line endings (except the one deliberate
BOM+CRLF boundary copy), rows sorted by record_id, sorted JSON keys.
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import sys
from collections import Counter
from datetime import date, timedelta
from typing import Dict, List, Optional, Sequence, Tuple

VERSION = "invoice-fixtures-v1"
SEED = 20261021
HEADER: Tuple[str, ...] = (
    "record_id", "vendor_id", "invoice_number", "invoice_date", "currency",
    "subtotal", "tax", "shipping", "discount", "total",
)
MAX_BYTES = 1_048_576
MAX_ROWS = 1000
ASCII_WS = " \t\n\r\x0b\x0c"
BASE_DATE = date(2026, 1, 1)
LABEL = "synthetic benchmark; planned targets shown separately from measured values"

OUT_DIR = "fixtures/out"
MANIFEST_PATH = "fixtures/manifest/invoice-fixtures-v1.json"


# --------------------------------------------------------------------------
# Independent helpers (deliberately NOT imported from preflight)
# --------------------------------------------------------------------------


def norm(raw: str) -> str:
    """Trim outer ASCII whitespace; uppercase ASCII letters only."""
    t = raw.strip(ASCII_WS)
    return "".join(chr(ord(c) - 32) if "a" <= c <= "z" else c for c in t)


def money(cents: int) -> str:
    if cents < 0:
        raise ValueError("negative amount cannot be a CSV cell")
    return f"{cents // 100}.{cents % 100:02d}"


def signed(cents: int) -> str:
    """Signed decimal string: +0.01 / -0.01 / 0.00."""
    if cents > 0:
        return "+" + money(cents)
    if cents < 0:
        return "-" + money(-cents)
    return "0.00"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _needs_quote(cell: str) -> bool:
    if any(ch in cell for ch in ',"\r\n'):
        return True
    return bool(cell) and (cell[0] in ASCII_WS or cell[-1] in ASCII_WS)


def _cell(cell: str) -> str:
    if _needs_quote(cell):
        return '"' + cell.replace('"', '""') + '"'
    return cell


def encode_csv(rows: Sequence[Sequence[str]], header: Sequence[str] = HEADER,
               newline: str = "\n", bom: bool = False) -> bytes:
    lines = [",".join(_cell(c) for c in header)]
    lines.extend(",".join(_cell(c) for c in r) for r in rows)
    text = newline.join(lines) + newline
    data = text.encode("utf-8")
    return (b"\xef\xbb\xbf" + data) if bom else data


class Row:
    """One synthetic row: integer cents plus optional raw-cell overrides."""

    def __init__(self, vendor: str, invoice: str, d: str, sub: int, tax: int,
                 ship: int, disc: int, declared: Optional[int] = None,
                 currency: str = "USD", record_id: Optional[str] = None) -> None:
        self.record_id = record_id
        self.vendor = vendor
        self.invoice = invoice
        self.date = d
        self.currency = currency
        self.sub, self.tax, self.ship, self.disc = sub, tax, ship, disc
        self.expected = sub + tax + ship - disc
        self.declared = self.expected if declared is None else declared
        self.overrides: Dict[str, str] = {}
        self.labels: Dict[str, object] = {}

    def key(self) -> Tuple[str, str, str]:
        return (norm(self.vendor), norm(self.invoice), norm(self.currency))

    def cells(self) -> List[str]:
        base = {
            "record_id": self.record_id or "",
            "vendor_id": self.vendor,
            "invoice_number": self.invoice,
            "invoice_date": self.date,
            "currency": self.currency,
            "subtotal": money(self.sub),
            "tax": money(self.tax),
            "shipping": money(self.ship),
            "discount": money(self.disc),
            "total": money(self.declared) if self.declared >= 0 else "0.00",
        }
        base.update(self.overrides)
        return [base[h] for h in HEADER]


def by_id(rows: List[Row]) -> List[Row]:
    return sorted(rows, key=lambda r: r.record_id)


# --------------------------------------------------------------------------
# Main 120-row benchmark
# --------------------------------------------------------------------------


class Ctx:
    def __init__(self) -> None:
        self.rng = random.Random(SEED)
        self.vendors = [f"V-{n:04d}" for n in range(1001, 1041)]
        self._inv = 40001
        self._obl = 1

    def inv(self) -> str:
        s = f"INV-{self._inv}"
        self._inv += 1
        return s

    def obl(self) -> str:
        s = f"OBL-{self._obl:04d}"
        self._obl += 1
        return s

    def vendor(self) -> str:
        return self.rng.choice(self.vendors)

    def rdate(self) -> str:
        return (BASE_DATE + timedelta(days=self.rng.randint(0, 272))).isoformat()

    def amounts(self, force_ship: bool = False, force_disc: bool = False) -> Tuple[int, int, int, int]:
        r = self.rng
        sub = r.randint(1500, 2_500_000)
        tax_opts = [0, sub * 6 // 100, sub * 825 // 10000]
        tax = tax_opts[r.randrange(3)]
        if force_ship:
            ship = r.randint(500, 7500)
        else:
            ship = r.randint(500, 7500) if r.randrange(3) == 0 else 0
        if force_disc:
            disc = r.randint(100, sub // 10)
        else:
            disc = r.randint(100, sub // 10) if r.randrange(4) == 0 else 0
        return sub, tax, ship, disc


def _label(row: Row, category: str, sub: str, obligation: str) -> Row:
    row.labels.update(category=category, subcategory=sub, obligation_id=obligation)
    return row


def build_main(ctx: Ctx):
    rng = ctx.rng
    rows: List[Row] = []
    hard_pairs: List[Tuple[str, str, Row, Row]] = []
    dup_groups: List[Tuple[str, bool, List[Row]]] = []

    # ---- clean: 12 hard-negative pairs (24 rows) ----
    for i in range(4):  # same invoice number, different vendors
        v1, v2 = rng.sample(ctx.vendors, 2)
        num = f"INV-{7001 + i}"
        a = _label(Row(v1, num, ctx.rdate(), *ctx.amounts()), "clean", "hard_negative_same_number_diff_vendor", ctx.obl())
        b = _label(Row(v2, num, ctx.rdate(), *ctx.amounts()), "clean", "hard_negative_same_number_diff_vendor", ctx.obl())
        rows += [a, b]
        hard_pairs.append((f"HN-A{i + 1}", "same_number_different_vendor", a, b))
    for i in range(4):  # same vendor/date/amount, different numbers
        v = ctx.vendor()
        d = ctx.rdate()
        amt = ctx.amounts()
        a = _label(Row(v, f"INV-{7101 + 2 * i}", d, *amt), "clean", "hard_negative_same_vendor_date_amount", ctx.obl())
        b = _label(Row(v, f"INV-{7102 + 2 * i}", d, *amt), "clean", "hard_negative_same_vendor_date_amount", ctx.obl())
        rows += [a, b]
        hard_pairs.append((f"HN-B{i + 1}", "same_vendor_date_amount_different_number", a, b))
    variants = [("INV-01", "INV01"), ("INV-1", "INV-001"), ("PO-0042", "PO-42"), ("2026_17", "2026-17")]
    for i, (n1, n2) in enumerate(variants):  # punctuation / leading zeros, same vendor
        v = ctx.vendors[30 + i]  # dedicated vendors V-1031..V-1034
        d = ctx.rdate()
        amt = ctx.amounts()
        a = _label(Row(v, n1, d, *amt), "clean", "hard_negative_punctuation_leading_zero", ctx.obl())
        b = _label(Row(v, n2, d, *amt), "clean", "hard_negative_punctuation_leading_zero", ctx.obl())
        rows += [a, b]
        hard_pairs.append((f"HN-C{i + 1}", "punctuation_or_leading_zero", a, b))

    # ---- clean: 56 other controls ----
    specials = [
        ("zero_all_fields", (0, 0, 0, 0)),
        ("decimal_control_0.10+0.20=0.30", (10, 20, 0, 0)),
        ("discount_equals_charges", (5000, 300, 200, 5500)),
        ("subtotal_only", (123456, 0, 0, 0)),
    ]
    for sub, amt in specials:
        rows.append(_label(Row(ctx.vendor(), ctx.inv(), ctx.rdate(), *amt), "clean", sub, ctx.obl()))
    for _ in range(56 - len(specials)):
        rows.append(_label(Row(ctx.vendor(), ctx.inv(), ctx.rdate(), *ctx.amounts()), "clean", "control", ctx.obl()))

    # ---- 16 standalone mismatches ----
    for kind in ("one_cent_high", "one_cent_low", "omitted_shipping", "discount_added"):
        for _ in range(4):
            sub, tax, ship, disc = ctx.amounts(force_ship=kind == "omitted_shipping",
                                                force_disc=kind == "discount_added")
            expected = sub + tax + ship - disc
            declared = {
                "one_cent_high": expected + 1,
                "one_cent_low": expected - 1,
                "omitted_shipping": expected - ship,
                "discount_added": expected + 2 * disc,
            }[kind]
            rows.append(_label(Row(ctx.vendor(), ctx.inv(), ctx.rdate(), sub, tax, ship, disc, declared),
                               "mismatch", kind, ctx.obl()))

    # ---- 10 genuine repeated-obligation pairs ----
    for i in range(10):
        v, num, d = ctx.vendor(), ctx.inv(), ctx.rdate()
        sub, tax, ship, disc = ctx.amounts()
        expected = sub + tax + ship - disc
        declared = expected + 1 if i >= 8 else expected
        sub_label = "genuine_repeat_both_one_cent_high" if i >= 8 else "genuine_repeat"
        ob = ctx.obl()
        a = _label(Row(v, num, d, sub, tax, ship, disc, declared), "duplicate_genuine", sub_label, ob)
        if i in (0, 1, 2):
            v2, num2, d2 = v.lower(), num, d                 # raw case differs
        elif i in (3, 4):
            v2, num2, d2 = v, f"  {num.lower()} ", d          # outer whitespace + case
        elif i in (5, 6):
            v2, num2 = v, num
            d2 = (date.fromisoformat(d) + timedelta(days=rng.randint(7, 30))).isoformat()  # resubmitted later
        else:
            v2, num2, d2 = v, num, d                         # identical raw keys
        b = _label(Row(v2, num2, d2, sub, tax, ship, disc, declared), "duplicate_genuine", sub_label, ob)
        rows += [a, b]
        dup_groups.append((f"DG-{i + 1:02d}", True, [a, b]))

    # ---- 2 legitimate same-key reuse pairs (different obligations/periods) ----
    for i in range(2):
        v = ctx.vendors[35 + i]
        num = f"INV-{6001 + i}"
        a = _label(Row(v, num, f"2025-0{3 + i}-31" if i == 0 else "2025-06-30", *ctx.amounts()),
                   "legitimate_reuse", "same_key_different_period", ctx.obl())
        b = _label(Row(v, num, f"2026-0{3 + i}-31" if i == 0 else "2026-06-30", *ctx.amounts()),
                   "legitimate_reuse", "same_key_different_period", ctx.obl())
        rows += [a, b]
        dup_groups.append((f"DG-{11 + i:02d}", False, [a, b]))

    assert len(rows) == 120, len(rows)

    # ---- record IDs: shuffled so categories interleave; then sort ----
    ids = [f"R-{n:04d}" for n in range(1, 121)]
    rng.shuffle(ids)
    for r, rid in zip(rows, ids):
        r.record_id = rid

    # ---- assertions across ALL categories ----
    keys = Counter(r.key() for r in rows)
    designated = {g[2][0].key() for g in dup_groups}
    for g in dup_groups:
        assert len({m.key() for m in g[2]}) == 1, g[0]
    for k, n in keys.items():
        if k in designated:
            assert n == 2, (k, n)
        else:
            assert n == 1, ("unexpected shared normalized key", k, n)
    assert len(designated) == 12
    for _, _, a, b in hard_pairs:
        assert a.key() != b.key(), (a.vendor, a.invoice, b.vendor, b.invoice)
        assert a.declared == a.expected and b.declared == b.expected
    for r in rows:
        assert r.disc <= r.sub + r.tax + r.ship
        assert r.declared >= 0
        assert r.labels["category"] in ("clean", "mismatch", "duplicate_genuine", "legitimate_reuse")
    obligations = Counter(r.labels["obligation_id"] for r in rows)
    assert sum(1 for n in obligations.values() if n == 2) == 10
    assert all(n in (1, 2) for n in obligations.values())
    return by_id(rows), hard_pairs, dup_groups


# --------------------------------------------------------------------------
# Small helper rows for rejection / boundary files
# --------------------------------------------------------------------------


def small_rows(prefix: str, start_vendor: int, start_inv: int, n: int, d0: str = "2026-05-01") -> List[Row]:
    out = []
    for i in range(n):
        sub = 10000 + 2500 * i
        out.append(Row(f"V-{start_vendor + i}", f"INV-{start_inv + i}", d0, sub, sub * 6 // 100, 0, 0,
                       record_id=f"{prefix}-{i + 1:04d}"))
    return out


def issue(code: str, row: Optional[int], field: Optional[str], check: Sequence[str]) -> dict:
    return {"code": code, "row": row, "field": field, "check": list(check)}


CRF = ("code", "row", "field")
CODE_ONLY = ("code",)


def rejected(issues: List[dict], note: str) -> dict:
    return {"accepted": False, "issue_count": len(issues), "issues": issues, "invoice_count": 0, "note": note}


def accepted(n: int, groups: List[List[str]], mismatches: List[dict], note: str) -> dict:
    return {"accepted": True, "issue_count": 0, "issues": [], "invoice_count": n,
            "duplicate_groups": [sorted(g) for g in sorted(groups)],
            "mismatches": sorted(mismatches, key=lambda m: m["record_id"]), "note": note}


def mm(r: Row) -> dict:
    return {"record_id": r.record_id, "delta": signed(r.declared - r.expected)}


# --------------------------------------------------------------------------
# Build everything in memory
# --------------------------------------------------------------------------


def build() -> Dict[str, bytes]:
    """Return {project-relative path: bytes} for every fixture plus the manifest."""
    ctx = Ctx()
    main_rows, hard_pairs, dup_groups = build_main(ctx)
    files: Dict[str, bytes] = {}
    expect: Dict[str, dict] = {}
    kinds: Dict[str, str] = {}

    def put(rel: str, data: bytes, kind: str, exp: dict) -> None:
        path = f"{OUT_DIR}/{rel}"
        assert path not in files
        files[path] = data
        expect[path] = exp
        kinds[path] = kind

    # ---- main-120 ----
    main_mismatches = [mm(r) for r in main_rows if r.declared != r.expected]
    put("main-120.csv", encode_csv([r.cells() for r in main_rows]), "main",
        accepted(120, [[m.record_id for m in g[2]] for g in dup_groups], main_mismatches,
                 "120 valid rows; full labels under manifest.main"))

    # ---- 8 one-row invalid files ----
    invalid_specs = [
        ("missing-vendor-id", "vendor_id", "", "FIELD_REQUIRED"),
        ("missing-invoice-number", "invoice_number", "", "FIELD_REQUIRED"),
        ("non-usd-currency", "currency", "EUR", "CURRENCY_UNSUPPORTED"),
        ("three-decimal-total", "total", "123.456", "AMOUNT_FORMAT"),
        ("formatted-subtotal", "subtotal", "$1,234.56", "AMOUNT_FORMAT"),
        ("negative-tax", "tax", "-5.00", "AMOUNT_FORMAT"),
        ("impossible-date", "invoice_date", "2026-02-30", "DATE_INVALID"),
        ("blank-total", "total", "", "AMOUNT_REQUIRED"),
    ]
    invalid_rows: List[Tuple[Row, str, str, str]] = []
    for i, (name, field, raw, code) in enumerate(invalid_specs):
        sub = 123456 if name == "formatted-subtotal" else 20000 + 1111 * i
        tax = 0 if name == "formatted-subtotal" else sub * 6 // 100
        r = Row(f"V-{2001 + i}", f"INV-{90001 + i}", "2026-04-15", sub, tax, 0, 0, record_id=f"X-{i + 1:04d}")
        r.overrides[field] = raw
        invalid_rows.append((r, name, field, code))
        put(f"invalid/{name}.csv", encode_csv([r.cells()]), "invalid",
            rejected([issue(code, 1, field, CRF)], f"one-row invalid: {field}={raw!r}"))

    # ---- mixed-128 ----
    mixed = by_id(main_rows + [t[0] for t in invalid_rows])
    pos = {r.record_id: i + 1 for i, r in enumerate(mixed)}
    mixed_issues = [issue(code, pos[r.record_id], field, CRF) for r, _, field, code in invalid_rows]
    mixed_issues.sort(key=lambda x: x["row"])
    put("mixed-128.csv", encode_csv([r.cells() for r in mixed]), "mixed",
        rejected(mixed_issues, "atomic policy: 120 valid + 8 invalid rows; all 8 reported, zero accepted"))

    # ---- extra rejection fixtures ----
    base = small_rows("S", 3001, 30001, 3)

    rows = small_rows("S", 3001, 30001, 3)
    rows[1].sub, rows[1].tax, rows[1].ship, rows[1].disc = 1000, 0, 0, 1001
    rows[1].expected = -1
    rows[1].declared = 0
    put("reject/discount-exceeds-charges.csv", encode_csv([r.cells() for r in rows]), "reject",
        rejected([issue("DISCOUNT_EXCEEDS_CHARGES", 2, "discount", CRF)], "discount 10.01 > charges 10.00"))

    rows = small_rows("S", 3001, 30001, 3)
    rows[0].overrides["discount"] = "-0.00"
    put("reject/negative-zero-amount.csv", encode_csv([r.cells() for r in rows]), "reject",
        rejected([issue("AMOUNT_FORMAT", 1, "discount", CRF)], "signed zero -0.00"))

    rows = small_rows("S", 3001, 30001, 3)
    rows[1].ship = 100
    rows[1].expected += 100
    rows[1].declared = rows[1].expected
    rows[1].overrides["shipping"] = "+1.00"
    put("reject/plus-sign-amount.csv", encode_csv([r.cells() for r in rows]), "reject",
        rejected([issue("AMOUNT_FORMAT", 2, "shipping", CRF)], "explicit plus sign +1.00"))

    good = encode_csv([r.cells() for r in base]).decode("utf-8").split("\n")
    bad_line = good[2].replace("INV-30002", '"INV-30002"x', 1)
    assert bad_line != good[2]
    good_mal = good[:2] + [bad_line] + good[3:]
    put("reject/malformed-quote.csv", "\n".join(good_mal).encode("utf-8"), "reject",
        rejected([issue("MALFORMED_CSV", None, None, CODE_ONLY)], 'characters after closing quote: "INV-30002"x'))

    drop = HEADER.index("shipping")
    hdr = [h for h in HEADER if h != "shipping"]
    put("reject/header-missing-column.csv",
        encode_csv([[c for j, c in enumerate(r.cells()) if j != drop] for r in base], header=hdr), "reject",
        rejected([issue("HEADER_MISMATCH", None, None, CODE_ONLY)], "shipping column missing"))

    hdr = list(HEADER)
    hdr[HEADER.index("tax")] = "subtotal"
    put("reject/header-duplicate-column.csv", encode_csv([r.cells() for r in base], header=hdr), "reject",
        rejected([issue("HEADER_MISMATCH", None, None, CODE_ONLY)], "subtotal header repeated in place of tax"))

    put("reject/header-extra-column.csv",
        encode_csv([r.cells() + ["n/a"] for r in base], header=list(HEADER) + ["notes"]), "reject",
        rejected([issue("HEADER_MISMATCH", None, None, CODE_ONLY)], "extra notes column"))

    cells = [r.cells() for r in base]
    cells[1] = cells[1] + ["EXTRA"]
    put("reject/row-extra-cell.csv", encode_csv(cells), "reject",
        rejected([issue("ROW_SHAPE", 2, None, ("code", "row"))], "row 2 has 11 cells"))

    rows = small_rows("S", 3001, 30001, 3)
    rows[2].record_id = rows[1].record_id
    put("reject/duplicate-record-id.csv", encode_csv([r.cells() for r in rows]), "reject",
        rejected([issue("DUPLICATE_RECORD_ID", 3, "record_id", CRF)], "rows 2 and 3 share S-0002; reported at the repeat"))

    many = small_rows("T", 4001, 50001, MAX_ROWS + 1)
    data = encode_csv([r.cells() for r in many])
    assert len(data) <= MAX_BYTES
    put("reject/too-many-rows.csv", data, "reject",
        rejected([issue("TOO_MANY_ROWS", None, None, CODE_ONLY)], "1,001 data rows, under 1 MiB"))

    big = small_rows("B", 6001, 60001, MAX_ROWS)
    pad = " " * 530
    for r in big:
        r.invoice = pad + r.invoice + pad
    data = encode_csv([r.cells() for r in big])
    assert len(data) > MAX_BYTES, len(data)
    put("reject/file-too-large.csv", data, "reject",
        rejected([issue("FILE_TOO_LARGE", None, None, CODE_ONLY)],
                 f"{len(data)} bytes > {MAX_BYTES}, {MAX_ROWS} rows padded with quoted outer whitespace"))

    put("reject/empty-file.csv", b"", "reject",
        rejected([issue("EMPTY_FILE", None, None, CODE_ONLY)], "0 bytes"))

    put("reject/header-only.csv", encode_csv([]), "reject",
        rejected([issue("NO_DATA_ROWS", None, None, CODE_ONLY)], "header line only"))

    raw = encode_csv([r.cells() for r in base])
    bad = raw.replace(b"V-3002", b"V-3\xff02", 1)
    assert bad != raw
    put("reject/invalid-utf8.csv", bad, "reject",
        rejected([issue("ENCODING", None, None, CODE_ONLY)], "byte 0xFF in vendor_id"))

    # ---- boundary fixtures ----
    r = Row("V-5001", "INV-70001", "2026-06-01", 99_999_999_999, 0, 0, 0, record_id="M-0001")
    put("boundary/max-amount.csv", encode_csv([r.cells()]), "boundary",
        accepted(1, [], [], "subtotal and total 999999999.99; valid, no finding"))

    r = Row("V-5002", "INV-70002", "2026-06-02", 99_999_999_999, 99_999_999_999, 0, 0,
            declared=99_999_999_999, record_id="M-0001")
    assert r.expected == 199_999_999_998
    put("boundary/expected-above-max.csv", encode_csv([r.cells()]), "boundary",
        accepted(1, [], [mm(r)], "expected total above 999999999.99 is still valid; mismatch reported (§8)"))

    trip = [Row("V-5101", "INV-71001", "2026-06-10", 45000, 2700, 0, 0, record_id="G-0001"),
            Row("v-5101", "INV-71001", "2026-06-11", 45000, 2700, 0, 0, record_id="G-0002"),
            Row("V-5101", "inv-71001", "2026-06-12", 45000, 2700, 0, 0, record_id="G-0003"),
            Row("V-5101", "INV-71002", "2026-06-10", 45000, 2700, 0, 0, record_id="G-0004")]
    put("boundary/triple-group.csv", encode_csv([x.cells() for x in trip]), "boundary",
        accepted(4, [["G-0001", "G-0002", "G-0003"]], [], "one group of 3; G-0004 distinct number"))

    cw = [Row("v-5201", "inv-77", "2026-07-01", 30000, 0, 500, 0, record_id="C-0001"),
          Row(" V-5201 ", "\tINV-77 ", "2026-07-01", 30000, 0, 500, 0, record_id="C-0002")]
    assert cw[0].key() == cw[1].key()
    put("boundary/case-whitespace-duplicate.csv", encode_csv([x.cells() for x in cw]), "boundary",
        accepted(2, [["C-0001", "C-0002"]], [], "case and outer ASCII whitespace differ; one group"))

    small = small_rows("L", 5301, 72001, 3)
    small_cells = [x.cells() for x in small]
    lf = encode_csv(small_cells)
    crlf = encode_csv(small_cells, newline="\r\n", bom=True)
    assert sha256(lf) != sha256(crlf)
    put("boundary/small-lf.csv", lf, "boundary", accepted(3, [], [], "LF reference copy"))
    put("boundary/small-bom-crlf.csv", crlf, "boundary",
        accepted(3, [], [], "UTF-8 BOM + CRLF copy of small-lf.csv: same invoices, different file hash"))

    sa = Row("V-5401", "INV-73001", "2026-08-01", 88000, 5280, 0, 0, record_id="P-0001")
    sb = Row("V-5401", "INV-73001", "2026-08-01", 88000, 5280, 0, 0, record_id="P-0002")
    put("boundary/split-batch-a.csv", encode_csv([sa.cells()]), "boundary",
        accepted(1, [], [], "KNOWN LIMITATION: duplicate split across batches is not detected (batch-scoped rule)"))
    put("boundary/split-batch-b.csv", encode_csv([sb.cells()]), "boundary",
        accepted(1, [], [], "KNOWN LIMITATION: duplicate split across batches is not detected (batch-scoped rule)"))
    put("boundary/split-combined-control.csv", encode_csv([sa.cells(), sb.cells()]), "boundary",
        accepted(2, [["P-0001", "P-0002"]], [], "control: same two rows in one batch form one group"))

    # ---- main-120 labels ----
    label_rows = []
    for i, r in enumerate(main_rows):
        k = r.key()
        label_rows.append({
            "record_id": r.record_id,
            "row_number": i + 1,
            "category": r.labels["category"],
            "subcategory": r.labels["subcategory"],
            "obligation_id": r.labels["obligation_id"],
            "raw_vendor_id": r.vendor,
            "raw_invoice_number": r.invoice,
            "invoice_date": r.date,
            "intended_key": {"vendor": k[0], "invoice": k[1], "currency": k[2]},
            "subtotal": money(r.sub), "tax": money(r.tax), "shipping": money(r.ship), "discount": money(r.disc),
            "expected_total": money(r.expected),
            "declared_total": money(r.declared),
            "is_mismatch": r.declared != r.expected,
            "expected_delta": signed(r.declared - r.expected),
        })
    groups = []
    for gid, genuine, members in dup_groups:
        k = members[0].key()
        groups.append({"group_id": gid, "genuine": genuine,
                       "kind": "genuine_repeated_obligation" if genuine else "legitimate_same_key_reuse",
                       "key": {"vendor": k[0], "invoice": k[1], "currency": k[2]},
                       "members": sorted(m.record_id for m in members)})
    hn = [{"pair_id": pid, "type": t, "members": sorted([a.record_id, b.record_id])}
          for pid, t, a, b in hard_pairs]
    reuse_pairs = [{"pair_id": g["group_id"], "type": "legitimate_same_key_reuse", "members": g["members"]}
                   for g in groups if not g["genuine"]]
    cat_counts = Counter(x["category"] for x in label_rows)
    n = len(label_rows)
    genuine_pairs = sum(1 for g in groups if g["genuine"])
    candidate_pairs = sum(len(g["members"]) * (len(g["members"]) - 1) // 2 for g in groups)
    total_pairs = n * (n - 1) // 2
    affected = {m for g in groups for m in g["members"]} | {x["record_id"] for x in label_rows if x["is_mismatch"]}
    n_mm = sum(1 for x in label_rows if x["is_mismatch"])

    manifest = {
        "version": VERSION,
        "seed": SEED,
        "label": LABEL,
        "synthetic": "SYNTHETIC DATA - invented figures, not real financial records",
        "generator": "fixtures/generator/make_fixtures.py",
        "normalization": "trim outer ASCII whitespace (space, \\t, \\n, \\r, \\x0b, \\x0c); uppercase ASCII a-z only; "
                         "punctuation and leading zeros preserved; key = (vendor_id, invoice_number, currency)",
        "arithmetic": "integer cents; expected = subtotal + tax + shipping - discount; delta = declared - expected",
        "issue_check_semantics": "each expected issue lists the attributes compared in 'check'; codes always compared; "
                                 "issue sets must match exactly (no missing, no extra)",
        "main": {
            "file": f"{OUT_DIR}/main-120.csv",
            "rows": label_rows,
            "category_counts": dict(sorted(cat_counts.items())),
            "duplicate_groups": groups,
            "mismatches": main_mismatches,
            "hard_negative_pairs": hn,
            "designated_negative_pairs": hn + reuse_pairs,
            "planned_targets": {
                "duplicate_groups": len(groups),
                "mismatch_findings": n_mm,
                "total_findings": len(groups) + n_mm,
                "distinct_affected_rows": len(affected),
                "pair_unit": "unordered pairs of the 120 valid records",
                "pairs_total": total_pairs,
                "pair_TP": genuine_pairs, "pair_FP": candidate_pairs - genuine_pairs, "pair_FN": 0,
                "pair_TN": total_pairs - candidate_pairs,
                "hard_negative_false_alerts": len(reuse_pairs),
                "designated_negative_pairs": len(hn) + len(reuse_pairs),
                "mismatch_TP": n_mm, "mismatch_FP": 0, "mismatch_FN": 0, "mismatch_TN": n - n_mm,
            },
        },
        "files": {p: {"sha256": sha256(files[p]), "bytes": len(files[p]), "kind": kinds[p], "expected": expect[p]}
                  for p in sorted(files)},
    }
    files[MANIFEST_PATH] = (json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=True) + "\n").encode("utf-8")
    return files


def write(files: Dict[str, bytes], root: str) -> None:
    for rel, data in sorted(files.items()):
        path = os.path.join(root, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)


def project_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> int:
    files = build()
    write(files, project_root())
    for rel in sorted(files):
        print(f"{sha256(files[rel])}  {len(files[rel]):>8}  {rel}")
    print(f"{VERSION}: wrote {len(files)} files (seed {SEED})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
