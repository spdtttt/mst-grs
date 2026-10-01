begin;

-- New grades may still be failing or incomplete when the work was reviewed.
alter table public.grade_records
  drop constraint grade_records_final_grade_check,
  add constraint grade_records_final_grade_check
    check (final_grade in ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ'));
alter table public.grade_record_history
  drop constraint grade_records_final_grade_check,
  add constraint grade_record_history_final_grade_check
    check (final_grade in ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ'));
alter table public.grade_corrections
  drop constraint grade_corrections_previous_grade_check,
  drop constraint grade_corrections_new_grade_check,
  add constraint grade_corrections_previous_grade_check
    check (previous_grade in ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ')),
  add constraint grade_corrections_new_grade_check
    check (new_grade in ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ'));

create or replace function public.advance_grade(
  p_id uuid, p_expected public.grade_status, p_assignment text default null,
  p_due_at timestamptz default null, p_final_grade text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.grade_records;
  target public.grade_status;
  actor public.app_role := public.my_role();
begin
  if not coalesce(public.site_is_open(), false) then
    raise exception 'ระบบปิดรับดำเนินการ';
  end if;
  select * into r from public.grade_records where id = p_id for update;
  if not found or r.status <> p_expected then
    raise exception 'ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่';
  end if;
  if actor = 'student' and r.student_id = auth.uid() and r.status = 'pending' then
    target := 'requested';
  elsif actor = 'teacher' and r.teacher_id @> array[auth.uid()] and r.status = 'requested' then
    if p_assignment is null or length(trim(p_assignment)) not between 10 and 10000
      or p_due_at is null or p_due_at <= now() then
      raise exception 'กรุณากรอกงานและกำหนดส่งในอนาคต';
    end if;
    target := 'assigned';
    insert into public.grade_assignments(record_id, round_number, assignment, due_at)
    values(p_id, 1, trim(p_assignment), p_due_at);
  elsif actor = 'teacher' and r.teacher_id @> array[auth.uid()] and r.status = 'assigned' then
    target := 'submitted';
    update public.grade_assignments set received_at = now()
    where id = (
      select id from public.grade_assignments
      where record_id = p_id order by round_number desc limit 1
    );
  elsif actor = 'teacher' and r.teacher_id @> array[auth.uid()] and r.status = 'submitted' then
    if p_final_grade is null or p_final_grade not in
      ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ') then
      raise exception 'กรุณาระบุผลการเรียนใหม่';
    end if;
    target := 'teacher_approved';
  elsif actor = 'academic' and r.status = 'teacher_approved' then
    target := 'completed';
  else
    raise exception 'ไม่มีสิทธิ์ดำเนินการ';
  end if;
  update public.grade_records set
    status = target,
    assignment = case when target = 'assigned' then trim(p_assignment) else assignment end,
    due_at = case when target = 'assigned' then p_due_at else due_at end,
    final_grade = case when target = 'teacher_approved' then p_final_grade else final_grade end,
    requested_at = case when target = 'requested' then now() else requested_at end,
    assigned_at = case when target = 'assigned' then now() else assigned_at end,
    submitted_at = case when target = 'submitted' then now() else submitted_at end,
    teacher_approved_at = case when target = 'teacher_approved' then now() else teacher_approved_at end,
    completed_at = case when target = 'completed' then now() else completed_at end
  where id = p_id;
  insert into public.audit_log(actor_id, record_id, action, from_status, to_status)
  values(auth.uid(), p_id, 'advance', r.status, target);
end;
$$;

create or replace function public.correct_final_grade(p_id uuid, p_expected text, p_new text)
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
  if p_new is null or p_new not in
    ('0','ร','มผ','1','1.5','2','2.5','3','3.5','4','ผ') then
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

commit;
