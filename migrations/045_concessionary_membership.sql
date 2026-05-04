-- Add Concessionary membership type.
-- £50/year subscription; eligible for Home EGU + County fees when home_away = 'H' and CDH set.
INSERT INTO payment_items (category, name, fee, description, active)
VALUES ('Subscription', 'Concessionary', 50, 'Concessionary membership — £50/year, eligible for Home EGU fees', 1);
