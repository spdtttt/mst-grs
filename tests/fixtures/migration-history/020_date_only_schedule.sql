begin;

-- Keep timestamp columns for existing cron/archive integrations. Boundaries
-- are Bangkok midnight; closes_at is midnight AFTER the selected closing day.
create or replace function public.update_schedule(p_opens_at timestamptz,p_closes_at timestamptz,p_notice text)
returns void language plpgsql security definer set search_path='' as $$
declare
  opening timestamptz;
  closing timestamptz;
begin
  if public.my_role() is distinct from 'academic' then raise exception 'ไม่มีสิทธิ์ดำเนินการ'; end if;
  if p_opens_at is null or p_closes_at is null or not isfinite(p_opens_at) or not isfinite(p_closes_at)
    or p_notice is null or length(p_notice)>1000 then raise exception 'ช่วงวันที่ไม่ถูกต้อง'; end if;
  opening := (p_opens_at at time zone 'Asia/Bangkok')::date::timestamp at time zone 'Asia/Bangkok';
  closing := (((p_closes_at - interval '1 microsecond') at time zone 'Asia/Bangkok')::date + 1)::timestamp at time zone 'Asia/Bangkok';
  if closing <= opening then raise exception 'ช่วงวันที่ไม่ถูกต้อง'; end if;
  update public.site_schedule set opens_at=opening,closes_at=closing,notice=p_notice where id=1;
  insert into public.audit_log(actor_id,action) values(auth.uid(),'schedule_updated');
end $$;

-- Do not archive against the old partial-day deadline while converting it.
alter table public.site_schedule disable trigger archive_on_schedule_change;
update public.site_schedule set
  opens_at = (opens_at at time zone 'Asia/Bangkok')::date::timestamp at time zone 'Asia/Bangkok',
  closes_at = (((closes_at - interval '1 microsecond') at time zone 'Asia/Bangkok')::date + 1)::timestamp at time zone 'Asia/Bangkok'
where opens_at is not null and closes_at is not null;
alter table public.site_schedule enable trigger archive_on_schedule_change;

commit;
