-- Fix phone number placement: mobile (07/7) → telephone_1, landline → telephone_2
-- Uses REPLACE to strip spaces before checking prefix

-- Step 1: Both fields populated, but they're in the wrong columns
-- telephone_1 has landline, telephone_2 has mobile → swap them
UPDATE members
SET telephone_1 = telephone_2,
    telephone_2 = telephone_1
WHERE telephone_1 IS NOT NULL AND telephone_1 <> ''
  AND telephone_2 IS NOT NULL AND telephone_2 <> ''
  AND (REPLACE(telephone_1, ' ', '') NOT LIKE '07%' AND REPLACE(telephone_1, ' ', '') NOT LIKE '7%')
  AND (REPLACE(telephone_2, ' ', '') LIKE '07%' OR REPLACE(telephone_2, ' ', '') LIKE '7%');

-- Step 2: Only telephone_2 populated and it's a mobile → move to telephone_1
UPDATE members
SET telephone_1 = telephone_2,
    telephone_2 = NULL
WHERE (telephone_1 IS NULL OR telephone_1 = '')
  AND telephone_2 IS NOT NULL AND telephone_2 <> ''
  AND (REPLACE(telephone_2, ' ', '') LIKE '07%' OR REPLACE(telephone_2, ' ', '') LIKE '7%');

-- Step 3: Only telephone_1 populated and it's a landline → move to telephone_2
UPDATE members
SET telephone_2 = telephone_1,
    telephone_1 = NULL
WHERE telephone_1 IS NOT NULL AND telephone_1 <> ''
  AND (telephone_2 IS NULL OR telephone_2 = '')
  AND (REPLACE(telephone_1, ' ', '') NOT LIKE '07%' AND REPLACE(telephone_1, ' ', '') NOT LIKE '7%');

-- Step 4: Both populated, both mobile (duplicates) → keep in telephone_1, clear telephone_2 if same
UPDATE members
SET telephone_2 = NULL
WHERE telephone_1 IS NOT NULL AND telephone_1 <> ''
  AND telephone_2 IS NOT NULL AND telephone_2 <> ''
  AND REPLACE(telephone_1, ' ', '') = REPLACE(telephone_2, ' ', '');

-- Step 5: Prepend leading 0 to UK numbers missing it (e.g. 7767120196 → 07767120196)
UPDATE members SET telephone_1 = '0' || telephone_1 WHERE telephone_1 IS NOT NULL AND telephone_1 != '' AND substr(REPLACE(telephone_1, ' ', ''),1,1) != '0' AND substr(REPLACE(telephone_1, ' ', ''),1,1) != '+';
UPDATE members SET telephone_2 = '0' || telephone_2 WHERE telephone_2 IS NOT NULL AND telephone_2 != '' AND substr(REPLACE(telephone_2, ' ', ''),1,1) != '0' AND substr(REPLACE(telephone_2, ' ', ''),1,1) != '+';
UPDATE members SET telephone_3 = '0' || telephone_3 WHERE telephone_3 IS NOT NULL AND telephone_3 != '' AND substr(REPLACE(telephone_3, ' ', ''),1,1) != '0' AND substr(REPLACE(telephone_3, ' ', ''),1,1) != '+';
