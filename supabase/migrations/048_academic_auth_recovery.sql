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
