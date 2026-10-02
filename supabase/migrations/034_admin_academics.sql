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
