-- Widen unique constraint on energy_bill_lines to include opening_read_date.
-- The previous key (invoice_number, mpan, register_id) silently drops the second
-- row when a single invoice covers two consecutive read periods with the same
-- register ID (e.g. a mid-month meter read splitting the billing period in two).
-- Adding opening_read_date allows both rows to coexist.

PRAGMA foreign_keys = OFF;

CREATE TABLE energy_bill_lines_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  mpan               TEXT NOT NULL,
  invoice_number     TEXT NOT NULL,
  invoice_date       TEXT NOT NULL,
  due_date           TEXT,
  opening_read       INTEGER,
  opening_read_date  TEXT,
  opening_read_type  TEXT,
  closing_read       INTEGER,
  closing_read_date  TEXT,
  closing_read_type  TEXT,
  register_id        TEXT,
  advance_units_kwh  REAL,
  net_amount         REAL,
  vat_amount         REAL,
  invoice_amount     REAL,
  vat_rate           REAL,
  ccl_amount         REAL,
  status             TEXT,
  UNIQUE(invoice_number, mpan, register_id, opening_read_date)
);

INSERT INTO energy_bill_lines_new SELECT * FROM energy_bill_lines;

DROP TABLE energy_bill_lines;
ALTER TABLE energy_bill_lines_new RENAME TO energy_bill_lines;

PRAGMA foreign_keys = ON;
