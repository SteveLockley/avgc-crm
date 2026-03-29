-- Migration: Restructure subscriptions
-- - category field now holds subscription type (references payment_items)
-- - subscription_template only holds fee templates for zero-cost subscriptions
-- - Add new subscription types (Intermediate, Senior Loyalty, Life, Honorary, Gratis)

-- Deactivate old subscription payment items instead of deleting (to preserve foreign key references)
UPDATE payment_items SET active = 0 WHERE category = 'Subscription';

-- Insert all new subscription types
INSERT INTO payment_items (category, name, fee, description, active) VALUES
    -- Standard paid subscriptions
    ('Subscription', 'Full Home', 0, 'Full playing membership (Home club)', 1),
    ('Subscription', 'Full Away', 0, 'Full playing membership (Away club)', 1),
    ('Subscription', 'Under 30 Home', 0, 'Under 30 membership (Home club)', 1),
    ('Subscription', 'Under 30 Away', 0, 'Under 30 membership (Away club)', 1),
    ('Subscription', 'Intermediate Home', 0, 'Intermediate membership 18-20 (Home club)', 1),
    ('Subscription', 'Intermediate Away', 0, 'Intermediate membership 18-20 (Away club)', 1),
    ('Subscription', 'Junior Home', 0, 'Junior membership under 18 (Home club)', 1),
    ('Subscription', 'Junior Away', 0, 'Junior membership under 18 (Away club)', 1),
    ('Subscription', 'Senior Loyalty Home', 0, 'Senior Loyalty 65+ with 25+ years (Home club)', 1),
    ('Subscription', 'Senior Loyalty Away', 0, 'Senior Loyalty 65+ with 25+ years (Away club)', 1),
    ('Subscription', 'Over 80 Home', 0, 'Over 80 membership (Home club)', 1),
    ('Subscription', 'Over 80 Away', 0, 'Over 80 membership (Away club)', 1),
    -- Zero-cost subscriptions (may still owe fees)
    ('Subscription', 'Life', 0, 'Life membership - 50+ years of membership', 1),
    ('Subscription', 'Honorary', 0, 'Honorary membership - awarded by club', 1),
    ('Subscription', 'Gratis', 0, 'Gratis membership - complimentary', 1),
    -- Other subscription types
    ('Subscription', 'Social', 0, 'Social (non-playing) membership', 1),
    ('Subscription', 'Twilight', 0, 'Twilight playing membership', 1),
    ('Subscription', 'Out Of County (<100 miles)', 0, 'Out of county membership (less than 100 miles)', 1),
    ('Subscription', 'Out Of County (100+ miles)', 0, 'Out of county membership (100 miles or more)', 1);

-- Migrate existing data: copy subscription_template to category where category is empty or different
-- This handles the mapping from old subscription_template values to new category values
UPDATE members SET category =
    CASE
        -- Map old template format to new category names
        WHEN subscription_template LIKE '%Full Home%' THEN 'Full Home'
        WHEN subscription_template LIKE '%Full Away%' THEN 'Full Away'
        WHEN subscription_template LIKE '%Under 30 Home%' THEN 'Under 30 Home'
        WHEN subscription_template LIKE '%Under 30 Away%' THEN 'Under 30 Away'
        WHEN subscription_template LIKE '%Senior Home%' OR subscription_template LIKE '%Senior Loyalty Home%' THEN 'Senior Loyalty Home'
        WHEN subscription_template LIKE '%Senior Away%' OR subscription_template LIKE '%Senior Loyalty Away%' THEN 'Senior Loyalty Away'
        WHEN subscription_template LIKE '%Over 80%' AND home_away = 'A' THEN 'Over 80 Away'
        WHEN subscription_template LIKE '%Over 80%' THEN 'Over 80 Home'
        WHEN subscription_template LIKE '%Junior Home%' THEN 'Junior Home'
        WHEN subscription_template LIKE '%Junior Academy%' THEN 'Junior Home'
        WHEN subscription_template LIKE '%Junior Away%' THEN 'Junior Away'
        WHEN subscription_template LIKE '%Intermediate Home%' THEN 'Intermediate Home'
        WHEN subscription_template LIKE '%Intermediate Away%' THEN 'Intermediate Away'
        WHEN subscription_template LIKE '%Life%' THEN 'Life'
        WHEN subscription_template LIKE '%Honorary%' THEN 'Honorary'
        WHEN subscription_template LIKE '%Gratis%' THEN 'Gratis'
        WHEN subscription_template LIKE '%Social%' THEN 'Social'
        WHEN subscription_template LIKE '%Twilight%' THEN 'Twilight'
        WHEN subscription_template LIKE '%Out Of County%Less than 100%' OR subscription_template LIKE '%Out Of County%<100%' THEN 'Out Of County (<100 miles)'
        WHEN subscription_template LIKE '%Out Of County%100 miles or more%' OR subscription_template LIKE '%Out Of County%100+%' THEN 'Out Of County (100+ miles)'
        ELSE category
    END
WHERE subscription_template IS NOT NULL AND subscription_template != '';

-- Clear subscription_template for non-zero-cost subscriptions
-- Only Life, Honorary, and Gratis should have fee templates
UPDATE members SET subscription_template = NULL
WHERE category NOT IN ('Life', 'Honorary', 'Gratis') OR category IS NULL;

-- For Life/Honorary/Gratis members, set the appropriate fee template based on their situation
-- Template logic:
-- - If has CDH (national_id) AND home club (home_away='H') -> needs EGU + County fees
-- - If has locker_number -> needs locker fees
-- Three templates:
--   'England Golf and County Fees'
--   'England Golf and County Fees and Locker'
--   'Locker'

UPDATE members SET subscription_template =
    CASE
        WHEN (national_id IS NOT NULL AND national_id != '' AND home_away = 'H')
             AND (locker_number IS NOT NULL AND locker_number != '')
            THEN 'England Golf and County Fees and Locker'
        WHEN (national_id IS NOT NULL AND national_id != '' AND home_away = 'H')
            THEN 'England Golf and County Fees'
        WHEN (locker_number IS NOT NULL AND locker_number != '')
            THEN 'Locker'
        ELSE NULL
    END
WHERE category IN ('Life', 'Honorary', 'Gratis');

-- Create index on payment_items for faster lookups
CREATE INDEX IF NOT EXISTS idx_payment_items_name ON payment_items(name);
