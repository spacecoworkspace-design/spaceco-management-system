-- Lets signed-in accounts use every public table (products, WhatsApp templates/logs,
-- stock tables, spaceco_kv). Some tables only had policies "TO anon", so once staff
-- signed in with accounts those tables looked empty (e.g. no drinks/snacks).
-- Additive only: removes nothing and does not lock out the public key.
-- 02_lock_database.sql later removes the anon policies.

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop policy if exists "signed_in_staff_all" on public.%I', t.tablename);
    execute format('create policy "signed_in_staff_all" on public.%I for all to authenticated using (true) with check (true)', t.tablename);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t.tablename);
  end loop;
end $$;
