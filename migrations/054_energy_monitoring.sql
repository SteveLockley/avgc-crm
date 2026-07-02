-- Energy Monitoring: meters, smart meter readings, bill lines

CREATE TABLE IF NOT EXISTS energy_meters (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  mpan     TEXT    UNIQUE NOT NULL,
  serial   TEXT,
  name     TEXT    NOT NULL,
  location TEXT,
  address  TEXT,
  type     TEXT    NOT NULL DEFAULT 'electricity',
  has_smart INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS energy_smart_readings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  mpan           TEXT NOT NULL,
  reading_date   TEXT NOT NULL,
  interval_time  TEXT NOT NULL,
  kwh            REAL NOT NULL,
  UNIQUE(mpan, reading_date, interval_time)
);

CREATE INDEX IF NOT EXISTS idx_energy_smart_mpan_date
  ON energy_smart_readings(mpan, reading_date);

CREATE TABLE IF NOT EXISTS energy_bill_lines (
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
  UNIQUE(invoice_number, mpan, register_id)
);

CREATE INDEX IF NOT EXISTS idx_energy_bill_mpan
  ON energy_bill_lines(mpan, invoice_date);
