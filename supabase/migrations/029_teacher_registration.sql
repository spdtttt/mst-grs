begin;

create function public.consume_teacher_registration(p_identity_bucket text, p_source_bucket text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare identity_count integer; source_count integer;
begin
  if p_identity_bucket is null or p_source_bucket is null
    or p_identity_bucket !~ '^[a-f0-9]{64}$' or p_source_bucket !~ '^[a-f0-9]{64}$'
    or p_identity_bucket = p_source_bucket then return false; end if;
  delete from public.login_attempts where window_start < now()-interval '1 day';
  insert into public.login_attempts(bucket,window_start,attempts) values(p_source_bucket,now(),1)
  on conflict(bucket) do update set attempts=case when login_attempts.window_start<now()-interval '15 minutes' then 1 else login_attempts.attempts+1 end,
    window_start=case when login_attempts.window_start<now()-interval '15 minutes' then now() else login_attempts.window_start end returning attempts into source_count;
  insert into public.login_attempts(bucket,window_start,attempts) values(p_identity_bucket,now(),1)
  on conflict(bucket) do update set attempts=case when login_attempts.window_start<now()-interval '15 minutes' then 1 else login_attempts.attempts+1 end,
    window_start=case when login_attempts.window_start<now()-interval '15 minutes' then now() else login_attempts.window_start end returning attempts into identity_count;
  return identity_count<=5 and source_count<=60;
end;
$$;
revoke all on function public.consume_teacher_registration(text,text) from public,anon,authenticated;
grant execute on function public.consume_teacher_registration(text,text) to service_role;

-- Called only by the trusted registration server. Public callers cannot choose a role.
create function public.register_teacher_profile(p_id uuid, p_profile jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null or jsonb_typeof(p_profile) is distinct from 'object'
    or coalesce(length(p_profile->>'name_prefix'),0) not between 1 and 40
    or coalesce(length(p_profile->>'first_name'),0) not between 1 and 80
    or coalesce(length(p_profile->>'last_name'),0) not between 1 and 80
    or coalesce(p_profile->>'citizen_id_encrypted','') !~ '^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]{26}$' then
    raise exception 'ข้อมูลสมัครสมาชิกไม่ถูกต้อง';
  end if;
  insert into public.profiles(id,role,full_name,name_prefix,first_name,last_name,citizen_id_encrypted)
  values(p_id,'teacher',(p_profile->>'name_prefix') || (p_profile->>'first_name') || ' ' || (p_profile->>'last_name'),
    p_profile->>'name_prefix',p_profile->>'first_name',p_profile->>'last_name',p_profile->>'citizen_id_encrypted');
  insert into public.audit_log(actor_id,action) values(p_id,'teacher_registered');
end;
$$;
revoke all on function public.register_teacher_profile(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.register_teacher_profile(uuid,jsonb) to service_role;

commit;
