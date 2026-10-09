begin;

create table public.admin_deleted_grade_records (
  id uuid primary key default gen_random_uuid(),
  original_record_id uuid not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid references public.profiles(id) on delete set null,
  record_snapshot jsonb not null,
  reset_history_snapshot jsonb not null default '[]'::jsonb,
  corrections_snapshot jsonb not null default '[]'::jsonb,
  check (jsonb_typeof(record_snapshot) = 'object'),
  check (jsonb_typeof(reset_history_snapshot) = 'array'),
  check (jsonb_typeof(corrections_snapshot) = 'array')
);
create index admin_deleted_grade_records_date
  on public.admin_deleted_grade_records(deleted_at desc, id);
create index admin_deleted_grade_records_original
  on public.admin_deleted_grade_records(original_record_id, deleted_at desc);
alter table public.admin_deleted_grade_records enable row level security;
revoke all on public.admin_deleted_grade_records from public, anon, authenticated, service_role;
grant select on public.admin_deleted_grade_records to authenticated;
create policy admin_deleted_grade_records_read on public.admin_deleted_grade_records
  for select to authenticated using (public.my_role() = 'admin');

alter table public.grade_assignments
  add column deleted_record_id uuid references public.admin_deleted_grade_records(id),
  drop constraint assignment_one_parent,
  add constraint assignment_one_parent
    check (num_nonnulls(record_id, archived_record_id, reset_history_id, deleted_record_id) = 1),
  add constraint deleted_assignment_round unique(deleted_record_id, round_number);
alter table public.assignment_files
  add column deleted_record_id uuid references public.admin_deleted_grade_records(id),
  drop constraint file_one_parent,
  add constraint file_one_parent
    check (num_nonnulls(record_id, archived_record_id, reset_history_id, deleted_record_id) = 1);
alter table public.audit_log
  add column deleted_record_id uuid references public.admin_deleted_grade_records(id),
  drop constraint audit_one_parent,
  add constraint audit_one_parent
    check (num_nonnulls(record_id, archived_record_id, deleted_record_id) <= 1);
create index deleted_grade_assignments
  on public.grade_assignments(deleted_record_id, round_number);
create index deleted_grade_assignment_files
  on public.assignment_files(deleted_record_id, created_at);
create index deleted_grade_audit
  on public.audit_log(deleted_record_id, created_at);

create policy deleted_assignments_read on public.grade_assignments
  for select to authenticated using (
    public.my_role() = 'admin' and exists (
      select 1 from public.admin_deleted_grade_records d where d.id = deleted_record_id
    )
  );
create policy deleted_files_read on public.assignment_files
  for select to authenticated using (
    public.my_role() = 'admin' and exists (
      select 1 from public.admin_deleted_grade_records d where d.id = deleted_record_id
    )
  );
create policy deleted_audit_read on public.audit_log
  for select to authenticated using (
    public.my_role() = 'admin' and deleted_record_id is not null
  );

drop policy archived_storage_read on storage.objects;
create policy archived_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'assignment-files' and (
    exists (
      select 1 from public.assignment_files f
      join public.grade_record_history h on h.id = f.archived_record_id
      where f.storage_path = name
    ) or (
      public.my_role() = 'admin' and exists (
        select 1 from public.assignment_files f
        join public.admin_deleted_grade_records d on d.id = f.deleted_record_id
        where f.storage_path = name
      )
    )
  )
);

create function public.admin_outstanding_grade_list(
  p_search text default '', p_level integer default null,
  p_classroom text default null, p_page integer default 1
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then
    raise exception 'ไม่มีสิทธิ์ดูรายการผลการเรียน';
  end if;
  if p_search is null or length(trim(p_search)) > 100
    or (p_level is not null and p_level not between 1 and 6)
    or (p_classroom is not null and length(trim(p_classroom)) not between 1 and 40)
    or p_page is null or p_page not between 1 and 100000 then
    raise exception 'ตัวกรองรายการผลการเรียนไม่ถูกต้อง';
  end if;

  with parsed as (
    select g.*,
      ((regexp_match(g.classroom, '^ม[.]\s*([1-6])/([0-9]+)$'))[1])::integer as level,
      ((regexp_match(g.classroom, '^ม[.]\s*([1-6])/([0-9]+)$'))[2])::numeric as room
    from public.grade_records g
    where g.status <> 'completed'
  ), filtered as (
    select * from parsed g
    where (p_level is null or g.level = p_level)
      and (p_classroom is null or g.classroom = trim(p_classroom))
      and (
        trim(p_search) = ''
        or strpos(lower(g.student_name), lower(trim(p_search))) > 0
        or strpos(g.student_code, trim(p_search)) > 0
        or strpos(lower(g.course_code), lower(trim(p_search))) > 0
        or strpos(lower(g.course_name), lower(trim(p_search))) > 0
        or exists (
          select 1 from unnest(g.teacher_name) teacher
          where strpos(lower(teacher), lower(trim(p_search))) > 0
        )
      )
  ), page_rows as (
    select * from filtered
    order by level nulls last, room nulls last, classroom,
      roll_number, student_code, course_code, id
    limit 50 offset (p_page - 1) * 50
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(p) - 'level' - 'room' order by
        level nulls last, room nulls last, classroom, roll_number,
        student_code, course_code, id)
      from page_rows p
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'classrooms', coalesce((
      select jsonb_agg(classroom order by level nulls last, room nulls last, classroom)
      from (
        select distinct classroom, level, room from parsed
        where classroom is not null and (p_level is null or level = p_level)
      ) rooms
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_outstanding_grade_list(text, integer, text, integer)
  from public, anon;
grant execute on function public.admin_outstanding_grade_list(text, integer, text, integer)
  to authenticated;

create function public.admin_delete_outstanding_grades(p_record_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_record_id uuid;
  deleted_id uuid;
  requested_count integer;
  matching_count integer;
  deleted_count integer := 0;
begin
  if auth.uid() is null or public.my_role() is distinct from 'admin' then
    raise exception 'ไม่มีสิทธิ์ลบรายการผลการเรียน';
  end if;
  if p_record_ids is null or cardinality(p_record_ids) not between 1 and 50
    or array_position(p_record_ids, null) is not null
    or exists (
      select 1 from unnest(p_record_ids) with ordinality items(id, ord)
      group by id having count(*) > 1
    ) then
    raise exception 'กรุณาเลือกรายการที่ต้องการลบ 1–50 รายการ';
  end if;

  -- Keep the same lock ordering as period closing and grade imports.
  perform 1 from public.site_schedule where id = 1 for share;
  lock table public.grade_records in share row exclusive mode;
  requested_count := cardinality(p_record_ids);
  select count(*) into matching_count from public.grade_records
    where id = any(p_record_ids) and status <> 'completed';
  if matching_count <> requested_count then
    raise exception 'OUTSTANDING_CHANGED';
  end if;

  foreach target_record_id in array p_record_ids loop
    insert into public.admin_deleted_grade_records(
      original_record_id, deleted_by, record_snapshot,
      reset_history_snapshot, corrections_snapshot
    )
    select g.id, auth.uid(), to_jsonb(g), coalesce((
      select jsonb_agg(to_jsonb(r) order by r.reset_at, r.id)
      from public.grade_reset_history r where r.record_id = g.id
    ), '[]'::jsonb), coalesce((
      select jsonb_agg(to_jsonb(c) order by c.changed_at, c.id)
      from public.grade_corrections c where c.record_id = g.id
    ), '[]'::jsonb)
    from public.grade_records g where g.id = target_record_id
    returning id into deleted_id;

    update public.assignment_files f set deleted_record_id = deleted_id, record_id = null
      where f.record_id = target_record_id;
    update public.grade_assignments a set deleted_record_id = deleted_id, record_id = null
      where a.record_id = target_record_id;
    update public.audit_log a set deleted_record_id = deleted_id, record_id = null
      where a.record_id = target_record_id;
    insert into public.audit_log(actor_id, deleted_record_id, action)
      values (auth.uid(), deleted_id, 'admin_deleted_grade_record');
    delete from public.grade_records where id = target_record_id;
    deleted_count := deleted_count + 1;
  end loop;

  return jsonb_build_object('deleted', deleted_count);
end;
$$;
revoke all on function public.admin_delete_outstanding_grades(uuid[])
  from public, anon;
grant execute on function public.admin_delete_outstanding_grades(uuid[])
  to authenticated;

notify pgrst, 'reload schema';
commit;
