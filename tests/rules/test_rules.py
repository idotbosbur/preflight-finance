"""Tests for the invoice-v1 rules (duplicates, totals, run_all)."""

import json
import random
import unittest

from preflight import contracts, rules
from preflight.contracts import Invoice, normalize_identifier
from preflight.money import parse_cents
from preflight.rules import duplicates, totals


def inv(record_id, vendor="VEND-1", number="INV-100", *, row=1, date="2026-01-15",
        subtotal="100.00", tax="0.00", shipping="0.00", discount="0.00", total=None,
        currency="USD"):
    """Build an Invoice as the importer would (raw cells kept verbatim)."""
    if total is None:
        total_c = parse_cents(subtotal) + parse_cents(tax) + parse_cents(shipping) - parse_cents(discount)
    else:
        total_c = parse_cents(total)
    raw = (record_id, vendor, number, date, currency, subtotal, tax, shipping, discount,
           total if total is not None else f"{total_c // 100}.{total_c % 100:02d}")
    return Invoice(
        record_id=record_id, row_number=row, raw=raw,
        vendor_norm=normalize_identifier(vendor), invoice_norm=normalize_identifier(number),
        invoice_date=date, currency=currency,
        subtotal_c=parse_cents(subtotal), tax_c=parse_cents(tax), shipping_c=parse_cents(shipping),
        discount_c=parse_cents(discount), total_c=total_c,
    )


def _has_float(obj):
    if isinstance(obj, float):
        return True
    if isinstance(obj, dict):
        return any(_has_float(v) for v in obj.values())
    if isinstance(obj, (list, tuple)):
        return any(_has_float(v) for v in obj)
    return False


class TotalsTests(unittest.TestCase):
    def test_spec_example_plus_one_cent(self):
        [f] = totals.run([inv("R1", row=3, subtotal="100.00", tax="8.25", shipping="5.00",
                              discount="3.00", total="110.26")])
        self.assertEqual(f.rule_id, contracts.RULE_MISMATCH)
        self.assertEqual(f.rule_version, contracts.RULESET_VERSION)
        self.assertEqual(f.member_ids, ("R1",))
        self.assertEqual(f.evidence, {
            "record_id": "R1", "row": 3, "subtotal": "100.00", "tax": "8.25",
            "shipping": "5.00", "discount": "3.00", "expected": "110.25",
            "declared": "110.26", "delta": "+0.01",
        })

    def test_one_cent_low(self):
        [f] = totals.run([inv("R1", subtotal="100.00", tax="8.25", shipping="5.00",
                              discount="3.00", total="110.24")])
        self.assertEqual(f.evidence["delta"], "-0.01")

    def test_consistent_row_no_finding(self):
        self.assertEqual(totals.run([inv("R1", subtotal="100.00", tax="8.25", shipping="5.00",
                                         discount="3.00", total="110.25")]), [])

    def test_zero_fields(self):
        self.assertEqual(totals.run([inv("R1", subtotal="0.00", total="0.00")]), [])
        [f] = totals.run([inv("R2", subtotal="0.00", total="0.01")])
        self.assertEqual(f.evidence["expected"], "0.00")
        self.assertEqual(f.evidence["delta"], "+0.01")

    def test_no_float_drift(self):
        self.assertEqual(totals.run([inv("R1", subtotal="0.10", tax="0.20", total="0.30")]), [])

    def test_expected_above_max_amount_is_integer(self):
        row = inv("R1", subtotal="999999999.99", tax="999999999.99", total="999999999.99")
        self.assertEqual(row.expected_total_c, 2 * 99_999_999_999)
        [f] = totals.run([row])
        self.assertEqual(f.evidence["expected"], "1999999999.98")
        self.assertEqual(f.evidence["delta"], "-999999999.99")


class DuplicateTests(unittest.TestCase):
    def test_group_of_three_one_finding(self):
        rows = [inv("R3", row=3, date="2026-02-01", subtotal="5.00"),
                inv("R1", row=1), inv("R2", row=2, total="1.00")]
        [f] = duplicates.run(rows)
        self.assertEqual(f.rule_id, contracts.RULE_DUPLICATE)
        self.assertEqual(f.member_ids, ("R1", "R2", "R3"))
        self.assertEqual([m["record_id"] for m in f.evidence["members"]], ["R1", "R2", "R3"])
        self.assertEqual(f.evidence["key"], {"vendor": "VEND-1", "invoice": "INV-100", "currency": "USD"})
        self.assertEqual(f.evidence["members"][2], {
            "record_id": "R3", "row": 3, "raw_vendor": "VEND-1", "raw_invoice": "INV-100",
            "invoice_date": "2026-02-01", "total": "5.00",
        })
        self.assertEqual(f.finding_id, contracts.make_finding_id(
            contracts.RULE_DUPLICATE, contracts.RULESET_VERSION, ["R1", "R2", "R3"]))

    def test_case_and_whitespace_normalized_keys(self):
        [f] = duplicates.run([inv("R1", vendor="vend-1", number=" inv-100 "),
                              inv("R2", vendor="VEND-1\t", number="INV-100")])
        self.assertEqual(f.evidence["key"]["vendor"], "VEND-1")
        self.assertEqual(f.evidence["members"][0]["raw_vendor"], "vend-1")
        self.assertEqual(f.evidence["members"][0]["raw_invoice"], " inv-100 ")

    def test_punctuation_and_zeros_distinct(self):
        rows = [inv("R1", number="INV-01"), inv("R2", number="INV01"), inv("R3", number="INV-1")]
        self.assertEqual(duplicates.run(rows), [])

    def test_same_number_different_vendors(self):
        self.assertEqual(duplicates.run([inv("R1", vendor="VEND-1"), inv("R2", vendor="VEND-2")]), [])

    def test_same_vendor_amount_different_numbers(self):
        self.assertEqual(duplicates.run([inv("R1", number="INV-100"), inv("R2", number="INV-101")]), [])

    def test_singletons_no_finding(self):
        self.assertEqual(duplicates.run([inv("R1")]), [])
        self.assertEqual(duplicates.run([]), [])


class RunAllTests(unittest.TestCase):
    def _batch(self):
        return [
            inv("R1", row=1),
            inv("R2", row=2, total="99.99"),                 # duplicate of R1 and a mismatch
            inv("R3", row=3, vendor="VEND-2", total="1.00"),  # mismatch only
            inv("R4", row=4, vendor="VEND-3", number="A-1"),
            inv("R5", row=5, vendor="vend-3", number="a-1"),
            inv("R6", row=6, vendor="VEND-9"),               # clean
        ]

    def test_inconsistent_totals_do_not_hide_duplicate_and_row_in_both(self):
        found = rules.run_all(self._batch())
        keys = [(f.rule_id, f.member_ids) for f in found]
        self.assertEqual(keys, [
            (contracts.RULE_DUPLICATE, ("R1", "R2")),
            (contracts.RULE_DUPLICATE, ("R4", "R5")),
            (contracts.RULE_MISMATCH, ("R2",)),
            (contracts.RULE_MISMATCH, ("R3",)),
        ])

    def test_order_invariance_and_stable_ids(self):
        baseline = rules.run_all(self._batch())
        rng = random.Random(1234)
        for _ in range(20):
            rows = self._batch()
            rng.shuffle(rows)
            again = rules.run_all(rows)
            self.assertEqual(again, baseline)
            self.assertEqual([f.finding_id for f in again], [f.finding_id for f in baseline])
            self.assertEqual([f.evidence for f in again], [f.evidence for f in baseline])
        for f in baseline:
            self.assertEqual(f.finding_id, contracts.make_finding_id(f.rule_id, f.rule_version, f.member_ids))
            self.assertEqual(len(f.finding_id), 16)

    def test_evidence_json_safe_without_floats(self):
        for f in rules.run_all(self._batch()):
            json.dumps(f.evidence)
            self.assertFalse(_has_float(f.evidence))
            self.assertTrue(json.loads(json.dumps(f.evidence)) == f.evidence)

    def test_rules_registry(self):
        self.assertEqual(rules.RULES, (duplicates, totals))


if __name__ == "__main__":
    unittest.main()
