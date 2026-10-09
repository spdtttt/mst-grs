begin;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check(length(endpoint) between 20 and 2048),
  p256dh text not null check(length(p256dh) between 20 and 512),
  auth text not null check(length(auth) between 8 and 256),
  user_agent text not null default '' check(length(user_agent) <= 512),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_subscriptions_user on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to service_role;

create function public.upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default ''
) returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if public.my_role() is distinct from 'teacher' then
    raise exception 'เฉพาะครูเท่านั้นที่เปิดรับการแจ้งเตือนได้';
  end if;
  if length(p_endpoint) not between 20 and 2048
    or p_endpoint not like 'https://%'
    or length(p_p256dh) not between 20 and 512
    or length(p_auth) not between 8 and 256
    or length(coalesce(p_user_agent, '')) > 512 then
    raise exception 'ข้อมูลการแจ้งเตือนไม่ถูกต้อง';
  end if;

  insert into public.push_subscriptions(
    user_id, endpoint, p256dh, auth, user_agent
  ) values (
    auth.uid(), p_endpoint, p_p256dh, p_auth, coalesce(p_user_agent, '')
  )
  on conflict(endpoint) do update set
    user_id=excluded.user_id,
    p256dh=excluded.p256dh,
    auth=excluded.auth,
    user_agent=excluded.user_agent,
    updated_at=now();
end $$;

create function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  delete from public.push_subscriptions
  where user_id=auth.uid() and endpoint=p_endpoint;
end $$;

revoke all on function public.upsert_push_subscription(text,text,text,text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.upsert_push_subscription(text,text,text,text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

commit;
