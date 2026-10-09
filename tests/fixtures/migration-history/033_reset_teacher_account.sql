begin;

-- Keep attribution when the deleted teacher is the actor of an old audit event.
alter table public.audit_log
  add column deleted_actor_id uuid,
  add column deleted_actor_name text;

-- Delete both account rows in one transaction. A failed FK/trigger/storage check
-- must never leave an Auth account without its profile (or the reverse).
create function public.admin_reset_teacher(p_id uuid, p_expected_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare teacher public.profiles; actor uuid := auth.uid();
begin
  if actor is null or public.my_role() is distinct from 'admin' then
    raise exception 'TEACHER_RESET_FORBIDDEN';
  end if;
  if p_id is null or p_expected_name is null or length(p_expected_name) not between 1 and 150 then
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
  if not public.profile_has_role(p_id,'teacher') then
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
    values(actor,'teacher_account_reset:' || p_id::text);
  return jsonb_build_object('deleted',true);
end;
$$;
revoke all on function public.admin_reset_teacher(uuid,text) from public,anon;
grant execute on function public.admin_reset_teacher(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
