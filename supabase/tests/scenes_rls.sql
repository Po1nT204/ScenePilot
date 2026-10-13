-- Replace UUIDs with two existing TEST accounts; run whole file. Changes roll back.
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
select public.save_test_scenes(current_setting('test.version_id')::uuid,'[{"description":"Frame","visual_prompt":"Prompt","narration":"Speech"}]');
do $$ begin
 if (select count(*) from public.scenes where script_version_id=current_setting('test.version_id')::uuid) <> 1 then raise exception 'Owner read failed'; end if;
 if exists(select 1 from public.scenes where script_version_id=current_setting('test.version_2')::uuid) then raise exception 'Scenes leaked to new version'; end if;
 begin
  perform public.save_test_scenes(current_setting('test.version_id')::uuid,'[{"description":"New","visual_prompt":"New","narration":"New"},{"description":"Bad"}]');
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
select public.save_test_scenes(current_setting('test.version_id')::uuid,'[{"description":"Edited","visual_prompt":"Edited","narration":"Edited"}]');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_b'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.scenes where script_version_id=current_setting('test.version_id')::uuid) then raise exception 'Foreign read allowed'; end if;
 begin
  perform public.save_test_scenes(current_setting('test.version_id')::uuid,'[{"description":"x","visual_prompt":"x","narration":"x"}]');
  raise exception 'Foreign write allowed';
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
  perform public.save_test_scenes(current_setting('test.version_id')::uuid,'[]');
  raise exception 'Anonymous call allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if not exists(select 1 from public.scenes where script_version_id=current_setting('test.version_id')::uuid and narration='Edited' and source='test') then raise exception 'Saved set incorrect'; end if;
end $$;
delete from public.projects where id=current_setting('test.project_id')::uuid;
reset role;
do $$ begin
 if exists(select 1 from public.scenes where script_version_id=current_setting('test.version_id')::uuid) then raise exception 'Cascade failed'; end if;
end $$;
rollback;
select 'Scene checks passed; test changes rolled back' as result;
