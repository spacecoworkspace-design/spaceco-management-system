-- LOCK: only SpaceCo accounts (role staff, admin or owner) can read or change data.
--
-- Run ONLY after:
--   1. every device has refreshed and signed in with an account,
--   2. a fresh full backup has been taken.
-- Run in Supabase -> SQL Editor, at a quiet hour.
--
-- What it does, for every table in the public schema:
--   - turns on row level security,
--   - removes every existing policy (the old "anyone with the public key" ones),
--   - adds one policy: signed-in users whose account role (app_metadata.role, which
--     users cannot change themselves) is staff, admin or owner may read and write.
--     A stranger who signs up on their own gets no role, so gets nothing.
-- The public key alone ('anon') then gets nothing. Server functions use the
-- service key and are not affected (public-booking, staff-accounts, grace-period-check).
-- It also stops anonymous uploads to the 'receipts' storage bucket and makes it private.
--
-- UNDO: run 03_unlock_database.sql.

do $$
declare
  t record;
  p record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t.tablename loop
      execute format('drop policy %I on public.%I', p.policyname, t.tablename);
    end loop;
    execute format(
      'create policy "spaceco_accounts_only" on public.%I for all to authenticated '
      || 'using ((auth.jwt() -> ''app_metadata'' ->> ''role'') in (''staff'', ''admin'', ''owner'')) '
      || 'with check ((auth.jwt() -> ''app_metadata'' ->> ''role'') in (''staff'', ''admin'', ''owner''))',
      t.tablename);
    execute format('revoke all on public.%I from anon', t.tablename);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t.tablename);
  end loop;
end $$;

drop policy if exists "receipts_anon_upload" on storage.objects;
drop policy if exists "receipts_public_read" on storage.objects;
update storage.buckets set public = false where id = 'receipts';

-- Check: every public table should show rls_on = true and one policy, spaceco_accounts_only.
select c.relname as table_name, c.relrowsecurity as rls_on,
       (select string_agg(policyname, '; ') from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;
