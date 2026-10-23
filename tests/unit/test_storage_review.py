import os
import sqlite3
import tempfile
import threading
import unittest

from preflight import contracts as c
from preflight import rules
from preflight.imports import validate_bytes
from preflight.review import parse_review_form
from preflight.storage import Store

HEADER = ",".join(c.CSV_HEADER)
DATA = "\n".join([
    HEADER,
    "R-1,V-001,INV-01,2026-01-15,USD,100.00,8.25,5.00,3.00,110.26",
    "R-2,v-001,inv-01,2026-02-15,USD,100.00,8.25,5.00,3.00,110.25",
    "R-3,V-002,INV-01,2026-01-15,USD,0.10,0.20,0.00,0.00,0.30",
]).encode() + b"\n"


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.tmp.name, "t.sqlite"))
        self.store.init_schema()
        self.result = validate_bytes(DATA)
        self.findings = rules.run_all(self.result.invoices)

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        return self.store.save_import("t.csv", self.result, self.findings, "2026-10-21T00:00:00Z")

    def test_save_and_idempotent_reimport(self):
        batch_id, existing = self.save()
        self.assertFalse(existing)
        self.assertEqual(self.save(), (batch_id, True))
        self.assertEqual(self.store.count_rows("batch"), 1)
        self.assertEqual(self.store.count_rows("invoice"), 3)
        batch = self.store.get_batch(batch_id)
        self.assertEqual((batch.finding_count, batch.duplicate_count, batch.mismatch_count, batch.open_count),
                         (2, 1, 1, 2))

    def test_failed_transaction_leaves_nothing(self):
        bad = c.Finding("deadbeefdeadbeef", c.RULE_MISMATCH, c.RULESET_VERSION, ("NOT-A-ROW",), {})
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.save_import("t.csv", self.result, [*self.findings, bad], "2026-10-21T00:00:00Z")
        for table in ("batch", "invoice", "finding", "finding_member", "vendor"):
            self.assertEqual(self.store.count_rows(table), 0, table)

    def test_review_sequence_conflict_and_history(self):
        batch_id, _ = self.save()
        fid = self.findings[0].finding_id
        ok = self.store.append_review(batch_id, fid, "confirm", "looks real", "AB", 0, "t1")
        self.assertEqual((ok.status, ok.finding.state, ok.finding.seq), ("ok", "confirmed", 1))
        stale = self.store.append_review(batch_id, fid, "dismiss", "other tab", "CD", 0, "t2")
        self.assertEqual((stale.status, stale.finding.state), ("conflict", "confirmed"))
        bad = self.store.append_review(batch_id, fid, "confirm", "again", "AB", 1, "t3")
        self.assertEqual(bad.status, "invalid_transition")
        self.store.append_review(batch_id, fid, "reopen", "new info", "AB", 1, "t4")
        self.store.append_review(batch_id, fid, "dismiss", "legit reuse", "AB", 2, "t5")
        events = self.store.list_events(batch_id, fid)
        self.assertEqual([(e.seq, e.prev_state, e.next_state) for e in events],
                         [(1, "open", "confirmed"), (2, "confirmed", "open"), (3, "open", "dismissed")])
        # restart = a brand-new Store object over the same file
        again = Store(self.store.db_path)
        self.assertEqual(len(again.list_events(batch_id, fid)), 3)
        self.assertEqual(again.get_finding(batch_id, fid).state, "dismissed")

    def test_history_and_invoices_append_only(self):
        batch_id, _ = self.save()
        fid = self.findings[0].finding_id
        self.store.append_review(batch_id, fid, "confirm", "r", "AB", 0, "t1")
        with self.store.connect() as conn:
            for sql in ("UPDATE review_event SET reason = 'x'", "DELETE FROM review_event",
                        "UPDATE invoice SET total_c = 0", "DELETE FROM invoice"):
                with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                    conn.execute(sql)

    def test_concurrent_reviews_only_one_wins(self):
        batch_id, _ = self.save()
        fid = self.findings[0].finding_id
        results, barrier = [], threading.Barrier(8)

        def attempt(i):
            barrier.wait()
            results.append(self.store.append_review(batch_id, fid, "confirm", f"r{i}", "AB", 0, "t").status)

        threads = [threading.Thread(target=attempt, args=(i,)) for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(results), ["conflict"] * 7 + ["ok"])
        self.assertEqual(len(self.store.list_events(batch_id, fid)), 1)


class ReviewFormTest(unittest.TestCase):
    def test_valid(self):
        parsed, errors = parse_review_form({"action": "confirm", "reason": " ok\r\nline2 ", "reviewer": " AB ",
                                            "expected_seq": "0"})
        self.assertEqual(errors, [])
        self.assertEqual((parsed.reason, parsed.reviewer, parsed.expected_seq), ("ok\nline2", "AB", 0))

    def test_invalid(self):
        cases = [
            {"action": "approve_payment", "reason": "r", "reviewer": "a", "expected_seq": "0"},
            {"action": "confirm", "reason": "  ", "reviewer": "a", "expected_seq": "0"},
            {"action": "confirm", "reason": "x" * 501, "reviewer": "a", "expected_seq": "0"},
            {"action": "confirm", "reason": "r", "reviewer": "", "expected_seq": "0"},
            {"action": "confirm", "reason": "r", "reviewer": "a" * 81, "expected_seq": "0"},
            {"action": "confirm", "reason": "r", "reviewer": "a\nb", "expected_seq": "0"},
            {"action": "confirm", "reason": "r\x00", "reviewer": "a", "expected_seq": "0"},
            {"action": "confirm", "reason": "r", "reviewer": "a", "expected_seq": "-1"},
            {"action": "confirm", "reason": "r", "reviewer": "a", "expected_seq": "١"},
        ]
        for form in cases:
            with self.subTest(form=form):
                parsed, errors = parse_review_form(form)
                self.assertIsNone(parsed)
                self.assertTrue(errors)

    def test_limits_inclusive(self):
        parsed, errors = parse_review_form({"action": "dismiss", "reason": "x" * 500, "reviewer": "a" * 80,
                                            "expected_seq": "3"})
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
