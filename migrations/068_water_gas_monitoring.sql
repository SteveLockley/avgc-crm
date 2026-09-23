-- Water and gas monitoring, and the record of what we changed.
--
-- Until now the energy tables held electricity only. The NECF carbon project
-- also has to account for water and gas, and — more importantly — has to show
-- the effect of each intervention. That needs three things: meters that know
-- what they measure, consumption in the right unit, and a dated record of the
-- changes themselves so a "before" and "after" window is data rather than
-- somebody's recollection.
--
-- energy_meters.mpan is the supply identifier for every utility: MPAN for
-- electricity, MPRN for gas, SPID or meter serial for water. The column keeps
-- its name because the electricity importers and pages already bind to it.

-- What the meter measures, and who supplies it.
ALTER TABLE energy_meters ADD COLUMN unit TEXT NOT NULL DEFAULT 'kWh';   -- 'kWh' | 'm3'
ALTER TABLE energy_meters ADD COLUMN supplier TEXT;
ALTER TABLE energy_meters ADD COLUMN notes TEXT;

-- Bill lines gain a unit and an explicit billed period, so gas and water bills
-- share the table with electricity. Existing rows are all electricity in kWh,
-- which is what the default gives them.
ALTER TABLE energy_bill_lines ADD COLUMN unit TEXT NOT NULL DEFAULT 'kWh';
ALTER TABLE energy_bill_lines ADD COLUMN period_from TEXT;
ALTER TABLE energy_bill_lines ADD COLUMN period_to TEXT;
ALTER TABLE energy_bill_lines ADD COLUMN standing_charge REAL;

-- Meter readings taken by hand. Water is read off the meter rather than
-- exported, and the course meter has no logger at all, so this is the only
-- record of consumption between bills. consumption is filled in on import by
-- differencing against the previous reading for the same meter.
CREATE TABLE IF NOT EXISTS utility_readings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mpan         TEXT NOT NULL,
  reading_date TEXT NOT NULL,
  reading      REAL NOT NULL,          -- the figure on the dial
  consumption  REAL,                   -- since the previous reading, same unit as the meter
  unit         TEXT NOT NULL DEFAULT 'm3',
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'bill', 'logger', 'import')),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (mpan, reading_date)
);

CREATE INDEX IF NOT EXISTS idx_utility_readings_meter ON utility_readings(mpan, reading_date);

-- Smart thermostat logs. These are not consumption — they are how the heating
-- actually ran, which is what shows whether the controls changed behaviour over
-- the winter. Gas consumption itself arrives on the bills.
CREATE TABLE IF NOT EXISTS thermostat_readings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  zone          TEXT NOT NULL,         -- 'clubhouse', 'cellar', 'changing rooms'...
  reading_date  TEXT NOT NULL,
  reading_time  TEXT NOT NULL,         -- 'HH:MM'
  temperature   REAL,                  -- measured, °C
  setpoint      REAL,                  -- target, °C
  humidity      REAL,
  heat_on       INTEGER,               -- 1 when calling for heat, 0 when not
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (zone, reading_date, reading_time)
);

CREATE INDEX IF NOT EXISTS idx_thermostat_zone_date ON thermostat_readings(zone, reading_date);

-- The changes we made, dated. Each row defines the boundary between a "before"
-- and an "after" window on one meter or one circuit, so a saving is computed
-- from the readings either side rather than asserted. baseline_from/until pin
-- the comparison windows explicitly where the obvious ones would be misleading
-- — a cooler measured only in August cannot be annualised off that alone.
CREATE TABLE IF NOT EXISTS energy_interventions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL DEFAULT 'electricity'
    CHECK (category IN ('electricity', 'gas', 'water', 'oil', 'other')),

  -- What it affects: a whole meter, or one logger circuit on one meter.
  mpan            TEXT,                -- supply identifier, when it affects a whole supply
  meter_name      TEXT,                -- logger meter, e.g. 'clubhouse'
  circuit         TEXT,                -- logger circuit, e.g. 'circuit3'

  changed_on      TEXT NOT NULL,       -- the day the change took effect
  baseline_from   TEXT,                -- explicit before-window, else everything before changed_on
  baseline_until  TEXT,
  measured_from   TEXT,                -- explicit after-window, else everything from changed_on
  measured_until  TEXT,

  cost            REAL,                -- what the change cost the club, ex VAT
  funded_by       TEXT NOT NULL DEFAULT 'club'
    CHECK (funded_by IN ('club', 'necf', 'other')),   -- keeps grant spend separate from club spend

  expected_saving TEXT,                -- what we predicted, in words
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  created_by      TEXT
);

CREATE INDEX IF NOT EXISTS idx_energy_interventions_date ON energy_interventions(changed_on);

-- Existing meters are all electricity in kWh; make that explicit.
UPDATE energy_meters SET unit = 'kWh' WHERE type = 'electricity';
