-- Schedules the grace-period-check Edge Function to run every minute, so the
-- 20-minute no-show auto-cancel keeps working even if every staff device is
-- closed (client-side JS can't guarantee that; a database-scheduled job can).
--
-- IMPORTANT — before running this:
-- 1. Deploy the function first: supabase functions deploy grace-period-check
-- 2. Replace <SERVICE_ROLE_KEY> below with the real service role key from
--    Project Settings > API. Do NOT commit the real key to this file/repo —
--    fill it in only in the Supabase SQL Editor when you actually run this,
--    or better, paste this with the key substituted directly into the SQL
--    Editor rather than editing this file on disk.
-- 3. Run once, manually, via the SQL Editor (or `supabase db push` if you'd
--    rather keep the substituted version out of git entirely and apply it
--    by hand instead of committing it).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select
  cron.schedule(
    'grace-period-check-every-minute',
    '* * * * *',
    $$
    select net.http_post(
      url := 'https://vfevpvfaeiwltixgdmln.supabase.co/functions/v1/grace-period-check',
      headers := jsonb_build_object(
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    ) as request_id;
    $$
  );

-- To check it's running: select * from cron.job where jobname = 'grace-period-check-every-minute';
-- To see recent runs:     select * from cron.job_run_details order by start_time desc limit 20;
-- To remove it later:     select cron.unschedule('grace-period-check-every-minute');
