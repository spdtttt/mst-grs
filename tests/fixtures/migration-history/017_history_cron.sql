-- Run as postgres in Supabase SQL Editor after 016_grade_record_history.sql.
-- Supabase Cron runs in the database even when nobody has the website open.
begin;
create extension if not exists pg_cron;
select cron.schedule(
  'mst-grs-archive-completed',
  '30 seconds',
  'select public.archive_completed_grade_records();'
);
commit;
