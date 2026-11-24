-- STAGING ONLY: creates the tables a SpaceCo backup restores into.
-- Run this in the SQL editor of a NEW, EMPTY Supabase project (never production),
-- then run Tools/restore_backup.py against that project.
--
-- products, whatsapp_logs and whatsapp_templates come from the migrations in
-- supabase/migrations (run those files first, in name order, skipping the cron
-- and storage ones). spaceco_kv has no migration, so it is created here.

create table if not exists public.spaceco_kv (
  key   text primary key,
  value text
);

-- Staging copy is locked the same way as production: no access for the public key.
alter table public.spaceco_kv          enable row level security;
alter table public.products            enable row level security;
alter table public.whatsapp_logs       enable row level security;
alter table public.whatsapp_templates  enable row level security;
