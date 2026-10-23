-- Preflight Finance Stage 1 schema (schema_version 1).
-- Normalized entities with stable text IDs; the seed of the later financial
-- knowledge graph (vendor -> invoice -> finding -> review_event). Imported
-- invoices and review events are append-only at the application level. The
-- owner of this file can still alter it: this is not a tamper-proof audit log.

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batch (
    batch_id        TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    sha256          TEXT NOT NULL,
    ruleset         TEXT NOT NULL,
    imported_at_utc TEXT NOT NULL,
    row_count       INTEGER NOT NULL,
    UNIQUE (sha256, ruleset)
);

CREATE TABLE IF NOT EXISTS vendor (
    vendor_norm      TEXT PRIMARY KEY,
    first_seen_batch TEXT NOT NULL REFERENCES batch (batch_id)
);

CREATE TABLE IF NOT EXISTS invoice (
    batch_id     TEXT NOT NULL REFERENCES batch (batch_id),
    record_id    TEXT NOT NULL,
    row_number   INTEGER NOT NULL,
    raw_json     TEXT NOT NULL,
    vendor_norm  TEXT NOT NULL REFERENCES vendor (vendor_norm),
    invoice_norm TEXT NOT NULL,
    invoice_date TEXT NOT NULL,
    currency     TEXT NOT NULL CHECK (currency = 'USD'),
    subtotal_c   INTEGER NOT NULL CHECK (subtotal_c >= 0),
    tax_c        INTEGER NOT NULL CHECK (tax_c >= 0),
    shipping_c   INTEGER NOT NULL CHECK (shipping_c >= 0),
    discount_c   INTEGER NOT NULL CHECK (discount_c >= 0),
    total_c      INTEGER NOT NULL CHECK (total_c >= 0),
    PRIMARY KEY (batch_id, record_id)
);

CREATE TABLE IF NOT EXISTS finding (
    batch_id        TEXT NOT NULL REFERENCES batch (batch_id),
    finding_id      TEXT NOT NULL,
    rule_id         TEXT NOT NULL,
    rule_version    TEXT NOT NULL,
    member_ids_json TEXT NOT NULL,
    evidence_json   TEXT NOT NULL,
    state           TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'confirmed', 'dismissed')),
    seq             INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (batch_id, finding_id)
);

CREATE TABLE IF NOT EXISTS finding_member (
    batch_id   TEXT NOT NULL,
    finding_id TEXT NOT NULL,
    record_id  TEXT NOT NULL,
    PRIMARY KEY (batch_id, finding_id, record_id),
    FOREIGN KEY (batch_id, finding_id) REFERENCES finding (batch_id, finding_id),
    FOREIGN KEY (batch_id, record_id) REFERENCES invoice (batch_id, record_id)
);

CREATE TABLE IF NOT EXISTS review_event (
    event_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id   TEXT NOT NULL,
    finding_id TEXT NOT NULL,
    seq        INTEGER NOT NULL CHECK (seq >= 1),
    prev_state TEXT NOT NULL,
    next_state TEXT NOT NULL,
    action     TEXT NOT NULL CHECK (action IN ('confirm', 'dismiss', 'reopen')),
    reason     TEXT NOT NULL,
    reviewer   TEXT NOT NULL,
    at_utc     TEXT NOT NULL,
    UNIQUE (batch_id, finding_id, seq),
    FOREIGN KEY (batch_id, finding_id) REFERENCES finding (batch_id, finding_id)
);

CREATE TRIGGER IF NOT EXISTS review_event_no_update BEFORE UPDATE ON review_event
BEGIN SELECT RAISE(ABORT, 'review history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS review_event_no_delete BEFORE DELETE ON review_event
BEGIN SELECT RAISE(ABORT, 'review history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS invoice_no_update BEFORE UPDATE ON invoice
BEGIN SELECT RAISE(ABORT, 'imported invoices are immutable; import a corrected file as a new batch'); END;
CREATE TRIGGER IF NOT EXISTS invoice_no_delete BEFORE DELETE ON invoice
BEGIN SELECT RAISE(ABORT, 'imported invoices are immutable'); END;

INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
