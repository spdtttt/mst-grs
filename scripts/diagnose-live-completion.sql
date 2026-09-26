-- Read-only: inspect the trigger that may still reference removed term columns.
select t.tgname, pg_get_triggerdef(t.oid) as trigger_definition,
       p.proname, pg_get_functiondef(p.oid) as function_definition
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.grade_records'::regclass and not t.tgisinternal;
