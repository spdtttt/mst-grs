begin;
-- A separate RPC name prevents older databases from silently using the unchecked rule.
drop function public.admin_change_student_status(jsonb,text,integer);
alter table public.profiles drop constraint profiles_student_status_check;
alter table public.profiles add constraint profiles_student_status_check
  check(student_status in ('active','graduated','transferred','not_graduated'));

create function public.admin_set_student_status(p_students jsonb,p_status text,p_year integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.profiles; wanted integer; matched integer := 0; changed integer := 0; graduated integer := 0; outstanding integer; actual_status text; not_graduated jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'STUDENT_LIFECYCLE_FORBIDDEN'; end if;
  if p_status is null or p_status not in ('active','graduated','transferred','not_graduated') or jsonb_typeof(p_students) is distinct from 'array' then
    raise exception 'STUDENT_LIFECYCLE_INVALID';
  end if;
  wanted := jsonb_array_length(p_students);
  if wanted not between 1 and 2000 or (p_status='active' and p_year is not null)
    or (p_status<>'active' and (p_year is null or p_year not between 2500 and 2800))
    or exists(select 1 from jsonb_array_elements(p_students) s where jsonb_typeof(s) is distinct from 'object'
      or coalesce(s->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or coalesce(s->>'revision','') !~ '^[0-9]{1,10}$') then raise exception 'STUDENT_LIFECYCLE_INVALID'; end if;
  if (select count(distinct (s->>'id')::uuid) from jsonb_array_elements(p_students) s)<>wanted then raise exception 'STUDENT_LIFECYCLE_INVALID'; end if;
  -- Match the lock order used by imports, account edits and closing the grading period.
  perform 1 from public.site_schedule where id=1 for share;
  lock table public.grade_records in share row exclusive mode;
  -- Deterministic locks and revisions prevent stale selections overwriting imports/edits.
  for target in select p.* from public.profiles p join jsonb_array_elements(p_students) s on p.id=(s->>'id')::uuid
    order by p.id for update of p
  loop
    if target.role<>'student' or not exists(select 1 from jsonb_array_elements(p_students) s
      where (s->>'id')::uuid=target.id and (s->>'revision')::bigint=target.account_revision) then
      raise exception 'STUDENT_LIFECYCLE_CHANGED';
    end if;
    matched := matched+1;
    actual_status := p_status;
    if p_status='graduated' then
      select count(*) into outstanding from public.grade_records where student_id=target.id and status<>'completed';
      if outstanding>0 then
        actual_status := 'not_graduated';
        not_graduated := not_graduated || jsonb_build_array(jsonb_build_object(
          'id',target.id,'student_code',target.student_code,'full_name',target.full_name,'outstanding_count',outstanding));
      end if;
    end if;
    if target.student_status is distinct from actual_status or target.student_status_year is distinct from p_year then
      update public.profiles set student_status=actual_status,student_status_year=p_year,student_status_changed_at=now() where id=target.id;
      insert into public.audit_log(actor_id,action) values(auth.uid(),'student_status_changed:' || jsonb_build_object(
        'id',target.id,'student_code',target.student_code,'classroom',target.classroom,
        'from',target.student_status,'from_year',target.student_status_year,'to',actual_status,'requested',p_status,'year',p_year)::text);
      changed := changed+1;
      if actual_status='graduated' then graduated := graduated+1; end if;
    end if;
  end loop;
  if matched<>wanted then raise exception 'STUDENT_LIFECYCLE_CHANGED'; end if;
  return jsonb_build_object('updated',changed,'graduated',graduated,'notGraduated',not_graduated);
end;
$$;
revoke all on function public.admin_set_student_status(jsonb,text,integer) from public,anon;
grant execute on function public.admin_set_student_status(jsonb,text,integer) to authenticated;

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
      ((regexp_match(classroom,'^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level
    from public.profiles where role='student'
  ), filtered as (
    select * from students where (p_status='all' or student_status=p_status)
      and (p_level is null or level=p_level) and (p_classroom is null or classroom=p_classroom)
      and (strpos(lower(full_name),lower(trim(p_search)))>0 or strpos(student_code,trim(p_search))>0)
  ), paged as (
    select id,student_code,full_name,classroom,roll_number,account_revision,student_status,student_status_year
    from filtered order by classroom,roll_number nulls last,student_code,id limit p_page_size offset (p_page-1)*p_page_size
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(p) order by classroom,roll_number nulls last,student_code,id) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'classrooms',coalesce((select jsonb_agg(classroom order by classroom) from (select distinct classroom from students where classroom is not null and (p_level is null or level=p_level)) c),'[]'::jsonb),
    'counts',jsonb_build_object('not_graduated',(select count(*) from students where student_status='not_graduated'),'active',(select count(*) from students where student_status='active'),
      'graduated',(select count(*) from students where student_status='graduated'),'transferred',(select count(*) from students where student_status='transferred'))
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_student_lifecycle_list(text,text,integer,text,integer,integer) from public,anon;
grant execute on function public.admin_student_lifecycle_list(text,text,integer,text,integer,integer) to authenticated;

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
    from public.profiles where role='student' and student_status in ('active','not_graduated')
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
  select count(*),count(*) filter(where student_status in ('graduated','transferred')) into existing,archived
    from public.profiles where role='student' and student_code=any(p_codes);
  return jsonb_build_object('created',cardinality(p_codes)-existing,'updated',existing,'archived',archived);
end;
$$;
revoke all on function public.admin_student_import_summary(text[]) from public,anon;
grant execute on function public.admin_student_import_summary(text[]) to authenticated;

notify pgrst,'reload schema';
commit;
