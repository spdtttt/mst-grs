begin;

create table public.grade_assignments (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.grade_records(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  assignment text not null check (length(trim(assignment)) between 10 and 10000),
  due_at timestamptz not null,
  assigned_at timestamptz not null default now(),
  received_at timestamptz,
  unique (record_id, round_number)
);
create index grade_assignments_record on public.grade_assignments(record_id, round_number);

insert into public.grade_assignments(record_id, round_number, assignment, due_at, assigned_at, received_at)
select id, 1, assignment, due_at, coalesce(assigned_at, now()),
  case when status in ('submitted', 'teacher_approved', 'completed') then submitted_at end
from public.grade_records
where assignment is not null and due_at is not null;

alter table public.grade_assignments enable row level security;
create policy grade_assignments_read on public.grade_assignments
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
revoke all on public.grade_assignments from anon, authenticated;
grant select on public.grade_assignments to authenticated;

alter table public.assignment_files
add column assignment_id uuid references public.grade_assignments(id) on delete cascade;
update public.assignment_files f set assignment_id = a.id
from public.grade_assignments a
where a.record_id = f.record_id and a.round_number = 1;
alter table public.assignment_files alter column assignment_id set not null;
create index assignment_files_assignment on public.assignment_files(assignment_id, created_at);

drop policy assignment_storage_insert on storage.objects;
drop policy assignment_storage_cleanup on storage.objects;
create policy assignment_storage_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'assignment-files' and
  name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f-]+\.[a-z0-9]+$' and
  public.site_is_open() and public.my_role() = 'teacher' and
  exists (
    select 1 from public.grade_records g
    where g.id = ((storage.foldername(name))[1])::uuid
      and g.teacher_id @> array[auth.uid()]
      and g.status in ('requested', 'assigned', 'submitted')
  )
);
create policy assignment_storage_cleanup on storage.objects
for delete to authenticated using (
  bucket_id = 'assignment-files' and
  name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' and
  public.site_is_open() and public.my_role() = 'teacher' and
  not exists (
    select 1 from public.assignment_files f where f.storage_path = name
  ) and
  exists (
    select 1 from public.grade_records g
    where g.id = ((storage.foldername(name))[1])::uuid
      and g.teacher_id @> array[auth.uid()]
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
    insert into public.grade_assignments(record_id, round_number, assignment, due_at)
    values(p_id, 1, trim(p_assignment), p_due_at);
  elsif actor = 'teacher' and r.teacher_id @> array[auth.uid()] and r.status = 'assigned' then
    target := 'submitted';
    update public.grade_assignments set received_at = now()
    where id = (
      select id from public.grade_assignments
      where record_id = p_id order by round_number desc limit 1
    );
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
  insert into public.audit_log(actor_id, record_id, action, from_status, to_status)
  values(auth.uid(), p_id, 'advance', r.status, target);
end;
$$;

drop function public.assign_grade(uuid, text, timestamptz, jsonb);
create function public.assign_grade(
  p_id uuid, p_assignment text, p_due_at timestamptz,
  p_files jsonb, p_expected public.grade_status
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.grade_records;
  item jsonb;
  task_id uuid;
  file_count integer;
  existing_count integer := 0;
  existing_bytes bigint := 0;
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
    select count(*), coalesce(sum(size_bytes), 0) into existing_count, existing_bytes
    from public.assignment_files where assignment_id = task_id;
  end if;
  if existing_count + file_count > 5 then raise exception 'แนบไฟล์ได้ไม่เกิน 5 ไฟล์ต่อภาระงาน'; end if;
  if existing_bytes + coalesce((
    select sum((value->>'size_bytes')::integer) from jsonb_array_elements(p_files)
  ), 0) > 4194304 then
    raise exception 'ไฟล์แนบของภาระงานต้องมีขนาดรวมไม่เกิน 4 MB';
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
      item->>'mime_type', (item->>'size_bytes')::integer, auth.uid()
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
