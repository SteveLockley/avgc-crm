-- Sub-metering logger: circuit metadata and hourly readings

CREATE TABLE IF NOT EXISTS energy_logger_circuits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meter_name  TEXT NOT NULL,
  circuit     TEXT NOT NULL,  -- immutable key: 'main', 'circuit1', etc.
  label       TEXT NOT NULL,  -- user-editable display name
  UNIQUE(meter_name, circuit)
);

CREATE TABLE IF NOT EXISTS energy_logger_readings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  meter_name   TEXT NOT NULL,
  reading_date TEXT NOT NULL,
  reading_hour INTEGER NOT NULL,
  circuit      TEXT NOT NULL,
  kwh          REAL NOT NULL,
  UNIQUE(meter_name, reading_date, reading_hour, circuit)
);

CREATE INDEX IF NOT EXISTS idx_energy_logger_date
  ON energy_logger_readings(meter_name, reading_date, reading_hour);
