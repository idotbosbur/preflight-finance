"""SQLite persistence.

Threading model: the HTTP server handles each request on its own thread, so
connections are never shared. Every operation opens a fresh connection
(``Store.connect``), uses explicit ``BEGIN IMMEDIATE`` transactions for writes,
and closes it. WAL mode lets readers proceed while one writer commits.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, List, Optional, Sequence, Tuple

from . import contracts as c

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def batch_id_for(sha256: str, ruleset: str = c.RULESET_VERSION) -> str:
    """Deterministic batch identity: the same file bytes + ruleset map to one batch."""
    return hashlib.sha256(f"{sha256}|{ruleset}".encode("ascii")).hexdigest()[:16]


@dataclass(frozen=True)
class ReviewOutcome:
    status: str  # "ok" | "conflict" | "invalid_transition" | "not_found"
    finding: Optional[c.FindingView]


class Store:
    def __init__(self, db_path: str | Path) -> None:
        self.db_path = str(db_path)

    @contextlib.contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, isolation_level=None, timeout=5.0)
        try:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA busy_timeout = 5000")
            yield conn
        finally:
            conn.close()

    @contextlib.contextmanager
    def _write(self) -> Iterator[sqlite3.Connection]:
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            else:
                conn.execute("COMMIT")

    def init_schema(self) -> None:
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))

    # ---- import ----

    def save_import(self, display_name: str, result: c.ImportResult, findings: Sequence[c.Finding],
                    now_utc: str) -> Tuple[str, bool]:
        """Persist a validated batch and its findings in one transaction.

        Returns ``(batch_id, existing)``. Re-importing identical bytes under the
        same ruleset returns the existing batch untouched (decisions preserved).
        """
        if not result.ok:
            raise ValueError("refusing to persist a rejected import")
        batch_id = batch_id_for(result.sha256)
        with self._write() as conn:
            if conn.execute("SELECT 1 FROM batch WHERE batch_id = ?", (batch_id,)).fetchone():
                return batch_id, True
            conn.execute(
                "INSERT INTO batch (batch_id, display_name, sha256, ruleset, imported_at_utc, row_count)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (batch_id, display_name, result.sha256, c.RULESET_VERSION, now_utc, len(result.invoices)),
            )
            for inv in result.invoices:
                conn.execute("INSERT OR IGNORE INTO vendor (vendor_norm, first_seen_batch) VALUES (?, ?)",
                             (inv.vendor_norm, batch_id))
                conn.execute(
                    "INSERT INTO invoice (batch_id, record_id, row_number, raw_json, vendor_norm, invoice_norm,"
                    " invoice_date, currency, subtotal_c, tax_c, shipping_c, discount_c, total_c)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (batch_id, inv.record_id, inv.row_number, json.dumps(list(inv.raw)), inv.vendor_norm,
                     inv.invoice_norm, inv.invoice_date, inv.currency, inv.subtotal_c, inv.tax_c,
                     inv.shipping_c, inv.discount_c, inv.total_c),
                )
            for f in findings:
                conn.execute(
                    "INSERT INTO finding (batch_id, finding_id, rule_id, rule_version, member_ids_json,"
                    " evidence_json) VALUES (?, ?, ?, ?, ?, ?)",
                    (batch_id, f.finding_id, f.rule_id, f.rule_version, json.dumps(list(f.member_ids)),
                     json.dumps(f.evidence, sort_keys=True)),
                )
                for record_id in f.member_ids:
                    conn.execute("INSERT INTO finding_member (batch_id, finding_id, record_id) VALUES (?, ?, ?)",
                                 (batch_id, f.finding_id, record_id))
        return batch_id, False

    # ---- reads ----

    _BATCH_SQL = """
        SELECT b.*,
               COUNT(f.finding_id) AS finding_count,
               COALESCE(SUM(f.rule_id = 'DUPLICATE_CANDIDATE'), 0) AS duplicate_count,
               COALESCE(SUM(f.rule_id = 'TOTAL_MISMATCH'), 0) AS mismatch_count,
               COALESCE(SUM(f.state = 'open'), 0) AS open_count,
               COALESCE(SUM(f.state = 'confirmed'), 0) AS confirmed_count,
               COALESCE(SUM(f.state = 'dismissed'), 0) AS dismissed_count
        FROM batch b LEFT JOIN finding f ON f.batch_id = b.batch_id
    """

    @staticmethod
    def _batch(row: sqlite3.Row) -> c.BatchSummary:
        return c.BatchSummary(
            batch_id=row["batch_id"], display_name=row["display_name"], sha256=row["sha256"],
            imported_at_utc=row["imported_at_utc"], ruleset=row["ruleset"], row_count=row["row_count"],
            finding_count=row["finding_count"], duplicate_count=row["duplicate_count"],
            mismatch_count=row["mismatch_count"], open_count=row["open_count"],
            confirmed_count=row["confirmed_count"], dismissed_count=row["dismissed_count"],
        )

    @staticmethod
    def _finding(row: sqlite3.Row) -> c.FindingView:
        return c.FindingView(
            batch_id=row["batch_id"], finding_id=row["finding_id"], rule_id=row["rule_id"],
            rule_version=row["rule_version"], member_ids=tuple(json.loads(row["member_ids_json"])),
            state=row["state"], seq=row["seq"], evidence=json.loads(row["evidence_json"]),
        )

    def list_batches(self) -> List[c.BatchSummary]:
        with self.connect() as conn:
            rows = conn.execute(self._BATCH_SQL + " GROUP BY b.batch_id ORDER BY b.imported_at_utc DESC, b.batch_id")
            return [self._batch(r) for r in rows]

    def get_batch(self, batch_id: str) -> Optional[c.BatchSummary]:
        with self.connect() as conn:
            row = conn.execute(self._BATCH_SQL + " WHERE b.batch_id = ? GROUP BY b.batch_id", (batch_id,)).fetchone()
            return self._batch(row) if row else None

    def list_findings(self, batch_id: str, state: Optional[str] = None) -> List[c.FindingView]:
        with self.connect() as conn:
            if state is None:
                rows = conn.execute("SELECT * FROM finding WHERE batch_id = ?", (batch_id,))
            else:
                rows = conn.execute("SELECT * FROM finding WHERE batch_id = ? AND state = ?", (batch_id, state))
            return sorted((self._finding(r) for r in rows), key=c.case_sort_key)

    def get_finding(self, batch_id: str, finding_id: str) -> Optional[c.FindingView]:
        with self.connect() as conn:
            return self._get_finding(conn, batch_id, finding_id)

    def _get_finding(self, conn: sqlite3.Connection, batch_id: str, finding_id: str) -> Optional[c.FindingView]:
        row = conn.execute("SELECT * FROM finding WHERE batch_id = ? AND finding_id = ?",
                           (batch_id, finding_id)).fetchone()
        return self._finding(row) if row else None

    def list_events(self, batch_id: str, finding_id: str) -> List[c.ReviewEventView]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT seq, prev_state, next_state, action, reason, reviewer, at_utc FROM review_event"
                " WHERE batch_id = ? AND finding_id = ? ORDER BY seq", (batch_id, finding_id))
            return [c.ReviewEventView(**dict(r)) for r in rows]

    def count_rows(self, table: str) -> int:
        if table not in ("batch", "invoice", "finding", "finding_member", "review_event", "vendor"):
            raise ValueError(table)
        with self.connect() as conn:
            return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    # ---- review ----

    def append_review(self, batch_id: str, finding_id: str, action: str, reason: str, reviewer: str,
                      expected_seq: int, now_utc: str) -> ReviewOutcome:
        """Atomically check the viewed sequence, move state and append one event."""
        allowed_from, next_state = c.ACTIONS[action]
        with self._write() as conn:
            current = self._get_finding(conn, batch_id, finding_id)
            if current is None:
                return ReviewOutcome("not_found", None)
            if current.seq != expected_seq:
                return ReviewOutcome("conflict", current)
            if current.state not in allowed_from:
                return ReviewOutcome("invalid_transition", current)
            seq = current.seq + 1
            conn.execute(
                "INSERT INTO review_event (batch_id, finding_id, seq, prev_state, next_state, action, reason,"
                " reviewer, at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (batch_id, finding_id, seq, current.state, next_state, action, reason, reviewer, now_utc),
            )
            updated = conn.execute(
                "UPDATE finding SET state = ?, seq = ? WHERE batch_id = ? AND finding_id = ? AND seq = ?",
                (next_state, seq, batch_id, finding_id, current.seq),
            )
            if updated.rowcount != 1:  # defensive; BEGIN IMMEDIATE already serializes writers
                raise sqlite3.IntegrityError("concurrent review update")
            return ReviewOutcome("ok", self._get_finding(conn, batch_id, finding_id))
