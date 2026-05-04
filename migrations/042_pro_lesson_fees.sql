-- Pro lesson fees table
CREATE TABLE IF NOT EXISTS pro_lesson_fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,               -- e.g., '30 min', '60 min', 'Junior'
  description TEXT,                  -- e.g., 'Individual Lesson', 'Group Lesson'
  price INTEGER NOT NULL,            -- Price in pence (3000 = £30)
  is_featured INTEGER DEFAULT 0,     -- Highlight this card
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO pro_lesson_fees (label, description, price, sort_order) VALUES
('30 min', 'Individual Lesson', 3000, 1);

INSERT INTO pro_lesson_fees (label, description, price, is_featured, sort_order) VALUES
('60 min', 'Individual Lesson', 5000, 1, 2);

INSERT INTO pro_lesson_fees (label, description, price, sort_order) VALUES
('Junior', 'Lesson', 2500, 3);

INSERT INTO pro_lesson_fees (label, description, price, sort_order) VALUES
('Group', 'Lesson', 6000, 4);
