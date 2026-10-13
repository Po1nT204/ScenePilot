-- Run once after the previous migrations. Old versions have unknown origin.
begin;
alter table public.script_versions add column source text not null default 'unknown'
 check(source in ('unknown','manual','test','yandex'));
alter function public.save_script_version(uuid,text) rename to save_script_version_internal;
revoke all on function public.save_script_version_internal(uuid,text) from public, anon, authenticated;
create function public.save_script_version(p_project_id uuid,p_content text,p_source text default 'manual')
returns uuid language plpgsql security definer set search_path = '' as $$
declare saved_id uuid;
begin
 if p_source is null or p_source not in ('unknown','manual','test','yandex') then
  raise exception 'Invalid source' using errcode = '22023';
 end if;
 -- Internal function performs ownership validation, locking and snapshot creation.
 saved_id := public.save_script_version_internal(p_project_id,p_content);
 update public.script_versions set source=p_source where id=saved_id;
 return saved_id;
end;
$$;
revoke all on function public.save_script_version(uuid,text,text) from public, anon;
grant execute on function public.save_script_version(uuid,text,text) to authenticated;
commit;
