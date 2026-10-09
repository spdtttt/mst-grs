-- Apply after migrations 001-003. Delete former admin profiles and Auth users.
-- Keep audit events, clearing only their reference to the removed actor.
begin;

drop policy records_read on public.grade_records;
drop policy audit_read on public.audit_log;
drop policy assignment_files_read on public.assignment_files;
drop policy assignment_storage_insert on storage.objects;
drop policy assignment_storage_read on storage.objects;
drop policy assignment_storage_cleanup on storage.objects;
drop function public.my_role();

create temporary table mst_removed_admin_ids on commit drop as
  select id from public.profiles where role='admin';
update public.audit_log set actor_id=null
  where actor_id in (select id from mst_removed_admin_ids);
-- Foreign keys intentionally prevent deletion if any grade or file refers to
-- a former admin; the whole migration then rolls back instead of deleting it.
delete from public.profiles where id in (select id from mst_removed_admin_ids);
delete from auth.users where id in (select id from mst_removed_admin_ids);
alter table public.profiles drop constraint profiles_check;
alter type public.app_role rename to app_role_legacy;
create type public.app_role as enum ('student','teacher','academic');
alter table public.profiles alter column role type public.app_role
  using role::text::public.app_role;
drop type public.app_role_legacy;
alter table public.profiles add constraint profiles_student_code_check check (
  case when role='student' then student_code is not null else student_code is null end
);

create function public.my_role() returns public.app_role
language sql stable security definer set search_path='' as $$
  select role from public.profiles where id=auth.uid()
$$;
revoke all on function public.my_role() from public;
grant execute on function public.my_role() to authenticated;

create policy records_read on public.grade_records for select to authenticated using(public.site_is_open() and ((public.my_role()='student' and student_id=auth.uid()) or (public.my_role()='teacher' and teacher_id=auth.uid()) or public.my_role()='academic'));

create policy audit_read on public.audit_log for select to authenticated using(public.site_is_open() and public.my_role()='academic');

create policy assignment_files_read on public.assignment_files
for select to authenticated using (
  public.site_is_open() and exists (
    select 1 from public.grade_records g
    where g.id=record_id and (
      (public.my_role()='student' and g.student_id=auth.uid()) or
      (public.my_role()='teacher' and g.teacher_id=auth.uid()) or
      public.my_role()='academic'
    )
  )
);

create policy assignment_storage_insert on storage.objects
for insert to authenticated with check (
  bucket_id='assignment-files' and
  name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f-]+\.[a-z0-9]+$' and
  public.site_is_open() and
  public.my_role()='teacher' and
  exists (
    select 1 from public.grade_records g
    where g.id=((storage.foldername(name))[1])::uuid
      and g.teacher_id=auth.uid()
      and g.status='requested'
  )
);

create policy assignment_storage_read on storage.objects
for select to authenticated using (
  bucket_id='assignment-files' and
  name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' and
  public.site_is_open() and
  exists (
    select 1 from public.grade_records g
    where g.id=((storage.foldername(name))[1])::uuid and (
      (public.my_role()='student' and g.student_id=auth.uid()) or
      (public.my_role()='teacher' and g.teacher_id=auth.uid()) or
      public.my_role()='academic'
    )
  )
);

create policy assignment_storage_cleanup on storage.objects
for delete to authenticated using (
  bucket_id='assignment-files' and
  name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' and
  public.site_is_open() and
  public.my_role()='teacher' and
  exists (
    select 1 from public.grade_records g
    where g.id=((storage.foldername(name))[1])::uuid
      and g.teacher_id=auth.uid()
      and g.status='requested'
  )
);

drop policy schedule_read on public.site_schedule;
create policy schedule_read on public.site_schedule for select to authenticated
using(public.my_role() is not null);

create or replace function public.update_schedule(p_opens_at timestamptz,p_closes_at timestamptz,p_notice text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if public.my_role() is distinct from 'academic' then raise exception 'ไม่มีสิทธิ์ดำเนินการ'; end if;
 if p_opens_at is null or p_closes_at is null or p_closes_at<=p_opens_at or length(p_notice)>1000 then raise exception 'ช่วงเวลาไม่ถูกต้อง'; end if;
 update public.site_schedule set opens_at=p_opens_at,closes_at=p_closes_at,notice=p_notice where id=1;
 insert into public.audit_log(actor_id,action) values(auth.uid(),'schedule_updated');
end $$;

commit;
