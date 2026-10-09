-- Apply after 008_manager_outstanding_statuses.sql. Managers receive only
-- student-level summaries; row-level policies still deny grade-record access.
begin;

create index if not exists grades_student_latest
  on public.grade_records(
    student_id,
    academic_year desc,
    semester desc,
    created_at desc,
    id desc
  );

create or replace function public.manager_student_list(
  p_completed boolean,
  p_query text default '',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
  search_term text := trim(coalesce(p_query, ''));
begin
  if public.my_role() is distinct from 'manager' then
    raise exception 'ไม่มีสิทธิ์ดูรายชื่อนักเรียน' using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100
     or p_offset is null or p_offset < 0 then
    raise exception 'ข้อมูลแบ่งหน้าไม่ถูกต้อง' using errcode = '22023';
  end if;

  with latest as (
    select distinct on (student_id)
      student_id,
      student_code,
      student_name,
      classroom,
      roll_number,
      academic_year,
      semester
    from public.grade_records
    order by
      student_id,
      academic_year desc,
      semester desc,
      created_at desc,
      id desc
  ), record_counts as (
    select
      student_id,
      count(*)::bigint as total_records,
      count(*) filter (where status <> 'completed')::bigint as incomplete_records,
      count(*) filter (where status = 'completed')::bigint as completed_records
    from public.grade_records
    group by student_id
  ), students as (
    select
      latest.student_code,
      latest.student_name,
      latest.classroom,
      latest.roll_number,
      latest.academic_year,
      latest.semester,
      record_counts.total_records,
      record_counts.incomplete_records,
      record_counts.completed_records
    from latest
    join record_counts using (student_id)
    where
      case
        when p_completed then record_counts.incomplete_records = 0
        else record_counts.incomplete_records > 0
      end
      and (
        search_term = ''
        or latest.student_code ilike '%' || search_term || '%'
        or latest.student_name ilike '%' || search_term || '%'
        or latest.classroom ilike '%' || search_term || '%'
      )
  ), page as (
    select *
    from students
    order by student_code, student_name
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from students),
    'items', coalesce(
      (select jsonb_agg(to_jsonb(page) order by student_code, student_name) from page),
      '[]'::jsonb
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.manager_student_list(boolean,text,integer,integer) from public;
grant execute on function public.manager_student_list(boolean,text,integer,integer) to authenticated;

commit;
