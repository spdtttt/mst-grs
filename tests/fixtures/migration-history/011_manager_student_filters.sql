-- Apply after 010_manager_student_courses.sql. Keep the unfiltered list RPC
-- available for older clients while adding server-side filters and year options.
begin;

create function public.manager_student_list_filtered(
  p_completed boolean,
  p_query text,
  p_limit integer,
  p_offset integer,
  p_level integer,
  p_academic_year integer,
  p_semester integer
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
     or p_offset is null or p_offset < 0
     or (p_level is not null and p_level not between 1 and 6)
     or (p_academic_year is not null and p_academic_year not between 2500 and 2700)
     or (p_semester is not null and p_semester not between 1 and 3) then
    raise exception 'ข้อมูลตัวกรองหรือการแบ่งหน้าไม่ถูกต้อง' using errcode = '22023';
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
      and (
        p_level is null
        or latest.classroom ~ ('^ม[.]?[[:space:]]*' || p_level || '([[:space:]]*/|$)')
      )
      and (p_academic_year is null or latest.academic_year = p_academic_year)
      and (p_semester is null or latest.semester = p_semester)
  ), page as (
    select *
    from students
    order by student_code, student_name
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from students),
    'years', coalesce(
      (select jsonb_agg(academic_year order by academic_year desc)
       from (select distinct academic_year from latest) available_years),
      '[]'::jsonb
    ),
    'items', coalesce(
      (select jsonb_agg(to_jsonb(page) order by student_code, student_name) from page),
      '[]'::jsonb
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.manager_student_list_filtered(boolean,text,integer,integer,integer,integer,integer) from public;
grant execute on function public.manager_student_list_filtered(boolean,text,integer,integer,integer,integer,integer) to authenticated;

commit;
