-- Set all members' electronic communication consent to 'Yes'
UPDATE members
SET electronic_communication_consent = 'Yes',
    date_communication_consent_changed = date('now')
WHERE electronic_communication_consent IS NULL
   OR electronic_communication_consent != 'Yes';
