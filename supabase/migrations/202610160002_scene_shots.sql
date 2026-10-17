-- Run after script_pace. No existing scene or version is rewritten.
begin;
alter table public.scenes add constraint scenes_id_version_key unique(id,script_version_id);
alter table public.scenes drop constraint scenes_script_version_id_position_key;
alter table public.scenes add constraint scenes_script_version_id_position_key unique(script_version_id,position) deferrable initially deferred;

create table public.scene_shot_plans (
 scene_id uuid primary key,
 script_version_id uuid not null,
 narration_snapshot text not null,
 foreign key(scene_id,script_version_id) references public.scenes(id,script_version_id) on delete cascade
);
create table public.scene_shots (
 id uuid primary key default gen_random_uuid(),
 scene_id uuid not null,
 script_version_id uuid not null,
 position integer not null check(position between 1 and 40),
 narration_excerpt text not null check(char_length(btrim(narration_excerpt)) between 1 and 1000),
 action text not null check(char_length(btrim(action)) between 1 and 1000),
 visual_prompt text not null check(char_length(btrim(visual_prompt)) between 1 and 2000),
 duration_seconds integer not null check(duration_seconds between 1 and 60),
 source text not null check(source in ('manual','test','yandex')),
 foreign key(scene_id,script_version_id) references public.scenes(id,script_version_id) on delete cascade,
 unique(scene_id,position) deferrable initially deferred
);
create index scene_shots_version_idx on public.scene_shots(script_version_id);
alter table public.scene_shots enable row level security;
alter table public.scene_shot_plans enable row level security;
revoke all on public.scene_shots,public.scene_shot_plans from public,anon,authenticated;
grant select on public.scene_shots,public.scene_shot_plans to authenticated;
create policy shots_select_own on public.scene_shots for select to authenticated using(exists(
 select 1 from public.script_versions v join public.projects p on p.id=v.project_id
 where v.id=script_version_id and p.owner_id=(select auth.uid())
));
create policy shot_plans_select_own on public.scene_shot_plans for select to authenticated using(exists(
 select 1 from public.script_versions v join public.projects p on p.id=v.project_id
 where v.id=script_version_id and p.owner_id=(select auth.uid())
));

create function public.lock_owned_scene_version(p_version_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 perform p.id from public.projects p join public.script_versions v on v.project_id=p.id
 where v.id=p_version_id and p.owner_id=auth.uid() for update of p;
 if not found then raise exception 'Version unavailable' using errcode='42501'; end if;
end;
$$;
revoke all on function public.lock_owned_scene_version(uuid) from public,anon,authenticated;

-- Replace function bodies in place: cached callers keep the same guarded function OIDs.
create or replace function public.save_test_scenes(p_version_id uuid, p_scenes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; field_name text; scene_position integer := 0;
begin
 perform public.lock_owned_scene_version(p_version_id);
 if exists(select 1 from public.scene_shots where script_version_id=p_version_id) then raise exception 'Scenes contain shots; use the current editor' using errcode='22023'; end if;
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

create or replace function public.save_scene_edits(p_version_id uuid, p_scenes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb;
begin
 perform public.lock_owned_scene_version(p_version_id);
 if exists(select 1 from public.scene_shots where script_version_id=p_version_id) then raise exception 'Scenes contain shots; use the current editor' using errcode='22023'; end if;
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

create function public.save_scene_edits_with_ids(p_version_id uuid,p_scenes jsonb,p_confirm_delete_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; field_name text; kept uuid[] := '{}'; scene_id uuid; n integer := 0; result jsonb;
begin
 perform public.lock_owned_scene_version(p_version_id);
 if p_scenes is null or jsonb_typeof(p_scenes)<>'array' then raise exception 'Invalid scenes' using errcode='22023'; end if;
 if jsonb_array_length(p_scenes)>12 then raise exception 'Invalid scene count' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_scenes) loop
  foreach field_name in array array['description','visual_prompt','narration'] loop
   if jsonb_typeof(item->field_name) is distinct from 'string' or char_length(btrim(item->>field_name)) not between 1 and 2000 then raise exception 'Invalid scene field' using errcode='22023'; end if;
  end loop;
  if jsonb_typeof(item->'source') is distinct from 'string' or item->>'source' not in ('manual','test','yandex') then raise exception 'Invalid scene source' using errcode='22023'; end if;
  if item->>'id' is not null then
   scene_id := (item->>'id')::uuid;
   if scene_id=any(kept) or not exists(select 1 from public.scenes s where s.id=scene_id and s.script_version_id=p_version_id) then raise exception 'Invalid scene id' using errcode='22023'; end if;
   kept := array_append(kept,scene_id);
  end if;
 end loop;
 if exists(select 1 from public.scene_shots s where s.script_version_id=p_version_id and not(s.scene_id=any(kept)) and (s.scene_id=any(coalesce(p_confirm_delete_ids,'{}'))) is not true) then
  raise exception 'SHOT_DELETE_CONFIRMATION_REQUIRED' using errcode='22023';
 end if;
 delete from public.scenes where script_version_id=p_version_id and not(id=any(kept));
 for item in select value from jsonb_array_elements(p_scenes) loop
  n:=n+1;
  if item->>'id' is null then
   insert into public.scenes(script_version_id,position,description,visual_prompt,narration,source)
   values(p_version_id,n,btrim(item->>'description'),btrim(item->>'visual_prompt'),btrim(item->>'narration'),item->>'source');
  else
   update public.scenes set position=n,description=btrim(item->>'description'),visual_prompt=btrim(item->>'visual_prompt'),narration=btrim(item->>'narration'),source=item->>'source'
   where id=(item->>'id')::uuid and script_version_id=p_version_id;
  end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'description',s.description,'visual_prompt',s.visual_prompt,'narration',s.narration,'source',s.source,'shot_count',(select count(*) from public.scene_shots h where h.scene_id=s.id)) order by s.position),'[]') into result from public.scenes s where s.script_version_id=p_version_id;
 return result;
end;
$$;
revoke all on function public.save_scene_edits_with_ids(uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.save_scene_edits_with_ids(uuid,jsonb,uuid[]) to authenticated;

create function public.save_scene_shots(p_version_id uuid,p_scene_id uuid,p_shots jsonb,p_expected_narration text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; field_name text; kept uuid[] := '{}'; shot_id uuid; scene_text text; n integer:=0; result jsonb;
begin
 perform public.lock_owned_scene_version(p_version_id);
 select narration into scene_text from public.scenes where id=p_scene_id and script_version_id=p_version_id;
 if not found then raise exception 'Scene unavailable' using errcode='42501'; end if;
 if p_expected_narration is distinct from scene_text then raise exception 'SCENE_CHANGED' using errcode='22023'; end if;
 if p_shots is null or jsonb_typeof(p_shots)<>'array' then raise exception 'Invalid shots' using errcode='22023'; end if;
 if jsonb_array_length(p_shots)>40 or octet_length(p_shots::text)>524288 then raise exception 'Invalid shot size' using errcode='22023'; end if;
 if (select count(*) from public.scene_shots where script_version_id=p_version_id and scene_id<>p_scene_id)+jsonb_array_length(p_shots)>240 then raise exception 'Too many shots in version' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_shots) loop
  foreach field_name in array array['narration_excerpt','action','visual_prompt'] loop
   if jsonb_typeof(item->field_name) is distinct from 'string' or char_length(btrim(item->>field_name)) not between 1 and (case when field_name='visual_prompt' then 2000 else 1000 end) then raise exception 'Invalid shot field' using errcode='22023'; end if;
  end loop;
  if jsonb_typeof(item->'duration_seconds') is distinct from 'number' then raise exception 'Invalid shot duration' using errcode='22023'; end if;
  if (item->>'duration_seconds')::numeric <> trunc((item->>'duration_seconds')::numeric) or (item->>'duration_seconds')::numeric not between 1 and 60 then raise exception 'Invalid shot duration' using errcode='22023'; end if;
  if jsonb_typeof(item->'source') is distinct from 'string' or item->>'source' not in ('manual','test','yandex') then raise exception 'Invalid shot source' using errcode='22023'; end if;
  if item->>'id' is not null then
   shot_id:=(item->>'id')::uuid;
   if shot_id=any(kept) or not exists(select 1 from public.scene_shots s where s.id=shot_id and s.scene_id=p_scene_id and s.script_version_id=p_version_id) then raise exception 'Invalid shot id' using errcode='22023'; end if;
   kept:=array_append(kept,shot_id);
  end if;
 end loop;
 delete from public.scene_shots where scene_id=p_scene_id and not(id=any(kept));
 for item in select value from jsonb_array_elements(p_shots) loop
  n:=n+1;
  if item->>'id' is null then
   insert into public.scene_shots(scene_id,script_version_id,position,narration_excerpt,action,visual_prompt,duration_seconds,source)
   values(p_scene_id,p_version_id,n,btrim(item->>'narration_excerpt'),btrim(item->>'action'),btrim(item->>'visual_prompt'),(item->>'duration_seconds')::integer,item->>'source');
  else
   update public.scene_shots set position=n,narration_excerpt=btrim(item->>'narration_excerpt'),action=btrim(item->>'action'),visual_prompt=btrim(item->>'visual_prompt'),duration_seconds=(item->>'duration_seconds')::integer,source=item->>'source'
   where id=(item->>'id')::uuid and scene_id=p_scene_id;
  end if;
 end loop;
 insert into public.scene_shot_plans(scene_id,script_version_id,narration_snapshot) values(p_scene_id,p_version_id,scene_text)
 on conflict(scene_id) do update set narration_snapshot=excluded.narration_snapshot;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.position),'[]') into result from public.scene_shots s where scene_id=p_scene_id;
 return result;
end;
$$;
revoke all on function public.save_scene_shots(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.save_scene_shots(uuid,uuid,jsonb,text) to authenticated;
commit;
