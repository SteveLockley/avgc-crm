-- Replace Standard hours with seasonal Winter + Summer periods
DELETE FROM opening_hours WHERE location = 'Clubhouse';

-- Winter (Oct-Mar): 8:30am-4pm every day
INSERT INTO opening_hours (location, period_name, day_of_week, open_time, close_time, is_closed, sort_order)
VALUES
  ('Clubhouse', 'Winter', 0, '08:30', '16:00', 0, 0),
  ('Clubhouse', 'Winter', 1, '08:30', '16:00', 0, 1),
  ('Clubhouse', 'Winter', 2, '08:30', '16:00', 0, 2),
  ('Clubhouse', 'Winter', 3, '08:30', '16:00', 0, 3),
  ('Clubhouse', 'Winter', 4, '08:30', '16:00', 0, 4),
  ('Clubhouse', 'Winter', 5, '08:30', '16:00', 0, 5),
  ('Clubhouse', 'Winter', 6, '08:30', '16:00', 0, 6);

-- Summer (Apr-Sep): Different hours per day
-- Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=0
INSERT INTO opening_hours (location, period_name, day_of_week, open_time, close_time, is_closed, sort_order)
VALUES
  ('Clubhouse', 'Summer', 0, '08:30', '19:00', 0, 0),
  ('Clubhouse', 'Summer', 1, '08:30', '21:00', 0, 1),
  ('Clubhouse', 'Summer', 2, '08:30', '19:00', 0, 2),
  ('Clubhouse', 'Summer', 3, '08:30', '19:00', 0, 3),
  ('Clubhouse', 'Summer', 4, '08:30', '19:00', 0, 4),
  ('Clubhouse', 'Summer', 5, '08:30', '21:00', 0, 5),
  ('Clubhouse', 'Summer', 6, '08:30', '19:00', 0, 6);

-- Track Google Business Profile sync attempts
CREATE TABLE IF NOT EXISTS google_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  season TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
