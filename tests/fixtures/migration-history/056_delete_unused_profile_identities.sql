begin;

-- Deleting a profile also deletes its identity unless school records
-- (grades, history, files, resets) still reference it. Any foreign key to
-- profile_identities, current or future, keeps the identity.
create function public.forget_unused_profile_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  begin
    delete from public.profile_identities where id=old.id;
  exception when foreign_key_violation then null;
  end;
  return old;
end;
$$;
revoke all on function public.forget_unused_profile_identity() from public,anon,authenticated,service_role;
create trigger forget_unused_profile_identity after delete on public.profiles
for each row execute function public.forget_unused_profile_identity();

-- Remove identities left behind by earlier deletions that nothing references.
delete from public.profile_identities i
where not exists(select 1 from public.profiles p where p.id=i.id)
  and not exists(select 1 from public.grade_records g where g.student_id=i.id)
  and not exists(select 1 from public.grade_record_history h where h.student_id=i.id)
  and not exists(select 1 from public.assignment_files f where f.uploaded_by=i.id)
  and not exists(select 1 from public.grade_reset_history r where r.reset_by=i.id);

commit;
