-- Replace UUIDs with two existing TEST accounts; run whole file. Changes roll back.
-- Requires 202610150003_scene_editing.sql, including manual/mixed/empty sets.
begin;
select set_config('test.user_a','REPLACE_WITH_USER_A_UUID',true);
select set_config('test.user_b','REPLACE_WITH_USER_B_UUID',true);
do $$ begin
 if current_setting('test.user_a') = current_setting('test.user_b') then raise exception 'Use different users'; end if;
 if not exists(select 1 from auth.users where id=current_setting('test.user_a')::uuid)
 or not exists(select 1 from auth.users where id=current_setting('test.user_b')::uuid) then raise exception 'Users must exist'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
with inserted as (
 insert into public.projects(owner_id,title,topic,genre,language,style,target_duration_seconds)
 values(current_setting('test.user_a')::uuid,'Scene test','test','test','ru','test',60) returning id
) select set_config('test.project_id',id::text,true) from inserted;
select set_config('test.version_id',public.save_script_version(current_setting('test.project_id')::uuid,'First version')::text,true);
select set_config('test.version_2',public.save_script_version(current_setting('test.project_id')::uuid,'Second version')::text,true);
select public.save_scenes(current_setting('test.version_id')::uuid,'[{"description":"Frame","visual_prompt":"Prompt","narration":"Speech"}]','yandex');
do $$ begin
 begin
  perform public.save_scenes(current_setting('test.version_id')::uuid,'[]','invalid');
  raise exception 'Invalid source accepted';
 exception when invalid_parameter_value then null; end;
 if (select count(*) from public.scenes where script_version_id=current_setting('test.version_id')::uuid) <> 1 then raise exception 'Owner read failed'; end if;
 if exists(select 1 from public.scenes where script_version_id=current_setting('test.version_2')::uuid) then raise exception 'Scenes leaked to new version'; end if;
 begin
  perform public.save_scenes(current_setting('test.version_id')::uuid,'[{"description":"New","visual_prompt":"New","narration":"New"},{"description":"Bad"}]','yandex');
  raise exception 'Invalid set accepted';
 exception when invalid_parameter_value then null; end;
 if not exists(select 1 from public.scenes where script_version_id=current_setting('test.version_id')::uuid and narration='Speech') then raise exception 'Failed save damaged old set'; end if;
 begin
  update public.scenes set source='test' where script_version_id=current_setting('test.version_id')::uuid;
  raise exception 'Direct update allowed';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.scenes where script_version_id=current_setting('test.version_id')::uuid;
  raise exception 'Direct delete allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.scenes(script_version_id,position,description,visual_prompt,narration)
  values(current_setting('test.version_id')::uuid,2,'x','x','x');
  raise exception 'Direct insert allowed';
 exception when insufficient_privilege then null; end;
end $$;
-- Per-scene sources, ignored forged positions/IDs, and exact saved order.
select public.save_scene_edits(current_setting('test.version_id')::uuid,'[
 {"description":"Manual","visual_prompt":"M","narration":"Manual narration","source":"manual","position":99,"script_version_id":"forged"},
 {"description":"Generated","visual_prompt":"G","narration":"Generated narration","source":"yandex"},
 {"description":"Template","visual_prompt":"T","narration":"Template narration","source":"test"}
]');
select public.save_scene_edits(current_setting('test.version_2')::uuid,'[{"description":"Other version","visual_prompt":"P","narration":"Keep","source":"manual"}]');
do $$ declare invalid_payload jsonb; begin
 if (select array_agg(source order by position) from public.scenes where script_version_id=current_setting('test.version_id')::uuid)
  is distinct from array['manual','yandex','test'] then raise exception 'Mixed sources lost'; end if;
 if (select array_agg(position order by position) from public.scenes where script_version_id=current_setting('test.version_id')::uuid)
  is distinct from array[1,2,3] then raise exception 'Invalid positions'; end if;
 for invalid_payload in select value from jsonb_array_elements('[
  null,{},[null],
  [{"description":"x","visual_prompt":"x","narration":"x","source":"unknown"}],
  [{"description":"x","visual_prompt":"x","narration":"x","source":null}],
  [{"description":"x","visual_prompt":"x","narration":"x"}],
  [{"description":"x","visual_prompt":"x","narration":" ","source":"manual"}]
 ]'::jsonb) loop
  begin
   perform public.save_scene_edits(current_setting('test.version_id')::uuid,invalid_payload);
   raise exception 'Invalid edit accepted';
  exception when invalid_parameter_value then null; end;
 end loop;
 begin
  perform public.save_scene_edits(current_setting('test.version_id')::uuid,
   (select jsonb_agg(jsonb_build_object('description','x','visual_prompt','x','narration','x','source','manual')) from generate_series(1,13)));
  raise exception 'Thirteen scenes accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.save_scene_edits(current_setting('test.version_id')::uuid,
   jsonb_build_array(jsonb_build_object('description',repeat('x',2001),'visual_prompt','x','narration','x','source','manual')));
  raise exception 'Oversized field accepted';
 exception when invalid_parameter_value then null; end;
 if (select count(*) from public.scenes where script_version_id=current_setting('test.version_id')::uuid) <> 3 then raise exception 'Invalid edit damaged saved set'; end if;
end $$;
-- Delete middle scene and move template first in one save; positions become 1,2.
select public.save_scene_edits(current_setting('test.version_id')::uuid,'[
 {"description":"Template","visual_prompt":"T","narration":"Template narration","source":"test"},
 {"description":"Manual","visual_prompt":"M","narration":"Manual narration","source":"manual"}
]');
do $$ begin
 if (select array_agg(narration order by position) from public.scenes where script_version_id=current_setting('test.version_id')::uuid)
  is distinct from array['Template narration','Manual narration'] then raise exception 'Reorder failed'; end if;
 if (select array_agg(position order by position) from public.scenes where script_version_id=current_setting('test.version_id')::uuid)
  is distinct from array[1,2] then raise exception 'Positions not contiguous'; end if;
end $$;
select public.save_scene_edits(current_setting('test.version_id')::uuid,'[]');
do $$ begin
 if exists(select 1 from public.scenes where script_version_id=current_setting('test.version_id')::uuid) then raise exception 'Empty set did not clear scenes'; end if;
 if not exists(select 1 from public.scenes where script_version_id=current_setting('test.version_2')::uuid and narration='Keep') then raise exception 'Other version modified'; end if;
 if not exists(select 1 from public.script_versions where id=current_setting('test.version_id')::uuid and content='First version') then raise exception 'Script modified'; end if;
end $$;
-- Legacy save API still works after the new migration.
select public.save_scenes(current_setting('test.version_id')::uuid,'[{"description":"Edited","visual_prompt":"Edited","narration":"Edited"}]','yandex');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_b'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.scenes where script_version_id=current_setting('test.version_id')::uuid) then raise exception 'Foreign read allowed'; end if;
 begin
  perform public.save_scenes(current_setting('test.version_id')::uuid,'[{"description":"x","visual_prompt":"x","narration":"x"}]','yandex');
  raise exception 'Foreign write allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.save_scene_edits(current_setting('test.version_id')::uuid,'[{"description":"x","visual_prompt":"x","narration":"x","source":"manual"}]');
  raise exception 'Foreign manual write allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.save_scene_edits(current_setting('test.version_id')::uuid,'[]');
  raise exception 'Foreign clear allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
 begin
  perform 1 from public.scenes;
  raise exception 'Anonymous read allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.save_scenes(current_setting('test.version_id')::uuid,'[]','yandex');
  raise exception 'Anonymous call allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.save_scene_edits(current_setting('test.version_id')::uuid,'[]');
  raise exception 'Anonymous edit allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if not exists(select 1 from public.scenes where script_version_id=current_setting('test.version_id')::uuid and narration='Edited' and source='yandex') then raise exception 'Saved set incorrect'; end if;
end $$;
delete from public.projects where id=current_setting('test.project_id')::uuid;
reset role;
do $$ begin
 if exists(select 1 from public.scenes where script_version_id=current_setting('test.version_id')::uuid) then raise exception 'Cascade failed'; end if;
end $$;
rollback;
select 'Scene checks passed; test changes rolled back' as result;
