-- Apply after 007_manager_student_counts.sql. Managers receive aggregate counts only;
-- row-level policies continue to deny access to individual grade records.
begin;

create or replace function public.manager_dashboard_stats()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  if public.my_role() is distinct from 'manager' then
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
    select student_id, bool_and(status = 'completed') as all_completed
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

commit;
