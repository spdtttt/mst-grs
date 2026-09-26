begin;

-- Keep the original record id, all grades, approval timestamps and teacher ids.
create table public.grade_record_history (
  like public.grade_records including defaults including constraints including indexes,
  archived_at timestamptz not null default now(),
  archived_closes_at timestamptz not null,
  constraint history_completed_only check (status = 'completed'),
  constraint history_student_fk foreign key (student_id) references public.profiles(id)
);
create index history_student_archive on public.grade_record_history(student_id, archived_at desc, id);
create index history_teachers on public.grade_record_history using gin(teacher_id);
create index history_archive on public.grade_record_history(archived_at desc, id);
alter table public.grade_record_history enable row level security;
revoke all on public.grade_record_history from public, anon, authenticated;
grant select on public.grade_record_history to authenticated;
create policy history_read on public.grade_record_history for select to authenticated using (
  (public.my_role() = 'student' and student_id = (select auth.uid())) or
  (public.my_role() = 'teacher' and teacher_id @> array[(select auth.uid())]) or
  public.my_role() = 'academic'
);

-- Repoint children to history before deleting the active parent. No cascading
-- delete of assignment rounds, file metadata or approval audit events occurs.
alter table public.grade_assignments
  alter column record_id drop not null,
  add column archived_record_id uuid references public.grade_record_history(id),
  add constraint assignment_one_parent check (num_nonnulls(record_id, archived_record_id) = 1),
  add constraint archived_assignment_round unique(archived_record_id, round_number);
alter table public.assignment_files
  alter column record_id drop not null,
  add column archived_record_id uuid references public.grade_record_history(id),
  add constraint file_one_parent check (num_nonnulls(record_id, archived_record_id) = 1);
alter table public.audit_log
  add column archived_record_id uuid references public.grade_record_history(id),
  add constraint audit_one_parent check (num_nonnulls(record_id, archived_record_id) <= 1);
create index history_files on public.assignment_files(archived_record_id, created_at);
create index history_audit on public.audit_log(archived_record_id, created_at);

create policy archived_assignments_read on public.grade_assignments for select to authenticated
using (exists(select 1 from public.grade_record_history h where h.id = archived_record_id));
create policy archived_files_read on public.assignment_files for select to authenticated
using (exists(select 1 from public.grade_record_history h where h.id = archived_record_id));
create policy archived_audit_read on public.audit_log for select to authenticated
using (public.my_role() = 'academic' and archived_record_id is not null);
create policy archived_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'assignment-files' and exists (
    select 1 from public.assignment_files f
    join public.grade_record_history h on h.id = f.archived_record_id
    where f.storage_path = name
  )
);

create function public.archive_completed_before_close(p_closes_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  moved_ids uuid[];
  moved_count integer;
begin
  if p_closes_at is null or p_closes_at > clock_timestamp() then return 0; end if;
  -- Serialize with import/approval transactions, including any approval that
  -- started just before closing. The copy and all deletes commit together.
  lock table public.grade_records in share row exclusive mode;
  with copied as (
    insert into public.grade_record_history
    select g.*, clock_timestamp(), p_closes_at from public.grade_records g
    where g.status = 'completed'
    returning id
  ) select array_agg(id), count(*)::integer into moved_ids, moved_count from copied;
  if moved_count = 0 then return 0; end if;

  update public.assignment_files set archived_record_id = record_id, record_id = null
    where record_id = any(moved_ids);
  update public.grade_assignments set archived_record_id = record_id, record_id = null
    where record_id = any(moved_ids);
  update public.audit_log set archived_record_id = record_id, record_id = null
    where record_id = any(moved_ids);
  insert into public.audit_log(archived_record_id, action)
    select unnest(moved_ids), 'archive_completed';
  delete from public.grade_records where id = any(moved_ids);
  return moved_count;
end;
$$;
revoke all on function public.archive_completed_before_close(timestamptz) from public, anon, authenticated;

-- Invoked by pg_cron as the database owner, never by a browser.
create function public.archive_completed_grade_records()
returns integer language plpgsql security definer set search_path = '' as $$
declare closing timestamptz;
begin
  select closes_at into closing from public.site_schedule where id = 1 for update;
  return public.archive_completed_before_close(closing);
end;
$$;
revoke all on function public.archive_completed_grade_records() from public, anon, authenticated;

-- Reopening before the next cron tick must not carry completed records into the
-- next period. Shortening the schedule to a past time also archives immediately.
create function public.archive_on_schedule_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.archive_completed_before_close(old.closes_at);
  perform public.archive_completed_before_close(new.closes_at);
  return new;
end;
$$;
revoke all on function public.archive_on_schedule_change() from public, anon, authenticated;
create trigger archive_on_schedule_change before update of opens_at, closes_at on public.site_schedule
for each row execute function public.archive_on_schedule_change();

-- Reimporting the same student/course/year/semester must not resurrect an
-- archived result. RETURN NULL preserves import_grades' skipped-row counting.
create function public.skip_archived_grade_import() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.grade_record_history h
    where (h.student_code, h.course_code, h.academic_year, h.semester) =
      (new.student_code, new.course_code, new.academic_year, new.semester)
  ) then return null; end if;
  return new;
end;
$$;
revoke all on function public.skip_archived_grade_import() from public, anon, authenticated;
create trigger skip_archived_grade_import before insert on public.grade_records
for each row execute function public.skip_archived_grade_import();

create or replace function public.prevent_assigned_teacher_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.grade_records where teacher_id @> array[old.id])
    or exists (select 1 from public.grade_record_history where teacher_id @> array[old.id]) then
    raise exception 'ไม่สามารถลบบัญชีครูที่มีรายการผลการเรียนหรือประวัติอยู่';
  end if;
  return old;
end;
$$;

-- Handle an already expired schedule when installing this migration.
select public.archive_completed_grade_records();
commit;
