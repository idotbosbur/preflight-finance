import unittest

from preflight import contracts as c
from preflight.money import AmountError, format_cents, format_delta, parse_cents


class ParseCentsTest(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(parse_cents("0.00"), 0)
        self.assertEqual(parse_cents("0.10"), 10)
        self.assertEqual(parse_cents("110.25"), 11025)
        self.assertEqual(parse_cents("999999999.99"), 99_999_999_999)

    def test_point_one_plus_point_two(self):
        self.assertEqual(parse_cents("0.10") + parse_cents("0.20"), parse_cents("0.30"))

    def test_rejects(self):
        bad = ["", " 1.00", "1.00 ", "1.00\n", "1", "1.0", "1.000", "-0.00", "+1.00", "1e2",
               "$1.00", "1,234.56", "1000000000.00", "NaN", "inf", ".50", "1.",
               "١.00", "１.00", "1.٠٠"]  # Unicode digits must fail
        for text in bad:
            with self.subTest(text=text):
                with self.assertRaises(AmountError):
                    parse_cents(text)

    def test_format(self):
        self.assertEqual(format_cents(11025), "110.25")
        self.assertEqual(format_cents(5), "0.05")
        self.assertEqual(format_cents(-5), "-0.05")
        self.assertEqual(format_delta(1), "+0.01")
        self.assertEqual(format_delta(-1), "-0.01")
        self.assertEqual(format_delta(0), "0.00")

    def test_spec_example(self):
        expected = parse_cents("100.00") + parse_cents("8.25") + parse_cents("5.00") - parse_cents("3.00")
        self.assertEqual(format_cents(expected), "110.25")
        self.assertEqual(format_delta(parse_cents("110.26") - expected), "+0.01")


class ContractsTest(unittest.TestCase):
    def test_normalize_preserves_punctuation_and_zeros(self):
        self.assertEqual(c.normalize_identifier("  inv-01 "), "INV-01")
        values = {c.normalize_identifier(v) for v in ("INV-01", "INV01", "INV-1", "inv-001")}
        self.assertEqual(len(values), 4)

    def test_normalize_ascii_only(self):
        # non-ASCII letters are not case-folded (they are rejected by import anyway)
        self.assertEqual(c.normalize_identifier("éa"), "éA")

    def test_finding_id_stable(self):
        a = c.make_finding_id(c.RULE_DUPLICATE, c.RULESET_VERSION, ("R1", "R2"))
        self.assertEqual(a, c.make_finding_id(c.RULE_DUPLICATE, c.RULESET_VERSION, ("R1", "R2")))
        self.assertNotEqual(a, c.make_finding_id(c.RULE_MISMATCH, c.RULESET_VERSION, ("R1", "R2")))
        self.assertEqual(len(a), 16)

    def test_modules_all_twelve(self):
        self.assertEqual([m.number for m in c.MODULES], list(range(1, 13)))

    def test_sort_key(self):
        def fv(state, rule, ids):
            return c.FindingView("b", "f", rule, c.RULESET_VERSION, ids, state, 0, {})
        items = [fv("confirmed", c.RULE_DUPLICATE, ("A",)), fv("open", c.RULE_MISMATCH, ("B",)),
                 fv("open", c.RULE_DUPLICATE, ("C", "D"))]
        ordered = sorted(items, key=c.case_sort_key)
        self.assertEqual([f.member_ids for f in ordered], [("C", "D"), ("B",), ("A",)])


if __name__ == "__main__":
    unittest.main()
