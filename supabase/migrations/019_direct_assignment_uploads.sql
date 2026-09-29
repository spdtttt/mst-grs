begin;

-- Files go directly to Storage. The application no longer imposes a file-size
-- or file-count limit; the project's global Storage limit still applies.
alter table public.assignment_files
  drop constraint assignment_files_size_bytes_check,
  alter column size_bytes type bigint,
  add constraint assignment_files_size_bytes_check check (size_bytes > 0);
update storage.buckets set file_size_limit = null where id = 'assignment-files';

-- Preserve role, owner, schedule and status checks. Verify each client's
-- manifest against the actual Storage metadata before attaching the file.
create or replace function public.assign_grade(
  p_id uuid, p_assignment text, p_due_at timestamptz,
  p_files jsonb, p_expected public.grade_status
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.grade_records;
  item jsonb;
  task_id uuid;
  file_count integer;
begin
  if not coalesce(public.site_is_open(), false) then
    raise exception 'ระบบปิดรับดำเนินการ';
  end if;
  if public.my_role() is distinct from 'teacher' then
    raise exception 'ไม่มีสิทธิ์มอบหมายงาน';
  end if;
  select * into r from public.grade_records where id = p_id for update;
  if not found or not r.teacher_id @> array[auth.uid()]
    or r.status not in ('requested', 'assigned', 'submitted') then
    raise exception 'ไม่มีสิทธิ์ดำเนินการหรือข้อมูลเปลี่ยนแปลงแล้ว';
  end if;
  if r.status is distinct from p_expected then
    raise exception 'ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่';
  end if;
  if p_assignment is null or length(trim(p_assignment)) not between 10 and 10000
    or p_due_at is null or p_due_at <= now() then
    raise exception 'กรุณากรอกงานและกำหนดส่งในอนาคต';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array' then
    raise exception 'ข้อมูลไฟล์แนบไม่ถูกต้อง';
  end if;
  file_count := jsonb_array_length(p_files);
  if r.status = 'assigned' then
    select id into task_id from public.grade_assignments
    where record_id = p_id order by round_number desc limit 1 for update;
    if task_id is null then raise exception 'ไม่พบภาระงานที่จะแก้ไข'; end if;
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
      or coalesce((item->>'size_bytes')::bigint,0) <= 0 then
      raise exception 'ข้อมูลไฟล์แนบไม่ถูกต้อง';
    end if;
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'assignment-files' and name = item->>'storage_path'
        and (metadata->>'size')::bigint = (item->>'size_bytes')::bigint
        and metadata->>'mimetype' = item->>'mime_type'
    ) then raise exception 'ไม่พบไฟล์ที่อัปโหลด'; end if;
  end loop;

  if r.status = 'assigned' then
    update public.grade_assignments set assignment = trim(p_assignment), due_at = p_due_at
    where id = task_id;
    update public.grade_records set assignment = trim(p_assignment), due_at = p_due_at
    where id = p_id;
  else
    insert into public.grade_assignments(record_id, round_number, assignment, due_at)
    values(
      p_id,
      coalesce((select max(round_number) + 1 from public.grade_assignments where record_id = p_id), 1),
      trim(p_assignment), p_due_at
    ) returning id into task_id;
    update public.grade_records set
      status = 'assigned', assignment = trim(p_assignment), due_at = p_due_at,
      assigned_at = now(), submitted_at = null,
      final_grade = null, teacher_approved_at = null
    where id = p_id;
  end if;

  for item in select value from jsonb_array_elements(p_files) loop
    insert into public.assignment_files(
      record_id, assignment_id, storage_path, original_name, mime_type, size_bytes, uploaded_by
    ) values (
      p_id, task_id, item->>'storage_path', item->>'original_name',
      item->>'mime_type', (item->>'size_bytes')::bigint, auth.uid()
    );
  end loop;
  insert into public.audit_log(actor_id, record_id, action, from_status, to_status)
  values(
    auth.uid(), p_id,
    case when r.status = 'assigned' then 'edit_assignment:'
      when r.status = 'submitted' then 'assign_more:' else 'assign:' end || file_count,
    r.status, 'assigned'
  );
end;
$$;
revoke all on function public.assign_grade(uuid, text, timestamptz, jsonb, public.grade_status) from public;
grant execute on function public.assign_grade(uuid, text, timestamptz, jsonb, public.grade_status) to authenticated;


commit;
