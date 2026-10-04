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
