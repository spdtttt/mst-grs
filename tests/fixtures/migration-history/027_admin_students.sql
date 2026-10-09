begin;

-- Legacy accounts keep their existing full_name and may have no split names/roll.
-- Identity data is encrypted by the server; the roster never returns it.
alter table public.profiles
  add column name_prefix text check(length(name_prefix) between 1 and 40),
  add column first_name text check(length(first_name) between 1 and 80),
  add column last_name text check(length(last_name) between 1 and 80),
  add column roll_number integer check(roll_number between 1 and 999),
  add column citizen_id_encrypted text check(citizen_id_encrypted ~ '^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]{26}$');
create index profiles_student_classroom on public.profiles(classroom, student_code) where role = 'student';

create function public.admin_student_list(p_search text default '', p_level integer default null, p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อนักเรียนได้'; end if;
  if p_search is null or length(p_search) > 150 or p_page is null or p_page < 1 or p_page > 100000
    or (p_level is not null and p_level not between 1 and 6) then raise exception 'ตัวกรองไม่ถูกต้อง'; end if;
  with students as (
    select id, student_code, full_name, classroom, name_prefix, first_name, last_name, roll_number,
      ((regexp_match(classroom, '^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level
    from public.profiles where role = 'student'
  ), filtered as (
    select * from students where (p_level is null or level = p_level)
      and (strpos(lower(full_name), lower(trim(p_search))) > 0 or strpos(student_code, trim(p_search)) > 0)
  ), page as (
    select id, student_code, full_name, classroom, name_prefix, first_name, last_name, roll_number from filtered
    order by level nulls last, classroom, roll_number nulls last, student_code, id
    limit 50 offset (p_page - 1) * 50
  ) select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(to_jsonb(page)) from page), '[]'::jsonb),
    'levels', coalesce((select jsonb_agg(level order by level) from (select distinct level from students where level is not null) x), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_student_list(text,integer,integer) from public, anon;
grant execute on function public.admin_student_list(text,integer,integer) to authenticated;

-- Profile changes and their audit entry commit together. Auth is provisioned
-- by the server first; a failed profile save rolls that newly created Auth back.
create function public.admin_save_student(p_id uuid, p_student jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare existing public.profiles; display_name text; existed boolean;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่เพิ่มนักเรียนได้'; end if;
  if p_id is null or jsonb_typeof(p_student) is distinct from 'object'
    or coalesce(p_student->>'student_code','') !~ '^\d{5,10}$'
    or coalesce(length(p_student->>'name_prefix'),0) not between 1 and 40
    or coalesce(length(p_student->>'first_name'),0) not between 1 and 80
    or coalesce(length(p_student->>'last_name'),0) not between 1 and 80
    or coalesce(p_student->>'classroom','') !~ '^ม[.][1-6]/[1-9]\d{0,2}$'
    or coalesce((p_student->>'roll_number')::integer,0) not between 1 and 999 then
    raise exception 'ข้อมูลนักเรียนไม่ถูกต้อง';
  end if;
  display_name := (p_student->>'name_prefix') || (p_student->>'first_name') || ' ' || (p_student->>'last_name');
  if length(display_name) > 150 then raise exception 'ชื่อรวมยาวเกิน 150 ตัวอักษร'; end if;
  select * into existing from public.profiles where id = p_id for update;
  existed := found;
  if existed and (existing.role <> 'student' or existing.student_code <> p_student->>'student_code') then
    raise exception 'ไม่สามารถเปลี่ยนประเภทบัญชีหรือรหัสนักเรียนเดิมได้';
  end if;
  insert into public.profiles(id,role,student_code,full_name,classroom,name_prefix,first_name,last_name,roll_number,citizen_id_encrypted)
  values(p_id,'student',p_student->>'student_code',display_name,p_student->>'classroom',p_student->>'name_prefix',
    p_student->>'first_name',p_student->>'last_name',(p_student->>'roll_number')::integer,p_student->>'citizen_id_encrypted')
  on conflict(id) do update set full_name=excluded.full_name, classroom=excluded.classroom,
    name_prefix=excluded.name_prefix, first_name=excluded.first_name, last_name=excluded.last_name, roll_number=excluded.roll_number,
    citizen_id_encrypted=coalesce(excluded.citizen_id_encrypted,public.profiles.citizen_id_encrypted)
    where public.profiles.role = 'student' and public.profiles.student_code = excluded.student_code;
  if not found then raise exception 'ไม่สามารถเปลี่ยนประเภทบัญชีหรือรหัสนักเรียนเดิมได้'; end if;
  insert into public.audit_log(actor_id,action) values(auth.uid(),case when existed then 'student_updated' else 'student_created' end);
end;
$$;
revoke all on function public.admin_save_student(uuid,jsonb) from public, anon;
grant execute on function public.admin_save_student(uuid,jsonb) to authenticated;
commit;
