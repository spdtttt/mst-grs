begin;

-- Filter the full teacher registry before counting and paginating.
create function public.admin_teacher_registry_list(
  p_search text default '', p_page integer default 1, p_subject_group text default ''
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if public.my_role() is distinct from 'admin' then raise exception 'ACCOUNT_FORBIDDEN'; end if;
  if p_search is null or length(p_search)>150 or p_page is null or p_page not between 1 and 100000
    or p_subject_group is null or length(p_subject_group)>200 then raise exception 'ACCOUNT_INVALID'; end if;
  with filtered as (
    select p.id,p.full_name,p.name_prefix,p.first_name,p.last_name,p.username,p.account_revision,
      p.learning_subject_group,exists(select 1 from auth.users u where u.id=p.id) as has_auth
    from public.profiles p
    where public.profile_has_role(p.id,'teacher')
      and (position(lower(btrim(p_search)) in lower(p.full_name))>0
        or position(lower(btrim(p_search)) in coalesce(p.username,''))>0)
      and (btrim(p_subject_group)='' or btrim(p.learning_subject_group)=btrim(p_subject_group))
  ), paged as (
    select * from filtered order by full_name,id limit 50 offset (p_page-1)*50
  ) select jsonb_build_object('total',(select count(*) from filtered),
    'items',coalesce((select jsonb_agg(to_jsonb(p) order by full_name,id) from paged p),'[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.admin_teacher_registry_list(text,integer,text) from public,anon;
grant execute on function public.admin_teacher_registry_list(text,integer,text) to authenticated;

notify pgrst,'reload schema';
commit;
