-- Courtesy tee times for NGU Junior Spring Open, 14th April 2025
-- Each slot holds up to 4 players (member IDs)

CREATE TABLE IF NOT EXISTS courtesy_tee_times (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course TEXT NOT NULL,
  tee_time TEXT NOT NULL,        -- e.g. '11:36'
  player1_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  player2_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  player3_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  player4_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO courtesy_tee_times (course, tee_time) VALUES
  ('Blyth', '11:36'),
  ('Stocksfield', '10:00'),
  ('Stocksfield', '10:10'),
  ('Newbiggin', '13:00'),
  ('Longhirst', '13:32'),
  ('Ponteland', '10:20'),
  ('The Northumberland', '13:00'),
  ('The Northumberland', '13:40'),
  ('Backworth', '15:30'),
  ('Close House (Filly)', '14:00'),
  ('Close House (Filly)', '14:10'),
  ('Rothbury', '12:00'),
  ('Magdalene Fields', '11:40'),
  ('Magdalene Fields', '11:50'),
  ('Gosforth (Bridle Path)', '14:00'),
  ('Gosforth (Bridle Path)', '14:08'),
  ('Alnwick Castle', '11:00'),
  ('Whitley Bay', '12:36'),
  ('Whitley Bay', '12:44'),
  ('Whitley Bay', '12:52'),
  ('Bamburgh', '14:00'),
  ('Bamburgh', '14:10'),
  ('Prudhoe', '13:00'),
  ('Prudhoe', '13:10'),
  ('Matfen', '11:04'),
  ('Hexham', '12:00'),
  ('Bedlington', '11:48'),
  ('Bedlington', '11:56'),
  ('Tynemouth', '14:06'),
  ('Tynemouth', '14:14'),
  ('Seahouses', '11:30'),
  ('Westerhope', '12:36'),
  ('Burgham', '12:06'),
  ('City of Newcastle', '14:28'),
  ('Morpeth', '13:30'),
  ('Newcastle United GC', 'TBC'),
  ('Bellingham GC', 'TBC');
