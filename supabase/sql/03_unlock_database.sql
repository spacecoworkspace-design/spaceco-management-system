-- EMERGENCY UNDO for 02_lock_database.sql.
-- Lets the public key read and write every public table again (the old, open
-- situation), so the app works even on devices that are not signed in.
-- Use only if something breaks after locking; then lock again once it is fixed.

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('grant select, insert, update, delete on public.%I to anon', t.tablename);
    execute format('drop policy if exists "temporary_open_anon" on public.%I', t.tablename);
    execute format(
      'create policy "temporary_open_anon" on public.%I for all to anon using (true) with check (true)',
      t.tablename);
  end loop;
end $$;
