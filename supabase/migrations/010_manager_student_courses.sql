-- Apply after 009_manager_student_lists.sql. Return only the course fields
-- needed by the manager detail dialog; grade-record RLS stays unchanged.
begin;

create or replace function public.manager_student_courses(p_student_code text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if public.my_role() is distinct from 'manager' then
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

commit;
