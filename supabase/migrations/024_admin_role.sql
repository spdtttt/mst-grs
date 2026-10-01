-- Run this separately before 025 so the new enum value is committed first.
alter type public.app_role add value if not exists 'admin';
