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
