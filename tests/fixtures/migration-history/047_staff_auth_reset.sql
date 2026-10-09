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
