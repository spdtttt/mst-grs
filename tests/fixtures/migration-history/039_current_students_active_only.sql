begin;

-- The current roster includes only active enrollment. All other statuses remain
-- searchable in the lifecycle page and keep their Auth and grade history.
create or replace function public.admin_student_list(p_search text default '', p_level integer default null, p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อนักเรียนได้'; end if;
  if p_search is null or length(p_search)>150 or p_page is null or p_page not between 1 and 100000
    or (p_level is not null and p_level not between 1 and 6) then raise exception 'ตัวกรองไม่ถูกต้อง'; end if;
  with students as (
    select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level
    from public.profiles where role='student' and student_status='active'
  ), filtered as (
    select * from students where (p_level is null or level=p_level)
      and (strpos(lower(full_name),lower(trim(p_search)))>0 or strpos(student_code,trim(p_search))>0)
  ), page as (
    select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision from filtered
    order by level nulls last,classroom,roll_number nulls last,student_code,id limit 50 offset (p_page-1)*50
  ) select jsonb_build_object('total',(select count(*) from filtered),
    'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),
    'levels',coalesce((select jsonb_agg(level order by level) from (select distinct level from students where level is not null) x),'[]'::jsonb)) into result;
  return result;
end;
$$;

create or replace function public.admin_student_import_summary(p_codes text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare existing integer; archived integer;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'STUDENT_LIFECYCLE_FORBIDDEN'; end if;
  if p_codes is null or cardinality(p_codes) not between 1 and 2000
    or exists(select 1 from unnest(p_codes) c where c is null or c !~ '^\d{5,10}$')
    or (select count(distinct c) from unnest(p_codes) c)<>cardinality(p_codes) then raise exception 'STUDENT_LIFECYCLE_INVALID'; end if;
  select count(*),count(*) filter(where student_status<>'active') into existing,archived
    from public.profiles where role='student' and student_code=any(p_codes);
  return jsonb_build_object('created',cardinality(p_codes)-existing,'updated',existing,'archived',archived);
end;
$$;
revoke all on function public.admin_student_import_summary(text[]) from public,anon;
grant execute on function public.admin_student_import_summary(text[]) to authenticated;

notify pgrst,'reload schema';
commit;
