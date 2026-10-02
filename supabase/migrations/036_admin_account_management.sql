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
