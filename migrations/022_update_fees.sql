-- Remove twilight green fee
DELETE FROM green_fees WHERE category = 'twilight' AND year = 2026;

-- Update weekday: 9 holes £25, 18 holes £35, no day ticket
UPDATE green_fees SET
  price_9_holes = 2500,
  price_18_holes = 3500,
  price_day_ticket = NULL,
  badge = 'Mon - Fri',
  updated_at = datetime('now')
WHERE category = 'weekday' AND year = 2026;

-- Update weekend: 9 holes £30, 18 holes £40, no day ticket
UPDATE green_fees SET
  price_9_holes = 3000,
  price_18_holes = 4000,
  price_day_ticket = NULL,
  badge = 'Sat & Sun',
  updated_at = datetime('now')
WHERE category = 'weekend' AND year = 2026;

-- Replace additional fees with detailed buggy/trolley pricing
DELETE FROM additional_fees;

INSERT INTO additional_fees (name, description, price, sort_order, is_active) VALUES
  ('Visitor Buggy Hire', '18 Holes £30 / 9 Holes £25', 3000, 1, 1),
  ('Member Buggy Hire', '18 Holes £15 / 9 Holes £10', 1500, 2, 1),
  ('Push Trolley Hire', '18 Holes £6 / 9 Holes £4', 600, 3, 1);
