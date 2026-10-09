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
