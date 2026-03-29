-- Opening hours table with periods and day-specific times
CREATE TABLE IF NOT EXISTS opening_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location TEXT NOT NULL DEFAULT 'Clubhouse',  -- e.g., 'Clubhouse', 'Bar', 'Catering'
  period_name TEXT,                            -- e.g., 'Summer', 'Winter', 'Christmas'
  period_start DATE,                           -- Start date for this period (NULL = all year)
  period_end DATE,                             -- End date for this period (NULL = all year)
  day_of_week INTEGER,                         -- 0=Sunday, 1=Monday, ... 6=Saturday (NULL = all days)
  open_time TEXT NOT NULL,                     -- e.g., '08:00'
  close_time TEXT NOT NULL,                    -- e.g., '21:00' or 'Dusk' or 'Late'
  is_closed INTEGER DEFAULT 0,                 -- 1 if closed on this day/period
  notes TEXT,                                  -- e.g., 'Last orders 30 mins before close'
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert default opening hours (all year, all days)
INSERT INTO opening_hours (location, open_time, close_time, sort_order) VALUES
  ('Clubhouse', '08:00', 'Dusk', 1);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_opening_hours_lookup
ON opening_hours(location, period_start, period_end, day_of_week);
