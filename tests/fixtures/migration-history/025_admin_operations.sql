begin;

-- Keep the existing validation and audit behavior; transfer these operations to Admin.
create or replace function public.import_grades(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  teacher_value jsonb;
  sid uuid;
  tid uuid;
  teacher_ids uuid[];
  teacher_names text[];
  teacher_name text;
  matches integer;
  inserted integer := 0;
  skipped integer := 0;
  affected integer;
begin
  if public.my_role() is distinct from 'admin' or not coalesce(public.site_is_open(), false) then
    raise exception 'ไม่มีสิทธิ์นำเข้าข้อมูลหรืออยู่นอกเวลาเปิดระบบ';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception 'นำเข้าได้ครั้งละ 1–2,000 รายการ';
  end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    if length(item->>'course_code') not between 1 and 40
      or length(item->>'course_name') not between 1 and 200
      or length(item->>'classroom') not between 1 and 40
      or length(item->>'student_name') not between 1 and 150 then
      raise exception 'รูปแบบข้อมูลไม่ถูกต้อง';
    end if;
    if jsonb_typeof(item->'teacher_name') is distinct from 'array' then
      raise exception 'ข้อมูลครูผู้สอนไม่ถูกต้อง';
    end if;
    if jsonb_array_length(item->'teacher_name') not between 1 and 20 then
      raise exception 'ข้อมูลครูผู้สอนไม่ถูกต้อง';
    end if;
    select id into sid from public.profiles
    where role = 'student' and student_code = item->>'student_code';
    if sid is null then
      raise exception 'ไม่พบบัญชีนักเรียนเลขประจำตัว %', item->>'student_code';
    end if;
    if not exists (
      select 1 from public.profiles
      where id = sid and full_name = item->>'student_name'
    ) then
      raise exception 'ชื่อนักเรียนไม่ตรงกับบัญชี: %', item->>'student_code';
    end if;

    teacher_ids := array[]::uuid[];
    teacher_names := array[]::text[];
    for teacher_value in select value from jsonb_array_elements(item->'teacher_name') loop
      if jsonb_typeof(teacher_value) is distinct from 'string' then
        raise exception 'ข้อมูลครูผู้สอนไม่ถูกต้อง';
      end if;
      teacher_name := trim(teacher_value #>> '{}');
      if teacher_name ~ '^-[[:space:]]*ครูที่ปรึกษาชุมนุม[[:space:]]*-$' then
        raise exception 'กรุณาระบุชื่อครูจริงแทน -ครูที่ปรึกษาชุมนุม -';
      end if;
      if length(teacher_name) not between 1 and 150
        or teacher_name = any(teacher_names) then
        raise exception 'ชื่อครูผู้สอนไม่ถูกต้องหรือซ้ำกัน: %', teacher_name;
      end if;
      select count(*), (array_agg(id))[1] into matches, tid from public.profiles
      where role = 'teacher' and full_name = teacher_name;
      if matches <> 1 then
        raise exception 'ชื่อครูไม่พบหรือซ้ำ: % กรุณาตรวจสอบบัญชี', teacher_name;
      end if;
      teacher_names := array_append(teacher_names, teacher_name);
      teacher_ids := array_append(teacher_ids, tid);
    end loop;

    insert into public.grade_records(
      course_code,course_name,credits,classroom,teacher_name,student_code,
      student_name,roll_number,academic_year,semester,original_grade,student_id,teacher_id
    ) values (
      item->>'course_code',item->>'course_name',(item->>'credits')::numeric,
      item->>'classroom',teacher_names,item->>'student_code',item->>'student_name',
      (item->>'roll_number')::integer,(item->>'academic_year')::integer,
      (item->>'semester')::integer,item->>'original_grade',sid,teacher_ids
    ) on conflict(student_code,course_code,academic_year,semester) do nothing;
    get diagnostics affected = row_count;
    inserted := inserted + affected;
    skipped := skipped + (1 - affected);
  end loop;
  insert into public.audit_log(actor_id,action)
  values(auth.uid(),'import:' || inserted || ':skipped:' || skipped);
  return jsonb_build_object('inserted',inserted,'skipped',skipped);
end;
$$;

create or replace function public.update_schedule(p_opens_at timestamptz,p_closes_at timestamptz,p_notice text)
returns void language plpgsql security definer set search_path='' as $$
declare
  opening timestamptz;
  closing timestamptz;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'ไม่มีสิทธิ์ดำเนินการ'; end if;
  if p_opens_at is null or p_closes_at is null or not isfinite(p_opens_at) or not isfinite(p_closes_at)
    or p_notice is null or length(p_notice)>1000 then raise exception 'ช่วงวันที่ไม่ถูกต้อง'; end if;
  opening := (p_opens_at at time zone 'Asia/Bangkok')::date::timestamp at time zone 'Asia/Bangkok';
  closing := (((p_closes_at - interval '1 microsecond') at time zone 'Asia/Bangkok')::date + 1)::timestamp at time zone 'Asia/Bangkok';
  if closing <= opening then raise exception 'ช่วงวันที่ไม่ถูกต้อง'; end if;
  update public.site_schedule set opens_at=opening,closes_at=closing,notice=p_notice where id=1;
  insert into public.audit_log(actor_id,action) values(auth.uid(),'schedule_updated');
end $$;

commit;
