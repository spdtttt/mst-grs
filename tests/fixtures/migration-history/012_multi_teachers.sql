-- Apply after 011_manager_student_filters.sql. Existing single-teacher rows
-- become one-element arrays. A shared record still has one workflow status.
begin;

drop policy records_read on public.grade_records;
drop policy assignment_files_read on public.assignment_files;
drop policy assignment_storage_insert on storage.objects;
drop policy assignment_storage_read on storage.objects;
drop policy assignment_storage_cleanup on storage.objects;

drop index public.grades_teacher;
alter table public.grade_records drop constraint grade_records_teacher_id_fkey;
alter table public.grade_records
  alter column teacher_name type text[] using array[teacher_name],
  alter column teacher_id type uuid[] using array[teacher_id];
alter table public.grade_records
  add constraint grade_records_teachers_valid check (
    cardinality(teacher_id) between 1 and 20
    and cardinality(teacher_name) = cardinality(teacher_id)
    and array_position(teacher_id, null) is null
    and array_position(teacher_name, null) is null
  );
create index grades_teachers on public.grade_records using gin(teacher_id);

create function public.prevent_assigned_teacher_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.grade_records
    where teacher_id @> array[old.id]
  ) then
    raise exception 'ไม่สามารถลบบัญชีครูที่มีรายการผลการเรียนอยู่';
  end if;
  return old;
end;
$$;
revoke all on function public.prevent_assigned_teacher_delete() from public;
create trigger prevent_assigned_teacher_delete
before delete on public.profiles
for each row when (old.role = 'teacher')
execute function public.prevent_assigned_teacher_delete();

create policy records_read on public.grade_records for select to authenticated
using (
  public.site_is_open() and (
    (public.my_role() = 'student' and student_id = auth.uid()) or
    (public.my_role() = 'teacher' and teacher_id @> array[auth.uid()]) or
    public.my_role() = 'academic'
  )
);

create policy assignment_files_read on public.assignment_files
for select to authenticated using (
  public.site_is_open() and exists (
    select 1 from public.grade_records g
    where g.id = record_id and (
      (public.my_role() = 'student' and g.student_id = auth.uid()) or
      (public.my_role() = 'teacher' and g.teacher_id @> array[auth.uid()]) or
      public.my_role() = 'academic'
    )
  )
);

create policy assignment_storage_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'assignment-files' and
  name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f-]+\.[a-z0-9]+$' and
  public.site_is_open() and public.my_role() = 'teacher' and
  exists (
    select 1 from public.grade_records g
    where g.id = ((storage.foldername(name))[1])::uuid
      and g.teacher_id @> array[auth.uid()]
      and g.status = 'requested'
  )
);

create policy assignment_storage_read on storage.objects
for select to authenticated using (
  bucket_id = 'assignment-files' and
  name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' and
  public.site_is_open() and
  exists (
    select 1 from public.grade_records g
    where g.id = ((storage.foldername(name))[1])::uuid and (
      (public.my_role() = 'student' and g.student_id = auth.uid()) or
      (public.my_role() = 'teacher' and g.teacher_id @> array[auth.uid()]) or
      public.my_role() = 'academic'
    )
  )
);

create policy assignment_storage_cleanup on storage.objects
for delete to authenticated using (
  bucket_id = 'assignment-files' and
  name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' and
  public.site_is_open() and public.my_role() = 'teacher' and
  exists (
    select 1 from public.grade_records g
    where g.id = ((storage.foldername(name))[1])::uuid
      and g.teacher_id @> array[auth.uid()]
      and g.status = 'requested'
  )
);

create or replace function public.advance_grade(
  p_id uuid, p_expected public.grade_status, p_assignment text default null,
  p_due_at timestamptz default null, p_final_grade text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.grade_records;
  target public.grade_status;
  actor public.app_role := public.my_role();
begin
  if not coalesce(public.site_is_open(), false) then
    raise exception 'ระบบปิดรับดำเนินการ';
  end if;
  select * into r from public.grade_records where id = p_id for update;
  if not found or r.status <> p_expected then
    raise exception 'ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่';
  end if;
  if actor = 'student' and r.student_id = auth.uid() and r.status = 'pending' then
    target := 'requested';
  elsif actor = 'teacher' and r.teacher_id @> array[auth.uid()] and r.status = 'requested' then
    if p_assignment is null or length(trim(p_assignment)) not between 10 and 10000
      or p_due_at is null or p_due_at <= now() then
      raise exception 'กรุณากรอกงานและกำหนดส่งในอนาคต';
    end if;
    target := 'assigned';
  elsif actor = 'teacher' and r.teacher_id @> array[auth.uid()] and r.status = 'assigned' then
    target := 'submitted';
  elsif actor = 'teacher' and r.teacher_id @> array[auth.uid()] and r.status = 'submitted' then
    if p_final_grade is null or p_final_grade not in ('1','1.5','2','2.5','3','3.5','4','ผ') then
      raise exception 'กรุณาระบุผลการเรียนใหม่';
    end if;
    target := 'teacher_approved';
  elsif actor = 'academic' and r.status = 'teacher_approved' then
    target := 'completed';
  else
    raise exception 'ไม่มีสิทธิ์ดำเนินการ';
  end if;
  update public.grade_records set
    status = target,
    assignment = case when target = 'assigned' then trim(p_assignment) else assignment end,
    due_at = case when target = 'assigned' then p_due_at else due_at end,
    final_grade = case when target = 'teacher_approved' then p_final_grade else final_grade end,
    requested_at = case when target = 'requested' then now() else requested_at end,
    assigned_at = case when target = 'assigned' then now() else assigned_at end,
    submitted_at = case when target = 'submitted' then now() else submitted_at end,
    teacher_approved_at = case when target = 'teacher_approved' then now() else teacher_approved_at end,
    completed_at = case when target = 'completed' then now() else completed_at end
  where id = p_id;
  insert into public.audit_log(actor_id,record_id,action,from_status,to_status)
  values(auth.uid(),p_id,'advance',r.status,target);
end;
$$;

create or replace function public.assign_grade(
  p_id uuid, p_assignment text, p_due_at timestamptz,
  p_files jsonb default '[]'::jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.grade_records;
  item jsonb;
  file_count integer;
begin
  if not coalesce(public.site_is_open(), false) then
    raise exception 'ระบบปิดรับดำเนินการ';
  end if;
  if public.my_role() is distinct from 'teacher' then
    raise exception 'ไม่มีสิทธิ์มอบหมายงาน';
  end if;
  select * into r from public.grade_records where id = p_id for update;
  if not found or not r.teacher_id @> array[auth.uid()] or r.status <> 'requested' then
    raise exception 'ไม่มีสิทธิ์ดำเนินการหรือข้อมูลเปลี่ยนแปลงแล้ว';
  end if;
  if p_assignment is null or length(trim(p_assignment)) not between 10 and 10000
    or p_due_at is null or p_due_at <= now() then
    raise exception 'กรุณากรอกงานและกำหนดส่งในอนาคต';
  end if;
  if jsonb_typeof(p_files) <> 'array' then
    raise exception 'ข้อมูลไฟล์แนบไม่ถูกต้อง';
  end if;
  file_count := jsonb_array_length(p_files);
  if file_count > 5 then raise exception 'แนบไฟล์ได้ไม่เกิน 5 ไฟล์'; end if;
  if coalesce((select sum((value->>'size_bytes')::integer) from jsonb_array_elements(p_files)),0) > 4194304 then
    raise exception 'ไฟล์แนบทั้งหมดต้องมีขนาดรวมไม่เกิน 4 MB';
  end if;

  for item in select value from jsonb_array_elements(p_files) loop
    if item->>'storage_path' not like p_id::text || '/%'
      or length(item->>'original_name') not between 1 and 180
      or length(item->>'mime_type') not between 1 and 150
      or item->>'mime_type' not in (
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'image/jpeg','image/png','text/plain'
      )
      or coalesce((item->>'size_bytes')::integer,0) not between 1 and 4194304 then
      raise exception 'ข้อมูลไฟล์แนบไม่ถูกต้อง';
    end if;
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'assignment-files' and name = item->>'storage_path'
    ) then raise exception 'ไม่พบไฟล์ที่อัปโหลด'; end if;
    insert into public.assignment_files(record_id,storage_path,original_name,mime_type,size_bytes,uploaded_by)
    values(p_id,item->>'storage_path',item->>'original_name',item->>'mime_type',(item->>'size_bytes')::integer,auth.uid());
  end loop;

  update public.grade_records set
    status = 'assigned', assignment = trim(p_assignment), due_at = p_due_at, assigned_at = now()
  where id = p_id;
  insert into public.audit_log(actor_id,record_id,action,from_status,to_status)
  values(auth.uid(),p_id,'assign:' || file_count,r.status,'assigned');
end;
$$;

create or replace function public.import_grades(p_rows jsonb)
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
  skipped integer := 0;
  affected integer;
begin
  if public.my_role() is distinct from 'academic' or not coalesce(public.site_is_open(), false) then
    raise exception 'ไม่มีสิทธิ์นำเข้าข้อมูลหรืออยู่นอกเวลาเปิดระบบ';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception 'นำเข้าได้ครั้งละ 1–2,000 รายการ';
  end if;
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

    insert into public.grade_records(
      course_code,course_name,credits,classroom,teacher_name,student_code,
      student_name,roll_number,academic_year,semester,original_grade,student_id,teacher_id
    ) values (
      item->>'course_code',item->>'course_name',(item->>'credits')::numeric,
      item->>'classroom',teacher_names,item->>'student_code',item->>'student_name',
      (item->>'roll_number')::integer,(item->>'academic_year')::integer,
      (item->>'semester')::integer,item->>'original_grade',sid,teacher_ids
    ) on conflict(student_code,course_code,academic_year,semester) do nothing;
    get diagnostics affected = row_count;
    inserted := inserted + affected;
    skipped := skipped + (1 - affected);
  end loop;
  insert into public.audit_log(actor_id,action)
  values(auth.uid(),'import:' || inserted || ':skipped:' || skipped);
  return jsonb_build_object('inserted',inserted,'skipped',skipped);
end;
$$;

commit;
