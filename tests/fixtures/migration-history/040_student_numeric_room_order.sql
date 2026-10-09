begin;

-- Sort room numbers numerically before pagination in both Admin rosters.
create or replace function public.admin_student_list(p_search text default '', p_level integer default null, p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อนักเรียนได้'; end if;
  if p_search is null or length(p_search)>150 or p_page is null or p_page not between 1 and 100000
    or (p_level is not null and p_level not between 1 and 6) then raise exception 'ตัวกรองไม่ถูกต้อง'; end if;
  with students as (
    select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?[1-6]/([0-9]+)$'))[1])::numeric as room
    from public.profiles where role='student' and student_status='active'
  ), filtered as (
    select * from students where (p_level is null or level=p_level)
      and (strpos(lower(full_name),lower(trim(p_search)))>0 or strpos(student_code,trim(p_search))>0)
  ), page as (
    select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision,level,room from filtered
    order by level nulls last,room nulls last,case when room is null then classroom end nulls last,roll_number nulls last,student_code,id limit 50 offset (p_page-1)*50
  ) select jsonb_build_object('total',(select count(*) from filtered),
    'items',coalesce((select jsonb_agg(to_jsonb(page)-'level'-'room' order by level nulls last,room nulls last,case when room is null then classroom end nulls last,roll_number nulls last,student_code,id) from page),'[]'::jsonb),
    'levels',coalesce((select jsonb_agg(level order by level) from (select distinct level from students where level is not null) x),'[]'::jsonb)) into result;
  return result;
end;
$$;

create or replace function public.admin_student_lifecycle_list(
  p_search text default '', p_status text default 'active', p_level integer default null,
  p_classroom text default null, p_page integer default 1, p_page_size integer default 50
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'STUDENT_LIFECYCLE_FORBIDDEN'; end if;
  if p_status is null or p_status not in ('all','active','graduated','transferred','not_graduated') or p_search is null or length(p_search)>150
    or (p_level is not null and p_level not between 1 and 6) or length(p_classroom)>40
    or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (50,2000) then
    raise exception 'STUDENT_LIFECYCLE_INVALID';
  end if;
  with students as (
    select id,student_code,full_name,classroom,roll_number,account_revision,student_status,student_status_year,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?[1-6]/([0-9]+)$'))[1])::numeric as room
    from public.profiles where role='student'
  ), filtered as (
    select * from students where (p_status='all' or student_status=p_status)
      and (p_level is null or level=p_level) and (p_classroom is null or classroom=p_classroom)
      and (strpos(lower(full_name),lower(trim(p_search)))>0 or strpos(student_code,trim(p_search))>0)
  ), paged as (
    select id,student_code,full_name,classroom,roll_number,account_revision,student_status,student_status_year,level,room
    from filtered order by level nulls last,room nulls last,case when room is null then classroom end nulls last,roll_number nulls last,student_code,id limit p_page_size offset (p_page-1)*p_page_size
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(p)-'level'-'room' order by level nulls last,room nulls last,case when room is null then classroom end nulls last,roll_number nulls last,student_code,id) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'classrooms',coalesce((select jsonb_agg(classroom order by level nulls last,room nulls last,classroom) from (select distinct classroom,level,room from students where classroom is not null and (p_level is null or level=p_level)) c),'[]'::jsonb),
    'counts',jsonb_build_object('not_graduated',(select count(*) from students where student_status='not_graduated'),'active',(select count(*) from students where student_status='active'),
      'graduated',(select count(*) from students where student_status='graduated'),'transferred',(select count(*) from students where student_status='transferred'))
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_student_lifecycle_list(text,text,integer,text,integer,integer) from public,anon;
grant execute on function public.admin_student_lifecycle_list(text,text,integer,text,integer,integer) to authenticated;

notify pgrst,'reload schema';
commit;
