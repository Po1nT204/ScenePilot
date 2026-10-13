begin;
create table public.scenes (
 id uuid primary key default gen_random_uuid(),
 script_version_id uuid not null references public.script_versions(id) on delete cascade,
 position integer not null check(position between 1 and 12),
 description text not null check(char_length(btrim(description)) between 1 and 2000),
 visual_prompt text not null check(char_length(btrim(visual_prompt)) between 1 and 2000),
 narration text not null check(char_length(btrim(narration)) between 1 and 2000),
 source text not null default 'test' check(source = 'test'),
 unique(script_version_id, position)
);
alter table public.scenes enable row level security;
revoke all on public.scenes from public, anon, authenticated;
grant select on public.scenes to authenticated;
create policy scenes_select_own on public.scenes for select to authenticated using(exists(
 select 1 from public.script_versions v join public.projects p on p.id = v.project_id
 where v.id = script_version_id and p.owner_id = (select auth.uid())
));
create function public.save_test_scenes(p_version_id uuid, p_scenes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; field_name text; scene_position integer := 0;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
 -- Lock the project first, consistently with saving versions and deleting projects.
 perform p.id from public.projects p join public.script_versions v on v.project_id = p.id
 where v.id = p_version_id and p.owner_id = auth.uid() for update of p;
 if not found then raise exception 'Version unavailable' using errcode = '42501'; end if;
 if p_scenes is null or jsonb_typeof(p_scenes) <> 'array' then
  raise exception 'Invalid scenes' using errcode = '22023';
 end if;
 if jsonb_array_length(p_scenes) not between 1 and 12 then raise exception 'Invalid scene count' using errcode = '22023'; end if;
 for item in select value from jsonb_array_elements(p_scenes) loop
  foreach field_name in array array['description','visual_prompt','narration'] loop
   if jsonb_typeof(item->field_name) is distinct from 'string'
    or char_length(btrim(item->>field_name)) not between 1 and 2000 then
    raise exception 'Invalid scene field' using errcode = '22023';
   end if;
  end loop;
 end loop;
 delete from public.scenes where script_version_id = p_version_id;
 for item in select value from jsonb_array_elements(p_scenes) loop
  scene_position := scene_position + 1;
  insert into public.scenes(script_version_id,position,description,visual_prompt,narration)
  values(p_version_id,scene_position,btrim(item->>'description'),btrim(item->>'visual_prompt'),btrim(item->>'narration'));
 end loop;
end;
$$;
revoke all on function public.save_test_scenes(uuid,jsonb) from public, anon;
grant execute on function public.save_test_scenes(uuid,jsonb) to authenticated;
commit;
