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
