begin;

-- Academic staff use the same read-only statistics and student lists as
-- managers. Function bodies are unchanged from 035 / 010 / 011; only the role
-- guard now accepts 'academic' in addition to 'manager'.
create or replace function public.manager_dashboard_stats()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if public.my_role() is null
     or public.my_role()::text not in ('manager', 'academic') then
    raise exception 'ไม่มีสิทธิ์ดูสถิติผู้บริหาร' using errcode = '42501';
  end if;

  with record_counts as (
    select
      count(*)::bigint as total_records,
      count(*) filter (where status <> 'completed')::bigint as incomplete_records,
      count(*) filter (where status = 'completed')::bigint as completed_records,
      count(*) filter (where status = 'pending')::bigint as pending_records,
      count(*) filter (where status = 'requested')::bigint as requested_records,
      count(*) filter (where status = 'assigned')::bigint as assigned_records,
      count(*) filter (where status = 'submitted')::bigint as submitted_records,
      count(*) filter (where status = 'teacher_approved')::bigint as teacher_approved_records
    from public.grade_records
  ), latest_class as (
    select distinct on (student_id)
      student_id,
      substring(classroom from 'ม[.][[:space:]]*([1-6])([[:space:]]*/|$)')::integer as level
    from public.grade_records
    order by student_id, academic_year desc, semester desc, created_at desc, id desc
  ), student_completion as (
    select student_id, bool_and(status = 'completed') as all_completed,
      count(*) filter (where status <> 'completed') as incomplete_records
    from public.grade_records
    group by student_id
  ), student_counts as (
    select c.student_id, c.level, s.all_completed
    from latest_class c
    join student_completion s using (student_id)
  ), class_counts as (
    select
      level,
      count(*) filter (where all_completed)::bigint as completed_students,
      count(*) filter (where not all_completed)::bigint as incomplete_students
    from student_counts
    where level between 1 and 6
    group by level
  )
  select jsonb_build_object(
    'total_records', r.total_records,
    'incomplete_records', r.incomplete_records,
    'completed_records', r.completed_records,
    'outstanding_by_status', jsonb_build_object(
      'pending', r.pending_records,
      'requested', r.requested_records,
      'assigned', r.assigned_records,
      'submitted', r.submitted_records,
      'teacher_approved', r.teacher_approved_records
    ),
    'total_students', (select count(*) from student_counts),
    'completed_students', (select count(*) from student_counts where all_completed),
    'incomplete_students', (select count(*) from student_counts where not all_completed),
    'students_by_remaining_records', (
      select jsonb_build_object(
        'one', count(*) filter (where incomplete_records = 1),
        'two_to_three', count(*) filter (where incomplete_records between 2 and 3),
        'four_to_five', count(*) filter (where incomplete_records between 4 and 5),
        'more_than_five', count(*) filter (where incomplete_records > 5)
      ) from student_completion
    ),
    'unclassified_students', (select count(*) from student_counts where level is null),
    'by_level', (
      select jsonb_agg(
        jsonb_build_object(
          'level', levels.level,
          'completed_students', coalesce(c.completed_students, 0),
          'incomplete_students', coalesce(c.incomplete_students, 0)
        ) order by levels.level
      )
      from generate_series(1, 6) as levels(level)
      left join class_counts c on c.level = levels.level
    )
  ) into result
  from record_counts r;

  return result;
end;
$$;

revoke all on function public.manager_dashboard_stats() from public;
grant execute on function public.manager_dashboard_stats() to authenticated;

create or replace function public.manager_student_courses(p_student_code text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if public.my_role() is null
     or public.my_role()::text not in ('manager', 'academic') then
    raise exception 'ไม่มีสิทธิ์ดูรายละเอียดนักเรียน' using errcode = '42501';
  end if;

  if p_student_code is null or length(trim(p_student_code)) not between 1 and 40 then
    raise exception 'รหัสนักเรียนไม่ถูกต้อง' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'academic_year', g.academic_year,
        'semester', g.semester,
        'course_code', g.course_code,
        'course_name', g.course_name,
        'credits', g.credits,
        'teacher_name', g.teacher_name,
        'original_grade', g.original_grade,
        'status', g.status
      )
      order by (g.status = 'completed'), g.academic_year desc,
        g.semester desc, g.course_code, g.id
    ),
    '[]'::jsonb
  ) into result
  from public.grade_records g
  where g.student_code = trim(p_student_code);

  return result;
end;
$$;

revoke all on function public.manager_student_courses(text) from public;
grant execute on function public.manager_student_courses(text) to authenticated;

create or replace function public.manager_student_list_filtered(
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
  if public.my_role() is null
     or public.my_role()::text not in ('manager', 'academic') then
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

notify pgrst, 'reload schema';
commit;
