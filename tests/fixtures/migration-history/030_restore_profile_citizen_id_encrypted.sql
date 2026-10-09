-- Repair databases where this column from migration 027 is missing.
-- Existing profiles remain valid: the encrypted identity is nullable.
begin;

alter table public.profiles
  add column if not exists citizen_id_encrypted text
  check (citizen_id_encrypted ~ '^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]{26}$');

notify pgrst, 'reload schema';

commit;
