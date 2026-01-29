-- Migration: Fix subscription fees on base types
-- The new base subscription types were created with fee = 0, need to copy fees from original items

UPDATE payment_items SET fee = 432 WHERE name = 'Full' AND category = 'Subscription' AND active = 1 AND fee = 0;
UPDATE payment_items SET fee = 327.5 WHERE name = 'Under 30' AND category = 'Subscription' AND active = 1 AND fee = 0;
UPDATE payment_items SET fee = 139 WHERE name = 'Intermediate' AND category = 'Subscription' AND active = 1 AND fee = 0;
UPDATE payment_items SET fee = 70 WHERE name = 'Junior' AND category = 'Subscription' AND active = 1 AND fee = 0;
UPDATE payment_items SET fee = 321 WHERE name = 'Senior Loyalty' AND category = 'Subscription' AND active = 1 AND fee = 0;
UPDATE payment_items SET fee = 186 WHERE name = 'Over 80' AND category = 'Subscription' AND active = 1 AND fee = 0;

-- Also fix Out Of County fees
UPDATE payment_items SET fee = 301.5 WHERE name = 'Out Of County (<100 miles)' AND category = 'Subscription' AND active = 1 AND fee = 0;
UPDATE payment_items SET fee = 224.5 WHERE name = 'Out Of County (100+ miles)' AND category = 'Subscription' AND active = 1 AND fee = 0;

-- Clean up duplicate entries (keep the one with non-zero fee or the first one)
DELETE FROM payment_items WHERE id IN (
  SELECT p1.id FROM payment_items p1
  INNER JOIN payment_items p2 ON p1.name = p2.name AND p1.category = p2.category AND p1.id > p2.id
  WHERE p1.active = 1 AND p2.active = 1
);
