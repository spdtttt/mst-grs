begin;

-- One transaction per closing boundary, even when cron runs every 30 seconds.
create table public.school_period_closures (
  closes_at timestamptz primary key,
  processed_at timestamptz not null default now()
);
alter table public.school_period_closures enable row level security;
revoke all on public.school_period_closures from public, anon, authenticated;

-- Keep the previous attempt without mixing it with successful grade history.
-- record_id intentionally has no FK: the active record may later be archived.
create table public.grade_reset_history (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,
  closes_at timestamptz not null references public.school_period_closures(closes_at),
  student_id uuid not null,
  teacher_id uuid[] not null,
  record_snapshot jsonb not null,
  reset_at timestamptz not null default now(),
  unique(record_id, closes_at)
);
create index reset_history_student on public.grade_reset_history(student_id);
create index reset_history_teachers on public.grade_reset_history using gin(teacher_id);
alter table public.grade_reset_history enable row level security;
revoke all on public.grade_reset_history from public, anon, authenticated;
grant select on public.grade_reset_history to authenticated;
create policy reset_history_read on public.grade_reset_history for select to authenticated using (
  (public.my_role() = 'student' and student_id = (select auth.uid())) or
  (public.my_role() = 'teacher' and teacher_id @> array[(select auth.uid())]) or
  public.my_role() = 'academic'
);

alter table public.grade_assignments
  add column reset_history_id uuid references public.grade_reset_history(id),
  drop constraint assignment_one_parent,
  add constraint assignment_one_parent check (num_nonnulls(record_id, archived_record_id, reset_history_id) = 1),
  add constraint reset_assignment_round unique(reset_history_id, round_number);
alter table public.assignment_files
  add column reset_history_id uuid references public.grade_reset_history(id),
  drop constraint file_one_parent,
  add constraint file_one_parent check (num_nonnulls(record_id, archived_record_id, reset_history_id) = 1);
create index reset_files on public.assignment_files(reset_history_id);
create policy reset_assignments_read on public.grade_assignments for select to authenticated
using (exists(select 1 from public.grade_reset_history h where h.id = reset_history_id));
create policy reset_files_read on public.assignment_files for select to authenticated
using (exists(select 1 from public.grade_reset_history h where h.id = reset_history_id));
create policy reset_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'assignment-files' and exists (
    select 1 from public.assignment_files f
    join public.grade_reset_history h on h.id = f.reset_history_id
    where f.storage_path = name
  )
);

create or replace function public.archive_completed_before_close(p_closes_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  moved_ids uuid[];
  moved_count integer;
begin
  if p_closes_at is null or p_closes_at > clock_timestamp() then return 0; end if;
  lock table public.grade_records in share row exclusive mode;
  insert into public.school_period_closures(closes_at) values (p_closes_at)
    on conflict do nothing;
  if not found then return 0; end if;

  with copied as (
    insert into public.grade_record_history
    select g.*, clock_timestamp(), p_closes_at from public.grade_records g
    where g.status = 'completed'
    returning id
  ) select array_agg(id), count(*)::integer into moved_ids, moved_count from copied;

  update public.assignment_files set archived_record_id = record_id, record_id = null
    where record_id = any(moved_ids);
  update public.grade_assignments set archived_record_id = record_id, record_id = null
    where record_id = any(moved_ids);
  update public.audit_log set archived_record_id = record_id, record_id = null
    where record_id = any(moved_ids);
  insert into public.audit_log(archived_record_id, action)
    select unnest(moved_ids), 'archive_completed';
  delete from public.grade_records where id = any(moved_ids);

  insert into public.grade_reset_history(record_id, closes_at, student_id, teacher_id, record_snapshot)
    select g.id, p_closes_at, g.student_id, g.teacher_id, to_jsonb(g)
    from public.grade_records g;
  update public.assignment_files f set reset_history_id = h.id, record_id = null
    from public.grade_reset_history h
    where h.closes_at = p_closes_at and f.record_id = h.record_id;
  update public.grade_assignments a set reset_history_id = h.id, record_id = null
    from public.grade_reset_history h
    where h.closes_at = p_closes_at and a.record_id = h.record_id;
  insert into public.audit_log(record_id, action, from_status, to_status)
    select id, 'reset_at_period_close', status, 'pending'::public.grade_status
    from public.grade_records;
  update public.grade_records set
    status = 'pending', assignment = null, due_at = null,
    requested_at = null, assigned_at = null, submitted_at = null,
    teacher_approved_at = null, completed_at = null, final_grade = null;
  return moved_count;
end;
$$;
revoke all on function public.archive_completed_before_close(timestamptz) from public, anon, authenticated;

-- Existing cron (migration 017) and schedule-change trigger call this function.
-- Also process the current period if it has already closed at installation.
select public.archive_completed_grade_records();
commit;