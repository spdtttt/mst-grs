begin;

-- Admins can import grades even when the system is outside its open window.
-- Same as 049 without the site_is_open() gate (admin role is still required).
create or replace function public.import_grades_overwrite(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  teacher_value jsonb;
  sid uuid;
  registered_student_name text;
  tid uuid;
  teacher_ids uuid[];
  teacher_names text[];
  teacher_name text;
  matches integer;
  inserted integer := 0;
  updated integer := 0;
  skipped integer := 0;
  affected integer;
  previous public.grade_records;
  saved_id uuid;
  snapshot_id uuid;
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'ไม่มีสิทธิ์นำเข้าข้อมูล';
  end if;
  -- Admins may import at any time, including outside the open/close window.
  -- Keep the same lock order as period closing: schedule first, then records.
  perform 1 from public.site_schedule where id = 1 for share;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'นำเข้าได้ครั้งละ 1–2,000 รายการ';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception 'นำเข้าได้ครั้งละ 1–2,000 รายการ';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
    group by r->>'student_code', r->>'course_code',
      (r->>'academic_year')::integer, (r->>'semester')::integer
    having count(*) > 1
  ) then
    raise exception 'รายการนักเรียน/วิชา/ปี/ภาคเรียนซ้ำในไฟล์';
  end if;
  -- Serialize with imports, approvals and archiving so counts reflect the writes.
  lock table public.grade_records in share row exclusive mode;
  for item in select value from jsonb_array_elements(p_rows) loop
    if length(item->>'course_code') not between 1 and 40
      or length(item->>'course_name') not between 1 and 200
      or length(item->>'classroom') not between 1 and 40
      or length(item->>'student_name') not between 1 and 150 then
      raise exception 'รูปแบบข้อมูลไม่ถูกต้อง';
    end if;
    if jsonb_typeof(item->'teacher_name') is distinct from 'array' then
      raise exception 'ข้อมูลครูผู้สอนไม่ถูกต้อง';
    end if;
    if jsonb_array_length(item->'teacher_name') not between 1 and 20 then
      raise exception 'ข้อมูลครูผู้สอนไม่ถูกต้อง';
    end if;
    select id, full_name into sid, registered_student_name from public.profiles
    where role = 'student' and student_code = item->>'student_code';
    if sid is null then
      raise exception 'ไม่พบบัญชีนักเรียนเลขประจำตัว %', item->>'student_code';
    end if;

    teacher_ids := array[]::uuid[];
    teacher_names := array[]::text[];
    for teacher_value in select value from jsonb_array_elements(item->'teacher_name') loop
      if jsonb_typeof(teacher_value) is distinct from 'string' then
        raise exception 'ข้อมูลครูผู้สอนไม่ถูกต้อง';
      end if;
      teacher_name := trim(teacher_value #>> '{}');
      if teacher_name ~ '^-[[:space:]]*ครูที่ปรึกษาชุมนุม[[:space:]]*-$' then
        raise exception 'กรุณาระบุชื่อครูจริงแทน -ครูที่ปรึกษาชุมนุม -';
      end if;
      if length(teacher_name) not between 1 and 150
        or teacher_name = any(teacher_names) then
        raise exception 'ชื่อครูผู้สอนไม่ถูกต้องหรือซ้ำกัน: %', teacher_name;
      end if;
      select count(*), (array_agg(id))[1] into matches, tid from public.profiles
      where public.profile_has_role(id, 'teacher') and full_name = teacher_name;
      if matches <> 1 then
        raise exception 'ชื่อครูไม่พบหรือซ้ำ: % กรุณาตรวจสอบบัญชี', teacher_name;
      end if;
      teacher_names := array_append(teacher_names, teacher_name);
      teacher_ids := array_append(teacher_ids, tid);
    end loop;

    select * into previous from public.grade_records
    where student_code = item->>'student_code' and course_code = item->>'course_code'
      and academic_year = (item->>'academic_year')::integer
      and semester = (item->>'semester')::integer;
    insert into public.grade_records(
      course_code,course_name,credits,classroom,teacher_name,student_code,
      student_name,roll_number,academic_year,semester,original_grade,student_id,teacher_id
    ) values (
      item->>'course_code',item->>'course_name',(item->>'credits')::numeric,
      item->>'classroom',teacher_names,item->>'student_code',registered_student_name,
      (item->>'roll_number')::integer,(item->>'academic_year')::integer,
      (item->>'semester')::integer,item->>'original_grade',sid,teacher_ids
    ) on conflict(student_code,course_code,academic_year,semester) do update set
      course_name = excluded.course_name,
      credits = excluded.credits,
      classroom = excluded.classroom,
      teacher_name = excluded.teacher_name,
      student_name = excluded.student_name,
      roll_number = excluded.roll_number,
      original_grade = excluded.original_grade,
      student_id = excluded.student_id,
      teacher_id = excluded.teacher_id,
      status = 'pending',
      assignment = null,
      due_at = null,
      requested_at = null,
      assigned_at = null,
      submitted_at = null,
      teacher_approved_at = null,
      completed_at = null,
      final_grade = null
    returning id into saved_id;
    get diagnostics affected = row_count;
    if affected = 0 then
      skipped := skipped + 1;
    elsif previous.id is null then
      inserted := inserted + 1;
    else
      updated := updated + 1;
      insert into public.grade_reset_history(
        record_id,student_id,teacher_id,record_snapshot,reset_reason,reset_by
      ) values (
        previous.id,previous.student_id,previous.teacher_id,to_jsonb(previous),
        'import_overwrite',auth.uid()
      ) returning id into snapshot_id;
      update public.assignment_files set reset_history_id = snapshot_id, record_id = null
        where record_id = saved_id;
      update public.grade_assignments set reset_history_id = snapshot_id, record_id = null
        where record_id = saved_id;
      insert into public.audit_log(actor_id,record_id,action,from_status,to_status)
      values(auth.uid(),saved_id,'import_overwrite',previous.status,'pending');
    end if;
  end loop;
  insert into public.audit_log(actor_id,action)
  values(auth.uid(),'import:' || inserted || ':updated:' || updated || ':skipped:' || skipped);
  return jsonb_build_object('inserted',inserted,'updated',updated,'skipped',skipped);
end;
$$;

notify pgrst, 'reload schema';
commit;
