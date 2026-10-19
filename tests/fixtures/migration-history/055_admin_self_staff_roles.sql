begin;

-- An Admin may add themself as a teacher or academic. The role is added to
-- their existing account (same login and password); other Admins stay protected.
create or replace function public.save_teacher_registry(p_actor uuid,p_row jsonb) returns jsonb
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
    if public.profile_has_role(target,'admin') and target<>p_actor then raise exception 'ACCOUNT_PROTECTED'; end if;
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

create or replace function public.claim_academic_registration(p_actor uuid,p_row jsonb,p_token uuid)
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
    -- The citizen ID already identifies the acting Admin; their profile and Auth stay as they are.
    if target_id=p_actor then
      if not public.profile_has_role(target_id,'academic') then
        insert into public.profile_roles(profile_id,role) values(target_id,'academic');
        insert into public.audit_log(actor_id,action) values(p_actor,'academic_role_added:' || target_id::text);
      end if;
      return jsonb_build_object('id',target_id,'token',p_token,'pending',false,'existing',true);
    end if;
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

notify pgrst,'reload schema';
commit;
