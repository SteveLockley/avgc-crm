-- Add 9-hole price column
ALTER TABLE green_fees ADD COLUMN price_9_holes INTEGER;

-- Delete duplicate/old rows and re-insert clean 2026 data
DELETE FROM green_fees;

-- Insert 2026 green fees with 9-hole option
INSERT INTO green_fees (category, label, badge, price_9_holes, price_18_holes, price_day_ticket, price_weekday, price_weekend, is_featured, sort_order, year)
VALUES
  ('weekday', 'Weekday', 'Mon - Fri', NULL, 4500, 5500, NULL, NULL, 0, 1, 2026),
  ('weekend', 'Weekend', 'Sat - Sun', NULL, 5500, 7000, NULL, NULL, 1, 2, 2026),
  ('twilight', 'Twilight', 'After 2pm', NULL, NULL, NULL, 3000, 3500, 0, 3, 2026),
  ('weekly', 'Weekly Ticket', '7 days', NULL, NULL, 12000, NULL, NULL, 0, 4, 2026);
