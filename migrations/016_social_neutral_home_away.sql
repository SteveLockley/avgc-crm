-- Social members are not golfers, so they should not have a home/away status
UPDATE members SET home_away = NULL WHERE category LIKE '%Social%' AND home_away IS NOT NULL;
