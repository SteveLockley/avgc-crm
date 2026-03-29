-- Set opening hours to 8:45 am - 7 pm for all days
-- Days: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday

-- Clear existing hours and insert fresh
DELETE FROM opening_hours WHERE location = 'Clubhouse';

INSERT INTO opening_hours (location, period_name, day_of_week, open_time, close_time, is_closed, sort_order)
VALUES
  ('Clubhouse', 'Standard', 0, '08:45', '19:00', 0, 0),
  ('Clubhouse', 'Standard', 1, '08:45', '19:00', 0, 1),
  ('Clubhouse', 'Standard', 2, '08:45', '19:00', 0, 2),
  ('Clubhouse', 'Standard', 3, '08:45', '19:00', 0, 3),
  ('Clubhouse', 'Standard', 4, '08:45', '19:00', 0, 4),
  ('Clubhouse', 'Standard', 5, '08:45', '19:00', 0, 5),
  ('Clubhouse', 'Standard', 6, '08:45', '19:00', 0, 6);
