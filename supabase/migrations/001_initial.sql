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
