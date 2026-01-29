-- Migration: Merge Home/Away subscription variants into base types
-- The home/away status is tracked in the home_away field, not in the subscription type

-- First, update members to use base subscription types (strip Home/Away suffix)
UPDATE members SET category = 'Full' WHERE category IN ('Full Home', 'Full Away');
UPDATE members SET category = 'Under 30' WHERE category IN ('Under 30 Home', 'Under 30 Away');
UPDATE members SET category = 'Intermediate' WHERE category IN ('Intermediate Home', 'Intermediate Away');
UPDATE members SET category = 'Junior' WHERE category IN ('Junior Home', 'Junior Away');
UPDATE members SET category = 'Senior Loyalty' WHERE category IN ('Senior Loyalty Home', 'Senior Loyalty Away');
UPDATE members SET category = 'Over 80' WHERE category IN ('Over 80 Home', 'Over 80 Away');
UPDATE members SET category = 'Out Of County (<100 miles)' WHERE category = 'Out Of County (<100 miles)';
UPDATE members SET category = 'Out Of County (100+ miles)' WHERE category = 'Out Of County (100+ miles)';

-- Deactivate the Home/Away variant payment items
UPDATE payment_items SET active = 0 WHERE name IN (
  'Full Home', 'Full Away',
  'Under 30 Home', 'Under 30 Away',
  'Intermediate Home', 'Intermediate Away',
  'Junior Home', 'Junior Away',
  'Senior Loyalty Home', 'Senior Loyalty Away',
  'Over 80 Home', 'Over 80 Away'
);

-- Insert the base subscription types (if they don't exist)
INSERT OR IGNORE INTO payment_items (category, name, fee, description, active) VALUES
  ('Subscription', 'Full', 0, 'Full playing membership', 1),
  ('Subscription', 'Under 30', 0, 'Under 30 membership (21-29)', 1),
  ('Subscription', 'Intermediate', 0, 'Intermediate membership (18-20)', 1),
  ('Subscription', 'Junior', 0, 'Junior membership (under 18)', 1),
  ('Subscription', 'Senior Loyalty', 0, 'Senior Loyalty membership (65+ with 25+ years)', 1),
  ('Subscription', 'Over 80', 0, 'Over 80 membership', 1);

-- Ensure the other subscription types are active
UPDATE payment_items SET active = 1 WHERE name IN (
  'Life', 'Honorary', 'Gratis', 'Social', 'Twilight',
  'Out Of County (<100 miles)', 'Out Of County (100+ miles)'
) AND category = 'Subscription';
