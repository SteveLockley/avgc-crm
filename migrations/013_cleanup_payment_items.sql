-- Clean up inactive subscription items (except id 18 which has invoice references)
DELETE FROM payment_items WHERE category = 'Subscription' AND active = 0 AND id <> 18;
