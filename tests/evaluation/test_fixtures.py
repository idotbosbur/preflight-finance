"""Self-check of invoice-fixtures-v1 (synthetic benchmark).

Independent of the system under test: no ``preflight`` import at all. Labels
are re-derived from the CSV bytes with this file's own parsing and integer
arithmetic, then compared with the manifest.
"""

from __future__ import annotations

import csv
import hashlib
import importlib.util
import io
import itertools
import json
import os
import unittest
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GEN_PATH = os.path.join(ROOT, "fixtures", "generator", "make_fixtures.py")
MANIFEST = os.path.join(ROOT, "fixtures", "manifest", "invoice-fixtures-v1.json")
OUT = os.path.join(ROOT, "fixtures", "out")
WS = " \t\n\r\x0b\x0c"
HEADER = ["record_id", "vendor_id", "invoice_number", "invoice_date", "currency",
          "subtotal", "tax", "shipping", "discount", "total"]


def _load_generator():
    spec = importlib.util.spec_from_file_location("make_fixtures_selfcheck", GEN_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _read(rel: str) -> bytes:
    with open(os.path.join(ROOT, *rel.split("/")), "rb") as fh:
        return fh.read()


def _n(s: str) -> str:
    return "".join(chr(ord(c) - 32) if "a" <= c <= "z" else c for c in s.strip(WS))


def _cents(s: str) -> int:
    whole, frac = s.split(".")
    assert whole.isdigit() and frac.isdigit() and len(frac) == 2, s
    return int(whole) * 100 + int(frac)


def _signed(c: int) -> str:
    sign = "+" if c > 0 else ("-" if c < 0 else "")
    return f"{sign}{abs(c) // 100}.{abs(c) % 100:02d}"


def _rows(rel: str):
    text = _read(rel).decode("utf-8")
    reader = csv.reader(io.StringIO(text, newline=""), strict=True)
    header = next(reader)
    return header, [dict(zip(header, r)) for r in reader]


class FixtureSelfCheck(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gen = _load_generator()
        cls.built = cls.gen.build()
        with open(MANIFEST, "rb") as fh:
            cls.manifest = json.loads(fh.read().decode("utf-8"))
        cls.header, cls.main = _rows("fixtures/out/main-120.csv")

    # ---- determinism / hashes ----
    def test_regeneration_is_byte_identical(self):
        again = self.gen.build()
        self.assertEqual(sorted(again), sorted(self.built))
        for rel, data in self.built.items():
            self.assertEqual(again[rel], data, rel)
            self.assertEqual(_read(rel), data, f"on-disk file differs from regeneration: {rel}")

    def test_no_stray_files_and_manifest_hashes(self):
        on_disk = set()
        for dirpath, _, names in os.walk(OUT):
            for name in names:
                on_disk.add(os.path.relpath(os.path.join(dirpath, name), ROOT).replace(os.sep, "/"))
        self.assertEqual(on_disk, set(self.manifest["files"]))
        for rel, meta in self.manifest["files"].items():
            data = _read(rel)
            self.assertEqual(hashlib.sha256(data).hexdigest(), meta["sha256"], rel)
            self.assertEqual(len(data), meta["bytes"], rel)
        self.assertEqual(self.manifest["version"], "invoice-fixtures-v1")
        self.assertEqual(self.manifest["seed"], 20261021)

    def test_format_lf_utf8_sorted(self):
        for rel, meta in self.manifest["files"].items():
            data = _read(rel)
            if rel.endswith("small-bom-crlf.csv"):
                self.assertTrue(data.startswith(b"\xef\xbb\xbf"))
                self.assertEqual(data.count(b"\r\n"), data.count(b"\n"))
                lf = _read("fixtures/out/boundary/small-lf.csv")
                self.assertEqual(data[3:].replace(b"\r\n", b"\n"), lf)
                self.assertNotEqual(meta["sha256"], self.manifest["files"]["fixtures/out/boundary/small-lf.csv"]["sha256"])
                continue
            self.assertNotIn(b"\r", data, rel)
            if rel.endswith("invalid-utf8.csv"):
                with self.assertRaises(UnicodeDecodeError):
                    data.decode("utf-8")
                continue
            data.decode("utf-8")
        self.assertEqual(self.header, HEADER)
        ids = [r["record_id"] for r in self.main]
        self.assertEqual(ids, sorted(ids))

    # ---- main-120 labels, recomputed independently ----
    def test_counts_and_categories(self):
        self.assertEqual(len(self.main), 120)
        self.assertEqual(len({r["record_id"] for r in self.main}), 120)
        labels = self.manifest["main"]["rows"]
        self.assertEqual([x["record_id"] for x in labels], [r["record_id"] for r in self.main])
        cats = Counter(x["category"] for x in labels)
        self.assertEqual(cats, Counter(clean=80, mismatch=16, duplicate_genuine=20, legitimate_reuse=4))
        for lab, row in zip(labels, self.main):
            self.assertEqual(lab["raw_vendor_id"], row["vendor_id"])
            self.assertEqual(lab["raw_invoice_number"], row["invoice_number"])
            self.assertEqual(lab["intended_key"], {"vendor": _n(row["vendor_id"]),
                                                   "invoice": _n(row["invoice_number"]), "currency": "USD"})
            for f in ("subtotal", "tax", "shipping", "discount"):
                self.assertEqual(lab[f], row[f])
            self.assertEqual(lab["declared_total"], row["total"])

    def test_arithmetic_and_mismatch_deltas(self):
        labels = {x["record_id"]: x for x in self.manifest["main"]["rows"]}
        mism = {}
        for row in self.main:
            s, t, sh, d, tot = (_cents(row[f]) for f in ("subtotal", "tax", "shipping", "discount", "total"))
            self.assertLessEqual(d, s + t + sh)
            exp = s + t + sh - d
            lab = labels[row["record_id"]]
            self.assertEqual(_cents(lab["expected_total"]), exp)
            self.assertEqual(lab["is_mismatch"], tot != exp)
            self.assertEqual(lab["expected_delta"], _signed(tot - exp))
            if tot != exp:
                mism[row["record_id"]] = tot - exp
            sub = lab["subcategory"]
            want = {"one_cent_high": 1, "genuine_repeat_both_one_cent_high": 1, "one_cent_low": -1,
                    "omitted_shipping": -sh, "discount_added": 2 * d}.get(sub, 0)
            self.assertEqual(tot - exp, want, (row["record_id"], sub))
            if sub == "one_cent_low":
                self.assertGreaterEqual(exp, 1)
            if sub == "omitted_shipping":
                self.assertGreater(sh, 0)
            if sub == "discount_added":
                self.assertGreater(d, 0)
        self.assertEqual(len(mism), 20)
        subs = Counter(labels[r]["subcategory"] for r in mism)
        self.assertEqual(subs, Counter(one_cent_high=4, one_cent_low=4, omitted_shipping=4, discount_added=4,
                                       genuine_repeat_both_one_cent_high=4))
        self.assertEqual({m["record_id"]: m["delta"] for m in self.manifest["main"]["mismatches"]},
                         {k: _signed(v) for k, v in mism.items()})

    def test_groups_findings_pairs(self):
        by_key = defaultdict(list)
        for row in self.main:
            by_key[(_n(row["vendor_id"]), _n(row["invoice_number"]), _n(row["currency"]))].append(row["record_id"])
        groups = sorted(sorted(v) for v in by_key.values() if len(v) > 1)
        self.assertEqual(len(groups), 12)
        self.assertTrue(all(len(g) == 2 for g in groups))
        mg = self.manifest["main"]["duplicate_groups"]
        self.assertEqual(groups, sorted(g["members"] for g in mg))
        self.assertEqual(sum(g["genuine"] for g in mg), 10)
        labels = {x["record_id"]: x for x in self.manifest["main"]["rows"]}
        for g in mg:  # genuine <=> same hidden obligation
            obl = {labels[m]["obligation_id"] for m in g["members"]}
            self.assertEqual(len(obl) == 1, g["genuine"])
        both_high = [g for g in mg if all(labels[m]["is_mismatch"] for m in g["members"])]
        self.assertEqual(len(both_high), 2)
        self.assertTrue(all(g["genuine"] for g in both_high))
        n_mm = sum(1 for x in labels.values() if x["is_mismatch"])
        self.assertEqual(len(groups) + n_mm, 32)
        affected = {m for g in groups for m in g} | {k for k, x in labels.items() if x["is_mismatch"]}
        self.assertEqual(len(affected), 40)
        # semantic pairs
        ids = sorted(labels)
        pairs = list(itertools.combinations(ids, 2))
        self.assertEqual(len(pairs), 7140)
        predicted = {tuple(p) for g in groups for p in itertools.combinations(g, 2)}
        tp = fp = fn = tn = 0
        for a, b in pairs:
            pos = labels[a]["obligation_id"] == labels[b]["obligation_id"]
            pred = (a, b) in predicted
            tp += pos and pred
            fp += (not pos) and pred
            fn += pos and not pred
            tn += (not pos) and not pred
        self.assertEqual((tp, fp, fn, tn), (10, 2, 0, 7128))
        pt = self.manifest["main"]["planned_targets"]
        self.assertEqual((pt["pair_TP"], pt["pair_FP"], pt["pair_FN"], pt["pair_TN"]), (10, 2, 0, 7128))
        self.assertEqual((pt["mismatch_TP"], pt["mismatch_TN"]), (20, 100))
        self.assertEqual((pt["total_findings"], pt["distinct_affected_rows"]), (32, 40))

    def test_hard_negatives(self):
        labels = {x["record_id"]: x for x in self.manifest["main"]["rows"]}
        rows = {r["record_id"]: r for r in self.main}
        hn = self.manifest["main"]["hard_negative_pairs"]
        self.assertEqual(len(hn), 12)
        self.assertEqual(Counter(p["type"] for p in hn), Counter(
            same_number_different_vendor=4, same_vendor_date_amount_different_number=4, punctuation_or_leading_zero=4))
        members = [m for p in hn for m in p["members"]]
        self.assertEqual(len(set(members)), 24)
        for p in hn:
            a, b = (rows[m] for m in p["members"])
            self.assertNotEqual((_n(a["vendor_id"]), _n(a["invoice_number"])),
                                (_n(b["vendor_id"]), _n(b["invoice_number"])))
            for m in p["members"]:
                self.assertEqual(labels[m]["category"], "clean")
                self.assertFalse(labels[m]["is_mismatch"])
            if p["type"] == "same_number_different_vendor":
                self.assertEqual(a["invoice_number"], b["invoice_number"])
                self.assertNotEqual(_n(a["vendor_id"]), _n(b["vendor_id"]))
            elif p["type"] == "same_vendor_date_amount_different_number":
                self.assertEqual((a["vendor_id"], a["invoice_date"], a["total"]),
                                 (b["vendor_id"], b["invoice_date"], b["total"]))
            else:
                self.assertEqual(a["vendor_id"], b["vendor_id"])
                self.assertNotEqual(a["invoice_number"], b["invoice_number"])
                # differ only by punctuation / leading zeros in the numeric part
                pa, pb = _n(a["invoice_number"]), _n(b["invoice_number"])
                self.assertEqual("".join(c for c in pa if c.isalpha()), "".join(c for c in pb if c.isalpha()))
                self.assertEqual(int("".join(c for c in pa if c.isdigit())), int("".join(c for c in pb if c.isdigit())))
        self.assertEqual(len(self.manifest["main"]["designated_negative_pairs"]), 14)

    def test_controls_present(self):
        subs = {x["subcategory"]: x for x in self.manifest["main"]["rows"]}
        c = subs["decimal_control_0.10+0.20=0.30"]
        self.assertEqual((c["subtotal"], c["tax"], c["declared_total"]), ("0.10", "0.20", "0.30"))
        z = subs["zero_all_fields"]
        self.assertEqual({z[f] for f in ("subtotal", "tax", "shipping", "discount", "declared_total")}, {"0.00"})
        raw_variation = [x for x in self.manifest["main"]["rows"] if x["category"] == "duplicate_genuine"
                         and (x["raw_vendor_id"] != x["intended_key"]["vendor"]
                              or x["raw_invoice_number"] != x["intended_key"]["invoice"])]
        self.assertGreaterEqual(len(raw_variation), 4)

    # ---- other fixtures ----
    def test_invalid_and_mixed(self):
        files = self.manifest["files"]
        invalid = [p for p in files if p.startswith("fixtures/out/invalid/")]
        self.assertEqual(len(invalid), 8)
        main_ids = {r["record_id"] for r in self.main}
        codes = Counter()
        bad_ids = set()
        for p in invalid:
            header, rows = _rows(p)
            self.assertEqual(header, HEADER)
            self.assertEqual(len(rows), 1)
            self.assertNotIn(rows[0]["record_id"], main_ids)
            bad_ids.add(rows[0]["record_id"])
            exp = files[p]["expected"]
            self.assertFalse(exp["accepted"])
            self.assertEqual(len(exp["issues"]), 1)
            codes[exp["issues"][0]["code"]] += 1
        self.assertEqual(codes, Counter(FIELD_REQUIRED=2, CURRENCY_UNSUPPORTED=1, AMOUNT_FORMAT=3,
                                        DATE_INVALID=1, AMOUNT_REQUIRED=1))
        self.assertIn('"$1,234.56"', _read("fixtures/out/invalid/formatted-subtotal.csv").decode())
        _, mixed = _rows("fixtures/out/mixed-128.csv")
        self.assertEqual(len(mixed), 128)
        self.assertEqual({r["record_id"] for r in mixed}, main_ids | bad_ids)
        exp = files["fixtures/out/mixed-128.csv"]["expected"]
        self.assertEqual(exp["issue_count"], 8)
        pos = {r["record_id"]: i + 1 for i, r in enumerate(mixed)}
        self.assertEqual(sorted(i["row"] for i in exp["issues"]), sorted(pos[x] for x in bad_ids))

    def test_size_and_row_limits(self):
        big = _read("fixtures/out/reject/file-too-large.csv")
        self.assertGreater(len(big), 1_048_576)
        _, rows = _rows("fixtures/out/reject/file-too-large.csv")
        self.assertLessEqual(len(rows), 1000)
        self.assertTrue(all(r["invoice_number"] != r["invoice_number"].strip(WS) for r in rows))
        many = _read("fixtures/out/reject/too-many-rows.csv")
        self.assertLessEqual(len(many), 1_048_576)
        _, rows = _rows("fixtures/out/reject/too-many-rows.csv")
        self.assertEqual(len(rows), 1001)
        self.assertEqual(len({r["record_id"] for r in rows}), 1001)
        self.assertEqual(_read("fixtures/out/reject/empty-file.csv"), b"")
        _, rows = _rows("fixtures/out/reject/header-only.csv")
        self.assertEqual(rows, [])

    def test_malformed_quote_really_malformed(self):
        text = _read("fixtures/out/reject/malformed-quote.csv").decode("utf-8")
        with self.assertRaises(csv.Error):
            list(csv.reader(io.StringIO(text, newline=""), strict=True))

    def test_boundary_labels(self):
        files = self.manifest["files"]
        _, rows = _rows("fixtures/out/boundary/max-amount.csv")
        self.assertEqual(rows[0]["subtotal"], "999999999.99")
        self.assertEqual(rows[0]["total"], "999999999.99")
        _, rows = _rows("fixtures/out/boundary/expected-above-max.csv")
        r = rows[0]
        exp = sum(_cents(r[f]) for f in ("subtotal", "tax", "shipping")) - _cents(r["discount"])
        self.assertEqual(files["fixtures/out/boundary/expected-above-max.csv"]["expected"]["mismatches"],
                         [{"record_id": r["record_id"], "delta": _signed(_cents(r["total"]) - exp)}])
        for name, size in (("triple-group", 3), ("case-whitespace-duplicate", 2), ("split-combined-control", 2)):
            p = f"fixtures/out/boundary/{name}.csv"
            _, rows = _rows(p)
            by_key = defaultdict(list)
            for row in rows:
                by_key[(_n(row["vendor_id"]), _n(row["invoice_number"]))].append(row["record_id"])
            groups = sorted(sorted(v) for v in by_key.values() if len(v) > 1)
            self.assertEqual(groups, files[p]["expected"]["duplicate_groups"])
            self.assertEqual(len(groups[0]), size)
        for p in ("fixtures/out/boundary/split-batch-a.csv", "fixtures/out/boundary/split-batch-b.csv"):
            self.assertEqual(files[p]["expected"]["duplicate_groups"], [])


if __name__ == "__main__":
    unittest.main()
