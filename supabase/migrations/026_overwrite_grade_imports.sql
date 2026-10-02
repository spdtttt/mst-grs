begin;

-- Preserve overwritten attempts using the same snapshots/child links as period resets.
alter table public.grade_reset_history
  alter column closes_at drop not null,
  add column reset_reason text not null default 'period_close',
  add column reset_by uuid references public.profiles(id) on delete set null,
  add constraint reset_history_reason check (
    (reset_reason = 'period_close' and closes_at is not null) or
    (reset_reason = 'import_overwrite' and closes_at is null)
  );

-- A record can receive different teachers on overwrite. Check linked files
-- globally, so RLS-hidden snapshots cannot be mistaken for disposable uploads.
create function public.can_access_unlinked_assignment_upload(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.site_is_open(), false)
    and public.my_role() = 'teacher'
    and p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f-]+\.[a-z0-9]+$'
    and exists (
      select 1 from public.grade_records g
      where g.id::text = split_part(p_path, '/', 1)
        and g.teacher_id @> array[auth.uid()]
    )
    and not exists (
      select 1 from public.assignment_files f where f.storage_path = p_path
    );
$$;
revoke all on function public.can_access_unlinked_assignment_upload(text) from public, anon;
grant execute on function public.can_access_unlinked_assignment_upload(text) to authenticated;

drop policy assignment_storage_read on storage.objects;
create policy assignment_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'assignment-files' and public.site_is_open() and (
    exists (
      select 1 from public.assignment_files f
      where f.storage_path = name and f.record_id is not null
    ) or public.can_access_unlinked_assignment_upload(name)
  )
);
drop policy assignment_storage_cleanup on storage.objects;
create policy assignment_storage_cleanup on storage.objects for delete to authenticated using (
  bucket_id = 'assignment-files' and public.can_access_unlinked_assignment_upload(name)
);

-- A distinct RPC prevents an older database from silently using skip behavior.
-- The existing archive trigger continues to protect results from previous terms.
create function public.import_grades_overwrite(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  teacher_value jsonb;
  sid uuid;
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
    raise exception 'ไม่มีสิทธิ์นำเข้าข้อมูลหรืออยู่นอกเวลาเปิดระบบ';
  end if;
  -- Use the same lock order as period closing: schedule first, then records.
  perform 1 from public.site_schedule where id = 1 for share;
  if not coalesce(public.site_is_open(), false) then
    raise exception 'ไม่มีสิทธิ์นำเข้าข้อมูลหรืออยู่นอกเวลาเปิดระบบ';
  end if;
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
    select id into sid from public.profiles
    where role = 'student' and student_code = item->>'student_code';
    if sid is null then
      raise exception 'ไม่พบบัญชีนักเรียนเลขประจำตัว %', item->>'student_code';
    end if;
    if not exists (
      select 1 from public.profiles
      where id = sid and full_name = item->>'student_name'
    ) then
      raise exception 'ชื่อนักเรียนไม่ตรงกับบัญชี: %', item->>'student_code';
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
      where role = 'teacher' and full_name = teacher_name;
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
      item->>'classroom',teacher_names,item->>'student_code',item->>'student_name',
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
revoke all on function public.import_grades_overwrite(jsonb) from public, anon;
grant execute on function public.import_grades_overwrite(jsonb) to authenticated;

-- Existing callers receive the same overwrite behavior and result counts.
create or replace function public.import_grades(p_rows jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select public.import_grades_overwrite(p_rows);
$$;
revoke all on function public.import_grades(jsonb) from public, anon;
grant execute on function public.import_grades(jsonb) to authenticated;

commit;
