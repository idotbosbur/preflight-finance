import hashlib
import unittest

from preflight import contracts as c
from preflight.imports import validate_bytes

HEADER = ",".join(c.CSV_HEADER)
GOOD = "R-1,V-001,INV-01,2026-01-15,USD,100.00,8.25,5.00,3.00,110.25"


def csv_bytes(*rows: str, newline: str = "\n", header: str = HEADER) -> bytes:
    return (newline.join([header, *rows]) + newline).encode("utf-8")


def codes(result):
    return [(i.code, i.row, i.field) for i in result.issues]


class AcceptTest(unittest.TestCase):
    def test_valid_row(self):
        r = validate_bytes(csv_bytes(GOOD))
        self.assertTrue(r.ok, codes(r))
        inv = r.invoices[0]
        self.assertEqual((inv.subtotal_c, inv.tax_c, inv.shipping_c, inv.discount_c, inv.total_c),
                         (10000, 825, 500, 300, 11025))
        self.assertEqual(inv.row_number, 1)
        self.assertEqual(inv.raw[0], "R-1")

    def test_hash_covers_original_bytes_bom_crlf(self):
        lf = csv_bytes(GOOD)
        crlf_bom = b"\xef\xbb\xbf" + csv_bytes(GOOD, newline="\r\n")
        a, b = validate_bytes(lf), validate_bytes(crlf_bom)
        self.assertTrue(a.ok and b.ok, codes(b))
        self.assertEqual(a.sha256, hashlib.sha256(lf).hexdigest())
        self.assertEqual(b.sha256, hashlib.sha256(crlf_bom).hexdigest())
        self.assertNotEqual(a.sha256, b.sha256)
        self.assertEqual(a.invoices[0].total_c, b.invoices[0].total_c)

    def test_normalisation_and_raw_preserved(self):
        r = validate_bytes(csv_bytes('R-1," v-001 ", inv-007/a ,2026-01-15, usd ,1.00,0.00,0.00,0.00,1.00'))
        self.assertTrue(r.ok, codes(r))
        inv = r.invoices[0]
        self.assertEqual((inv.vendor_norm, inv.invoice_norm, inv.currency), ("V-001", "INV-007/A", "USD"))
        self.assertEqual(inv.raw[1], " v-001 ")

    def test_quoted_values_and_expected_above_max(self):
        r = validate_bytes(csv_bytes('"R-1","V-1","A.1","2026-01-15","USD","999999999.99","999999999.99",'
                                     '"0.00","0.00","999999999.99"'))
        self.assertTrue(r.ok, codes(r))
        self.assertEqual(r.invoices[0].expected_total_c, 2 * 99_999_999_999)

    def test_record_id_case_sensitive(self):
        r = validate_bytes(csv_bytes(GOOD, GOOD.replace("R-1", "r-1", 1)))
        self.assertTrue(r.ok, codes(r))


class RejectTest(unittest.TestCase):
    def assertRejected(self, data, expected):
        r = validate_bytes(data)
        self.assertFalse(r.ok)
        self.assertEqual(r.invoices, ())
        self.assertEqual(codes(r), expected)
        return r

    def test_file_level(self):
        self.assertRejected(b"", [("EMPTY_FILE", None, None)])
        self.assertRejected(b"x" * (c.MAX_BYTES + 1), [("FILE_TOO_LARGE", None, None)])
        self.assertRejected(csv_bytes(GOOD)[:-5] + b"\xff\n", [("ENCODING", None, None)])
        self.assertRejected((HEADER + "\n").encode(), [("NO_DATA_ROWS", None, None)])
        self.assertRejected(csv_bytes('R-1,"V-1"x,INV,2026-01-15,USD,1.00,0.00,0.00,0.00,1.00'),
                            [("MALFORMED_CSV", None, None)])
        self.assertRejected(csv_bytes('R-1,"V-1,INV,2026-01-15,USD,1.00,0.00,0.00,0.00,1.00'),
                            [("MALFORMED_CSV", None, None)])

    def test_headers(self):
        for header in (HEADER.replace(",total", ""), HEADER + ",total", HEADER + ",extra",
                       HEADER.replace("tax,shipping", "shipping,tax"), HEADER.upper()):
            with self.subTest(header=header):
                self.assertRejected(csv_bytes(GOOD, header=header), [("HEADER_MISMATCH", None, None)])

    def test_too_many_rows(self):
        rows = [GOOD.replace("R-1", f"R-{i}", 1) for i in range(c.MAX_ROWS + 1)]
        self.assertRejected(csv_bytes(*rows), [("TOO_MANY_ROWS", None, None)])
        self.assertTrue(validate_bytes(csv_bytes(*rows[:-1])).ok)

    def test_field_errors(self):
        cases = {
            "R-1,,INV,2026-01-15,USD,1.00,0.00,0.00,0.00,1.00": ("FIELD_REQUIRED", "vendor_id"),
            "R-1,V,   ,2026-01-15,USD,1.00,0.00,0.00,0.00,1.00": ("FIELD_REQUIRED", "invoice_number"),
            "R-1,V,INV,2026-01-15,EUR,1.00,0.00,0.00,0.00,1.00": ("CURRENCY_UNSUPPORTED", "currency"),
            "R-1,V,INV,2026-01-15,USD,1.00,0.00,0.00,0.00,1.000": ("AMOUNT_FORMAT", "total"),
            'R-1,V,INV,2026-01-15,USD,"$1,234.56",0.00,0.00,0.00,1.00': ("AMOUNT_FORMAT", "subtotal"),
            "R-1,V,INV,2026-01-15,USD,1.00,-0.10,0.00,0.00,1.00": ("AMOUNT_FORMAT", "tax"),
            "R-1,V,INV,2026-02-30,USD,1.00,0.00,0.00,0.00,1.00": ("DATE_INVALID", "invoice_date"),
            "R-1,V,INV,15/01/2026,USD,1.00,0.00,0.00,0.00,1.00": ("DATE_FORMAT", "invoice_date"),
            "R-1,V,INV,2026-01-15,USD,1.00,0.00,0.00,0.00,": ("AMOUNT_REQUIRED", "total"),
            "R-1,V,INV,2026-01-15,USD,1.00,0.00,0.00,-0.00,1.00": ("AMOUNT_FORMAT", "discount"),
            "R-1,V,INV,2026-01-15,USD,1.00,0.00,+1.00,0.00,2.00": ("AMOUNT_FORMAT", "shipping"),
            "R-1,V,INV,2026-01-15,USD,1.00,0.00,0.00,0.00, 1.00": ("AMOUNT_FORMAT", "total"),
            "R-1,V,INV,2026-01-15,USD,١.00,0.00,0.00,0.00,1.00": ("AMOUNT_FORMAT", "subtotal"),
            "R-1,V,INV,2026-01-15,USD,1.00,0.00,0.00,1.01,0.00": ("DISCOUNT_EXCEEDS_CHARGES", "discount"),
            "R 1,V,INV,2026-01-15,USD,1.00,0.00,0.00,0.00,1.00": ("ID_FORMAT", "record_id"),
            "R-1,V,INV#1,2026-01-15,USD,1.00,0.00,0.00,0.00,1.00": ("INVOICE_NUMBER_FORMAT", "invoice_number"),
            "R-1,Vé,INV,2026-01-15,USD,1.00,0.00,0.00,0.00,1.00": ("ID_FORMAT", "vendor_id"),
        }
        for row, (code, field) in cases.items():
            with self.subTest(row=row):
                self.assertRejected(csv_bytes(row), [(code, 1, field)])

    def test_row_shape_and_duplicate_ids(self):
        self.assertRejected(csv_bytes(GOOD, GOOD.replace("R-1", "R-2", 1) + ",extra"), [("ROW_SHAPE", 2, None)])
        self.assertRejected(csv_bytes(GOOD, GOOD, GOOD), [("DUPLICATE_RECORD_ID", 2, "record_id"),
                                                          ("DUPLICATE_RECORD_ID", 3, "record_id")])

    def test_blank_lines_rejected_with_clear_message(self):
        r = self.assertRejected(csv_bytes(GOOD) + b"\n", [("ROW_SHAPE", 2, None)])
        self.assertIn("blank line", r.issues[0].message)

    def test_duplicate_id_after_malformed_row(self):
        self.assertRejected(csv_bytes(GOOD + ",extra", GOOD),
                            [("ROW_SHAPE", 1, None), ("DUPLICATE_RECORD_ID", 2, "record_id")])

    def test_all_row_errors_reported_atomically(self):
        rows = [GOOD.replace("R-1", f"R-{i}", 1) for i in range(5)]
        rows[1] = rows[1].replace("USD", "CAD")
        rows[3] = rows[3].replace("2026-01-15", "2026-13-01")
        r = self.assertRejected(csv_bytes(*rows), [("CURRENCY_UNSUPPORTED", 2, "currency"),
                                                   ("DATE_INVALID", 4, "invoice_date")])
        self.assertEqual(r.issue_count, 2)


if __name__ == "__main__":
    unittest.main()
