begin;

-- Only control metadata lives here. Student credentials stay in the request.
create table public.student_import_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check(status in ('active','cancelled','finished')),
  active_batch_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
alter table public.student_import_runs enable row level security;
revoke all on public.student_import_runs from public, anon, authenticated;

create function public.student_import_control(p_operation text, p_import_id uuid default null, p_batch_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.student_import_runs;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ควบคุมการนำเข้าได้'; end if;
  if p_operation = 'start' then
    insert into public.student_import_runs(owner_id) values(auth.uid()) returning * into r;
  else
    select * into r from public.student_import_runs where id=p_import_id and owner_id=auth.uid() for update;
    if not found then raise exception 'ไม่พบรอบนำเข้าหรือไม่มีสิทธิ์'; end if;
    if r.expires_at <= clock_timestamp() and r.status='active' then r.status := 'cancelled'; end if;
    case p_operation
      when 'cancel' then
        if r.status='active' then r.status := 'cancelled'; end if;
      when 'claim' then
        if p_batch_id is null then raise exception 'ไม่พบรหัสชุดนำเข้า'; end if;
        if r.status='active' then
          if r.active_batch_id is not null then raise exception 'มีชุดนำเข้าที่กำลังทำงานอยู่'; end if;
          r.active_batch_id := p_batch_id;
        end if;
      when 'check' then
        if p_batch_id is null or r.active_batch_id is distinct from p_batch_id then raise exception 'ชุดนำเข้าไม่ตรงกัน'; end if;
      when 'release' then
        if p_batch_id is null or r.active_batch_id is distinct from p_batch_id then raise exception 'ชุดนำเข้าไม่ตรงกัน'; end if;
        r.active_batch_id := null;
      when 'finish' then
        if r.active_batch_id is not null then raise exception 'กำลังรอชุดนำเข้าจบ'; end if;
        if r.status='active' then r.status := 'finished'; end if;
      else raise exception 'คำสั่งควบคุมไม่ถูกต้อง';
    end case;
    update public.student_import_runs set status=r.status, active_batch_id=r.active_batch_id where id=r.id;
  end if;
  return jsonb_build_object('importId',r.id,'status',r.status,'canContinue',r.status='active');
end;
$$;
revoke all on function public.student_import_control(text,uuid,uuid) from public, anon;
grant execute on function public.student_import_control(text,uuid,uuid) to authenticated;

create or replace function public.admin_student_list(p_search text default '', p_level integer default null, p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อนักเรียนได้'; end if;
  if p_search is null or length(p_search) > 150 or p_page is null or p_page < 1 or p_page > 100000
    or (p_level is not null and p_level not between 1 and 6) then raise exception 'ตัวกรองไม่ถูกต้อง'; end if;
  with students as (
    select id, student_code, full_name, classroom, name_prefix, first_name, last_name, roll_number,
      ((regexp_match(classroom, '^(?:ม[.]\s*)?([1-6])(?:/|$)'))[1])::integer as level,
      ((regexp_match(classroom, '^(?:ม[.]\s*)?[1-6]/([0-9]+)$'))[1])::numeric as room
    from public.profiles where role = 'student'
  ), filtered as (
    select * from students where (p_level is null or level = p_level)
      and (strpos(lower(full_name), lower(trim(p_search))) > 0 or strpos(student_code, trim(p_search)) > 0)
  ), page as (
    select id, student_code, full_name, classroom, name_prefix, first_name, last_name, roll_number,
      row_number() over (order by level nulls last, room nulls last,
        case when level is null or room is null then classroom end nulls last,
        roll_number nulls last, student_code, id) as position
    from filtered order by position limit 50 offset (p_page - 1) * 50
  ) select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(to_jsonb(page)-'position' order by position) from page), '[]'::jsonb),
    'levels', coalesce((select jsonb_agg(level order by level) from (select distinct level from students where level is not null) x), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_student_list(text,integer,integer) from public, anon;
grant execute on function public.admin_student_list(text,integer,integer) to authenticated;
commit;
