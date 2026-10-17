-- After both 20261016 migrations. Use two existing TEST accounts. Entire transaction rolls back.
begin;
select set_config('test.user_a','REPLACE_WITH_USER_A_UUID',true);
select set_config('test.user_b','REPLACE_WITH_USER_B_UUID',true);
do $$ begin
 if current_setting('test.user_a')=current_setting('test.user_b') then raise exception 'Use different users'; end if;
 if not exists(select 1 from auth.users where id=current_setting('test.user_a')::uuid) or not exists(select 1 from auth.users where id=current_setting('test.user_b')::uuid) then raise exception 'Users must exist'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
with inserted as (
 insert into public.projects(owner_id,title,topic,genre,style,language,target_duration_seconds)
 values(current_setting('test.user_a')::uuid,'Shots test','Test','Story','Calm','en',600) returning id
) select set_config('test.project',id::text,true) from inserted;
select set_config('test.old',public.save_script_version(current_setting('test.project')::uuid,'Old text','manual')::text,true);
select set_config('test.version',public.save_script_version_with_pace(current_setting('test.project')::uuid,'New text','manual',160)::text,true);
select public.save_scene_edits(current_setting('test.version')::uuid,'[{"description":"A","visual_prompt":"A","narration":"First. Second.","source":"manual"},{"description":"B","visual_prompt":"B","narration":"Other.","source":"test"}]');
select set_config('test.scene',id::text,true) from public.scenes where script_version_id=current_setting('test.version')::uuid and position=1;
select public.save_scene_shots(current_setting('test.version')::uuid,current_setting('test.scene')::uuid,'[{"narration_excerpt":"First.","action":"A","visual_prompt":"A","duration_seconds":3,"source":"manual"},{"narration_excerpt":"Second.","action":"B","visual_prompt":"B","duration_seconds":4,"source":"manual"}]','First. Second.');
select set_config('test.shot',id::text,true) from public.scene_shots where scene_id=current_setting('test.scene')::uuid and position=1;
do $$ declare payload jsonb; item jsonb; before_set jsonb; begin
 if exists(select 1 from public.script_versions where id=current_setting('test.old')::uuid and settings_snapshot ? 'narration_pace') then raise exception 'Old snapshot rewritten'; end if;
 if not exists(select 1 from public.script_versions where id=current_setting('test.version')::uuid and settings_snapshot->>'narration_pace'='160') then raise exception 'Pace missing'; end if;
 begin
  perform public.save_script_version_with_pace(current_setting('test.project')::uuid,'Bad pace','manual',79);
  raise exception 'Bad pace accepted';
 exception when invalid_parameter_value then null; end;
 -- Reordering episodes must preserve ids, sources and their shots.
 select jsonb_agg(to_jsonb(s) order by position desc) into payload from public.scenes s where script_version_id=current_setting('test.version')::uuid;
 perform public.save_scene_edits_with_ids(current_setting('test.version')::uuid,payload);
 set constraints all immediate;
 set constraints all deferred;
 if not exists(select 1 from public.scenes where id=current_setting('test.scene')::uuid and position=2) or not exists(select 1 from public.scene_shots where id=current_setting('test.shot')::uuid) then raise exception 'Scene reorder lost identity or shots'; end if;
 select jsonb_agg(to_jsonb(s) order by position desc) into payload from public.scene_shots s where scene_id=current_setting('test.scene')::uuid;
 perform public.save_scene_shots(current_setting('test.version')::uuid,current_setting('test.scene')::uuid,payload,'First. Second.');
 set constraints all immediate;
 set constraints all deferred;
 if not exists(select 1 from public.scene_shots where id=current_setting('test.shot')::uuid and position=2) then raise exception 'Shot reorder lost identity'; end if;
 select jsonb_agg(to_jsonb(s) order by position) into before_set from public.scene_shots s where scene_id=current_setting('test.scene')::uuid;
 item := before_set->0;
 for payload in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_build_array(item || '{"duration_seconds":0}'),jsonb_build_array(item || '{"duration_seconds":1.5}'),
  jsonb_build_array(item || '{"action":""}'),jsonb_build_array(item,item),
  jsonb_build_array(item || jsonb_build_object('id',gen_random_uuid())),
  jsonb_build_array(item || jsonb_build_object('visual_prompt',repeat('x',2001)))
 )) loop
  begin
   perform public.save_scene_shots(current_setting('test.version')::uuid,current_setting('test.scene')::uuid,payload,'First. Second.');
   raise exception 'Invalid shot accepted';
  exception when invalid_parameter_value then null; end;
 end loop;
 if (select jsonb_agg(to_jsonb(s) order by position) from public.scene_shots s where scene_id=current_setting('test.scene')::uuid) is distinct from before_set then raise exception 'Failed save damaged shots'; end if;
 begin
  perform public.save_scene_shots(current_setting('test.old')::uuid,current_setting('test.scene')::uuid,'[]','First. Second.');
  raise exception 'Cross version write accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.save_scene_shots(current_setting('test.version')::uuid,current_setting('test.scene')::uuid,'[]','Outdated text');
  raise exception 'Stale save accepted';
 exception when invalid_parameter_value then null; end;
 -- All legacy replacement entry points, including empty edits, must refuse shot loss.
 begin
  perform public.save_scene_edits(current_setting('test.version')::uuid,'[]'); raise exception 'Legacy empty edit deleted shots';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.save_test_scenes(current_setting('test.version')::uuid,'[{"description":"x","visual_prompt":"x","narration":"x"}]'); raise exception 'Legacy test writer deleted shots';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.save_scenes(current_setting('test.version')::uuid,'[{"description":"x","visual_prompt":"x","narration":"x"}]','yandex'); raise exception 'Legacy Yandex writer deleted shots';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.save_scene_edits_with_ids(current_setting('test.version')::uuid,'[]',array[null]::uuid[]); raise exception 'Null confirmation bypass';
 exception when invalid_parameter_value then null; end;
 begin
  update public.scene_shots set duration_seconds=9; raise exception 'Direct update allowed';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.scene_shot_plans; raise exception 'Direct plan delete allowed';
 exception when insufficient_privilege then null; end;
 -- Changed narration keeps the historical plan snapshot; UI can flag it as stale.
 select jsonb_agg(to_jsonb(s)||jsonb_build_object('narration','Changed.') order by position) into payload from public.scenes s where script_version_id=current_setting('test.version')::uuid;
 perform public.save_scene_edits_with_ids(current_setting('test.version')::uuid,payload);
 if not exists(select 1 from public.scene_shot_plans where scene_id=current_setting('test.scene')::uuid and narration_snapshot='First. Second.') then raise exception 'Plan snapshot overwritten'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_b'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.scene_shots where scene_id=current_setting('test.scene')::uuid) or exists(select 1 from public.scene_shot_plans where scene_id=current_setting('test.scene')::uuid) then raise exception 'Foreign read allowed'; end if;
 begin
  perform public.save_scene_shots(current_setting('test.version')::uuid,current_setting('test.scene')::uuid,'[]','Changed.'); raise exception 'Foreign shot write allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.save_scene_edits_with_ids(current_setting('test.version')::uuid,'[]',array[current_setting('test.scene')::uuid]); raise exception 'Foreign scene write allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.save_script_version_with_pace(current_setting('test.project')::uuid,'Foreign','manual',140); raise exception 'Foreign pace write allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$ begin
 begin
  perform public.save_scene_shots(current_setting('test.version')::uuid,current_setting('test.scene')::uuid,'[]','Changed.'); raise exception 'Anonymous write allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
select public.save_scene_edits_with_ids(current_setting('test.version')::uuid,'[]',array[current_setting('test.scene')::uuid]);
do $$ begin
 if exists(select 1 from public.scene_shots where script_version_id=current_setting('test.version')::uuid) or exists(select 1 from public.scene_shot_plans where script_version_id=current_setting('test.version')::uuid) then raise exception 'Confirmed deletion did not cascade'; end if;
 if not exists(select 1 from public.script_versions where id=current_setting('test.old')::uuid and content='Old text') then raise exception 'Old version changed'; end if;
end $$;
set constraints all immediate;
reset role;
rollback;
select 'Shot and pace checks passed; test changes rolled back' as result;
