-- Run after 202610150002_channel_profile_limits.sql. Existing scenes stay unchanged.
begin;
alter table public.scenes drop constraint scenes_source_check;
alter table public.scenes add constraint scenes_source_check check(source in ('manual','test','yandex'));

-- Separate entry point keeps old generation/save functions compatible.
create function public.save_scene_edits(p_version_id uuid, p_scenes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
 -- Same lock order as existing version and scene writers, including the empty-set path.
 perform p.id from public.projects p join public.script_versions v on v.project_id = p.id
 where v.id = p_version_id and p.owner_id = auth.uid() for update of p;
 if not found then raise exception 'Version unavailable' using errcode = '42501'; end if;
 if p_scenes is null or jsonb_typeof(p_scenes) <> 'array' then
  raise exception 'Invalid scenes' using errcode = '22023';
 end if;
 if jsonb_array_length(p_scenes) > 12 then raise exception 'Invalid scene count' using errcode = '22023'; end if;
 for item in select value from jsonb_array_elements(p_scenes) loop
  if jsonb_typeof(item->'source') is distinct from 'string'
   or item->>'source' not in ('manual','test','yandex') then
   raise exception 'Invalid scene source' using errcode = '22023';
  end if;
 end loop;
 if jsonb_array_length(p_scenes) = 0 then
  delete from public.scenes where script_version_id = p_version_id;
 else
  -- Validates all text before replacing the set, assigns contiguous positions.
  perform public.save_test_scenes(p_version_id,p_scenes);
  update public.scenes s set source=items.value->>'source'
  from jsonb_array_elements(p_scenes) with ordinality as items(value,position)
  where s.script_version_id=p_version_id and s.position=items.position;
 end if;
end;
$$;
revoke all on function public.save_scene_edits(uuid,jsonb) from public,anon;
grant execute on function public.save_scene_edits(uuid,jsonb) to authenticated;
commit;
