begin;

-- Keep corrections after a completed record moves to grade_record_history.
-- There is no FK on record_id because the active row is deleted at period close.
create table public.grade_corrections (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,
  student_id uuid not null,
  teacher_id uuid[] not null,
  previous_grade text not null,
  new_grade text not null,
  changed_by uuid not null,
  changed_by_name text not null,
  changed_at timestamptz not null default now(),
  check (previous_grade in ('1','1.5','2','2.5','3','3.5','4','ผ')),
  check (new_grade in ('1','1.5','2','2.5','3','3.5','4','ผ')),
  check (previous_grade <> new_grade)
);
create index grade_corrections_record_time on public.grade_corrections(record_id, changed_at desc);
create index grade_corrections_teacher on public.grade_corrections using gin(teacher_id);
alter table public.grade_corrections enable row level security;
revoke all on public.grade_corrections from public, anon, authenticated;
grant select on public.grade_corrections to authenticated;
create policy grade_corrections_read on public.grade_corrections for select to authenticated using (
  (public.my_role() = 'student' and student_id = (select auth.uid())) or
  (public.my_role() = 'teacher' and teacher_id @> array[(select auth.uid())]) or
  public.my_role() = 'academic'
);

create function public.correct_final_grade(p_id uuid, p_expected text, p_new text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.grade_records;
  correction public.grade_corrections;
  actor_name text;
begin
  if not coalesce(public.site_is_open(), false) then
    raise exception 'ระบบปิดรับดำเนินการ';
  end if;
  if public.my_role() is distinct from 'teacher' then
    raise exception 'ไม่มีสิทธิ์แก้ไขผลการเรียน';
  end if;
  if p_new is null or p_new not in ('1','1.5','2','2.5','3','3.5','4','ผ') then
    raise exception 'กรุณาระบุผลการเรียนใหม่ที่ถูกต้อง';
  end if;
  select * into r from public.grade_records where id = p_id for update;
  if not found or not r.teacher_id @> array[auth.uid()]
    or r.status not in ('teacher_approved', 'completed') then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการนี้หรือรายการเข้าประวัติแล้ว';
  end if;
  if r.final_grade is distinct from p_expected then
    raise exception 'ผลการเรียนเปลี่ยนแปลงแล้ว กรุณาโหลดหน้าใหม่';
  end if;
  if r.final_grade = p_new then
    raise exception 'กรุณาเลือกผลการเรียนที่ต่างจากเดิม';
  end if;
  select full_name into actor_name from public.profiles where id = auth.uid();
  update public.grade_records set final_grade = p_new where id = p_id;
  insert into public.grade_corrections(
    record_id, student_id, teacher_id, previous_grade, new_grade, changed_by, changed_by_name
  ) values (
    p_id, r.student_id, r.teacher_id, r.final_grade, p_new, auth.uid(), actor_name
  ) returning * into correction;
  insert into public.audit_log(actor_id, record_id, action, from_status, to_status)
  values (auth.uid(), p_id, 'correct_final_grade', r.status, r.status);
  return to_jsonb(correction);
end;
$$;
revoke all on function public.correct_final_grade(uuid,text,text) from public, anon, authenticated;
grant execute on function public.correct_final_grade(uuid,text,text) to authenticated;

commit;
