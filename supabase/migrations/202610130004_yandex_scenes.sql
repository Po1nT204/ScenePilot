begin;
alter table public.scenes drop constraint scenes_source_check;
alter table public.scenes add constraint scenes_source_check check(source in ('test','yandex'));
create function public.save_scenes(p_version_id uuid,p_scenes jsonb,p_source text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if p_source is null or p_source not in ('test','yandex') then
  raise exception 'Invalid scene source' using errcode = '22023';
 end if;
 -- Existing function checks ownership, locks the project and validates the full set.
 -- Replacement and source update are part of this transaction.
 perform public.save_test_scenes(p_version_id,p_scenes);
 update public.scenes set source=p_source where script_version_id=p_version_id;
end;
$$;
revoke all on function public.save_scenes(uuid,jsonb,text) from public,anon;
grant execute on function public.save_scenes(uuid,jsonb,text) to authenticated;
commit;
