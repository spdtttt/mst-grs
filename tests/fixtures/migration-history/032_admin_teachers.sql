begin;

create function public.admin_teacher_list(p_search text default '', p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูรายชื่อคุณครูได้';
  end if;
  if p_search is null or length(p_search) > 150 or p_page is null or p_page not between 1 and 100000 then
    raise exception 'ตัวกรองไม่ถูกต้อง';
  end if;
  with filtered as (
    select id, full_name from public.profiles
    where public.profile_has_role(id, 'teacher')
      and (trim(p_search) = '' or position(lower(trim(p_search)) in lower(full_name)) > 0)
  ), paged as (
    select id, full_name from filtered order by full_name, id
    limit 50 offset (p_page - 1) * 50
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(to_jsonb(p) order by p.full_name,p.id) from paged p),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_teacher_list(text,integer) from public,anon;
grant execute on function public.admin_teacher_list(text,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
