begin;

create table public.assignment_files (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.grade_records(id) on delete cascade,
  storage_path text not null unique check(length(storage_path) between 38 and 300 and storage_path not like '%..%'),
  original_name text not null check(length(original_name) between 1 and 180),
  mime_type text not null check(length(mime_type) between 1 and 150),
  size_bytes integer not null check(size_bytes between 1 and 4194304),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index assignment_files_record on public.assignment_files(record_id, created_at);
alter table public.assignment_files enable row level security;

create policy assignment_files_read on public.assignment_files
for select to authenticated using (
  public.site_is_open() and exists (
    select 1 from public.grade_records g
    where g.id=record_id and (
      (public.my_role()='student' and g.student_id=auth.uid()) or
      (public.my_role()='teacher' and g.teacher_id=auth.uid()) or
      public.my_role()='academic'
    )
  )
);

revoke all on public.assignment_files from anon, authenticated;
grant select on public.assignment_files to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'assignment-files',
  'assignment-files',
  false,
  4194304,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'text/plain'
  ]
)
on conflict(id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy assignment_storage_insert on storage.objects
for insert to authenticated with check (
  bucket_id='assignment-files' and
  name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f-]+\.[a-z0-9]+$' and
  public.site_is_open() and
  public.my_role()='teacher' and
  exists (
    select 1 from public.grade_records g
    where g.id=((storage.foldername(name))[1])::uuid
      and g.teacher_id=auth.uid()
      and g.status='requested'
  )
);

create policy assignment_storage_read on storage.objects
for select to authenticated using (
  bucket_id='assignment-files' and
  name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' and
  public.site_is_open() and
  exists (
    select 1 from public.grade_records g
    where g.id=((storage.foldername(name))[1])::uuid and (
      (public.my_role()='student' and g.student_id=auth.uid()) or
      (public.my_role()='teacher' and g.teacher_id=auth.uid()) or
      public.my_role()='academic'
    )
  )
);

create policy assignment_storage_cleanup on storage.objects
for delete to authenticated using (
  bucket_id='assignment-files' and
  name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' and
  public.site_is_open() and
  public.my_role()='teacher' and
  exists (
    select 1 from public.grade_records g
    where g.id=((storage.foldername(name))[1])::uuid
      and g.teacher_id=auth.uid()
      and g.status='requested'
  )
);

create function public.assign_grade(
  p_id uuid,
  p_assignment text,
  p_due_at timestamptz,
  p_files jsonb default '[]'::jsonb
)
returns void language plpgsql security definer set search_path='' as $$
declare
  r public.grade_records;
  item jsonb;
  file_count integer;
begin
  if not coalesce(public.site_is_open(),false) then
    raise exception 'ระบบปิดรับดำเนินการ';
  end if;
  if public.my_role() is distinct from 'teacher' then
    raise exception 'ไม่มีสิทธิ์มอบหมายงาน';
  end if;
  select * into r from public.grade_records where id=p_id for update;
  if not found or r.teacher_id<>auth.uid() or r.status<>'requested' then
    raise exception 'ไม่มีสิทธิ์ดำเนินการหรือข้อมูลเปลี่ยนแปลงแล้ว';
  end if;
  if p_assignment is null or length(trim(p_assignment)) not between 10 and 10000 or p_due_at is null or p_due_at<=now() then
    raise exception 'กรุณากรอกงานและกำหนดส่งในอนาคต';
  end if;
  if jsonb_typeof(p_files)<>'array' then
    raise exception 'ข้อมูลไฟล์แนบไม่ถูกต้อง';
  end if;
  file_count:=jsonb_array_length(p_files);
  if file_count>5 then raise exception 'แนบไฟล์ได้ไม่เกิน 5 ไฟล์'; end if;
  if coalesce((select sum((value->>'size_bytes')::integer) from jsonb_array_elements(p_files)),0)>4194304 then
    raise exception 'ไฟล์แนบทั้งหมดต้องมีขนาดรวมไม่เกิน 4 MB';
  end if;

  for item in select value from jsonb_array_elements(p_files) loop
    if item->>'storage_path' not like p_id::text||'/%'
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
      where bucket_id='assignment-files' and name=item->>'storage_path'
    ) then raise exception 'ไม่พบไฟล์ที่อัปโหลด'; end if;
    insert into public.assignment_files(record_id,storage_path,original_name,mime_type,size_bytes,uploaded_by)
    values(p_id,item->>'storage_path',item->>'original_name',item->>'mime_type',(item->>'size_bytes')::integer,auth.uid());
  end loop;

  update public.grade_records set
    status='assigned', assignment=trim(p_assignment), due_at=p_due_at, assigned_at=now()
  where id=p_id;
  insert into public.audit_log(actor_id,record_id,action,from_status,to_status)
  values(auth.uid(),p_id,'assign:'||file_count,r.status,'assigned');
end $$;

revoke all on function public.assign_grade(uuid,text,timestamptz,jsonb) from public;
grant execute on function public.assign_grade(uuid,text,timestamptz,jsonb) to authenticated;

commit;
