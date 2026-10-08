begin;

-- Same as 045 with the department renamed to ฝ่ายวัดผล in error messages.
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
  if not found or not r.teacher_id @> array[auth.uid()] then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการนี้หรือรายการเข้าประวัติแล้ว';
  end if;
  if r.status = 'completed' then
    raise exception 'ฝ่ายวัดผลอนุมัติแล้ว ไม่สามารถแก้ไขผลการเรียนได้';
  end if;
  if r.status <> 'teacher_approved' then
    raise exception 'แก้ไขผลการเรียนได้เฉพาะรายการที่รอฝ่ายวัดผลอนุมัติ';
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
