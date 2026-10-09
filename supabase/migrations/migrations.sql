-- MST-GRS: all migrations 001-051 merged in order. Run once on a fresh database.
-- Requires pg_cron (used by the former 017_history_cron).

-- ============================================================
-- 001_initial.sql
-- ============================================================
begin;
create type public.app_role as enum ('student','teacher','academic','admin');
create type public.grade_status as enum ('pending','requested','assigned','submitted','teacher_approved','completed');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 role public.app_role not null, full_name text not null check(length(full_name) between 1 and 150),
 student_code text unique, classroom text,
 check ((role='student' and student_code is not null) or (role<>'student' and student_code is null))
);
create table public.site_schedule (
 id integer primary key check(id=1), opens_at timestamptz, closes_at timestamptz,
 notice text not null default 'กรุณาติดต่อฝ่ายวิชาการหากต้องการความช่วยเหลือ',
 check((opens_at is null and closes_at is null) or (opens_at is not null and closes_at is not null and closes_at>opens_at))
);
insert into public.site_schedule(id) values(1);
create table public.grade_records (
 id uuid primary key default gen_random_uuid(), course_code text not null, course_name text not null,
 credits numeric(4,2) not null check(credits>=0 and credits<=20), classroom text not null,
 teacher_name text not null, student_code text not null, student_name text not null,
 roll_number integer not null check(roll_number between 1 and 999), academic_year integer not null check(academic_year between 2500 and 2700),
 semester integer not null check(semester in (1,2,3)), original_grade text not null check(original_grade in ('0','ร','มส','มผ')),
 student_id uuid not null references public.profiles(id), teacher_id uuid not null references public.profiles(id),
 status public.grade_status not null default 'pending', assignment text, due_at timestamptz,
 requested_at timestamptz, assigned_at timestamptz, submitted_at timestamptz, teacher_approved_at timestamptz, completed_at timestamptz,
 final_grade text check(final_grade in ('1','1.5','2','2.5','3','3.5','4','ผ')),
 created_at timestamptz not null default now(),
 unique(student_code,course_code,academic_year,semester),
 check((status='completed')=(completed_at is not null)),
 check(status not in ('teacher_approved','completed') or final_grade is not null)
);
create index grades_student on public.grade_records(student_id,status);
create index grades_teacher on public.grade_records(teacher_id,status);
create index grades_status on public.grade_records(status);
create table public.audit_log (
 id bigint generated always as identity primary key, actor_id uuid references public.profiles(id),
 record_id uuid references public.grade_records(id), action text not null, from_status public.grade_status,
 to_status public.grade_status, created_at timestamptz not null default now()
);
create table public.login_attempts (bucket text primary key, window_start timestamptz not null, attempts integer not null);
alter table public.profiles enable row level security;
alter table public.site_schedule enable row level security;
alter table public.grade_records enable row level security;
alter table public.audit_log enable row level security;
alter table public.login_attempts enable row level security;
create function public.my_role() returns public.app_role language sql stable security definer set search_path='' as $$ select role from public.profiles where id=auth.uid() $$;
create function public.site_is_open() returns boolean language sql stable security definer set search_path='' as $$ select coalesce(now()>=opens_at and now()<closes_at,false) from public.site_schedule where id=1 $$;
create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
create policy schedule_read on public.site_schedule for select to authenticated using(true);
create policy records_read on public.grade_records for select to authenticated using(public.site_is_open() and ((public.my_role()='student' and student_id=auth.uid()) or (public.my_role()='teacher' and teacher_id=auth.uid()) or public.my_role()='academic'));
create policy audit_read on public.audit_log for select to authenticated using(public.site_is_open() and public.my_role()='academic');
revoke all on public.profiles,public.site_schedule,public.grade_records,public.audit_log,public.login_attempts from anon,authenticated;
grant select on public.profiles,public.site_schedule,public.grade_records,public.audit_log to authenticated;

create function public.advance_grade(p_id uuid,p_expected public.grade_status,p_assignment text default null,p_due_at timestamptz default null,p_final_grade text default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.grade_records; target public.grade_status; actor public.app_role:=public.my_role();
begin
 if not coalesce(public.site_is_open(),false) then raise exception 'ระบบปิดรับดำเนินการ'; end if;
 select * into r from public.grade_records where id=p_id for update;
 if not found or r.status<>p_expected then raise exception 'ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่'; end if;
 if actor='student' and r.student_id=auth.uid() and r.status='pending' then target:='requested';
 elsif actor='teacher' and r.teacher_id=auth.uid() and r.status='requested' then
   if p_assignment is null or length(trim(p_assignment)) not between 10 and 10000 or p_due_at is null or p_due_at<=now() then raise exception 'กรุณากรอกงานและกำหนดส่งในอนาคต'; end if;
   target:='assigned';
 elsif actor='teacher' and r.teacher_id=auth.uid() and r.status='assigned' then target:='submitted';
 elsif actor='teacher' and r.teacher_id=auth.uid() and r.status='submitted' then
   if p_final_grade is null or p_final_grade not in ('1','1.5','2','2.5','3','3.5','4','ผ') then raise exception 'กรุณาระบุผลการเรียนใหม่'; end if;
   target:='teacher_approved';
 elsif actor='academic' and r.status='teacher_approved' then target:='completed';
 else raise exception 'ไม่มีสิทธิ์ดำเนินการ'; end if;
 update public.grade_records set status=target,
 assignment=case when target='assigned' then trim(p_assignment) else assignment end,
 due_at=case when target='assigned' then p_due_at else due_at end,
 final_grade=case when target='teacher_approved' then p_final_grade else final_grade end,
 requested_at=case when target='requested' then now() else requested_at end,
 assigned_at=case when target='assigned' then now() else assigned_at end,
 submitted_at=case when target='submitted' then now() else submitted_at end,
 teacher_approved_at=case when target='teacher_approved' then now() else teacher_approved_at end,
 completed_at=case when target='completed' then now() else completed_at end where id=p_id;
 insert into public.audit_log(actor_id,record_id,action,from_status,to_status) values(auth.uid(),p_id,'advance',r.status,target);
end $$;

create function public.update_schedule(p_opens_at timestamptz,p_closes_at timestamptz,p_notice text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if public.my_role() is distinct from 'admin' then raise exception 'ไม่มีสิทธิ์ดำเนินการ'; end if;
 if p_opens_at is null or p_closes_at is null or p_closes_at<=p_opens_at or length(p_notice)>1000 then raise exception 'ช่วงเวลาไม่ถูกต้อง'; end if;
 update public.site_schedule set opens_at=p_opens_at,closes_at=p_closes_at,notice=p_notice where id=1;
 insert into public.audit_log(actor_id,action) values(auth.uid(),'schedule_updated');
end $$;

create function public.import_grades(p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; sid uuid; tid uuid; matches integer; inserted integer:=0; skipped integer:=0; affected integer;
begin
 if public.my_role() is distinct from 'academic' or not coalesce(public.site_is_open(),false) then raise exception 'ไม่มีสิทธิ์นำเข้าข้อมูลหรืออยู่นอกเวลาเปิดระบบ'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 2000 then raise exception 'นำเข้าได้ครั้งละ 1–2,000 รายการ'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
   if length(item->>'course_code') not between 1 and 40 or length(item->>'course_name') not between 1 and 200 or length(item->>'classroom') not between 1 and 40 or length(item->>'student_name') not between 1 and 150 or length(item->>'teacher_name') not between 1 and 150 then raise exception 'รูปแบบข้อมูลไม่ถูกต้อง'; end if;
   select id into sid from public.profiles where role='student' and student_code=item->>'student_code';
   if sid is null then raise exception 'ไม่พบบัญชีนักเรียนเลขประจำตัว %',item->>'student_code'; end if;
   if not exists(select 1 from public.profiles where id=sid and full_name=item->>'student_name') then raise exception 'ชื่อนักเรียนไม่ตรงกับบัญชี: %',item->>'student_code'; end if;
   select count(*) into matches from public.profiles where role='teacher' and full_name=item->>'teacher_name';
   if matches<>1 then raise exception 'ชื่อครูไม่พบหรือซ้ำ: % กรุณาตรวจสอบบัญชี',item->>'teacher_name'; end if;
   select id into tid from public.profiles where role='teacher' and full_name=item->>'teacher_name';
   insert into public.grade_records(course_code,course_name,credits,classroom,teacher_name,student_code,student_name,roll_number,academic_year,semester,original_grade,student_id,teacher_id)
   values(item->>'course_code',item->>'course_name',(item->>'credits')::numeric,item->>'classroom',item->>'teacher_name',item->>'student_code',item->>'student_name',(item->>'roll_number')::integer,(item->>'academic_year')::integer,(item->>'semester')::integer,item->>'original_grade',sid,tid)
   on conflict(student_code,course_code,academic_year,semester) do nothing;
   get diagnostics affected = row_count;
   inserted:=inserted+affected; skipped:=skipped+(1-affected);
 end loop;
 insert into public.audit_log(actor_id,action) values(auth.uid(),'import:'||inserted||':skipped:'||skipped);
 return jsonb_build_object('inserted',inserted,'skipped',skipped);
end $$;

create function public.consume_login_attempt(p_bucket text) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_bucket !~ '^[a-f0-9]{64}$' then return false; end if;
 delete from public.login_attempts where window_start < now()-interval '1 day';
 insert into public.login_attempts(bucket,window_start,attempts) values(p_bucket,now(),1)
 on conflict(bucket) do update set attempts=case when login_attempts.window_start<now()-interval '15 minutes' then 1 else login_attempts.attempts+1 end,
 window_start=case when login_attempts.window_start<now()-interval '15 minutes' then now() else login_attempts.window_start end returning attempts into n;
 return n<=10;
end $$;
revoke all on function public.my_role(),public.site_is_open(),public.advance_grade(uuid,public.grade_status,text,timestamptz,text),public.update_schedule(timestamptz,timestamptz,text),public.import_grades(jsonb),public.consume_login_attempt(text) from public;
grant execute on function public.my_role(),public.site_is_open(),public.advance_grade(uuid,public.grade_status,text,timestamptz,text),public.update_schedule(timestamptz,timestamptz,text),public.import_grades(jsonb) to authenticated;
grant execute on function public.consume_login_attempt(text) to anon,authenticated;
commit;

-- ============================================================
-- 002_assignment_attachments.sql
-- ============================================================
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

-- ============================================================
-- 003_web_push.sql
-- ============================================================
begin;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check(length(endpoint) between 20 and 2048),
  p256dh text not null check(length(p256dh) between 20 and 512),
  auth text not null check(length(auth) between 8 and 256),
  user_agent text not null default '' check(length(user_agent) <= 512),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_subscriptions_user on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to service_role;

create function public.upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default ''
) returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if public.my_role() is distinct from 'teacher' then
    raise exception 'เฉพาะครูเท่านั้นที่เปิดรับการแจ้งเตือนได้';
  end if;
  if length(p_endpoint) not between 20 and 2048
    or p_endpoint not like 'https://%'
    or length(p_p256dh) not between 20 and 512
    or length(p_auth) not between 8 and 256
    or length(coalesce(p_user_agent, '')) > 512 then
    raise exception 'ข้อมูลการแจ้งเตือนไม่ถูกต้อง';
  end if;

  insert into public.push_subscriptions(
    user_id, endpoint, p256dh, auth, user_agent
  ) values (
    auth.uid(), p_endpoint, p_p256dh, p_auth, coalesce(p_user_agent, '')
  )
  on conflict(endpoint) do update set
    user_id=excluded.user_id,
    p256dh=excluded.p256dh,
    auth=excluded.auth,
    user_agent=excluded.user_agent,
    updated_at=now();
end $$;

create function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  delete from public.push_subscriptions
  where user_id=auth.uid() and endpoint=p_endpoint;
end $$;

revoke all on function public.upsert_push_subscription(text,text,text,text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.upsert_push_subscription(text,text,text,text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

commit;

-- ============================================================
-- 004_academic_schedule.sql
-- ============================================================
-- Apply after migrations 001-003. Delete former admin profiles and Auth users.
-- Keep audit events, clearing only their reference to the removed actor.
begin;

drop policy records_read on public.grade_records;
drop policy audit_read on public.audit_log;
drop policy assignment_files_read on public.assignment_files;
drop policy assignment_storage_insert on storage.objects;
drop policy assignment_storage_read on storage.objects;
drop policy assignment_storage_cleanup on storage.objects;
drop function public.my_role();

create temporary table mst_removed_admin_ids on commit drop as
  select id from public.profiles where role='admin';
update public.audit_log set actor_id=null
  where actor_id in (select id from mst_removed_admin_ids);
-- Foreign keys intentionally prevent deletion if any grade or file refers to
-- a former admin; the whole migration then rolls back instead of deleting it.
delete from public.profiles where id in (select id from mst_removed_admin_ids);
delete from auth.users where id in (select id from mst_removed_admin_ids);
alter table public.profiles drop constraint profiles_check;
alter type public.app_role rename to app_role_legacy;
create type public.app_role as enum ('student','teacher','academic');
alter table public.profiles alter column role type public.app_role
  using role::text::public.app_role;
drop type public.app_role_legacy;
alter table public.profiles add constraint profiles_student_code_check check (
  case when role='student' then student_code is not null else student_code is null end
);

create function public.my_role() returns public.app_role
language sql stable security definer set search_path='' as $$
  select role from public.profiles where id=auth.uid()
$$;
revoke all on function public.my_role() from public;
grant execute on function public.my_role() to authenticated;

create policy records_read on public.grade_records for select to authenticated using(public.site_is_open() and ((public.my_role()='student' and student_id=auth.uid()) or (public.my_role()='teacher' and teacher_id=auth.uid()) or public.my_role()='academic'));

create policy audit_read on public.audit_log for select to authenticated using(public.site_is_open() and public.my_role()='academic');

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

drop policy schedule_read on public.site_schedule;
create policy schedule_read on public.site_schedule for select to authenticated
using(public.my_role() is not null);

create or replace function public.update_schedule(p_opens_at timestamptz,p_closes_at timestamptz,p_notice text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if public.my_role() is distinct from 'academic' then raise exception 'ไม่มีสิทธิ์ดำเนินการ'; end if;
 if p_opens_at is null or p_closes_at is null or p_closes_at<=p_opens_at or length(p_notice)>1000 then raise exception 'ช่วงเวลาไม่ถูกต้อง'; end if;
 update public.site_schedule set opens_at=p_opens_at,closes_at=p_closes_at,notice=p_notice where id=1;
 insert into public.audit_log(actor_id,action) values(auth.uid(),'schedule_updated');
end $$;

commit;

-- ============================================================
-- 005_manager_role.sql
-- ============================================================
begin;
-- Apply after 004_academic_schedule.sql. Existing RLS grants manager access to
-- their own profile and the schedule, but not to grade records or mutations.
alter type public.app_role add value if not exists 'manager';
commit;

-- ============================================================
-- 006_manager_dashboard_stats.sql
-- ============================================================
-- Apply after 005_manager_role.sql. Managers receive aggregate counts only;
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
      count(*) filter (where status = 'completed')::bigint as completed_records
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
    'total_students', (select count(*) from student_counts),
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

-- ============================================================
-- 007_manager_student_counts.sql
-- ============================================================
-- Apply after 006_manager_dashboard_stats.sql. Managers receive aggregate counts only;
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
      count(*) filter (where status = 'completed')::bigint as completed_records
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

-- ============================================================
-- 008_manager_outstanding_statuses.sql
-- ============================================================
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

-- ============================================================
-- 009_manager_student_lists.sql
-- ============================================================
-- Apply after 008_manager_outstanding_statuses.sql. Managers receive only
-- student-level summaries; row-level policies still deny grade-record access.
begin;

create index if not exists grades_student_latest
  on public.grade_records(
    student_id,
    academic_year desc,
    semester desc,
    created_at desc,
    id desc
  );

create or replace function public.manager_student_list(
  p_completed boolean,
  p_query text default '',
  p_limit integer default 20,
  p_offset integer default 0
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
     or p_offset is null or p_offset < 0 then
    raise exception 'ข้อมูลแบ่งหน้าไม่ถูกต้อง' using errcode = '22023';
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
  ), page as (
    select *
    from students
    order by student_code, student_name
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from students),
    'items', coalesce(
      (select jsonb_agg(to_jsonb(page) order by student_code, student_name) from page),
      '[]'::jsonb
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.manager_student_list(boolean,text,integer,integer) from public;
grant execute on function public.manager_student_list(boolean,text,integer,integer) to authenticated;

commit;

-- ============================================================
-- 010_manager_student_courses.sql
-- ============================================================
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

-- ============================================================
-- 011_manager_student_filters.sql
-- ============================================================
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

-- ============================================================
-- 012_multi_teachers.sql
-- ============================================================
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

-- ============================================================
-- 013_assignment_rounds.sql
-- ============================================================
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

-- ============================================================
-- 016_grade_record_history.sql
-- ============================================================
begin;

-- Keep the original record id, all grades, approval timestamps and teacher ids.
create table public.grade_record_history (
  like public.grade_records including defaults including constraints including indexes,
  archived_at timestamptz not null default now(),
  archived_closes_at timestamptz not null,
  constraint history_completed_only check (status = 'completed'),
  constraint history_student_fk foreign key (student_id) references public.profiles(id)
);
create index history_student_archive on public.grade_record_history(student_id, archived_at desc, id);
create index history_teachers on public.grade_record_history using gin(teacher_id);
create index history_archive on public.grade_record_history(archived_at desc, id);
alter table public.grade_record_history enable row level security;
revoke all on public.grade_record_history from public, anon, authenticated;
grant select on public.grade_record_history to authenticated;
create policy history_read on public.grade_record_history for select to authenticated using (
  (public.my_role() = 'student' and student_id = (select auth.uid())) or
  (public.my_role() = 'teacher' and teacher_id @> array[(select auth.uid())]) or
  public.my_role() = 'academic'
);

-- Repoint children to history before deleting the active parent. No cascading
-- delete of assignment rounds, file metadata or approval audit events occurs.
alter table public.grade_assignments
  alter column record_id drop not null,
  add column archived_record_id uuid references public.grade_record_history(id),
  add constraint assignment_one_parent check (num_nonnulls(record_id, archived_record_id) = 1),
  add constraint archived_assignment_round unique(archived_record_id, round_number);
alter table public.assignment_files
  alter column record_id drop not null,
  add column archived_record_id uuid references public.grade_record_history(id),
  add constraint file_one_parent check (num_nonnulls(record_id, archived_record_id) = 1);
alter table public.audit_log
  add column archived_record_id uuid references public.grade_record_history(id),
  add constraint audit_one_parent check (num_nonnulls(record_id, archived_record_id) <= 1);
create index history_files on public.assignment_files(archived_record_id, created_at);
create index history_audit on public.audit_log(archived_record_id, created_at);

create policy archived_assignments_read on public.grade_assignments for select to authenticated
using (exists(select 1 from public.grade_record_history h where h.id = archived_record_id));
create policy archived_files_read on public.assignment_files for select to authenticated
using (exists(select 1 from public.grade_record_history h where h.id = archived_record_id));
create policy archived_audit_read on public.audit_log for select to authenticated
using (public.my_role() = 'academic' and archived_record_id is not null);
create policy archived_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'assignment-files' and exists (
    select 1 from public.assignment_files f
    join public.grade_record_history h on h.id = f.archived_record_id
    where f.storage_path = name
  )
);

create function public.archive_completed_before_close(p_closes_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  moved_ids uuid[];
  moved_count integer;
begin
  if p_closes_at is null or p_closes_at > clock_timestamp() then return 0; end if;
  -- Serialize with import/approval transactions, including any approval that
  -- started just before closing. The copy and all deletes commit together.
  lock table public.grade_records in share row exclusive mode;
  with copied as (
    insert into public.grade_record_history
    select g.*, clock_timestamp(), p_closes_at from public.grade_records g
    where g.status = 'completed'
    returning id
  ) select array_agg(id), count(*)::integer into moved_ids, moved_count from copied;
  if moved_count = 0 then return 0; end if;

  update public.assignment_files set archived_record_id = record_id, record_id = null
    where record_id = any(moved_ids);
  update public.grade_assignments set archived_record_id = record_id, record_id = null
    where record_id = any(moved_ids);
  update public.audit_log set archived_record_id = record_id, record_id = null
    where record_id = any(moved_ids);
  insert into public.audit_log(archived_record_id, action)
    select unnest(moved_ids), 'archive_completed';
  delete from public.grade_records where id = any(moved_ids);
  return moved_count;
end;
$$;
revoke all on function public.archive_completed_before_close(timestamptz) from public, anon, authenticated;

-- Invoked by pg_cron as the database owner, never by a browser.
create function public.archive_completed_grade_records()
returns integer language plpgsql security definer set search_path = '' as $$
declare closing timestamptz;
begin
  select closes_at into closing from public.site_schedule where id = 1 for update;
  return public.archive_completed_before_close(closing);
end;
$$;
revoke all on function public.archive_completed_grade_records() from public, anon, authenticated;

-- Reopening before the next cron tick must not carry completed records into the
-- next period. Shortening the schedule to a past time also archives immediately.
create function public.archive_on_schedule_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.archive_completed_before_close(old.closes_at);
  perform public.archive_completed_before_close(new.closes_at);
  return new;
end;
$$;
revoke all on function public.archive_on_schedule_change() from public, anon, authenticated;
create trigger archive_on_schedule_change before update of opens_at, closes_at on public.site_schedule
for each row execute function public.archive_on_schedule_change();

-- Reimporting the same student/course/year/semester must not resurrect an
-- archived result. RETURN NULL preserves import_grades' skipped-row counting.
create function public.skip_archived_grade_import() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.grade_record_history h
    where (h.student_code, h.course_code, h.academic_year, h.semester) =
      (new.student_code, new.course_code, new.academic_year, new.semester)
  ) then return null; end if;
  return new;
end;
$$;
revoke all on function public.skip_archived_grade_import() from public, anon, authenticated;
create trigger skip_archived_grade_import before insert on public.grade_records
for each row execute function public.skip_archived_grade_import();

create or replace function public.prevent_assigned_teacher_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.grade_records where teacher_id @> array[old.id])
    or exists (select 1 from public.grade_record_history where teacher_id @> array[old.id]) then
    raise exception 'ไม่สามารถลบบัญชีครูที่มีรายการผลการเรียนหรือประวัติอยู่';
  end if;
  return old;
end;
$$;

-- Handle an already expired schedule when installing this migration.
select public.archive_completed_grade_records();
commit;

-- ============================================================
-- 017_history_cron.sql
-- ============================================================
-- Run as postgres in Supabase SQL Editor after 016_grade_record_history.sql.
-- Supabase Cron runs in the database even when nobody has the website open.
begin;
create extension if not exists pg_cron;
select cron.schedule(
  'mst-grs-archive-completed',
  '30 seconds',
  'select public.archive_completed_grade_records();'
);
commit;

-- ============================================================
-- 018_remove_legacy_completion_trigger.sql
-- ============================================================
begin;

-- The history-table workflow superseded the completion-term workflow.
-- Some existing installations retain this trigger after schedule term columns
-- were removed, causing every approval to completed to fail.
-- Retain legacy columns and their data to preserve history table compatibility.
drop trigger if exists stamp_completion_term on public.grade_records;
drop function if exists public.stamp_completion_term();

commit;

-- ============================================================
-- 019_direct_assignment_uploads.sql
-- ============================================================
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

-- ============================================================
-- 020_date_only_schedule.sql
-- ============================================================
begin;

-- Keep timestamp columns for existing cron/archive integrations. Boundaries
-- are Bangkok midnight; closes_at is midnight AFTER the selected closing day.
create or replace function public.update_schedule(p_opens_at timestamptz,p_closes_at timestamptz,p_notice text)
returns void language plpgsql security definer set search_path='' as $$
declare
  opening timestamptz;
  closing timestamptz;
begin
  if public.my_role() is distinct from 'academic' then raise exception 'ไม่มีสิทธิ์ดำเนินการ'; end if;
  if p_opens_at is null or p_closes_at is null or not isfinite(p_opens_at) or not isfinite(p_closes_at)
    or p_notice is null or length(p_notice)>1000 then raise exception 'ช่วงวันที่ไม่ถูกต้อง'; end if;
  opening := (p_opens_at at time zone 'Asia/Bangkok')::date::timestamp at time zone 'Asia/Bangkok';
  closing := (((p_closes_at - interval '1 microsecond') at time zone 'Asia/Bangkok')::date + 1)::timestamp at time zone 'Asia/Bangkok';
  if closing <= opening then raise exception 'ช่วงวันที่ไม่ถูกต้อง'; end if;
  update public.site_schedule set opens_at=opening,closes_at=closing,notice=p_notice where id=1;
  insert into public.audit_log(actor_id,action) values(auth.uid(),'schedule_updated');
end $$;

-- Do not archive against the old partial-day deadline while converting it.
alter table public.site_schedule disable trigger archive_on_schedule_change;
update public.site_schedule set
  opens_at = (opens_at at time zone 'Asia/Bangkok')::date::timestamp at time zone 'Asia/Bangkok',
  closes_at = (((closes_at - interval '1 microsecond') at time zone 'Asia/Bangkok')::date + 1)::timestamp at time zone 'Asia/Bangkok'
where opens_at is not null and closes_at is not null;
alter table public.site_schedule enable trigger archive_on_schedule_change;

commit;

-- ============================================================
-- 021_reset_unfinished_on_close.sql
-- ============================================================
begin;

-- One transaction per closing boundary, even when cron runs every 30 seconds.
create table public.school_period_closures (
  closes_at timestamptz primary key,
  processed_at timestamptz not null default now()
);
alter table public.school_period_closures enable row level security;
revoke all on public.school_period_closures from public, anon, authenticated;

-- Keep the previous attempt without mixing it with successful grade history.
-- record_id intentionally has no FK: the active record may later be archived.
create table public.grade_reset_history (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,
  closes_at timestamptz not null references public.school_period_closures(closes_at),
  student_id uuid not null,
  teacher_id uuid[] not null,
  record_snapshot jsonb not null,
  reset_at timestamptz not null default now(),
  unique(record_id, closes_at)
);
create index reset_history_student on public.grade_reset_history(student_id);
create index reset_history_teachers on public.grade_reset_history using gin(teacher_id);
alter table public.grade_reset_history enable row level security;
revoke all on public.grade_reset_history from public, anon, authenticated;
grant select on public.grade_reset_history to authenticated;
create policy reset_history_read on public.grade_reset_history for select to authenticated using (
  (public.my_role() = 'student' and student_id = (select auth.uid())) or
  (public.my_role() = 'teacher' and teacher_id @> array[(select auth.uid())]) or
  public.my_role() = 'academic'
);

alter table public.grade_assignments
  add column reset_history_id uuid references public.grade_reset_history(id),
  drop constraint assignment_one_parent,
  add constraint assignment_one_parent check (num_nonnulls(record_id, archived_record_id, reset_history_id) = 1),
  add constraint reset_assignment_round unique(reset_history_id, round_number);
alter table public.assignment_files
  add column reset_history_id uuid references public.grade_reset_history(id),
  drop constraint file_one_parent,
  add constraint file_one_parent check (num_nonnulls(record_id, archived_record_id, reset_history_id) = 1);
create index reset_files on public.assignment_files(reset_history_id);
create policy reset_assignments_read on public.grade_assignments for select to authenticated
using (exists(select 1 from public.grade_reset_history h where h.id = reset_history_id));
create policy reset_files_read on public.assignment_files for select to authenticated
using (exists(select 1 from public.grade_reset_history h where h.id = reset_history_id));
create policy reset_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'assignment-files' and exists (
    select 1 from public.assignment_files f
    join public.grade_reset_history h on h.id = f.reset_history_id
    where f.storage_path = name
  )
);

create or replace function public.archive_completed_before_close(p_closes_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  moved_ids uuid[];
  moved_count integer;
begin
  if p_closes_at is null or p_closes_at > clock_timestamp() then return 0; end if;
  lock table public.grade_records in share row exclusive mode;
  insert into public.school_period_closures(closes_at) values (p_closes_at)
    on conflict do nothing;
  if not found then return 0; end if;

  with copied as (
    insert into public.grade_record_history
    select g.*, clock_timestamp(), p_closes_at from public.grade_records g
    where g.status = 'completed'
    returning id
  ) select array_agg(id), count(*)::integer into moved_ids, moved_count from copied;

  update public.assignment_files set archived_record_id = record_id, record_id = null
    where record_id = any(moved_ids);
  update public.grade_assignments set archived_record_id = record_id, record_id = null
    where record_id = any(moved_ids);
  update public.audit_log set archived_record_id = record_id, record_id = null
    where record_id = any(moved_ids);
  insert into public.audit_log(archived_record_id, action)
    select unnest(moved_ids), 'archive_completed';
  delete from public.grade_records where id = any(moved_ids);

  insert into public.grade_reset_history(record_id, closes_at, student_id, teacher_id, record_snapshot)
    select g.id, p_closes_at, g.student_id, g.teacher_id, to_jsonb(g)
    from public.grade_records g;
  update public.assignment_files f set reset_history_id = h.id, record_id = null
    from public.grade_reset_history h
    where h.closes_at = p_closes_at and f.record_id = h.record_id;
  update public.grade_assignments a set reset_history_id = h.id, record_id = null
    from public.grade_reset_history h
    where h.closes_at = p_closes_at and a.record_id = h.record_id;
  insert into public.audit_log(record_id, action, from_status, to_status)
    select id, 'reset_at_period_close', status, 'pending'::public.grade_status
    from public.grade_records;
  update public.grade_records set
    status = 'pending', assignment = null, due_at = null,
    requested_at = null, assigned_at = null, submitted_at = null,
    teacher_approved_at = null, completed_at = null, final_grade = null;
  return moved_count;
end;
$$;
revoke all on function public.archive_completed_before_close(timestamptz) from public, anon, authenticated;

-- Existing cron (migration 017) and schedule-change trigger call this function.
-- Also process the current period if it has already closed at installation.
select public.archive_completed_grade_records();
commit;

-- ============================================================
-- 022_grade_corrections.sql
-- ============================================================
begin;

-- Keep corrections after a completed record moves to grade_record_history.
-- There is no FK on record_id because the active row is deleted at period close.
create table public.grade_corrections (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,
  student_id uuid not null,
  teacher_id uuid[] not null,
  previous_grade text not null,
  new_grade text not null,
  changed_by uuid not null,
  changed_by_name text not null,
  changed_at timestamptz not null default now(),
  check (previous_grade in ('1','1.5','2','2.5','3','3.5','4','ผ')),
  check (new_grade in ('1','1.5','2','2.5','3','3.5','4','ผ')),
  check (previous_grade <> new_grade)
);
create index grade_corrections_record_time on public.grade_corrections(record_id, changed_at desc);
create index grade_corrections_teacher on public.grade_corrections using gin(teacher_id);
alter table public.grade_corrections enable row level security;
revoke all on public.grade_corrections from public, anon, authenticated;
grant select on public.grade_corrections to authenticated;
create policy grade_corrections_read on public.grade_corrections for select to authenticated using (
  (public.my_role() = 'student' and student_id = (select auth.uid())) or
  (public.my_role() = 'teacher' and teacher_id @> array[(select auth.uid())]) or
  public.my_role() = 'academic'
);

create function public.correct_final_grade(p_id uuid, p_expected text, p_new text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.grade_records;
  correction public.grade_corrections;
  actor_name text;
begin
  if not coalesce(public.site_is_open(), false) then
    raise exception 'ระบบปิดรับดำเนินการ';
  end if;
  if public.my_role() is distinct from 'teacher' then
    raise exception 'ไม่มีสิทธิ์แก้ไขผลการเรียน';
  end if;
  if p_new is null or p_new not in ('1','1.5','2','2.5','3','3.5','4','ผ') then
    raise exception 'กรุณาระบุผลการเรียนใหม่ที่ถูกต้อง';
  end if;
  select * into r from public.grade_records where id = p_id for update;
  if not found or not r.teacher_id @> array[auth.uid()]
    or r.status not in ('teacher_approved', 'completed') then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการนี้หรือรายการเข้าประวัติแล้ว';
  end if;
  if r.final_grade is distinct from p_expected then
    raise exception 'ผลการเรียนเปลี่ยนแปลงแล้ว กรุณาโหลดหน้าใหม่';
  end if;
  if r.final_grade = p_new then
    raise exception 'กรุณาเลือกผลการเรียนที่ต่างจากเดิม';
  end if;
  select full_name into actor_name from public.profiles where id = auth.uid();
  update public.grade_records set final_grade = p_new where id = p_id;
  insert into public.grade_corrections(
    record_id, student_id, teacher_id, previous_grade, new_grade, changed_by, changed_by_name
  ) values (
    p_id, r.student_id, r.teacher_id, r.final_grade, p_new, auth.uid(), actor_name
  ) returning * into correction;
  insert into public.audit_log(actor_id, record_id, action, from_status, to_status)
  values (auth.uid(), p_id, 'correct_final_grade', r.status, r.status);
  return to_jsonb(correction);
end;
$$;
revoke all on function public.correct_final_grade(uuid,text,text) from public, anon, authenticated;
grant execute on function public.correct_final_grade(uuid,text,text) to authenticated;

commit;

-- ============================================================
-- 023_allow_all_new_grades.sql
-- ============================================================
begin;

-- New grades may still be failing or incomplete when the work was reviewed.
alter table public.grade_records
  drop constraint grade_records_final_grade_check,
  add constraint grade_records_final_grade_check
    check (final_grade in ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ'));
alter table public.grade_record_history
  drop constraint grade_records_final_grade_check,
  add constraint grade_record_history_final_grade_check
    check (final_grade in ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ'));
alter table public.grade_corrections
  drop constraint grade_corrections_previous_grade_check,
  drop constraint grade_corrections_new_grade_check,
  add constraint grade_corrections_previous_grade_check
    check (previous_grade in ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ')),
  add constraint grade_corrections_new_grade_check
    check (new_grade in ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ'));

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
    if p_final_grade is null or p_final_grade not in
      ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ') then
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

create or replace function public.correct_final_grade(p_id uuid, p_expected text, p_new text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.grade_records;
  correction public.grade_corrections;
  actor_name text;
begin
  if not coalesce(public.site_is_open(), false) then
    raise exception 'ระบบปิดรับดำเนินการ';
  end if;
  if public.my_role() is distinct from 'teacher' then
    raise exception 'ไม่มีสิทธิ์แก้ไขผลการเรียน';
  end if;
  if p_new is null or p_new not in
    ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ') then
    raise exception 'กรุณาระบุผลการเรียนใหม่ที่ถูกต้อง';
  end if;
  select * into r from public.grade_records where id = p_id for update;
  if not found or not r.teacher_id @> array[auth.uid()]
    or r.status not in ('teacher_approved', 'completed') then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการนี้หรือรายการเข้าประวัติแล้ว';
  end if;
  if r.final_grade is distinct from p_expected then
    raise exception 'ผลการเรียนเปลี่ยนแปลงแล้ว กรุณาโหลดหน้าใหม่';
  end if;
  if r.final_grade = p_new then
    raise exception 'กรุณาเลือกผลการเรียนที่ต่างจากเดิม';
  end if;
  select full_name into actor_name from public.profiles where id = auth.uid();
  update public.grade_records set final_grade = p_new where id = p_id;
  insert into public.grade_corrections(
    record_id, student_id, teacher_id, previous_grade, new_grade, changed_by, changed_by_name
  ) values (
    p_id, r.student_id, r.teacher_id, r.final_grade, p_new, auth.uid(), actor_name
  ) returning * into correction;
  insert into public.audit_log(actor_id, record_id, action, from_status, to_status)
  values (auth.uid(), p_id, 'correct_final_grade', r.status, r.status);
  return to_jsonb(correction);
end;
$$;

commit;

-- ============================================================
-- 024_admin_role.sql
-- ============================================================
begin;
-- Run this separately before 025 so the new enum value is committed first.
alter type public.app_role add value if not exists 'admin';
commit;

-- ============================================================
-- 025_admin_operations.sql
-- ============================================================
begin;

-- Keep the existing validation and audit behavior; transfer these operations to Admin.
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
  if public.my_role() is distinct from 'admin' or not coalesce(public.site_is_open(), false) then
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

create or replace function public.update_schedule(p_opens_at timestamptz,p_closes_at timestamptz,p_notice text)
returns void language plpgsql security definer set search_path='' as $$
declare
  opening timestamptz;
  closing timestamptz;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'ไม่มีสิทธิ์ดำเนินการ'; end if;
  if p_opens_at is null or p_closes_at is null or not isfinite(p_opens_at) or not isfinite(p_closes_at)
    or p_notice is null or length(p_notice)>1000 then raise exception 'ช่วงวันที่ไม่ถูกต้อง'; end if;
  opening := (p_opens_at at time zone 'Asia/Bangkok')::date::timestamp at time zone 'Asia/Bangkok';
  closing := (((p_closes_at - interval '1 microsecond') at time zone 'Asia/Bangkok')::date + 1)::timestamp at time zone 'Asia/Bangkok';
  if closing <= opening then raise exception 'ช่วงวันที่ไม่ถูกต้อง'; end if;
  update public.site_schedule set opens_at=opening,closes_at=closing,notice=p_notice where id=1;
  insert into public.audit_log(actor_id,action) values(auth.uid(),'schedule_updated');
end $$;

commit;

-- ============================================================
-- 026_overwrite_grade_imports.sql
-- ============================================================
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

-- ============================================================
-- 027_admin_students.sql
-- ============================================================
begin;

-- Legacy accounts keep their existing full_name and may have no split names/roll.
-- Identity data is encrypted by the server; the roster never returns it.
alter table public.profiles
  add column name_prefix text check(length(name_prefix) between 1 and 40),
  add column first_name text check(length(first_name) between 1 and 80),
  add column last_name text check(length(last_name) between 1 and 80),
  add column roll_number integer check(roll_number between 1 and 999),
  add column citizen_id_encrypted text check(citizen_id_encrypted ~ '^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]{26}$');
create index profiles_student_classroom on public.profiles(classroom, student_code) where role = 'student';

create function public.admin_student_list(p_search text default '', p_level integer default null, p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อนักเรียนได้'; end if;
  if p_search is null or length(p_search) > 150 or p_page is null or p_page < 1 or p_page > 100000
    or (p_level is not null and p_level not between 1 and 6) then raise exception 'ตัวกรองไม่ถูกต้อง'; end if;
  with students as (
    select id, student_code, full_name, classroom, name_prefix, first_name, last_name, roll_number,
      ((regexp_match(classroom, '^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level
    from public.profiles where role = 'student'
  ), filtered as (
    select * from students where (p_level is null or level = p_level)
      and (strpos(lower(full_name), lower(trim(p_search))) > 0 or strpos(student_code, trim(p_search)) > 0)
  ), page as (
    select id, student_code, full_name, classroom, name_prefix, first_name, last_name, roll_number from filtered
    order by level nulls last, classroom, roll_number nulls last, student_code, id
    limit 50 offset (p_page - 1) * 50
  ) select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(to_jsonb(page)) from page), '[]'::jsonb),
    'levels', coalesce((select jsonb_agg(level order by level) from (select distinct level from students where level is not null) x), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_student_list(text,integer,integer) from public, anon;
grant execute on function public.admin_student_list(text,integer,integer) to authenticated;

-- Profile changes and their audit entry commit together. Auth is provisioned
-- by the server first; a failed profile save rolls that newly created Auth back.
create function public.admin_save_student(p_id uuid, p_student jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare existing public.profiles; display_name text; existed boolean;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่เพิ่มนักเรียนได้'; end if;
  if p_id is null or jsonb_typeof(p_student) is distinct from 'object'
    or coalesce(p_student->>'student_code','') !~ '^\d{5,10}$'
    or coalesce(length(p_student->>'name_prefix'),0) not between 1 and 40
    or coalesce(length(p_student->>'first_name'),0) not between 1 and 80
    or coalesce(length(p_student->>'last_name'),0) not between 1 and 80
    or coalesce(p_student->>'classroom','') !~ '^ม[.][1-6]/[1-9]\d{0,2}$'
    or coalesce((p_student->>'roll_number')::integer,0) not between 1 and 999 then
    raise exception 'ข้อมูลนักเรียนไม่ถูกต้อง';
  end if;
  display_name := (p_student->>'name_prefix') || (p_student->>'first_name') || ' ' || (p_student->>'last_name');
  if length(display_name) > 150 then raise exception 'ชื่อรวมยาวเกิน 150 ตัวอักษร'; end if;
  select * into existing from public.profiles where id = p_id for update;
  existed := found;
  if existed and (existing.role <> 'student' or existing.student_code <> p_student->>'student_code') then
    raise exception 'ไม่สามารถเปลี่ยนประเภทบัญชีหรือรหัสนักเรียนเดิมได้';
  end if;
  insert into public.profiles(id,role,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,citizen_id_encrypted)
  values(p_id,'student',p_student->>'student_code',display_name,p_student->>'classroom',p_student->>'name_prefix',
    p_student->>'first_name',p_student->>'last_name',(p_student->>'roll_number')::integer,p_student->>'citizen_id_encrypted')
  on conflict(id) do update set full_name=excluded.full_name, classroom=excluded.classroom,
    name_prefix=excluded.name_prefix, first_name=excluded.first_name, last_name=excluded.last_name, roll_number=excluded.roll_number,
    citizen_id_encrypted=coalesce(excluded.citizen_id_encrypted,public.profiles.citizen_id_encrypted)
    where public.profiles.role = 'student' and public.profiles.student_code = excluded.student_code;
  if not found then raise exception 'ไม่สามารถเปลี่ยนประเภทบัญชีหรือรหัสนักเรียนเดิมได้'; end if;
  insert into public.audit_log(actor_id,action) values(auth.uid(),case when existed then 'student_updated' else 'student_created' end);
end;
$$;
revoke all on function public.admin_save_student(uuid,jsonb) from public, anon;
grant execute on function public.admin_save_student(uuid,jsonb) to authenticated;
commit;

-- ============================================================
-- 028_student_import_speed_cancel.sql
-- ============================================================
begin;

-- Only control metadata lives here. Student credentials stay in the request.
create table public.student_import_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check(status in ('active','cancelled','finished')),
  active_batch_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
alter table public.student_import_runs enable row level security;
revoke all on public.student_import_runs from public, anon, authenticated;

create function public.student_import_control(p_operation text, p_import_id uuid default null, p_batch_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.student_import_runs;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ควบคุมการนำเข้าได้'; end if;
  if p_operation = 'start' then
    insert into public.student_import_runs(owner_id) values(auth.uid()) returning * into r;
  else
    select * into r from public.student_import_runs where id=p_import_id and owner_id=auth.uid() for update;
    if not found then raise exception 'ไม่พบรอบนำเข้าหรือไม่มีสิทธิ์'; end if;
    if r.expires_at <= clock_timestamp() and r.status='active' then r.status := 'cancelled'; end if;
    case p_operation
      when 'cancel' then
        if r.status='active' then r.status := 'cancelled'; end if;
      when 'claim' then
        if p_batch_id is null then raise exception 'ไม่พบรหัสชุดนำเข้า'; end if;
        if r.status='active' then
          if r.active_batch_id is not null then raise exception 'มีชุดนำเข้าที่กำลังทำงานอยู่'; end if;
          r.active_batch_id := p_batch_id;
        end if;
      when 'check' then
        if p_batch_id is null or r.active_batch_id is distinct from p_batch_id then raise exception 'ชุดนำเข้าไม่ตรงกัน'; end if;
      when 'release' then
        if p_batch_id is null or r.active_batch_id is distinct from p_batch_id then raise exception 'ชุดนำเข้าไม่ตรงกัน'; end if;
        r.active_batch_id := null;
      when 'finish' then
        if r.active_batch_id is not null then raise exception 'กำลังรอชุดนำเข้าจบ'; end if;
        if r.status='active' then r.status := 'finished'; end if;
      else raise exception 'คำสั่งควบคุมไม่ถูกต้อง';
    end case;
    update public.student_import_runs set status=r.status, active_batch_id=r.active_batch_id where id=r.id;
  end if;
  return jsonb_build_object('importId',r.id,'status',r.status,'canContinue',r.status='active');
end;
$$;
revoke all on function public.student_import_control(text,uuid,uuid) from public, anon;
grant execute on function public.student_import_control(text,uuid,uuid) to authenticated;

create or replace function public.admin_student_list(p_search text default '', p_level integer default null, p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อนักเรียนได้'; end if;
  if p_search is null or length(p_search) > 150 or p_page is null or p_page < 1 or p_page > 100000
    or (p_level is not null and p_level not between 1 and 6) then raise exception 'ตัวกรองไม่ถูกต้อง'; end if;
  with students as (
    select id, student_code, full_name, classroom, name_prefix, first_name, last_name, roll_number,
      ((regexp_match(classroom, '^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level,
      ((regexp_match(classroom, '^(?:ม[.]\s*)?[1-6]/([0-9]+)$'))[1])::numeric as room
    from public.profiles where role = 'student'
  ), filtered as (
    select * from students where (p_level is null or level = p_level)
      and (strpos(lower(full_name), lower(trim(p_search))) > 0 or strpos(student_code, trim(p_search)) > 0)
  ), page as (
    select id, student_code, full_name, classroom, name_prefix, first_name, last_name, roll_number,
      row_number() over (order by level nulls last, room nulls last,
        case when level is null or room is null then classroom end nulls last,
        roll_number nulls last, student_code, id) as position
    from filtered order by position limit 50 offset (p_page - 1) * 50
  ) select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(to_jsonb(page)-'position' order by position) from page), '[]'::jsonb),
    'levels', coalesce((select jsonb_agg(level order by level) from (select distinct level from students where level is not null) x), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_student_list(text,integer,integer) from public, anon;
grant execute on function public.admin_student_list(text,integer,integer) to authenticated;
commit;

-- ============================================================
-- 029_teacher_registration.sql
-- ============================================================
begin;

create function public.consume_teacher_registration(p_identity_bucket text, p_source_bucket text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare identity_count integer; source_count integer;
begin
  if p_identity_bucket is null or p_source_bucket is null
    or p_identity_bucket !~ '^[a-f0-9]{64}$' or p_source_bucket !~ '^[a-f0-9]{64}$'
    or p_identity_bucket = p_source_bucket then return false; end if;
  delete from public.login_attempts where window_start < now()-interval '1 day';
  insert into public.login_attempts(bucket,window_start,attempts) values(p_source_bucket,now(),1)
  on conflict(bucket) do update set attempts=case when login_attempts.window_start<now()-interval '15 minutes' then 1 else login_attempts.attempts+1 end,
    window_start=case when login_attempts.window_start<now()-interval '15 minutes' then now() else login_attempts.window_start end returning attempts into source_count;
  insert into public.login_attempts(bucket,window_start,attempts) values(p_identity_bucket,now(),1)
  on conflict(bucket) do update set attempts=case when login_attempts.window_start<now()-interval '15 minutes' then 1 else login_attempts.attempts+1 end,
    window_start=case when login_attempts.window_start<now()-interval '15 minutes' then now() else login_attempts.window_start end returning attempts into identity_count;
  return identity_count<=5 and source_count<=60;
end;
$$;
revoke all on function public.consume_teacher_registration(text,text) from public,anon,authenticated;
grant execute on function public.consume_teacher_registration(text,text) to service_role;

-- Called only by the trusted registration server. Public callers cannot choose a role.
create function public.register_teacher_profile(p_id uuid, p_profile jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null or jsonb_typeof(p_profile) is distinct from 'object'
    or coalesce(length(p_profile->>'name_prefix'),0) not between 1 and 40
    or coalesce(length(p_profile->>'first_name'),0) not between 1 and 80
    or coalesce(length(p_profile->>'last_name'),0) not between 1 and 80
    or coalesce(p_profile->>'citizen_id_encrypted','') !~ '^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]{26}$' then
    raise exception 'ข้อมูลสมัครสมาชิกไม่ถูกต้อง';
  end if;
  insert into public.profiles(id,role,full_name,name_prefix,first_name,last_name,citizen_id_encrypted)
  values(p_id,'teacher',(p_profile->>'name_prefix') || (p_profile->>'first_name') || ' ' || (p_profile->>'last_name'),
    p_profile->>'name_prefix',p_profile->>'first_name',p_profile->>'last_name',p_profile->>'citizen_id_encrypted');
  insert into public.audit_log(actor_id,action) values(p_id,'teacher_registered');
end;
$$;
revoke all on function public.register_teacher_profile(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.register_teacher_profile(uuid,jsonb) to service_role;

commit;

-- ============================================================
-- 030_restore_profile_citizen_id_encrypted.sql
-- ============================================================
-- Repair databases where this column from migration 027 is missing.
-- Existing profiles remain valid: the encrypted identity is nullable.
begin;

alter table public.profiles
  add column if not exists citizen_id_encrypted text
  check (citizen_id_encrypted ~ '^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]{26}$');

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- 031_multi_role_login.sql
-- ============================================================
begin;

-- profiles.role remains the original role and preserves existing account links.
-- Extra staff roles are managed only through the trusted operator function below.
create table public.profile_roles (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null check (role in ('teacher','academic','admin')),
  primary key (profile_id, role)
);
alter table public.profile_roles enable row level security;
revoke all on public.profile_roles from public, anon, authenticated, service_role;

create function public.profile_has_role(p_user_id uuid, p_role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p where p.id = p_user_id and (
      p.role = p_role or (
        p.role in ('teacher','academic','admin') and exists (
          select 1 from public.profile_roles r
          where r.profile_id = p.id and r.role = p_role
        )
      )
    )
  );
$$;
revoke all on function public.profile_has_role(uuid,public.app_role) from public,anon,authenticated;
grant execute on function public.profile_has_role(uuid,public.app_role) to service_role;

create function public.set_staff_roles(p_profile_id uuid, p_roles public.app_role[])
returns void language plpgsql security definer set search_path = '' as $$
declare original_role public.app_role;
begin
  select role into original_role from public.profiles where id = p_profile_id for update;
  if original_role is null or original_role not in ('teacher','academic','admin')
    or p_roles is null or cardinality(p_roles) not between 1 and 3
    or array_position(p_roles, null) is not null
    or not p_roles <@ array['teacher','academic','admin']::public.app_role[]
    or not original_role = any(p_roles) then
    raise exception 'Invalid staff roles; keep the original account role';
  end if;
  delete from public.profile_roles where profile_id = p_profile_id;
  insert into public.profile_roles(profile_id,role)
    select p_profile_id, r from (select distinct unnest(p_roles) r) roles
    where r <> original_role;
  insert into public.audit_log(actor_id,action)
    values(auth.uid(),'staff_roles_updated:' || p_profile_id::text || ':' || array_to_string(p_roles,','));
end;
$$;
revoke all on function public.set_staff_roles(uuid,public.app_role[]) from public,anon,authenticated;
grant execute on function public.set_staff_roles(uuid,public.app_role[]) to service_role;

-- Resolve the existing Auth account without changing its email, password or ID.
-- Inputs are HMAC-derived internal emails, never plaintext citizen IDs.
create function public.resolve_staff_login(p_emails text[], p_role public.app_role)
returns text language plpgsql stable security definer set search_path = '' as $$
declare matches integer; result text;
begin
  if p_role is null or p_role not in ('teacher','academic','admin')
    or p_emails is null or cardinality(p_emails) <> 3
    or array_position(p_emails,null) is not null
    or exists (select 1 from unnest(p_emails) e where e !~ '^[a-f0-9]{64}@login[.]mst-grs[.]internal$') then
    return null;
  end if;
  select count(*), min(u.email) into matches, result
    from auth.users u
    where u.email = any(p_emails) and public.profile_has_role(u.id,p_role);
  -- Never guess which account to use when existing separate accounts conflict.
  if matches <> 1 then return null; end if;
  return result;
end;
$$;
revoke all on function public.resolve_staff_login(text[],public.app_role) from public,anon,authenticated;
grant execute on function public.resolve_staff_login(text[],public.app_role) to service_role;

create function public.staff_identity_exists(p_emails text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users where email = any(p_emails));
$$;
revoke all on function public.staff_identity_exists(text[]) from public,anon,authenticated;
grant execute on function public.staff_identity_exists(text[]) to service_role;

-- A login fixes one role for one Auth session. Refreshing a token keeps its role.
create table public.login_role_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now()
);
create index login_role_sessions_user on public.login_role_sessions(user_id);
alter table public.login_role_sessions enable row level security;
revoke all on public.login_role_sessions from public,anon,authenticated,service_role;

create function public.activate_login_role(p_session_id uuid, p_user_id uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
declare saved public.login_role_sessions;
begin
  if not exists (select 1 from auth.sessions where id = p_session_id and user_id = p_user_id)
    or not public.profile_has_role(p_user_id,p_role) then
    raise exception 'Invalid account, session or role';
  end if;
  insert into public.login_role_sessions(session_id,user_id,role)
    values(p_session_id,p_user_id,p_role) on conflict(session_id) do nothing;
  select * into saved from public.login_role_sessions where session_id = p_session_id;
  if saved.user_id is distinct from p_user_id or saved.role is distinct from p_role then
    raise exception 'Sign out and sign in again to choose another role';
  end if;
end;
$$;
revoke all on function public.activate_login_role(uuid,uuid,public.app_role) from public,anon,authenticated;
grant execute on function public.activate_login_role(uuid,uuid,public.app_role) to service_role;

create or replace function public.my_role()
returns public.app_role language plpgsql stable security definer set search_path = '' as $$
declare session_claim text := auth.jwt()->>'session_id'; selected_role public.app_role;
begin
  if session_claim is null or session_claim = '' then
    -- Legacy tokens / trusted SQL callers keep only their original role.
    select role into selected_role from public.profiles where id = auth.uid();
    return selected_role;
  end if;
  if session_claim !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  select r.role into selected_role
    from public.login_role_sessions r join auth.sessions s on s.id = r.session_id
    where r.session_id = session_claim::uuid and r.user_id = auth.uid()
      and s.user_id = auth.uid() and public.profile_has_role(r.user_id,r.role);
  return selected_role;
end;
$$;
revoke all on function public.my_role() from public,anon;
grant execute on function public.my_role() to authenticated;

-- Teachers may have a different original role; protect their assigned records too.
drop trigger prevent_assigned_teacher_delete on public.profiles;
create trigger prevent_assigned_teacher_delete before delete on public.profiles
for each row execute function public.prevent_assigned_teacher_delete();

create or replace function public.import_grades_overwrite(p_rows jsonb)
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

notify pgrst, 'reload schema';
commit;

-- ============================================================
-- 032_admin_teachers.sql
-- ============================================================
begin;

create function public.admin_teacher_list(p_search text default '', p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อคุณครูได้';
  end if;
  if p_search is null or length(p_search) > 150 or p_page is null or p_page not between 1 and 100000 then
    raise exception 'ตัวกรองไม่ถูกต้อง';
  end if;
  with filtered as (
    select id, full_name from public.profiles
    where public.profile_has_role(id, 'teacher')
      and (trim(p_search) = '' or position(lower(trim(p_search)) in lower(full_name)) > 0)
  ), paged as (
    select id, full_name from filtered order by full_name, id
    limit 50 offset (p_page - 1) * 50
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(to_jsonb(p) order by p.full_name,p.id) from paged p),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_teacher_list(text,integer) from public,anon;
grant execute on function public.admin_teacher_list(text,integer) to authenticated;

notify pgrst, 'reload schema';
commit;

-- ============================================================
-- 033_reset_teacher_account.sql
-- ============================================================
begin;

-- Keep attribution when the deleted teacher is the actor of an old audit event.
alter table public.audit_log
  add column deleted_actor_id uuid,
  add column deleted_actor_name text;

-- Delete both account rows in one transaction. A failed FK/trigger/storage check
-- must never leave an Auth account without its profile (or the reverse).
create function public.admin_reset_teacher(p_id uuid, p_expected_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare teacher public.profiles; actor uuid := auth.uid();
begin
  if actor is null or public.my_role() is distinct from 'admin' then
    raise exception 'TEACHER_RESET_FORBIDDEN';
  end if;
  if p_id is null or p_expected_name is null or length(p_expected_name) not between 1 and 150 then
    raise exception 'TEACHER_RESET_INVALID';
  end if;
  if p_id = actor then raise exception 'TEACHER_RESET_SELF'; end if;

  -- Follow the schedule/import lock order, then prevent new references between
  -- checking the teacher and deleting the account. Resets are rare single-user operations.
  perform 1 from public.site_schedule where id = 1 for share;
  lock table public.grade_records, public.grade_record_history,
    public.grade_reset_history, public.grade_corrections,
    public.assignment_files, storage.objects in share row exclusive mode;

  if public.my_role() is distinct from 'admin' then
    raise exception 'TEACHER_RESET_FORBIDDEN';
  end if;
  select * into teacher from public.profiles where id = p_id for update;
  if not found then
    -- Retrying a request whose successful response was lost is safe.
    if not exists (select 1 from auth.users where id = p_id) then
      return jsonb_build_object('deleted',true);
    end if;
    raise exception 'TEACHER_RESET_NOT_FOUND';
  end if;
  if not public.profile_has_role(p_id,'teacher') then
    raise exception 'TEACHER_RESET_NOT_TEACHER';
  end if;
  if teacher.full_name is distinct from p_expected_name then
    raise exception 'TEACHER_RESET_CHANGED';
  end if;
  if exists (select 1 from public.grade_records where teacher_id @> array[p_id] or student_id = p_id)
    or exists (select 1 from public.grade_record_history where teacher_id @> array[p_id] or student_id = p_id)
    or exists (select 1 from public.grade_reset_history where teacher_id @> array[p_id] or student_id = p_id)
    or exists (select 1 from public.grade_corrections where teacher_id @> array[p_id] or student_id = p_id or changed_by = p_id)
    or exists (select 1 from public.assignment_files where uploaded_by = p_id) then
    raise exception 'TEACHER_RESET_REFERENCED';
  end if;
  -- Storage has used both owner and owner_id. Do not delete files or orphan their
  -- ownership; avoid depending on either optional/deprecated column directly.
  if exists (select 1 from storage.objects o
    where to_jsonb(o)->>'owner_id' = p_id::text or to_jsonb(o)->>'owner' = p_id::text) then
    raise exception 'TEACHER_RESET_STORAGE';
  end if;

  update public.audit_log
    set deleted_actor_id = coalesce(deleted_actor_id,actor_id),
        deleted_actor_name = coalesce(deleted_actor_name,teacher.full_name),
        actor_id = null
    where actor_id = p_id;
  delete from public.profiles where id = p_id;
  delete from auth.users where id = p_id;
  insert into public.audit_log(actor_id,action)
    values(actor,'teacher_account_reset:' || p_id::text);
  return jsonb_build_object('deleted',true);
end;
$$;
revoke all on function public.admin_reset_teacher(uuid,text) from public,anon;
grant execute on function public.admin_reset_teacher(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;

-- ============================================================
-- 034_admin_academics.sql
-- ============================================================
begin;

create function public.admin_academic_list(p_search text default '', p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'ACADEMIC_FORBIDDEN'; end if;
  if p_search is null or length(p_search) > 150 or p_page is null or p_page not between 1 and 100000 then
    raise exception 'ACADEMIC_INVALID';
  end if;
  with filtered as (
    select id, full_name from public.profiles
    where public.profile_has_role(id, 'academic')
      and (trim(p_search) = '' or position(lower(trim(p_search)) in lower(full_name)) > 0)
  ), paged as (
    select id, full_name from filtered order by full_name, id limit 50 offset (p_page - 1) * 50
  )
  select jsonb_build_object('total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(to_jsonb(p) order by p.full_name,p.id) from paged p),'[]'::jsonb))
    into result;
  return result;
end;
$$;
revoke all on function public.admin_academic_list(text,integer) from public,anon;
grant execute on function public.admin_academic_list(text,integer) to authenticated;

-- Lock the account before merging roles; never overwrite its existing privileges.
create function public.admin_add_academic_teacher(p_id uuid, p_expected_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.profiles; merged public.app_role[];
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'ACADEMIC_FORBIDDEN'; end if;
  select * into target from public.profiles where id = p_id for update;
  if not found or not public.profile_has_role(p_id,'teacher')
    or p_expected_name is null or target.full_name is distinct from p_expected_name then
    raise exception 'ACADEMIC_TEACHER_CHANGED';
  end if;
  if public.profile_has_role(p_id,'academic') then return; end if;
  select array_agg(distinct r) into merged from (
    select target.role as r union select role from public.profile_roles where profile_id=p_id
    union select 'academic'::public.app_role
  ) roles;
  perform public.set_staff_roles(p_id,merged);
end;
$$;
revoke all on function public.admin_add_academic_teacher(uuid,text) from public,anon;
grant execute on function public.admin_add_academic_teacher(uuid,text) to authenticated;

-- Auth is created by the server first. The active Admin session saves the profile.
create function public.admin_create_academic_profile(p_id uuid, p_profile jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'ACADEMIC_FORBIDDEN'; end if;
  if p_id is null or jsonb_typeof(p_profile) is distinct from 'object'
    or coalesce(length(trim(p_profile->>'name_prefix')),0) not between 1 and 40
    or coalesce(length(trim(p_profile->>'first_name')),0) not between 1 and 80
    or coalesce(length(trim(p_profile->>'last_name')),0) not between 1 and 80
    or coalesce(p_profile->>'citizen_id_encrypted','') !~ '^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]{26}$' then
    raise exception 'ACADEMIC_INVALID';
  end if;
  insert into public.profiles(id,role,full_name,name_prefix,first_name,last_name,citizen_id_encrypted)
  values(p_id,'academic',trim(p_profile->>'name_prefix') || trim(p_profile->>'first_name') || ' ' || trim(p_profile->>'last_name'),
    trim(p_profile->>'name_prefix'),trim(p_profile->>'first_name'),trim(p_profile->>'last_name'),p_profile->>'citizen_id_encrypted');
  insert into public.audit_log(actor_id,action) values(auth.uid(),'academic_created:' || p_id::text);
end;
$$;
revoke all on function public.admin_create_academic_profile(uuid,jsonb) from public,anon;
grant execute on function public.admin_create_academic_profile(uuid,jsonb) to authenticated;

create function public.admin_reset_staff(p_id uuid, p_expected_name text, p_role public.app_role)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare teacher public.profiles; actor uuid := auth.uid();
begin
  if actor is null or public.my_role() is distinct from 'admin' then
    raise exception 'TEACHER_RESET_FORBIDDEN';
  end if;
  if p_role is null or p_role not in ('teacher','academic') or p_id is null or p_expected_name is null or length(p_expected_name) not between 1 and 150 then
    raise exception 'TEACHER_RESET_INVALID';
  end if;
  if p_id = actor then raise exception 'TEACHER_RESET_SELF'; end if;

  -- Follow the schedule/import lock order, then prevent new references between
  -- checking the teacher and deleting the account. Resets are rare single-user operations.
  perform 1 from public.site_schedule where id = 1 for share;
  lock table public.grade_records, public.grade_record_history,
    public.grade_reset_history, public.grade_corrections,
    public.assignment_files, storage.objects in share row exclusive mode;

  if public.my_role() is distinct from 'admin' then
    raise exception 'TEACHER_RESET_FORBIDDEN';
  end if;
  select * into teacher from public.profiles where id = p_id for update;
  if not found then
    -- Retrying a request whose successful response was lost is safe.
    if not exists (select 1 from auth.users where id = p_id) then
      return jsonb_build_object('deleted',true);
    end if;
    raise exception 'TEACHER_RESET_NOT_FOUND';
  end if;
  if not public.profile_has_role(p_id,p_role) then
    raise exception 'TEACHER_RESET_NOT_TEACHER';
  end if;
  if teacher.full_name is distinct from p_expected_name then
    raise exception 'TEACHER_RESET_CHANGED';
  end if;
  if exists (select 1 from public.grade_records where teacher_id @> array[p_id] or student_id = p_id)
    or exists (select 1 from public.grade_record_history where teacher_id @> array[p_id] or student_id = p_id)
    or exists (select 1 from public.grade_reset_history where teacher_id @> array[p_id] or student_id = p_id)
    or exists (select 1 from public.grade_corrections where teacher_id @> array[p_id] or student_id = p_id or changed_by = p_id)
    or exists (select 1 from public.assignment_files where uploaded_by = p_id) then
    raise exception 'TEACHER_RESET_REFERENCED';
  end if;
  -- Storage has used both owner and owner_id. Do not delete files or orphan their
  -- ownership; avoid depending on either optional/deprecated column directly.
  if exists (select 1 from storage.objects o
    where to_jsonb(o)->>'owner_id' = p_id::text or to_jsonb(o)->>'owner' = p_id::text) then
    raise exception 'TEACHER_RESET_STORAGE';
  end if;

  update public.audit_log
    set deleted_actor_id = coalesce(deleted_actor_id,actor_id),
        deleted_actor_name = coalesce(deleted_actor_name,teacher.full_name),
        actor_id = null
    where actor_id = p_id;
  delete from public.profiles where id = p_id;
  delete from auth.users where id = p_id;
  insert into public.audit_log(actor_id,action)
    values(actor,p_role::text || '_account_reset:' || p_id::text);
  return jsonb_build_object('deleted',true);
end;
$$;
revoke all on function public.admin_reset_staff(uuid,text,public.app_role) from public,anon,authenticated;

create or replace function public.admin_reset_teacher(p_id uuid, p_expected_name text)
returns jsonb language sql security definer set search_path = '' as $$
  select public.admin_reset_staff(p_id,p_expected_name,'teacher');
$$;
revoke all on function public.admin_reset_teacher(uuid,text) from public,anon;
grant execute on function public.admin_reset_teacher(uuid,text) to authenticated;

create function public.admin_reset_academic(p_id uuid, p_expected_name text)
returns jsonb language sql security definer set search_path = '' as $$
  select public.admin_reset_staff(p_id,p_expected_name,'academic');
$$;
revoke all on function public.admin_reset_academic(uuid,text) from public,anon;
grant execute on function public.admin_reset_academic(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;

-- ============================================================
-- 035_manager_completion_summary.sql
-- ============================================================
-- Add remaining-record distribution using the same active records as all dashboard totals.
-- History is intentionally outside this snapshot; access remains manager-only.
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

commit;

-- ============================================================
-- 036_admin_account_management.sql
-- ============================================================
begin;

-- Legacy manager usernames cannot be recovered from the HMAC Auth email.
alter table public.profiles
  add column username text,
  add column account_revision integer not null default 0,
  add constraint profile_username_format check (
    username is null or (role = 'manager' and username ~ '^[a-z][a-z0-9_.-]{2,39}$')
  );
create unique index profiles_manager_username on public.profiles(username) where username is not null;

create function public.bump_account_revision() returns trigger
language plpgsql set search_path = '' as $$
begin new.account_revision := old.account_revision + 1; return new; end;
$$;
revoke all on function public.bump_account_revision() from public,anon,authenticated;
create trigger bump_account_revision before update on public.profiles
for each row execute function public.bump_account_revision();

create function public.admin_account_list(p_role public.app_role, p_search text default '', p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_role is null or p_role not in ('teacher','academic','manager')
    or p_search is null or length(p_search)>150 or p_page is null or p_page not between 1 and 100000 then
    raise exception 'ACCOUNT_INVALID';
  end if;
  with filtered as (
    select id,full_name,name_prefix,first_name,last_name,username,account_revision
    from public.profiles where public.profile_has_role(id,p_role)
      and (position(lower(trim(p_search)) in lower(full_name))>0
        or position(lower(trim(p_search)) in coalesce(username,''))>0)
  ), paged as (
    select * from filtered order by full_name,id limit 50 offset (p_page-1)*50
  ) select jsonb_build_object('total',(select count(*) from filtered),
    'items',coalesce((select jsonb_agg(to_jsonb(p) order by full_name,id) from paged p),'[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.admin_account_list(public.app_role,text,integer) from public,anon;
grant execute on function public.admin_account_list(public.app_role,text,integer) to authenticated;

create function public.admin_create_manager_profile(p_id uuid, p_profile jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare display_name text;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_id is null or jsonb_typeof(p_profile) is distinct from 'object'
    or coalesce(length(trim(p_profile->>'name_prefix')),0) not between 1 and 40
    or coalesce(length(trim(p_profile->>'first_name')),0) not between 1 and 80
    or coalesce(length(trim(p_profile->>'last_name')),0) not between 1 and 80
    or coalesce(p_profile->>'username','') !~ '^[a-z][a-z0-9_.-]{2,39}$' then raise exception 'ACCOUNT_INVALID'; end if;
  display_name := trim(p_profile->>'name_prefix') || trim(p_profile->>'first_name') || ' ' || trim(p_profile->>'last_name');
  if length(display_name)>150 then raise exception 'ACCOUNT_INVALID'; end if;
  insert into public.profiles(id,role,full_name,name_prefix,first_name,last_name,username)
    values(p_id,'manager',display_name,trim(p_profile->>'name_prefix'),trim(p_profile->>'first_name'),trim(p_profile->>'last_name'),p_profile->>'username');
  insert into public.audit_log(actor_id,action) values(auth.uid(),'manager_created:' || p_id::text);
end;
$$;
revoke all on function public.admin_create_manager_profile(uuid,jsonb) from public,anon;
grant execute on function public.admin_create_manager_profile(uuid,jsonb) to authenticated;

create function public.admin_edit_account(p_id uuid, p_role public.app_role, p_expected_revision integer, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.profiles; display_name text;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_id is null or p_role is null or p_role not in ('student','teacher','academic')
    or p_expected_revision is null or p_expected_revision < 0 or jsonb_typeof(p_changes) is distinct from 'object'
    or coalesce(length(trim(p_changes->>'name_prefix')),0) not between 1 and 40
    or coalesce(length(trim(p_changes->>'first_name')),0) not between 1 and 80
    or coalesce(length(trim(p_changes->>'last_name')),0) not between 1 and 80
    or exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('name_prefix','first_name','last_name','classroom','roll_number')) then
    raise exception 'ACCOUNT_INVALID';
  end if;
  if p_role='student' and (coalesce(p_changes->>'classroom','') !~ '^ม[.][1-6]/[1-9]\d{0,2}$'
    or coalesce((p_changes->>'roll_number')::integer,0) not between 1 and 999) then raise exception 'ACCOUNT_INVALID'; end if;
  display_name := trim(p_changes->>'name_prefix') || trim(p_changes->>'first_name') || ' ' || trim(p_changes->>'last_name');
  if length(display_name)>150 then raise exception 'ACCOUNT_INVALID'; end if;
  perform 1 from public.site_schedule where id=1 for share;
  lock table public.grade_records in share row exclusive mode;
  select * into target from public.profiles where id=p_id for update;
  if not found or not public.profile_has_role(p_id,p_role) then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if public.profile_has_role(p_id,'admin') then raise exception 'ACCOUNT_PROTECTED'; end if;
  if target.account_revision <> p_expected_revision then raise exception 'ACCOUNT_CHANGED'; end if;
  update public.profiles set full_name=display_name,
    name_prefix=trim(p_changes->>'name_prefix'),first_name=trim(p_changes->>'first_name'),last_name=trim(p_changes->>'last_name'),
    classroom=case when p_role='student' then p_changes->>'classroom' else classroom end,
    roll_number=case when p_role='student' then (p_changes->>'roll_number')::integer else roll_number end
    where id=p_id returning * into target;
  -- Refresh display names in active work by ID. Historical names/classes remain snapshots.
  if p_role='student' then
    update public.grade_records set student_name=display_name where student_id=p_id;
  else
    update public.grade_records g set teacher_name=(
      select array_agg(case when t.id=p_id then display_name else g.teacher_name[t.ord::integer] end order by t.ord)
      from unnest(g.teacher_id) with ordinality t(id,ord)
    ) where g.teacher_id @> array[p_id];
  end if;
  insert into public.audit_log(actor_id,action) values(auth.uid(),'account_edited:' || p_id::text);
  return jsonb_build_object('id',target.id,'full_name',target.full_name,'name_prefix',target.name_prefix,
    'first_name',target.first_name,'last_name',target.last_name,'account_revision',target.account_revision,
    'student_code',target.student_code,'classroom',target.classroom,'roll_number',target.roll_number);
end;
$$;
revoke all on function public.admin_edit_account(uuid,public.app_role,integer,jsonb) from public,anon;
grant execute on function public.admin_edit_account(uuid,public.app_role,integer,jsonb) to authenticated;

create function public.admin_delete_account(p_id uuid, p_role public.app_role, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.profiles; actor uuid := auth.uid();
begin
  if actor is null or public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_id is null or p_role is null or p_role not in ('student','teacher','academic','manager')
    or p_expected_revision is null or p_expected_revision<0 then raise exception 'ACCOUNT_INVALID'; end if;
  if p_id=actor then raise exception 'ACCOUNT_PROTECTED'; end if;
  perform 1 from public.site_schedule where id=1 for share;
  lock table public.grade_records,public.grade_record_history,public.grade_reset_history,
    public.grade_corrections,public.assignment_files,storage.objects in share row exclusive mode;
  select * into target from public.profiles where id=p_id for update;
  if not found then
    if not exists(select 1 from auth.users where id=p_id) then return jsonb_build_object('deleted',true); end if;
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;
  if not public.profile_has_role(p_id,p_role) then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if public.profile_has_role(p_id,'admin') then raise exception 'ACCOUNT_PROTECTED'; end if;
  if target.account_revision<>p_expected_revision then raise exception 'ACCOUNT_CHANGED'; end if;
  if exists(select 1 from public.grade_records where student_id=p_id or teacher_id @> array[p_id])
    or exists(select 1 from public.grade_record_history where student_id=p_id or teacher_id @> array[p_id])
    or exists(select 1 from public.grade_reset_history where student_id=p_id or teacher_id @> array[p_id])
    or exists(select 1 from public.grade_corrections where student_id=p_id or teacher_id @> array[p_id] or changed_by=p_id)
    or exists(select 1 from public.assignment_files where uploaded_by=p_id) then raise exception 'ACCOUNT_REFERENCED'; end if;
  if exists(select 1 from storage.objects o where to_jsonb(o)->>'owner_id'=p_id::text or to_jsonb(o)->>'owner'=p_id::text) then
    raise exception 'ACCOUNT_REFERENCED'; end if;
  update public.audit_log set deleted_actor_id=coalesce(deleted_actor_id,actor_id),
    deleted_actor_name=coalesce(deleted_actor_name,target.full_name),actor_id=null where actor_id=p_id;
  delete from public.profiles where id=p_id;
  delete from auth.users where id=p_id;
  insert into public.audit_log(actor_id,action) values(actor,'account_deleted:' || p_role::text || ':' || p_id::text);
  return jsonb_build_object('deleted',true);
end;
$$;
revoke all on function public.admin_delete_account(uuid,public.app_role,integer) from public,anon;
grant execute on function public.admin_delete_account(uuid,public.app_role,integer) to authenticated;

-- Check the target with the active Admin session before the server calls Auth.
create function public.admin_manager_password_target(p_id uuid, p_expected_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.profiles;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  select * into target from public.profiles where id=p_id;
  if not found or target.role<>'manager' then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if p_expected_revision is null or target.account_revision<>p_expected_revision then raise exception 'ACCOUNT_CHANGED'; end if;
end;
$$;
revoke all on function public.admin_manager_password_target(uuid,integer) from public,anon;
grant execute on function public.admin_manager_password_target(uuid,integer) to authenticated;

create function public.admin_finish_manager_password_reset(p_id uuid, p_expected_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_manager_password_target(p_id,p_expected_revision);
  delete from auth.sessions where user_id=p_id;
  insert into public.audit_log(actor_id,action) values(auth.uid(),'manager_password_changed:' || p_id::text);
end;
$$;
revoke all on function public.admin_finish_manager_password_reset(uuid,integer) from public,anon;
grant execute on function public.admin_finish_manager_password_reset(uuid,integer) to authenticated;

create or replace function public.admin_student_list(p_search text default '', p_level integer default null, p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อนักเรียนได้'; end if;
  if p_search is null or length(p_search) > 150 or p_page is null or p_page < 1 or p_page > 100000
    or (p_level is not null and p_level not between 1 and 6) then raise exception 'ตัวกรองไม่ถูกต้อง'; end if;
  with students as (
    select id, student_code, full_name, classroom, name_prefix, first_name, last_name, roll_number, account_revision,
      ((regexp_match(classroom, '^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level
    from public.profiles where role = 'student'
  ), filtered as (
    select * from students where (p_level is null or level = p_level)
      and (strpos(lower(full_name), lower(trim(p_search))) > 0 or strpos(student_code, trim(p_search)) > 0)
  ), page as (
    select id, student_code, full_name, classroom, name_prefix, first_name, last_name, roll_number, account_revision from filtered
    order by level nulls last, classroom, roll_number nulls last, student_code, id
    limit 50 offset (p_page - 1) * 50
  ) select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(to_jsonb(page)) from page), '[]'::jsonb),
    'levels', coalesce((select jsonb_agg(level order by level) from (select distinct level from students where level is not null) x), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_student_list(text,integer,integer) from public, anon;
grant execute on function public.admin_student_list(text,integer,integer) to authenticated;


notify pgrst, 'reload schema';
commit;

-- ============================================================
-- 037_student_lifecycle.sql
-- ============================================================
begin;

-- Enrollment status is independent of Auth and grade completion status.
alter table public.profiles
  add column student_status text not null default 'active' check(student_status in ('active','graduated','transferred')),
  add column student_status_year integer,
  add column student_status_changed_at timestamptz,
  add constraint student_status_year_valid check (
    (student_status='active' and student_status_year is null) or
    (role='student' and student_status<>'active' and student_status_year between 2500 and 2800 and student_status_year is not null)
  );
create index profiles_student_status_class on public.profiles(student_status,classroom,student_code) where role='student';

create function public.admin_student_lifecycle_list(
  p_search text default '', p_status text default 'active', p_level integer default null,
  p_classroom text default null, p_page integer default 1, p_page_size integer default 50
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'STUDENT_LIFECYCLE_FORBIDDEN'; end if;
  if p_status is null or p_status not in ('all','active','graduated','transferred') or p_search is null or length(p_search)>150
    or (p_level is not null and p_level not between 1 and 6) or length(p_classroom)>40
    or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (50,2000) then
    raise exception 'STUDENT_LIFECYCLE_INVALID';
  end if;
  with students as (
    select id,student_code,full_name,classroom,roll_number,account_revision,student_status,student_status_year,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level
    from public.profiles where role='student'
  ), filtered as (
    select * from students where (p_status='all' or student_status=p_status)
      and (p_level is null or level=p_level) and (p_classroom is null or classroom=p_classroom)
      and (strpos(lower(full_name),lower(trim(p_search)))>0 or strpos(student_code,trim(p_search))>0)
  ), paged as (
    select id,student_code,full_name,classroom,roll_number,account_revision,student_status,student_status_year
    from filtered order by classroom,roll_number nulls last,student_code,id limit p_page_size offset (p_page-1)*p_page_size
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(p) order by classroom,roll_number nulls last,student_code,id) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'classrooms',coalesce((select jsonb_agg(classroom order by classroom) from (select distinct classroom from students where classroom is not null and (p_level is null or level=p_level)) c),'[]'::jsonb),
    'counts',jsonb_build_object('active',(select count(*) from students where student_status='active'),
      'graduated',(select count(*) from students where student_status='graduated'),'transferred',(select count(*) from students where student_status='transferred'))
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_student_lifecycle_list(text,text,integer,text,integer,integer) from public,anon;
grant execute on function public.admin_student_lifecycle_list(text,text,integer,text,integer,integer) to authenticated;

create function public.admin_change_student_status(p_students jsonb,p_status text,p_year integer default null)
returns integer language plpgsql security definer set search_path='' as $$
declare target public.profiles; wanted integer; matched integer := 0; changed integer := 0;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'STUDENT_LIFECYCLE_FORBIDDEN'; end if;
  if p_status is null or p_status not in ('active','graduated','transferred') or jsonb_typeof(p_students) is distinct from 'array' then
    raise exception 'STUDENT_LIFECYCLE_INVALID';
  end if;
  wanted := jsonb_array_length(p_students);
  if wanted not between 1 and 2000 or (p_status='active' and p_year is not null)
    or (p_status<>'active' and (p_year is null or p_year not between 2500 and 2800))
    or exists(select 1 from jsonb_array_elements(p_students) s where jsonb_typeof(s) is distinct from 'object'
      or coalesce(s->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or coalesce(s->>'revision','') !~ '^[0-9]{1,10}$') then raise exception 'STUDENT_LIFECYCLE_INVALID'; end if;
  if (select count(distinct (s->>'id')::uuid) from jsonb_array_elements(p_students) s)<>wanted then raise exception 'STUDENT_LIFECYCLE_INVALID'; end if;
  -- Deterministic locks and revisions prevent stale selections overwriting imports/edits.
  for target in select p.* from public.profiles p join jsonb_array_elements(p_students) s on p.id=(s->>'id')::uuid
    order by p.id for update of p
  loop
    if target.role<>'student' or not exists(select 1 from jsonb_array_elements(p_students) s
      where (s->>'id')::uuid=target.id and (s->>'revision')::bigint=target.account_revision) then
      raise exception 'STUDENT_LIFECYCLE_CHANGED';
    end if;
    matched := matched+1;
    if target.student_status is distinct from p_status or target.student_status_year is distinct from p_year then
      update public.profiles set student_status=p_status,student_status_year=p_year,student_status_changed_at=now() where id=target.id;
      insert into public.audit_log(actor_id,action) values(auth.uid(),'student_status_changed:' || jsonb_build_object(
        'id',target.id,'student_code',target.student_code,'classroom',target.classroom,
        'from',target.student_status,'from_year',target.student_status_year,'to',p_status,'year',p_year)::text);
      changed := changed+1;
    end if;
  end loop;
  if matched<>wanted then raise exception 'STUDENT_LIFECYCLE_CHANGED'; end if;
  return changed;
end;
$$;
revoke all on function public.admin_change_student_status(jsonb,text,integer) from public,anon;
grant execute on function public.admin_change_student_status(jsonb,text,integer) to authenticated;

-- Existing imports update the same student ID and preserve enrollment status.
-- The main roster lists current students. Archived students remain in the lifecycle page.
create or replace function public.admin_student_list(p_search text default '', p_level integer default null, p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อนักเรียนได้'; end if;
  if p_search is null or length(p_search)>150 or p_page is null or p_page not between 1 and 100000
    or (p_level is not null and p_level not between 1 and 6) then raise exception 'ตัวกรองไม่ถูกต้อง'; end if;
  with students as (
    select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level
    from public.profiles where role='student' and student_status='active'
  ), filtered as (
    select * from students where (p_level is null or level=p_level)
      and (strpos(lower(full_name),lower(trim(p_search)))>0 or strpos(student_code,trim(p_search))>0)
  ), page as (
    select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision from filtered
    order by level nulls last,classroom,roll_number nulls last,student_code,id limit 50 offset (p_page-1)*50
  ) select jsonb_build_object('total',(select count(*) from filtered),
    'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),
    'levels',coalesce((select jsonb_agg(level order by level) from (select distinct level from students where level is not null) x),'[]'::jsonb)) into result;
  return result;
end;
$$;

create function public.admin_student_import_summary(p_codes text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare existing integer; archived integer;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'STUDENT_LIFECYCLE_FORBIDDEN'; end if;
  if p_codes is null or cardinality(p_codes) not between 1 and 2000
    or exists(select 1 from unnest(p_codes) c where c is null or c !~ '^\d{5,10}$')
    or (select count(distinct c) from unnest(p_codes) c)<>cardinality(p_codes) then raise exception 'STUDENT_LIFECYCLE_INVALID'; end if;
  select count(*),count(*) filter(where student_status<>'active') into existing,archived
    from public.profiles where role='student' and student_code=any(p_codes);
  return jsonb_build_object('created',cardinality(p_codes)-existing,'updated',existing,'archived',archived);
end;
$$;
revoke all on function public.admin_student_import_summary(text[]) from public,anon;
grant execute on function public.admin_student_import_summary(text[]) to authenticated;

notify pgrst,'reload schema';
commit;

-- ============================================================
-- 038_student_graduation_eligibility.sql
-- ============================================================
begin;
-- A separate RPC name prevents older databases from silently using the unchecked rule.
drop function public.admin_change_student_status(jsonb,text,integer);
alter table public.profiles drop constraint profiles_student_status_check;
alter table public.profiles add constraint profiles_student_status_check
  check(student_status in ('active','graduated','transferred','not_graduated'));

create function public.admin_set_student_status(p_students jsonb,p_status text,p_year integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.profiles; wanted integer; matched integer := 0; changed integer := 0; graduated integer := 0; outstanding integer; actual_status text; not_graduated jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'STUDENT_LIFECYCLE_FORBIDDEN'; end if;
  if p_status is null or p_status not in ('active','graduated','transferred','not_graduated') or jsonb_typeof(p_students) is distinct from 'array' then
    raise exception 'STUDENT_LIFECYCLE_INVALID';
  end if;
  wanted := jsonb_array_length(p_students);
  if wanted not between 1 and 2000 or (p_status='active' and p_year is not null)
    or (p_status<>'active' and (p_year is null or p_year not between 2500 and 2800))
    or exists(select 1 from jsonb_array_elements(p_students) s where jsonb_typeof(s) is distinct from 'object'
      or coalesce(s->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or coalesce(s->>'revision','') !~ '^[0-9]{1,10}$') then raise exception 'STUDENT_LIFECYCLE_INVALID'; end if;
  if (select count(distinct (s->>'id')::uuid) from jsonb_array_elements(p_students) s)<>wanted then raise exception 'STUDENT_LIFECYCLE_INVALID'; end if;
  -- Match the lock order used by imports, account edits and closing the grading period.
  perform 1 from public.site_schedule where id=1 for share;
  lock table public.grade_records in share row exclusive mode;
  -- Deterministic locks and revisions prevent stale selections overwriting imports/edits.
  for target in select p.* from public.profiles p join jsonb_array_elements(p_students) s on p.id=(s->>'id')::uuid
    order by p.id for update of p
  loop
    if target.role<>'student' or not exists(select 1 from jsonb_array_elements(p_students) s
      where (s->>'id')::uuid=target.id and (s->>'revision')::bigint=target.account_revision) then
      raise exception 'STUDENT_LIFECYCLE_CHANGED';
    end if;
    matched := matched+1;
    actual_status := p_status;
    if p_status='graduated' then
      select count(*) into outstanding from public.grade_records where student_id=target.id and status<>'completed';
      if outstanding>0 then
        actual_status := 'not_graduated';
        not_graduated := not_graduated || jsonb_build_array(jsonb_build_object(
          'id',target.id,'student_code',target.student_code,'full_name',target.full_name,'outstanding_count',outstanding));
      end if;
    end if;
    if target.student_status is distinct from actual_status or target.student_status_year is distinct from p_year then
      update public.profiles set student_status=actual_status,student_status_year=p_year,student_status_changed_at=now() where id=target.id;
      insert into public.audit_log(actor_id,action) values(auth.uid(),'student_status_changed:' || jsonb_build_object(
        'id',target.id,'student_code',target.student_code,'classroom',target.classroom,
        'from',target.student_status,'from_year',target.student_status_year,'to',actual_status,'requested',p_status,'year',p_year)::text);
      changed := changed+1;
      if actual_status='graduated' then graduated := graduated+1; end if;
    end if;
  end loop;
  if matched<>wanted then raise exception 'STUDENT_LIFECYCLE_CHANGED'; end if;
  return jsonb_build_object('updated',changed,'graduated',graduated,'notGraduated',not_graduated);
end;
$$;
revoke all on function public.admin_set_student_status(jsonb,text,integer) from public,anon;
grant execute on function public.admin_set_student_status(jsonb,text,integer) to authenticated;

create or replace function public.admin_student_lifecycle_list(
  p_search text default '', p_status text default 'active', p_level integer default null,
  p_classroom text default null, p_page integer default 1, p_page_size integer default 50
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'STUDENT_LIFECYCLE_FORBIDDEN'; end if;
  if p_status is null or p_status not in ('all','active','graduated','transferred','not_graduated') or p_search is null or length(p_search)>150
    or (p_level is not null and p_level not between 1 and 6) or length(p_classroom)>40
    or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (50,2000) then
    raise exception 'STUDENT_LIFECYCLE_INVALID';
  end if;
  with students as (
    select id,student_code,full_name,classroom,roll_number,account_revision,student_status,student_status_year,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level
    from public.profiles where role='student'
  ), filtered as (
    select * from students where (p_status='all' or student_status=p_status)
      and (p_level is null or level=p_level) and (p_classroom is null or classroom=p_classroom)
      and (strpos(lower(full_name),lower(trim(p_search)))>0 or strpos(student_code,trim(p_search))>0)
  ), paged as (
    select id,student_code,full_name,classroom,roll_number,account_revision,student_status,student_status_year
    from filtered order by classroom,roll_number nulls last,student_code,id limit p_page_size offset (p_page-1)*p_page_size
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(p) order by classroom,roll_number nulls last,student_code,id) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'classrooms',coalesce((select jsonb_agg(classroom order by classroom) from (select distinct classroom from students where classroom is not null and (p_level is null or level=p_level)) c),'[]'::jsonb),
    'counts',jsonb_build_object('not_graduated',(select count(*) from students where student_status='not_graduated'),'active',(select count(*) from students where student_status='active'),
      'graduated',(select count(*) from students where student_status='graduated'),'transferred',(select count(*) from students where student_status='transferred'))
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_student_lifecycle_list(text,text,integer,text,integer,integer) from public,anon;
grant execute on function public.admin_student_lifecycle_list(text,text,integer,text,integer,integer) to authenticated;

create or replace function public.admin_student_list(p_search text default '', p_level integer default null, p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อนักเรียนได้'; end if;
  if p_search is null or length(p_search)>150 or p_page is null or p_page not between 1 and 100000
    or (p_level is not null and p_level not between 1 and 6) then raise exception 'ตัวกรองไม่ถูกต้อง'; end if;
  with students as (
    select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level
    from public.profiles where role='student' and student_status in ('active','not_graduated')
  ), filtered as (
    select * from students where (p_level is null or level=p_level)
      and (strpos(lower(full_name),lower(trim(p_search)))>0 or strpos(student_code,trim(p_search))>0)
  ), page as (
    select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision from filtered
    order by level nulls last,classroom,roll_number nulls last,student_code,id limit 50 offset (p_page-1)*50
  ) select jsonb_build_object('total',(select count(*) from filtered),
    'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),
    'levels',coalesce((select jsonb_agg(level order by level) from (select distinct level from students where level is not null) x),'[]'::jsonb)) into result;
  return result;
end;
$$;

create or replace function public.admin_student_import_summary(p_codes text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare existing integer; archived integer;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'STUDENT_LIFECYCLE_FORBIDDEN'; end if;
  if p_codes is null or cardinality(p_codes) not between 1 and 2000
    or exists(select 1 from unnest(p_codes) c where c is null or c !~ '^\d{5,10}$')
    or (select count(distinct c) from unnest(p_codes) c)<>cardinality(p_codes) then raise exception 'STUDENT_LIFECYCLE_INVALID'; end if;
  select count(*),count(*) filter(where student_status in ('graduated','transferred')) into existing,archived
    from public.profiles where role='student' and student_code=any(p_codes);
  return jsonb_build_object('created',cardinality(p_codes)-existing,'updated',existing,'archived',archived);
end;
$$;
revoke all on function public.admin_student_import_summary(text[]) from public,anon;
grant execute on function public.admin_student_import_summary(text[]) to authenticated;

notify pgrst,'reload schema';
commit;

-- ============================================================
-- 039_current_students_active_only.sql
-- ============================================================
begin;

-- The current roster includes only active enrollment. All other statuses remain
-- searchable in the lifecycle page and keep their Auth and grade history.
create or replace function public.admin_student_list(p_search text default '', p_level integer default null, p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อนักเรียนได้'; end if;
  if p_search is null or length(p_search)>150 or p_page is null or p_page not between 1 and 100000
    or (p_level is not null and p_level not between 1 and 6) then raise exception 'ตัวกรองไม่ถูกต้อง'; end if;
  with students as (
    select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level
    from public.profiles where role='student' and student_status='active'
  ), filtered as (
    select * from students where (p_level is null or level=p_level)
      and (strpos(lower(full_name),lower(trim(p_search)))>0 or strpos(student_code,trim(p_search))>0)
  ), page as (
    select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision from filtered
    order by level nulls last,classroom,roll_number nulls last,student_code,id limit 50 offset (p_page-1)*50
  ) select jsonb_build_object('total',(select count(*) from filtered),
    'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),
    'levels',coalesce((select jsonb_agg(level order by level) from (select distinct level from students where level is not null) x),'[]'::jsonb)) into result;
  return result;
end;
$$;

create or replace function public.admin_student_import_summary(p_codes text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare existing integer; archived integer;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'STUDENT_LIFECYCLE_FORBIDDEN'; end if;
  if p_codes is null or cardinality(p_codes) not between 1 and 2000
    or exists(select 1 from unnest(p_codes) c where c is null or c !~ '^\d{5,10}$')
    or (select count(distinct c) from unnest(p_codes) c)<>cardinality(p_codes) then raise exception 'STUDENT_LIFECYCLE_INVALID'; end if;
  select count(*),count(*) filter(where student_status<>'active') into existing,archived
    from public.profiles where role='student' and student_code=any(p_codes);
  return jsonb_build_object('created',cardinality(p_codes)-existing,'updated',existing,'archived',archived);
end;
$$;
revoke all on function public.admin_student_import_summary(text[]) from public,anon;
grant execute on function public.admin_student_import_summary(text[]) to authenticated;

notify pgrst,'reload schema';
commit;

-- ============================================================
-- 040_student_numeric_room_order.sql
-- ============================================================
begin;

-- Sort room numbers numerically before pagination in both Admin rosters.
create or replace function public.admin_student_list(p_search text default '', p_level integer default null, p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อนักเรียนได้'; end if;
  if p_search is null or length(p_search)>150 or p_page is null or p_page not between 1 and 100000
    or (p_level is not null and p_level not between 1 and 6) then raise exception 'ตัวกรองไม่ถูกต้อง'; end if;
  with students as (
    select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?[1-6]/([0-9]+)$'))[1])::numeric as room
    from public.profiles where role='student' and student_status='active'
  ), filtered as (
    select * from students where (p_level is null or level=p_level)
      and (strpos(lower(full_name),lower(trim(p_search)))>0 or strpos(student_code,trim(p_search))>0)
  ), page as (
    select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision,level,room from filtered
    order by level nulls last,room nulls last,case when room is null then classroom end nulls last,roll_number nulls last,student_code,id limit 50 offset (p_page-1)*50
  ) select jsonb_build_object('total',(select count(*) from filtered),
    'items',coalesce((select jsonb_agg(to_jsonb(page)-'level'-'room' order by level nulls last,room nulls last,case when room is null then classroom end nulls last,roll_number nulls last,student_code,id) from page),'[]'::jsonb),
    'levels',coalesce((select jsonb_agg(level order by level) from (select distinct level from students where level is not null) x),'[]'::jsonb)) into result;
  return result;
end;
$$;

create or replace function public.admin_student_lifecycle_list(
  p_search text default '', p_status text default 'active', p_level integer default null,
  p_classroom text default null, p_page integer default 1, p_page_size integer default 50
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'STUDENT_LIFECYCLE_FORBIDDEN'; end if;
  if p_status is null or p_status not in ('all','active','graduated','transferred','not_graduated') or p_search is null or length(p_search)>150
    or (p_level is not null and p_level not between 1 and 6) or length(p_classroom)>40
    or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (50,2000) then
    raise exception 'STUDENT_LIFECYCLE_INVALID';
  end if;
  with students as (
    select id,student_code,full_name,classroom,roll_number,account_revision,student_status,student_status_year,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level,
      ((regexp_match(classroom,'^(?:ม[.]\s*)?[1-6]/([0-9]+)$'))[1])::numeric as room
    from public.profiles where role='student'
  ), filtered as (
    select * from students where (p_status='all' or student_status=p_status)
      and (p_level is null or level=p_level) and (p_classroom is null or classroom=p_classroom)
      and (strpos(lower(full_name),lower(trim(p_search)))>0 or strpos(student_code,trim(p_search))>0)
  ), paged as (
    select id,student_code,full_name,classroom,roll_number,account_revision,student_status,student_status_year,level,room
    from filtered order by level nulls last,room nulls last,case when room is null then classroom end nulls last,roll_number nulls last,student_code,id limit p_page_size offset (p_page-1)*p_page_size
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(p)-'level'-'room' order by level nulls last,room nulls last,case when room is null then classroom end nulls last,roll_number nulls last,student_code,id) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'classrooms',coalesce((select jsonb_agg(classroom order by level nulls last,room nulls last,classroom) from (select distinct classroom,level,room from students where classroom is not null and (p_level is null or level=p_level)) c),'[]'::jsonb),
    'counts',jsonb_build_object('not_graduated',(select count(*) from students where student_status='not_graduated'),'active',(select count(*) from students where student_status='active'),
      'graduated',(select count(*) from students where student_status='graduated'),'transferred',(select count(*) from students where student_status='transferred'))
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_student_lifecycle_list(text,text,integer,text,integer,integer) from public,anon;
grant execute on function public.admin_student_lifecycle_list(text,text,integer,text,integer,integer) to authenticated;

notify pgrst,'reload schema';
commit;

-- ============================================================
-- 041_student_classroom_filter.sql
-- ============================================================
begin;

  -- Replace the old signature to avoid ambiguous PostgREST overloads.
  -- The fourth argument defaults to null, preserving callers with three arguments.
  drop function public.admin_student_list(text,integer,integer);

  create or replace function public.admin_student_list(p_search text default '', p_level integer default null, p_page integer default 1, p_classroom text default null)
  returns jsonb language plpgsql stable security definer set search_path = '' as $$
  declare result jsonb;
  begin
    if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อนักเรียนได้'; end if;
    if p_search is null or length(p_search)>150 or p_page is null or p_page not between 1 and 100000
      or (p_level is not null and p_level not between 1 and 6)
      or (p_classroom is not null and length(trim(p_classroom)) not between 1 and 40) then raise exception 'ตัวกรองไม่ถูกต้อง'; end if;
    with students as (
      select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision,
        ((regexp_match(classroom,'^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level,
        ((regexp_match(classroom,'^(?:ม[.]\s*)?[1-6]/([0-9]+)$'))[1])::numeric as room
      from public.profiles where role='student' and student_status='active'
    ), filtered as (
      select * from students where (p_level is null or level=p_level) and (p_classroom is null or classroom=p_classroom)
        and (strpos(lower(full_name),lower(trim(p_search)))>0 or strpos(student_code,trim(p_search))>0)
    ), page as (
      select id,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,account_revision,level,room from filtered
      order by level nulls last,room nulls last,case when room is null then classroom end nulls last,roll_number nulls last,student_code,id limit 50 offset (p_page-1)*50
    ) select jsonb_build_object('total',(select count(*) from filtered),
      'items',coalesce((select jsonb_agg(to_jsonb(page)-'level'-'room' order by level nulls last,room nulls last,case when room is null then classroom end nulls last,roll_number nulls last,student_code,id) from page),'[]'::jsonb),
      'classrooms',coalesce((select jsonb_agg(classroom order by level nulls last,room nulls last,classroom) from (select distinct classroom,level,room from students where classroom is not null and (p_level is null or level=p_level)) c),'[]'::jsonb),
      'levels',coalesce((select jsonb_agg(level order by level) from (select distinct level from students where level is not null) x),'[]'::jsonb)) into result;
    return result;
  end;
  $$;

  revoke all on function public.admin_student_list(text,integer,integer,text) from public,anon;
  grant execute on function public.admin_student_list(text,integer,integer,text) to authenticated;
  notify pgrst,'reload schema';
  commit;

-- ============================================================
-- 042_teacher_registry.sql
-- ============================================================
begin;

-- A profile is a permanent school identity, not the lifetime of an Auth user.
alter table public.profiles drop constraint profiles_id_fkey;
alter table public.profiles
  add column learning_subject_group text check (length(learning_subject_group) <= 200),
  add column staff_citizen_hash text check (staff_citizen_hash ~ '^[a-f0-9]{64}$'),
  add column auth_generation integer not null default 0;
create unique index profiles_staff_citizen_hash on public.profiles(staff_citizen_hash)
  where staff_citizen_hash is not null;

-- No expiry/automatic takeover: a delayed Auth request must never outlive its
-- reservation and create an account after a reset. Uncertain attempts are
-- reconciled by their Auth app_metadata token before a reservation is released.
create table public.teacher_registration_claims (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  token uuid not null unique,
  created_at timestamptz not null default now()
);
alter table public.teacher_registration_claims enable row level security;
revoke all on public.teacher_registration_claims from public,anon,authenticated,service_role;

create function public.live_profile_session() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare generation integer; session_claim text := auth.jwt()->>'session_id';
begin
  select p.auth_generation into generation from public.profiles p
    join auth.users u on u.id=p.id where p.id=auth.uid();
  if not found then return false; end if;
  if session_claim is null or session_claim='' then return generation=0; end if;
  if session_claim !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  return exists(select 1 from auth.sessions where id=session_claim::uuid and user_id=auth.uid());
end;
$$;
revoke all on function public.live_profile_session() from public,anon;
grant execute on function public.live_profile_session() to authenticated;

-- Also protect policies that use auth.uid() without my_role(), including own_profile.
do $$ declare t record; begin
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relrowsecurity and c.relkind='r' and (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
  loop
    execute format('create policy live_account_session on %I.%I as restrictive for all to authenticated using ((select public.live_profile_session())) with check ((select public.live_profile_session()))',t.nspname,t.relname);
  end loop;
end $$;

create or replace function public.my_role() returns public.app_role
language plpgsql stable security definer set search_path='' as $$
declare session_claim text := auth.jwt()->>'session_id'; selected_role public.app_role;
begin
  if not public.live_profile_session() then return null; end if;
  if session_claim is null or session_claim='' then
    select role into selected_role from public.profiles where id=auth.uid(); return selected_role;
  end if;
  if session_claim !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return null; end if;
  select r.role into selected_role from public.login_role_sessions r join auth.sessions s on s.id=r.session_id
    where r.session_id=session_claim::uuid and r.user_id=auth.uid() and s.user_id=auth.uid()
      and public.profile_has_role(r.user_id,r.role);
  return selected_role;
end;
$$;

create function public.registry_normalize_name(p_name text) returns text
language sql immutable set search_path='' as $$ select trim(regexp_replace(p_name,'[[:space:]]+',' ','g')) $$;
revoke all on function public.registry_normalize_name(text) from public,anon,authenticated;

create function public.teacher_registry_target(p_hash text,p_emails text[]) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare ids uuid[];
begin
  select array_agg(distinct p.id) into ids from public.profiles p
    left join auth.users u on u.id=p.id
    where p.staff_citizen_hash=p_hash or u.email=any(p_emails);
  if coalesce(array_length(ids,1),0)>1 then raise exception 'REGISTRY_AMBIGUOUS'; end if;
  if ids[1] is not null and not (public.profile_has_role(ids[1],'teacher') or public.profile_has_role(ids[1],'academic') or public.profile_has_role(ids[1],'admin')) then
    raise exception 'REGISTRY_AMBIGUOUS';
  end if;
  return ids[1];
end;
$$;
revoke all on function public.teacher_registry_target(text,text[]) from public,anon,authenticated,service_role;

create function public.preview_teacher_registry(p_actor uuid,p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item jsonb; target uuid; result jsonb := '[]';
begin
  if not public.profile_has_role(p_actor,'admin') or not exists(select 1 from auth.users where id=p_actor) then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 then raise exception 'ACCOUNT_INVALID'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    target := public.teacher_registry_target(item->>'hash',array(select jsonb_array_elements_text(item->'emails')));
    result := result || jsonb_build_array(jsonb_build_object('id',target,'expected_revision',
      (select account_revision from public.profiles where id=target)));
  end loop;
  return result;
end;
$$;
revoke all on function public.preview_teacher_registry(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.preview_teacher_registry(uuid,jsonb) to service_role;

create function public.save_teacher_registry(p_actor uuid,p_row jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid; teacher public.profiles; display_name text; existed boolean; group_name text;
begin
  if not public.profile_has_role(p_actor,'admin') or not exists(select 1 from auth.users where id=p_actor) then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if jsonb_typeof(p_row) is distinct from 'object' or coalesce(p_row->>'hash','') !~ '^[a-f0-9]{64}$'
    or coalesce(p_row->>'citizen_id_encrypted','') !~ '^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]{26}$'
    or coalesce(length(trim(p_row->>'name_prefix')),0) not between 1 and 40
    or coalesce(length(trim(p_row->>'first_name')),0) not between 1 and 80
    or coalesce(length(trim(p_row->>'last_name')),0) not between 1 and 80
    or coalesce(length(trim(p_row->>'learning_subject_group')),0) not between 1 and 200
    or p_row->>'id' is null then raise exception 'ACCOUNT_INVALID'; end if;
  -- Shared order with edits/reset: schedule -> grades -> identity -> profile.
  perform 1 from public.site_schedule where id=1 for share;
  lock table public.grade_records in share row exclusive mode;
  perform pg_advisory_xact_lock(hashtextextended(p_row->>'hash',0));
  target := public.teacher_registry_target(p_row->>'hash',array(select jsonb_array_elements_text(p_row->'emails')));
  existed := target is not null;
  if existed then
    select * into teacher from public.profiles where id=target for update;
    if public.profile_has_role(target,'admin') then raise exception 'ACCOUNT_PROTECTED'; end if;
    if target is distinct from (p_row->>'id')::uuid or p_row->>'expected_revision' is null
      or teacher.account_revision is distinct from (p_row->>'expected_revision')::integer then raise exception 'ACCOUNT_CHANGED'; end if;
    if exists(select 1 from public.teacher_registration_claims where profile_id=target) then raise exception 'REGISTRY_BUSY'; end if;
    if teacher.staff_citizen_hash is not null and teacher.staff_citizen_hash<>p_row->>'hash' then raise exception 'REGISTRY_AMBIGUOUS'; end if;
  else
    if p_row->>'expected_revision' is not null then raise exception 'ACCOUNT_CHANGED'; end if;
    target := (p_row->>'id')::uuid;
  end if;
  display_name := trim(p_row->>'name_prefix') || trim(p_row->>'first_name') || ' ' || trim(p_row->>'last_name');
  if length(display_name)>150 then raise exception 'ACCOUNT_INVALID'; end if;
  group_name := trim(p_row->>'learning_subject_group');
  if existed then
    update public.profiles set full_name=display_name,name_prefix=trim(p_row->>'name_prefix'),
      first_name=trim(p_row->>'first_name'),last_name=trim(p_row->>'last_name'),learning_subject_group=group_name,
      staff_citizen_hash=p_row->>'hash',citizen_id_encrypted=p_row->>'citizen_id_encrypted' where id=target;
    if not public.profile_has_role(target,'teacher') then
      insert into public.profile_roles(profile_id,role) values(target,'teacher');
    end if;
    update public.grade_records g set teacher_name=(select array_agg(
      case when t.id=target then display_name else g.teacher_name[t.ord::integer] end order by t.ord)
      from unnest(g.teacher_id) with ordinality t(id,ord)) where g.teacher_id @> array[target];
  else
    insert into public.profiles(id,role,full_name,name_prefix,first_name,last_name,learning_subject_group,staff_citizen_hash,citizen_id_encrypted)
      values(target,'teacher',display_name,trim(p_row->>'name_prefix'),trim(p_row->>'first_name'),trim(p_row->>'last_name'),group_name,p_row->>'hash',p_row->>'citizen_id_encrypted');
  end if;
  insert into public.audit_log(actor_id,action) values(p_actor,'teacher_registry_saved:' || target::text);
  return jsonb_build_object('id',target,'status',case when existed then 'updated' else 'created' end);
end;
$$;
revoke all on function public.save_teacher_registry(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_teacher_registry(uuid,jsonb) to service_role;

create function public.claim_teacher_registration(p_hash text,p_first text,p_last text,p_token uuid,p_emails text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare teacher public.profiles; existing public.teacher_registration_claims;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_token is null then raise exception 'ACCOUNT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_hash,0));
  select * into teacher from public.profiles where staff_citizen_hash=p_hash for update;
  if not found or not public.profile_has_role(teacher.id,'teacher') or public.profile_has_role(teacher.id,'admin') then raise exception 'REGISTRATION_DENIED'; end if;
  if public.registry_normalize_name(teacher.first_name) is distinct from public.registry_normalize_name(p_first)
    or public.registry_normalize_name(teacher.last_name) is distinct from public.registry_normalize_name(p_last) then raise exception 'REGISTRATION_DENIED'; end if;
  select * into existing from public.teacher_registration_claims where profile_id=teacher.id;
  if found then return jsonb_build_object('id',teacher.id,'token',existing.token,'pending',true); end if;
  if exists(select 1 from auth.users where id=teacher.id or email=any(p_emails)) then raise exception 'REGISTRATION_EXISTS'; end if;
  insert into public.teacher_registration_claims(profile_id,token) values(teacher.id,p_token);
  return jsonb_build_object('id',teacher.id,'token',p_token,'pending',false);
end;
$$;
revoke all on function public.claim_teacher_registration(text,text,text,uuid,text[]) from public,anon,authenticated;
grant execute on function public.claim_teacher_registration(text,text,text,uuid,text[]) to service_role;

create function public.finish_teacher_registration(p_id uuid,p_token uuid,p_success boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.profiles where id=p_id for update;
  if not exists(select 1 from public.teacher_registration_claims where profile_id=p_id and token=p_token) then raise exception 'REGISTRY_BUSY'; end if;
  if p_success is distinct from exists(select 1 from auth.users where id=p_id) then raise exception 'REGISTRY_BUSY'; end if;
  delete from public.teacher_registration_claims where profile_id=p_id and token=p_token;
  if p_success then
    update public.profiles set auth_generation=auth_generation+1 where id=p_id;
    insert into public.audit_log(actor_id,action) values(p_id,'teacher_registered');
  end if;
end;
$$;
revoke all on function public.finish_teacher_registration(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.finish_teacher_registration(uuid,uuid,boolean) to service_role;
-- Remove the old unrestricted registration entrypoint from service clients.
revoke execute on function public.register_teacher_profile(uuid,jsonb) from service_role;

alter function public.admin_account_list(public.app_role,text,integer) rename to admin_account_list_before_registry;
revoke all on function public.admin_account_list_before_registry(public.app_role,text,integer) from public,anon,authenticated,service_role;
create function public.admin_account_list(p_role public.app_role,p_search text default '',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  result := public.admin_account_list_before_registry(p_role,p_search,p_page);
  if p_role<>'teacher' then return result; end if;
  return jsonb_set(result,'{items}',coalesce((select jsonb_agg(item || jsonb_build_object(
    'learning_subject_group',p.learning_subject_group,'has_auth',exists(select 1 from auth.users where id=p.id)) order by ord)
    from jsonb_array_elements(result->'items') with ordinality e(item,ord)
    join public.profiles p on p.id=(item->>'id')::uuid),'[]'::jsonb));
end;
$$;
revoke all on function public.admin_account_list(public.app_role,text,integer) from public,anon;
grant execute on function public.admin_account_list(public.app_role,text,integer) to authenticated;

alter function public.admin_edit_account(uuid,public.app_role,integer,jsonb) rename to admin_edit_account_before_registry;
revoke all on function public.admin_edit_account_before_registry(uuid,public.app_role,integer,jsonb) from public,anon,authenticated,service_role;
create function public.admin_edit_account(p_id uuid,p_role public.app_role,p_expected_revision integer,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; teacher public.profiles;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_role='teacher' then
    if p_changes ? 'learning_subject_group' and coalesce(length(trim(p_changes->>'learning_subject_group')),0) not between 1 and 200 then raise exception 'ACCOUNT_INVALID'; end if;
    perform 1 from public.site_schedule where id=1 for share;
    lock table public.grade_records in share row exclusive mode;
    select * into teacher from public.profiles where id=p_id for update;
    if exists(select 1 from public.teacher_registration_claims where profile_id=p_id) then raise exception 'REGISTRY_BUSY'; end if;
  elsif p_changes ? 'learning_subject_group' then raise exception 'ACCOUNT_INVALID'; end if;
  result := public.admin_edit_account_before_registry(p_id,p_role,p_expected_revision,p_changes-'learning_subject_group');
  if p_role='teacher' then
    if p_changes ? 'learning_subject_group' then
      update public.profiles set learning_subject_group=trim(p_changes->>'learning_subject_group') where id=p_id;
    end if;
    select * into teacher from public.profiles where id=p_id;
    result := result || jsonb_build_object('learning_subject_group',teacher.learning_subject_group,'account_revision',teacher.account_revision,
      'has_auth',exists(select 1 from auth.users where id=p_id));
  end if;
  return result;
end;
$$;
revoke all on function public.admin_edit_account(uuid,public.app_role,integer,jsonb) from public,anon;
grant execute on function public.admin_edit_account(uuid,public.app_role,integer,jsonb) to authenticated;

create function public.reset_teacher_registry(p_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare teacher public.profiles; actor uuid:=auth.uid();
begin
  if actor is null or public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'ACCOUNT_INVALID'; end if;
  if actor=p_id then raise exception 'ACCOUNT_PROTECTED'; end if;
  perform 1 from public.site_schedule where id=1 for share;
  lock table storage.objects in share row exclusive mode;
  select * into teacher from public.profiles where id=p_id for update;
  if not found or not public.profile_has_role(p_id,'teacher') then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if public.profile_has_role(p_id,'admin') then raise exception 'ACCOUNT_PROTECTED'; end if;
  if teacher.account_revision<>p_expected_revision then raise exception 'ACCOUNT_CHANGED'; end if;
  if exists(select 1 from public.teacher_registration_claims where profile_id=p_id) then raise exception 'REGISTRY_BUSY'; end if;
  if exists(select 1 from storage.objects o where to_jsonb(o)->>'owner_id'=p_id::text or to_jsonb(o)->>'owner'=p_id::text) then raise exception 'REGISTRY_STORAGE'; end if;
  if teacher.staff_citizen_hash is null then raise exception 'REGISTRY_IDENTITY_MISSING'; end if;
  if not exists(select 1 from auth.users where id=p_id) then return jsonb_build_object('deleted',true,'retained',true); end if;
  delete from auth.sessions where user_id=p_id;
  delete from public.push_subscriptions where user_id=p_id;
  delete from auth.users where id=p_id;
  update public.profiles set auth_generation=auth_generation+1 where id=p_id;
  insert into public.audit_log(actor_id,action) values(actor,'teacher_account_reset:' || p_id::text);
  return jsonb_build_object('deleted',true,'retained',true);
end;
$$;
revoke all on function public.reset_teacher_registry(uuid,integer) from public,anon,authenticated,service_role;

alter function public.admin_delete_account(uuid,public.app_role,integer) rename to admin_delete_account_before_registry;
revoke all on function public.admin_delete_account_before_registry(uuid,public.app_role,integer) from public,anon,authenticated,service_role;
create function public.admin_delete_account(p_id uuid,p_role public.app_role,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_role='teacher' then return public.reset_teacher_registry(p_id,p_expected_revision); end if;
  -- Do not erase a permanent teacher identity from another role's page either.
  if p_role in ('academic','manager') and public.profile_has_role(p_id,p_role) and public.profile_has_role(p_id,'teacher') then
    return public.reset_teacher_registry(p_id,p_expected_revision);
  end if;
  return public.admin_delete_account_before_registry(p_id,p_role,p_expected_revision);
end;
$$;
revoke all on function public.admin_delete_account(uuid,public.app_role,integer) from public,anon;
grant execute on function public.admin_delete_account(uuid,public.app_role,integer) to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.live_profile_session() then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  delete from public.push_subscriptions where user_id=auth.uid() and endpoint=p_endpoint;
end;
$$;

create or replace function public.admin_reset_teacher(p_id uuid,p_expected_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare teacher public.profiles;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'TEACHER_RESET_FORBIDDEN'; end if;
  if p_id=auth.uid() then raise exception 'TEACHER_RESET_SELF'; end if;
  perform 1 from public.site_schedule where id=1 for share;
  lock table storage.objects in share row exclusive mode;
  select * into teacher from public.profiles where id=p_id for update;
  if not found then raise exception 'TEACHER_RESET_NOT_FOUND'; end if;
  if not public.profile_has_role(p_id,'teacher') then raise exception 'TEACHER_RESET_NOT_TEACHER'; end if;
  if teacher.full_name is distinct from p_expected_name then raise exception 'TEACHER_RESET_CHANGED'; end if;
  return public.reset_teacher_registry(p_id,teacher.account_revision);
end;
$$;

-- The legacy academic endpoint must preserve shared teacher identities too.
alter function public.admin_reset_staff(uuid,text,public.app_role) rename to admin_reset_staff_before_registry;
revoke all on function public.admin_reset_staff_before_registry(uuid,text,public.app_role) from public,anon,authenticated,service_role;
create function public.admin_reset_staff(p_id uuid,p_expected_name text,p_role public.app_role) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if public.my_role() is distinct from 'admin' then raise exception 'TEACHER_RESET_FORBIDDEN'; end if;
  if p_id=auth.uid() then raise exception 'TEACHER_RESET_SELF'; end if;
  if p_role is null or p_role not in ('teacher','academic') then raise exception 'TEACHER_RESET_INVALID'; end if;
  if public.profile_has_role(p_id,p_role) and public.profile_has_role(p_id,'teacher') then
    return public.admin_reset_teacher(p_id,p_expected_name);
  end if;
  return public.admin_reset_staff_before_registry(p_id,p_expected_name,p_role);
end;
$$;
revoke all on function public.admin_reset_staff(uuid,text,public.app_role) from public,anon,authenticated,service_role;
-- Replace this SQL body explicitly so it resolves the new wrapper OID.
create or replace function public.admin_reset_academic(p_id uuid,p_expected_name text) returns jsonb
language sql security definer set search_path='' as $$
  select public.admin_reset_staff(p_id,p_expected_name,'academic');
$$;

-- Used by the explicit server-side backfill; never exposed to browser sessions.
create function public.backfill_staff_identity(p_id uuid,p_hash text,p_identity jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'ACCOUNT_INVALID'; end if;
  perform 1 from public.profiles where id=p_id and role<>'student' for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if exists(select 1 from public.profiles where id=p_id and staff_citizen_hash is not null and staff_citizen_hash<>p_hash) then raise exception 'REGISTRY_AMBIGUOUS'; end if;
  update public.profiles set staff_citizen_hash=p_hash,
    name_prefix=coalesce(nullif(name_prefix,''),nullif(p_identity->>'name_prefix','')),
    first_name=coalesce(nullif(first_name,''),nullif(p_identity->>'first_name','')),
    last_name=coalesce(nullif(last_name,''),nullif(p_identity->>'last_name','')),
    citizen_id_encrypted=coalesce(citizen_id_encrypted,p_identity->>'citizen_id_encrypted')
    where id=p_id;
end;
$$;
revoke all on function public.backfill_staff_identity(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.backfill_staff_identity(uuid,text,jsonb) to service_role;

notify pgrst,'reload schema';
commit;

-- ============================================================
-- 043_teacher_reset_identity.sql
-- ============================================================
begin;

-- Server-only recovery of encrypted identities already present in the registry.
-- Compare-and-set prevents a stale reset form from changing a newer profile.
create function public.prepare_teacher_reset_identity(
  p_actor uuid, p_id uuid, p_expected_revision integer,
  p_ciphertext text, p_hash text, p_names jsonb
) returns integer
language plpgsql security definer set search_path='' as $$
declare target public.profiles; revision integer;
begin
  if p_actor is null or not public.profile_has_role(p_actor,'admin')
    or not exists(select 1 from auth.users where id=p_actor) then
    raise exception 'ACCOUNT_FORBIDDEN';
  end if;
  if p_actor=p_id then raise exception 'ACCOUNT_PROTECTED'; end if;
  select * into target from public.profiles where id=p_id for update;
  if not found or not public.profile_has_role(p_id,'teacher') then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if public.profile_has_role(p_id,'admin') then raise exception 'ACCOUNT_PROTECTED'; end if;
  if p_expected_revision is null or target.account_revision<>p_expected_revision then raise exception 'ACCOUNT_CHANGED'; end if;
  if exists(select 1 from public.teacher_registration_claims where profile_id=p_id) then raise exception 'REGISTRY_BUSY'; end if;
  if target.citizen_id_encrypted is null or p_ciphertext is distinct from target.citizen_id_encrypted then raise exception 'REGISTRY_IDENTITY_MISSING'; end if;
  if target.staff_citizen_hash is not null then raise exception 'ACCOUNT_CHANGED'; end if;
  if nullif(btrim(p_names->>'first_name'),'') is null or nullif(btrim(p_names->>'last_name'),'') is null then raise exception 'ACCOUNT_INVALID'; end if;
  perform public.backfill_staff_identity(p_id,p_hash,p_names);
  select account_revision into revision from public.profiles where id=p_id;
  return revision;
end;
$$;
revoke all on function public.prepare_teacher_reset_identity(uuid,uuid,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_teacher_reset_identity(uuid,uuid,integer,text,text,jsonb) to service_role;

create or replace function public.reset_teacher_registry(p_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare teacher public.profiles; actor uuid:=auth.uid();
begin
  if actor is null or public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'ACCOUNT_INVALID'; end if;
  if actor=p_id then raise exception 'ACCOUNT_PROTECTED'; end if;
  perform 1 from public.site_schedule where id=1 for share;
  lock table storage.objects in share row exclusive mode;
  select * into teacher from public.profiles where id=p_id for update;
  if not found or not public.profile_has_role(p_id,'teacher') then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if public.profile_has_role(p_id,'admin') then raise exception 'ACCOUNT_PROTECTED'; end if;
  if teacher.account_revision<>p_expected_revision then raise exception 'ACCOUNT_CHANGED'; end if;
  if exists(select 1 from public.teacher_registration_claims where profile_id=p_id) then raise exception 'REGISTRY_BUSY'; end if;
  if exists(select 1 from storage.objects o where to_jsonb(o)->>'owner_id'=p_id::text or to_jsonb(o)->>'owner'=p_id::text) then raise exception 'REGISTRY_STORAGE'; end if;
  if teacher.staff_citizen_hash is null then raise exception 'REGISTRY_IDENTITY_MISSING'; end if;
  if not exists(select 1 from auth.users where id=p_id) then return jsonb_build_object('deleted',true,'retained',true,'account_revision',(select account_revision from public.profiles where id=p_id)); end if;
  delete from auth.sessions where user_id=p_id;
  delete from public.push_subscriptions where user_id=p_id;
  delete from auth.users where id=p_id;
  update public.profiles set auth_generation=auth_generation+1 where id=p_id;
  insert into public.audit_log(actor_id,action) values(actor,'teacher_account_reset:' || p_id::text);
  return jsonb_build_object('deleted',true,'retained',true,'account_revision',(select account_revision from public.profiles where id=p_id));
end;
$$;
notify pgrst,'reload schema';
commit;

-- ============================================================
-- 044_teacher_subject_filter.sql
-- ============================================================
begin;

-- Filter the full teacher registry before counting and paginating.
create function public.admin_teacher_registry_list(
  p_search text default '', p_page integer default 1, p_subject_group text default ''
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_search is null or length(p_search)>150 or p_page is null or p_page not between 1 and 100000
    or p_subject_group is null or length(p_subject_group)>200 then raise exception 'ACCOUNT_INVALID'; end if;
  with filtered as (
    select p.id,p.full_name,p.name_prefix,p.first_name,p.last_name,p.username,p.account_revision,
      p.learning_subject_group,exists(select 1 from auth.users u where u.id=p.id) as has_auth
    from public.profiles p
    where public.profile_has_role(p.id,'teacher')
      and (position(lower(btrim(p_search)) in lower(p.full_name))>0
        or position(lower(btrim(p_search)) in coalesce(p.username,''))>0)
      and (btrim(p_subject_group)='' or btrim(p.learning_subject_group)=btrim(p_subject_group))
  ), paged as (
    select * from filtered order by full_name,id limit 50 offset (p_page-1)*50
  ) select jsonb_build_object('total',(select count(*) from filtered),
    'items',coalesce((select jsonb_agg(to_jsonb(p) order by full_name,id) from paged p),'[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.admin_teacher_registry_list(text,integer,text) from public,anon;
grant execute on function public.admin_teacher_registry_list(text,integer,text) to authenticated;

notify pgrst,'reload schema';
commit;

-- ============================================================
-- 045_lock_approved_grade_corrections.sql
-- ============================================================
begin;

-- Serialize corrections with academic approval and check the locked row's status.
create or replace function public.correct_final_grade(p_id uuid, p_expected text, p_new text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.grade_records;
  correction public.grade_corrections;
  actor_name text;
begin
  if not coalesce(public.site_is_open(), false) then
    raise exception 'ระบบปิดรับดำเนินการ';
  end if;
  if public.my_role() is distinct from 'teacher' then
    raise exception 'ไม่มีสิทธิ์แก้ไขผลการเรียน';
  end if;
  if p_new is null or p_new not in
    ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ') then
    raise exception 'กรุณาระบุผลการเรียนใหม่ที่ถูกต้อง';
  end if;
  select * into r from public.grade_records where id = p_id for update;
  if not found or not r.teacher_id @> array[auth.uid()] then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการนี้หรือรายการเข้าประวัติแล้ว';
  end if;
  if r.status = 'completed' then
    raise exception 'ฝ่ายวิชาการอนุมัติแล้ว ไม่สามารถแก้ไขผลการเรียนได้';
  end if;
  if r.status <> 'teacher_approved' then
    raise exception 'แก้ไขผลการเรียนได้เฉพาะรายการที่รอฝ่ายวิชาการอนุมัติ';
  end if;
  if r.final_grade is distinct from p_expected then
    raise exception 'ผลการเรียนเปลี่ยนแปลงแล้ว กรุณาโหลดหน้าใหม่';
  end if;
  if r.final_grade = p_new then
    raise exception 'กรุณาเลือกผลการเรียนที่ต่างจากเดิม';
  end if;
  select full_name into actor_name from public.profiles where id = auth.uid();
  update public.grade_records set final_grade = p_new where id = p_id;
  insert into public.grade_corrections(
    record_id, student_id, teacher_id, previous_grade, new_grade, changed_by, changed_by_name
  ) values (
    p_id, r.student_id, r.teacher_id, r.final_grade, p_new, auth.uid(), actor_name
  ) returning * into correction;
  insert into public.audit_log(actor_id, record_id, action, from_status, to_status)
  values (auth.uid(), p_id, 'correct_final_grade', r.status, r.status);
  return to_jsonb(correction);
end;
$$;

revoke all on function public.correct_final_grade(uuid,text,text) from public, anon, authenticated;
grant execute on function public.correct_final_grade(uuid,text,text) to authenticated;

commit;

-- ============================================================
-- 046_account_role_deletion.sql
-- ============================================================
begin;

-- School records outlive a login and its active profile. Do not copy secrets or
-- citizen IDs into the historical identity directory.
create table public.profile_identities (
  id uuid primary key,
  full_name text not null
);
insert into public.profile_identities select id,full_name from public.profiles;
alter table public.profile_identities enable row level security;
revoke all on public.profile_identities from public,anon,authenticated,service_role;
create function public.remember_profile_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.profile_identities(id,full_name) values(new.id,new.full_name)
    on conflict(id) do update set full_name=excluded.full_name;
  return new;
end;
$$;
revoke all on function public.remember_profile_identity() from public,anon,authenticated,service_role;
create trigger remember_profile_identity before insert or update of full_name on public.profiles
for each row execute function public.remember_profile_identity();
alter table public.grade_records drop constraint grade_records_student_id_fkey,
  add constraint grade_records_student_id_fkey foreign key(student_id) references public.profile_identities(id);
alter table public.grade_record_history drop constraint history_student_fk,
  add constraint history_student_fk foreign key(student_id) references public.profile_identities(id);
alter table public.assignment_files drop constraint assignment_files_uploaded_by_fkey,
  add constraint assignment_files_uploaded_by_fkey foreign key(uploaded_by) references public.profile_identities(id);
alter table public.grade_reset_history drop constraint grade_reset_history_reset_by_fkey,
  add constraint grade_reset_history_reset_by_fkey foreign key(reset_by) references public.profile_identities(id);

-- Check new assignments against live roles, not the historical directory.
create function public.check_live_grade_people() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or new.student_id is distinct from old.student_id then
    if not public.profile_has_role(new.student_id,'student') then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  end if;
  if tg_op='INSERT' or new.teacher_id is distinct from old.teacher_id then
    if exists(select 1 from unnest(new.teacher_id) t where not public.profile_has_role(t,'teacher')) then
      raise exception 'ACCOUNT_NOT_FOUND';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.check_live_grade_people() from public,anon,authenticated,service_role;
create trigger check_live_grade_people before insert or update of student_id,teacher_id on public.grade_records
for each row execute function public.check_live_grade_people();

create or replace function public.prevent_assigned_teacher_delete() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.grade_records where status<>'completed'
    and (student_id=old.id or teacher_id @> array[old.id])) then raise exception 'ACCOUNT_OUTSTANDING'; end if;
  return old;
end;
$$;

create or replace function public.admin_delete_account(p_id uuid,p_role public.app_role,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.profiles; remaining public.app_role[]; actor uuid:=auth.uid();
begin
  if actor is null or public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_role is null or p_role not in ('student','teacher','academic','manager') or p_id is null
    or p_expected_revision is null or p_expected_revision<0 then raise exception 'ACCOUNT_INVALID'; end if;
  if p_id=actor then raise exception 'ACCOUNT_PROTECTED'; end if;
  -- Match the import/archive lock order. Only the short database mutation holds
  -- this lock; resetting Auth never locks grade tables.
  perform 1 from public.site_schedule where id=1 for share;
  lock table public.grade_records in share row exclusive mode;
  select * into target from public.profiles where id=p_id for update;
  if not found or not public.profile_has_role(p_id,p_role) then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if public.profile_has_role(p_id,'admin') then raise exception 'ACCOUNT_PROTECTED'; end if;
  if target.account_revision<>p_expected_revision then raise exception 'ACCOUNT_CHANGED'; end if;
  if exists(select 1 from public.teacher_registration_claims where profile_id=p_id) then raise exception 'REGISTRY_BUSY'; end if;
  if exists(select 1 from public.grade_records where status<>'completed'
    and (student_id=p_id or teacher_id @> array[p_id])) then raise exception 'ACCOUNT_OUTSTANDING'; end if;
  select array_agg(r order by r::text) into remaining from (
    select target.role r union select role from public.profile_roles where profile_id=p_id
  ) roles where r<>p_role;
  if coalesce(cardinality(remaining),0)>0 then
    delete from public.profile_roles where profile_id=p_id and role in (p_role,remaining[1]);
    update public.profiles set role=remaining[1],auth_generation=auth_generation+1 where id=p_id;
    -- Revoke only the removed role's sessions. Other role sessions still work.
    delete from auth.sessions where id in (
      select session_id from public.login_role_sessions where user_id=p_id and role=p_role
    );
  else
    delete from auth.sessions where user_id=p_id;
    update public.audit_log set deleted_actor_id=coalesce(deleted_actor_id,actor_id),
      deleted_actor_name=coalesce(deleted_actor_name,target.full_name),actor_id=null where actor_id=p_id;
    delete from public.profiles where id=p_id;
  end if;
  insert into public.audit_log(actor_id,action) values(actor,'account_role_deleted:' || p_role::text || ':' || p_id::text);
  return jsonb_build_object('deleted',true,'removed_role',p_role,'profile_retained',coalesce(cardinality(remaining),0)>0);
end;
$$;

-- The common editor already validates and propagates names. Permit managers
-- without exposing username or password through the profile update.
create or replace function public.admin_edit_account_before_registry(p_id uuid,p_role public.app_role,p_expected_revision integer,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.profiles; display_name text;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_id is null or p_role is null or p_role not in ('student','teacher','academic','manager')
    or p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_changes) is distinct from 'object'
    or coalesce(length(trim(p_changes->>'name_prefix')),0) not between 1 and 40
    or coalesce(length(trim(p_changes->>'first_name')),0) not between 1 and 80
    or coalesce(length(trim(p_changes->>'last_name')),0) not between 1 and 80
    or exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('name_prefix','first_name','last_name','classroom','roll_number')) then
    raise exception 'ACCOUNT_INVALID';
  end if;
  if p_role='student' and (coalesce(p_changes->>'classroom','') !~ '^ม[.][1-6]/[1-9]\d{0,2}$'
    or coalesce((p_changes->>'roll_number')::integer,0) not between 1 and 999) then raise exception 'ACCOUNT_INVALID'; end if;
  display_name:=trim(p_changes->>'name_prefix') || trim(p_changes->>'first_name') || ' ' || trim(p_changes->>'last_name');
  if length(display_name)>150 then raise exception 'ACCOUNT_INVALID'; end if;
  perform 1 from public.site_schedule where id=1 for share;
  lock table public.grade_records in share row exclusive mode;
  select * into target from public.profiles where id=p_id for update;
  if not found or not public.profile_has_role(p_id,p_role) then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if p_id=auth.uid() or public.profile_has_role(p_id,'admin') then raise exception 'ACCOUNT_PROTECTED'; end if;
  if target.account_revision<>p_expected_revision then raise exception 'ACCOUNT_CHANGED'; end if;
  if exists(select 1 from public.teacher_registration_claims where profile_id=p_id) then raise exception 'REGISTRY_BUSY'; end if;
  update public.profiles set full_name=display_name,name_prefix=trim(p_changes->>'name_prefix'),
    first_name=trim(p_changes->>'first_name'),last_name=trim(p_changes->>'last_name'),
    classroom=case when p_role='student' then p_changes->>'classroom' else classroom end,
    roll_number=case when p_role='student' then (p_changes->>'roll_number')::integer else roll_number end
    where id=p_id returning * into target;
  if p_role='student' then
    update public.grade_records set student_name=display_name where student_id=p_id;
  elsif public.profile_has_role(p_id,'teacher') then
    update public.grade_records g set teacher_name=(select array_agg(
      case when t.id=p_id then display_name else g.teacher_name[t.ord::integer] end order by t.ord)
      from unnest(g.teacher_id) with ordinality t(id,ord)) where g.teacher_id @> array[p_id];
  end if;
  insert into public.audit_log(actor_id,action) values(auth.uid(),'account_edited:' || p_id::text);
  return jsonb_build_object('id',target.id,'full_name',target.full_name,'name_prefix',target.name_prefix,
    'first_name',target.first_name,'last_name',target.last_name,'account_revision',target.account_revision,
    'student_code',target.student_code,'classroom',target.classroom,'roll_number',target.roll_number,
    'username',target.username,'has_auth',exists(select 1 from auth.users where id=p_id));
end;
$$;

create or replace function public.admin_account_list(p_role public.app_role,p_search text default '',p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  result:=public.admin_account_list_before_registry(p_role,p_search,p_page);
  return jsonb_set(result,'{items}',coalesce((select jsonb_agg(item || jsonb_build_object(
    'learning_subject_group',p.learning_subject_group,'has_auth',exists(select 1 from auth.users where id=p.id)) order by ord)
    from jsonb_array_elements(result->'items') with ordinality e(item,ord)
    join public.profiles p on p.id=(item->>'id')::uuid),'[]'::jsonb));
end;
$$;

notify pgrst,'reload schema';
commit;

-- ============================================================
-- 047_staff_auth_reset.sql
-- ============================================================
begin;

-- A durable reservation spans Storage/Auth HTTP requests without holding SQL
-- locks. The deleting stage is claimed once, so a delayed retry cannot delete
-- a newly registered Auth account with the same UUID.
create table public.staff_auth_resets (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  token uuid not null unique,
  actor_id uuid not null,
  stage text not null check(stage in ('files','deleting','complete')),
  created_at timestamptz not null default now()
);
alter table public.staff_auth_resets enable row level security;
revoke all on public.staff_auth_resets from public,anon,authenticated,service_role;

alter function public.live_profile_session() rename to live_profile_session_before_reset;
revoke all on function public.live_profile_session_before_reset() from public,anon,authenticated,service_role;
create function public.live_profile_session() returns boolean
language sql stable security definer set search_path='' as $$
  select public.live_profile_session_before_reset() and not exists(
    select 1 from public.staff_auth_resets where profile_id=auth.uid() and stage<>'complete');
$$;
revoke all on function public.live_profile_session() from public,anon;
grant execute on function public.live_profile_session() to authenticated;
-- Policies bind function OIDs, so replace the existing policies explicitly.
do $$ declare t record; begin
  for t in select schemaname,tablename from pg_policies where policyname='live_account_session' loop
    execute format('alter policy live_account_session on %I.%I using ((select public.live_profile_session())) with check ((select public.live_profile_session()))',t.schemaname,t.tablename);
  end loop;
end $$;

create function public.guard_staff_reset() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; active_token uuid;
begin
  if tg_table_name='profiles' then target:=old.id;
  elsif tg_op='DELETE' then target:=old.profile_id;
  else target:=new.profile_id; end if;
  perform 1 from public.profiles where id=target for update;
  select token into active_token from public.staff_auth_resets where profile_id=target and stage<>'complete';
  if active_token is not null and active_token::text is distinct from current_setting('app.staff_reset_token',true) then
    raise exception 'REGISTRY_BUSY';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_staff_reset() from public,anon,authenticated,service_role;
create trigger guard_staff_reset before update or delete on public.profiles for each row execute function public.guard_staff_reset();
create trigger guard_staff_reset before insert or update or delete on public.profile_roles for each row execute function public.guard_staff_reset();
create trigger guard_staff_reset before insert on public.teacher_registration_claims for each row execute function public.guard_staff_reset();

create or replace function public.prepare_teacher_reset_identity(
  p_actor uuid,p_id uuid,p_expected_revision integer,p_ciphertext text,p_hash text,p_names jsonb
) returns integer language plpgsql security definer set search_path='' as $$
declare target public.profiles; revision integer;
begin
  if p_actor is null or not public.profile_has_role(p_actor,'admin')
    or not exists(select 1 from auth.users where id=p_actor) then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_actor=p_id then raise exception 'ACCOUNT_PROTECTED'; end if;
  select * into target from public.profiles where id=p_id for update;
  if not found or not (public.profile_has_role(p_id,'teacher') or public.profile_has_role(p_id,'academic')) then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if public.profile_has_role(p_id,'admin') then raise exception 'ACCOUNT_PROTECTED'; end if;
  if p_expected_revision is null or target.account_revision<>p_expected_revision then raise exception 'ACCOUNT_CHANGED'; end if;
  if exists(select 1 from public.teacher_registration_claims where profile_id=p_id) then raise exception 'REGISTRY_BUSY'; end if;
  if target.citizen_id_encrypted is null or p_ciphertext is distinct from target.citizen_id_encrypted then raise exception 'REGISTRY_IDENTITY_MISSING'; end if;
  if target.staff_citizen_hash is not null then raise exception 'ACCOUNT_CHANGED'; end if;
  if nullif(btrim(p_names->>'first_name'),'') is null or nullif(btrim(p_names->>'last_name'),'') is null then raise exception 'ACCOUNT_INVALID'; end if;
  perform public.backfill_staff_identity(p_id,p_hash,p_names);
  select account_revision into revision from public.profiles where id=p_id;
  return revision;
end;
$$;

create function public.admin_begin_staff_auth_reset(p_id uuid,p_role public.app_role,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.profiles; operation public.staff_auth_resets;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_id is null or p_role is null or p_role not in ('teacher','academic') or p_expected_revision is null or p_expected_revision<0 then raise exception 'ACCOUNT_INVALID'; end if;
  select * into target from public.profiles where id=p_id for update;
  if not found or not public.profile_has_role(p_id,p_role) then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if p_id=auth.uid() or public.profile_has_role(p_id,'admin') then raise exception 'ACCOUNT_PROTECTED'; end if;
  if target.account_revision<>p_expected_revision then raise exception 'ACCOUNT_CHANGED'; end if;
  select * into operation from public.staff_auth_resets where profile_id=p_id;
  if found and operation.stage<>'complete' then
    return jsonb_build_object('token',operation.token,'stage',operation.stage,'account_revision',target.account_revision);
  end if;
  if exists(select 1 from public.teacher_registration_claims where profile_id=p_id) then raise exception 'REGISTRY_BUSY'; end if;
  if not exists(select 1 from auth.users where id=p_id) then
    return jsonb_build_object('stage','complete','account_revision',target.account_revision);
  end if;
  if target.staff_citizen_hash is null then raise exception 'REGISTRY_IDENTITY_MISSING'; end if;
  insert into public.staff_auth_resets(profile_id,token,actor_id,stage) values(p_id,gen_random_uuid(),auth.uid(),'files')
    on conflict(profile_id) do update set token=excluded.token,actor_id=excluded.actor_id,stage='files',created_at=now()
    returning * into operation;
  perform set_config('app.staff_reset_token',operation.token::text,true);
  update public.profiles set auth_generation=auth_generation+1 where id=p_id returning * into target;
  delete from auth.sessions where user_id=p_id;
  delete from public.push_subscriptions where user_id=p_id;
  return jsonb_build_object('token',operation.token,'stage',operation.stage,'account_revision',target.account_revision);
end;
$$;
revoke all on function public.admin_begin_staff_auth_reset(uuid,public.app_role,integer) from public,anon;
grant execute on function public.admin_begin_staff_auth_reset(uuid,public.app_role,integer) to authenticated;

-- Storage is managed by Supabase and the migration role does not own its
-- tables. Read the native ownership columns without altering storage.objects.
-- Older Storage versions may expose only one of owner_id/owner.
create function public.owned_staff_files(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare predicate text:='false'; result jsonb;
begin
  if exists(select 1 from pg_attribute where attrelid='storage.objects'::regclass and attname='owner_id' and not attisdropped) then
    predicate:=predicate || ' or o.owner_id=$1::text';
  end if;
  if exists(select 1 from pg_attribute where attrelid='storage.objects'::regclass and attname='owner' and not attisdropped) then
    predicate:=predicate || ' or o.owner=$1::uuid';
  end if;
  execute 'select coalesce(jsonb_agg(item),''[]''::jsonb) from (
    select jsonb_build_object(''bucket'',o.bucket_id,''name'',o.name,''metadata'',to_jsonb(o)->''metadata'',
      ''version'',to_jsonb(o)->>''version'') item from storage.objects o where ' || predicate ||
    ' order by o.bucket_id,o.name limit 20) files' into result using p_id;
  return result;
end;
$$;
revoke all on function public.owned_staff_files(uuid) from public,anon,authenticated,service_role;
create function public.staff_reset_files(p_id uuid,p_token uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.staff_auth_resets where profile_id=p_id and token=p_token and stage='files') then raise exception 'REGISTRY_BUSY'; end if;
  return public.owned_staff_files(p_id);
end;
$$;
create function public.claim_staff_auth_delete(p_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.profiles where id=p_id for update;
  if jsonb_array_length(public.owned_staff_files(p_id))>0 then raise exception 'REGISTRY_STORAGE'; end if;
  update public.staff_auth_resets set stage='deleting' where profile_id=p_id and token=p_token and stage='files';
  return found;
end;
$$;
create function public.finish_staff_auth_reset(p_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare operation public.staff_auth_resets; revision integer;
begin
  perform 1 from public.profiles where id=p_id for update;
  select * into operation from public.staff_auth_resets where profile_id=p_id and token=p_token for update;
  if not found or operation.stage not in ('deleting','complete') then raise exception 'REGISTRY_BUSY'; end if;
  if exists(select 1 from auth.users where id=p_id) then raise exception 'REGISTRY_BUSY'; end if;
  if operation.stage='deleting' then
    perform set_config('app.staff_reset_token',p_token::text,true);
    update public.profiles set auth_generation=auth_generation+1 where id=p_id;
    update public.staff_auth_resets set stage='complete' where profile_id=p_id;
    insert into public.audit_log(actor_id,action) values(null,'staff_auth_reset:' || p_id::text || ':actor:' || operation.actor_id::text);
  end if;
  select account_revision into revision from public.profiles where id=p_id;
  return jsonb_build_object('success',true,'has_auth',false,'account_revision',revision);
end;
$$;
revoke all on function public.staff_reset_files(uuid,uuid),public.claim_staff_auth_delete(uuid,uuid),public.finish_staff_auth_reset(uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_reset_files(uuid,uuid),public.claim_staff_auth_delete(uuid,uuid),public.finish_staff_auth_reset(uuid,uuid) to service_role;

-- Only used after a definitive Auth HTTP rejection, never after a timeout or
-- unknown response. The same operation can preserve newly uploaded files.
create function public.retry_staff_auth_reset(p_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.profiles where id=p_id for update;
  if not exists(select 1 from auth.users where id=p_id) then raise exception 'REGISTRY_BUSY'; end if;
  update public.staff_auth_resets set stage='files' where profile_id=p_id and token=p_token and stage='deleting';
  if not found then raise exception 'REGISTRY_BUSY'; end if;
end;
$$;
revoke all on function public.retry_staff_auth_reset(uuid,uuid) from public,anon,authenticated;
grant execute on function public.retry_staff_auth_reset(uuid,uuid) to service_role;

-- Completed reset receipts must not prevent a later, intentional role delete.
alter table public.staff_auth_resets drop constraint staff_auth_resets_profile_id_fkey,
  add constraint staff_auth_resets_profile_id_fkey foreign key(profile_id) references public.profiles(id) on delete cascade;

-- Old SQL reset endpoints cannot do the Storage/Auth protocol safely. Revoke
-- them, including internal pre-registry routines; the server action replaces them.
revoke all on function public.admin_reset_teacher(uuid,text),public.admin_reset_academic(uuid,text),
  public.reset_teacher_registry(uuid,integer),public.admin_reset_staff(uuid,text,public.app_role),
  public.admin_reset_staff_before_registry(uuid,text,public.app_role),
  public.admin_delete_account_before_registry(uuid,public.app_role,integer)
  from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;

-- ============================================================
-- 048_academic_auth_recovery.sql
-- ============================================================
begin;

-- Use the same reservation as teacher registration. Existing academic profiles
-- are recovered by identity; the form never creates a second school identity.
create function public.claim_academic_registration(p_actor uuid,p_row jsonb,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_id uuid; target public.profiles; reservation public.teacher_registration_claims; emails text[];
begin
  if p_actor is null or not public.profile_has_role(p_actor,'admin') or not exists(select 1 from auth.users where id=p_actor) then
    raise exception 'ACCOUNT_FORBIDDEN';
  end if;
  if p_token is null or jsonb_typeof(p_row) is distinct from 'object'
    or coalesce(p_row->>'hash','') !~ '^[a-f0-9]{64}$'
    or coalesce(p_row->>'citizen_id_encrypted','') !~ '^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]{26}$'
    or coalesce(length(trim(p_row->>'name_prefix')),0) not between 1 and 40
    or coalesce(length(trim(p_row->>'first_name')),0) not between 1 and 80
    or coalesce(length(trim(p_row->>'last_name')),0) not between 1 and 80 then raise exception 'ACCOUNT_INVALID'; end if;
  emails:=array(select jsonb_array_elements_text(p_row->'emails'));
  if cardinality(emails)<>3 or exists(select 1 from unnest(emails) e where e !~ '^[a-f0-9]{64}@login[.]mst-grs[.]internal$') then raise exception 'ACCOUNT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_row->>'hash',0));
  target_id:=public.teacher_registry_target(p_row->>'hash',emails);
  if target_id is not null then
    select * into target from public.profiles where id=target_id for update;
    if not public.profile_has_role(target_id,'academic') or public.profile_has_role(target_id,'admin') then raise exception 'REGISTRATION_EXISTS'; end if;
    if public.registry_normalize_name(target.first_name) is distinct from public.registry_normalize_name(p_row->>'first_name')
      or public.registry_normalize_name(target.last_name) is distinct from public.registry_normalize_name(p_row->>'last_name') then raise exception 'REGISTRATION_DENIED'; end if;
    if exists(select 1 from public.staff_auth_resets where profile_id=target_id and stage<>'complete') then raise exception 'REGISTRY_BUSY'; end if;
    select * into reservation from public.teacher_registration_claims where profile_id=target_id;
    if found then return jsonb_build_object('id',target_id,'token',reservation.token,'pending',true); end if;
  end if;
  if exists(select 1 from auth.users where id=target_id or email=any(emails)) then raise exception 'REGISTRATION_EXISTS'; end if;
  if target_id is null then
    target_id:=(p_row->>'id')::uuid;
    if target_id is null then raise exception 'ACCOUNT_INVALID'; end if;
    insert into public.profiles(id,role,full_name,name_prefix,first_name,last_name,staff_citizen_hash,citizen_id_encrypted)
      values(target_id,'academic',trim(p_row->>'name_prefix') || trim(p_row->>'first_name') || ' ' || trim(p_row->>'last_name'),
        trim(p_row->>'name_prefix'),trim(p_row->>'first_name'),trim(p_row->>'last_name'),p_row->>'hash',p_row->>'citizen_id_encrypted');
    insert into public.audit_log(actor_id,action) values(p_actor,'academic_created:' || target_id::text);
  end if;
  insert into public.teacher_registration_claims(profile_id,token) values(target_id,p_token);
  return jsonb_build_object('id',target_id,'token',p_token,'pending',false);
end;
$$;
revoke all on function public.claim_academic_registration(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.claim_academic_registration(uuid,jsonb,uuid) to service_role;

notify pgrst,'reload schema';
commit;

-- ============================================================
-- 049_import_student_code_matching.sql
-- ============================================================
begin;

-- Match students by their exact student code and store the registered name.
-- Preserve the multi-role teacher lookup, permissions and overwrite history.
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

-- ============================================================
-- 050_admin_outstanding_grade_management.sql
-- ============================================================
begin;

create table public.admin_deleted_grade_records (
  id uuid primary key default gen_random_uuid(),
  original_record_id uuid not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid references public.profiles(id) on delete set null,
  record_snapshot jsonb not null,
  reset_history_snapshot jsonb not null default '[]'::jsonb,
  corrections_snapshot jsonb not null default '[]'::jsonb,
  check (jsonb_typeof(record_snapshot) = 'object'),
  check (jsonb_typeof(reset_history_snapshot) = 'array'),
  check (jsonb_typeof(corrections_snapshot) = 'array')
);
create index admin_deleted_grade_records_date
  on public.admin_deleted_grade_records(deleted_at desc, id);
create index admin_deleted_grade_records_original
  on public.admin_deleted_grade_records(original_record_id, deleted_at desc);
alter table public.admin_deleted_grade_records enable row level security;
revoke all on public.admin_deleted_grade_records from public, anon, authenticated, service_role;
grant select on public.admin_deleted_grade_records to authenticated;
create policy admin_deleted_grade_records_read on public.admin_deleted_grade_records
  for select to authenticated using (public.my_role() = 'admin');

alter table public.grade_assignments
  add column deleted_record_id uuid references public.admin_deleted_grade_records(id),
  drop constraint assignment_one_parent,
  add constraint assignment_one_parent
    check (num_nonnulls(record_id, archived_record_id, reset_history_id, deleted_record_id) = 1),
  add constraint deleted_assignment_round unique(deleted_record_id, round_number);
alter table public.assignment_files
  add column deleted_record_id uuid references public.admin_deleted_grade_records(id),
  drop constraint file_one_parent,
  add constraint file_one_parent
    check (num_nonnulls(record_id, archived_record_id, reset_history_id, deleted_record_id) = 1);
alter table public.audit_log
  add column deleted_record_id uuid references public.admin_deleted_grade_records(id),
  drop constraint audit_one_parent,
  add constraint audit_one_parent
    check (num_nonnulls(record_id, archived_record_id, deleted_record_id) <= 1);
create index deleted_grade_assignments
  on public.grade_assignments(deleted_record_id, round_number);
create index deleted_grade_assignment_files
  on public.assignment_files(deleted_record_id, created_at);
create index deleted_grade_audit
  on public.audit_log(deleted_record_id, created_at);

create policy deleted_assignments_read on public.grade_assignments
  for select to authenticated using (
    public.my_role() = 'admin' and exists (
      select 1 from public.admin_deleted_grade_records d where d.id = deleted_record_id
    )
  );
create policy deleted_files_read on public.assignment_files
  for select to authenticated using (
    public.my_role() = 'admin' and exists (
      select 1 from public.admin_deleted_grade_records d where d.id = deleted_record_id
    )
  );
create policy deleted_audit_read on public.audit_log
  for select to authenticated using (
    public.my_role() = 'admin' and deleted_record_id is not null
  );

drop policy archived_storage_read on storage.objects;
create policy archived_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'assignment-files' and (
    exists (
      select 1 from public.assignment_files f
      join public.grade_record_history h on h.id = f.archived_record_id
      where f.storage_path = name
    ) or (
      public.my_role() = 'admin' and exists (
        select 1 from public.assignment_files f
        join public.admin_deleted_grade_records d on d.id = f.deleted_record_id
        where f.storage_path = name
      )
    )
  )
);

create function public.admin_outstanding_grade_list(
  p_search text default '', p_level integer default null,
  p_classroom text default null, p_page integer default 1
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then
    raise exception 'ไม่มีสิทธิ์ดูรายการผลการเรียน';
  end if;
  if p_search is null or length(trim(p_search)) > 100
    or (p_level is not null and p_level not between 1 and 6)
    or (p_classroom is not null and length(trim(p_classroom)) not between 1 and 40)
    or p_page is null or p_page not between 1 and 100000 then
    raise exception 'ตัวกรองรายการผลการเรียนไม่ถูกต้อง';
  end if;

  with parsed as (
    select g.*,
      ((regexp_match(g.classroom, '^ม[.]\s*([1-6])/([0-9]+)$'))[1])::integer as level,
      ((regexp_match(g.classroom, '^ม[.]\s*([1-6])/([0-9]+)$'))[2])::numeric as room
    from public.grade_records g
    where g.status <> 'completed'
  ), filtered as (
    select * from parsed g
    where (p_level is null or g.level = p_level)
      and (p_classroom is null or g.classroom = trim(p_classroom))
      and (
        trim(p_search) = ''
        or strpos(lower(g.student_name), lower(trim(p_search))) > 0
        or strpos(g.student_code, trim(p_search)) > 0
        or strpos(lower(g.course_code), lower(trim(p_search))) > 0
        or strpos(lower(g.course_name), lower(trim(p_search))) > 0
        or exists (
          select 1 from unnest(g.teacher_name) teacher
          where strpos(lower(teacher), lower(trim(p_search))) > 0
        )
      )
  ), page_rows as (
    select * from filtered
    order by level nulls last, room nulls last, classroom,
      roll_number, student_code, course_code, id
    limit 50 offset (p_page - 1) * 50
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(p) - 'level' - 'room' order by
        level nulls last, room nulls last, classroom, roll_number,
        student_code, course_code, id)
      from page_rows p
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'classrooms', coalesce((
      select jsonb_agg(classroom order by level nulls last, room nulls last, classroom)
      from (
        select distinct classroom, level, room from parsed
        where classroom is not null and (p_level is null or level = p_level)
      ) rooms
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_outstanding_grade_list(text, integer, text, integer)
  from public, anon;
grant execute on function public.admin_outstanding_grade_list(text, integer, text, integer)
  to authenticated;

create function public.admin_delete_outstanding_grades(p_record_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_record_id uuid;
  deleted_id uuid;
  requested_count integer;
  matching_count integer;
  deleted_count integer := 0;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then
    raise exception 'ไม่มีสิทธิ์ลบรายการผลการเรียน';
  end if;
  if p_record_ids is null or cardinality(p_record_ids) not between 1 and 50
    or array_position(p_record_ids, null) is not null
    or exists (
      select 1 from unnest(p_record_ids) with ordinality items(id, ord)
      group by id having count(*) > 1
    ) then
    raise exception 'กรุณาเลือกรายการที่ต้องการลบ 1–50 รายการ';
  end if;

  -- Keep the same lock ordering as period closing and grade imports.
  perform 1 from public.site_schedule where id = 1 for share;
  lock table public.grade_records in share row exclusive mode;
  requested_count := cardinality(p_record_ids);
  select count(*) into matching_count from public.grade_records
    where id = any(p_record_ids) and status <> 'completed';
  if matching_count <> requested_count then
    raise exception 'OUTSTANDING_CHANGED';
  end if;

  foreach target_record_id in array p_record_ids loop
    insert into public.admin_deleted_grade_records(
      original_record_id, deleted_by, record_snapshot,
      reset_history_snapshot, corrections_snapshot
    )
    select g.id, auth.uid(), to_jsonb(g), coalesce((
      select jsonb_agg(to_jsonb(r) order by r.reset_at, r.id)
      from public.grade_reset_history r where r.record_id = g.id
    ), '[]'::jsonb), coalesce((
      select jsonb_agg(to_jsonb(c) order by c.changed_at, c.id)
      from public.grade_corrections c where c.record_id = g.id
    ), '[]'::jsonb)
    from public.grade_records g where g.id = target_record_id
    returning id into deleted_id;

    update public.assignment_files f set deleted_record_id = deleted_id, record_id = null
      where f.record_id = target_record_id;
    update public.grade_assignments a set deleted_record_id = deleted_id, record_id = null
      where a.record_id = target_record_id;
    update public.audit_log a set deleted_record_id = deleted_id, record_id = null
      where a.record_id = target_record_id;
    insert into public.audit_log(actor_id, deleted_record_id, action)
      values (auth.uid(), deleted_id, 'admin_deleted_grade_record');
    delete from public.grade_records where id = target_record_id;
    deleted_count := deleted_count + 1;
  end loop;

  return jsonb_build_object('deleted', deleted_count);
end;
$$;
revoke all on function public.admin_delete_outstanding_grades(uuid[])
  from public, anon;
grant execute on function public.admin_delete_outstanding_grades(uuid[])
  to authenticated;

notify pgrst, 'reload schema';
commit;

-- ============================================================
-- 051_measurement_wording.sql
-- ============================================================
begin;

-- Same as 045 with the department renamed to ฝ่ายวัดผล in error messages.
create or replace function public.correct_final_grade(p_id uuid, p_expected text, p_new text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.grade_records;
  correction public.grade_corrections;
  actor_name text;
begin
  if not coalesce(public.site_is_open(), false) then
    raise exception 'ระบบปิดรับดำเนินการ';
  end if;
  if public.my_role() is distinct from 'teacher' then
    raise exception 'ไม่มีสิทธิ์แก้ไขผลการเรียน';
  end if;
  if p_new is null or p_new not in
    ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ') then
    raise exception 'กรุณาระบุผลการเรียนใหม่ที่ถูกต้อง';
  end if;
  select * into r from public.grade_records where id = p_id for update;
  if not found or not r.teacher_id @> array[auth.uid()] then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการนี้หรือรายการเข้าประวัติแล้ว';
  end if;
  if r.status = 'completed' then
    raise exception 'ฝ่ายวัดผลอนุมัติแล้ว ไม่สามารถแก้ไขผลการเรียนได้';
  end if;
  if r.status <> 'teacher_approved' then
    raise exception 'แก้ไขผลการเรียนได้เฉพาะรายการที่รอฝ่ายวัดผลอนุมัติ';
  end if;
  if r.final_grade is distinct from p_expected then
    raise exception 'ผลการเรียนเปลี่ยนแปลงแล้ว กรุณาโหลดหน้าใหม่';
  end if;
  if r.final_grade = p_new then
    raise exception 'กรุณาเลือกผลการเรียนที่ต่างจากเดิม';
  end if;
  select full_name into actor_name from public.profiles where id = auth.uid();
  update public.grade_records set final_grade = p_new where id = p_id;
  insert into public.grade_corrections(
    record_id, student_id, teacher_id, previous_grade, new_grade, changed_by, changed_by_name
  ) values (
    p_id, r.student_id, r.teacher_id, r.final_grade, p_new, auth.uid(), actor_name
  ) returning * into correction;
  insert into public.audit_log(actor_id, record_id, action, from_status, to_status)
  values (auth.uid(), p_id, 'correct_final_grade', r.status, r.status);
  return to_jsonb(correction);
end;
$$;

revoke all on function public.correct_final_grade(uuid,text,text) from public, anon, authenticated;
grant execute on function public.correct_final_grade(uuid,text,text) to authenticated;

commit;

-- ============================================================
-- 052_admin_import_when_closed.sql
-- ============================================================
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
