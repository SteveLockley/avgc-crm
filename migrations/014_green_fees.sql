-- Green fees table for visitor pricing
CREATE TABLE IF NOT EXISTS green_fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,            -- e.g., 'weekday', 'weekend', 'twilight'
  label TEXT NOT NULL,               -- e.g., 'Weekday', 'Weekend', 'Twilight'
  badge TEXT,                        -- e.g., 'Mon - Fri', 'Sat - Sun', 'After 3pm'
  description TEXT,                  -- Optional description
  price_18_holes INTEGER,            -- Price in pence (4500 = £45.00)
  price_day_ticket INTEGER,          -- Day ticket price in pence
  price_weekday INTEGER,             -- For twilight: weekday price
  price_weekend INTEGER,             -- For twilight: weekend price
  is_featured INTEGER DEFAULT 0,     -- Highlight this card
  sort_order INTEGER DEFAULT 0,
  year INTEGER DEFAULT 2025,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Additional fees (buggies, trolleys, clubs, etc.)
CREATE TABLE IF NOT EXISTS additional_fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,            -- Price in pence
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Insert default green fees for 2025
INSERT INTO green_fees (category, label, badge, price_18_holes, price_day_ticket, sort_order, year) VALUES
('weekday', 'Weekday', 'Mon - Fri', 4500, 5500, 1, 2025);

INSERT INTO green_fees (category, label, badge, price_18_holes, price_day_ticket, is_featured, sort_order, year) VALUES
('weekend', 'Weekend', 'Sat - Sun', 5500, 7000, 1, 2, 2025);

INSERT INTO green_fees (category, label, badge, price_weekday, price_weekend, sort_order, year) VALUES
('twilight', 'Twilight', 'After 3pm', 3000, 3500, 3, 2025);

-- Insert default additional fees
INSERT INTO additional_fees (name, description, price, sort_order) VALUES
('Buggy Hire', 'Per round', 2500, 1),
('Trolley Hire', NULL, 500, 2),
('Club Hire', NULL, 1500, 3);
