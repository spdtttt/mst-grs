-- Apply after 004_academic_schedule.sql. Existing RLS grants manager access to
-- their own profile and the schedule, but not to grade records or mutations.
alter type public.app_role add value if not exists 'manager';
