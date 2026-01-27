-- Fix payment_items table with correct subscription types from Payment Items.csv

-- Clear existing subscription items
DELETE FROM payment_items WHERE category = 'Subscription';

-- Insert correct subscription items
INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Full', 432, 'Full access to all facilities throughout the year');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Senior Loyalty', 318, 'Over 65 years of age with 25 years continuous membership');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Over 80', 186, 'Over 80 years of age at the start of the year');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Under 30', 330, '21 - 29 years of age at the start of the season');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Intermediate', 138, '18 - 20 years of age at the start of the season');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Junior', 70, 'Full playing member');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Out of County - Near', 300, 'Resident 60 - 99 miles from AVGC');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Out of County - Far', 222, 'Resident at least 100 miles from AVGC');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Twilight', 210, '1st April till the 30th September after 3 pm');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'PGA Professional', 70, NULL);

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Social', 50, 'NE66 or NE65 postcodes only');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Junior Academy', 40, 'Only attend the lessons with the Pro, no course access');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Gratis', 0, 'Staff, Captains, Pro');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Winter', 240, '1st October to the 31st March');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'International', 50, 'Can only play 5 number 9 hole games in a year');

INSERT INTO payment_items (category, name, fee, description) VALUES
('Subscription', 'Honorary or Life', 0, 'Over 50 years membership or honorary');

-- Update existing members subscription_template to new format
UPDATE members SET subscription_template = 'Full' WHERE subscription_template IN ('A) Full Home', 'B) Full Away', '3) 18 Month Full Membership');
UPDATE members SET subscription_template = 'Under 30' WHERE subscription_template IN ('C) Under 30 Home', 'D) Under 30 Away');
UPDATE members SET subscription_template = 'Senior Loyalty' WHERE subscription_template IN ('E) Senior Home', 'F) Senior Away');
UPDATE members SET subscription_template = 'Over 80' WHERE subscription_template IN ('G) Over 80 Home', 'H) Over 80 Away');
UPDATE members SET subscription_template = 'Intermediate' WHERE subscription_template IN ('I) Intermediate Home');
UPDATE members SET subscription_template = 'Winter' WHERE subscription_template = 'K) Winter Membership';
UPDATE members SET subscription_template = 'Junior' WHERE subscription_template IN ('M) Junior Home', 'N) Junior Away');
UPDATE members SET subscription_template = 'Junior Academy' WHERE subscription_template = 'O) Junior Academy';
UPDATE members SET subscription_template = 'International' WHERE subscription_template = 'Q) International Membership';
UPDATE members SET subscription_template = 'Gratis' WHERE subscription_template IN ('R) Gratis Membership', 'Y) England Golf and Union Fees');
UPDATE members SET subscription_template = 'Social' WHERE subscription_template = 'S) Social Membership';
UPDATE members SET subscription_template = 'Twilight' WHERE subscription_template = 'T) Twilight Member';
UPDATE members SET subscription_template = 'Out of County - Near' WHERE subscription_template IN ('U) Out Of County (Less than 100 miles) Home Member', 'V) Out Of County (Less than 100 miles) Away Member');
UPDATE members SET subscription_template = 'Out of County - Far' WHERE subscription_template IN ('W) Out Of County (100 miles or more) Away Member', 'X) Out of County (100 miles or more) Home Member');
UPDATE members SET subscription_template = NULL WHERE subscription_template = 'None';
