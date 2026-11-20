-- Marks the owner's sign-in account as Admin, shown in the app as "Youssef".
-- Run once in Supabase → SQL Editor. Replace YOUR_EMAIL with the email of the
-- account you created (keep the quotes). Nothing else is changed.
-- Users cannot change app_metadata themselves, so nobody else can make
-- themselves admin.

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                        || jsonb_build_object('role', 'admin', 'name', 'Youssef', 'must_change', false)
where email = lower('YOUR_EMAIL');

-- Check: should show one row with role admin.
select email, raw_app_meta_data ->> 'role' as role, raw_app_meta_data ->> 'name' as name
from auth.users
where raw_app_meta_data ->> 'role' = 'admin';
