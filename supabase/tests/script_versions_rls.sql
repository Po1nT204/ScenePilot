-- Replace with two existing TEST user IDs. Run the entire file after both migrations.
begin;
select set_config('test.user_a', 'REPLACE_WITH_USER_A_UUID', true);
select set_config('test.user_b', 'REPLACE_WITH_USER_B_UUID', true);
do $$ begin
 if current_setting('test.user_a') = current_setting('test.user_b') then raise exception 'Use different users'; end if;
 if not exists(select 1 from auth.users where id = current_setting('test.user_a')::uuid)
 or not exists(select 1 from auth.users where id = current_setting('test.user_b')::uuid)
 then raise exception 'Both test users must exist'; end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
with inserted as (
 insert into public.projects(owner_id,title,topic,genre,language,style,target_duration_seconds)
 values(current_setting('test.user_a')::uuid,'Version test','Original topic','test','ru','test',60) returning id
) select set_config('test.project_id',id::text,true) from inserted;
select set_config('test.version_id',public.save_script_version(current_setting('test.project_id')::uuid,'First script')::text,true);
update public.projects set topic = 'New topic' where id = current_setting('test.project_id')::uuid;
select public.save_script_version(current_setting('test.project_id')::uuid,'Second script');
do $$ begin
 if not exists(select 1 from public.script_versions where id = current_setting('test.version_id')::uuid and source='manual') then raise exception 'Default source incorrect'; end if;
 begin
  perform public.save_script_version_internal(current_setting('test.project_id')::uuid,'Bypass');
  raise exception 'Internal function exposed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.save_script_version(current_setting('test.project_id')::uuid,'Bad source','invalid');
  raise exception 'Invalid source accepted';
 exception when invalid_parameter_value then null; end;
 if not exists(select 1 from public.script_versions where id = current_setting('test.version_id')::uuid
 and version_number = 1 and content = 'First script' and settings_snapshot->>'topic' = 'Original topic') then raise exception 'First version changed'; end if;
 if not exists(select 1 from public.script_versions where project_id = current_setting('test.project_id')::uuid
 and version_number = 2 and settings_snapshot->>'topic' = 'New topic') then raise exception 'Second snapshot incorrect'; end if;
 begin
  perform public.save_script_version(current_setting('test.project_id')::uuid,'');
  raise exception 'Empty script allowed';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.save_script_version(current_setting('test.project_id')::uuid,repeat('x',20001));
  raise exception 'Oversized script allowed';
 exception when invalid_parameter_value then null; end;
 begin
  update public.script_versions set content = 'changed' where id = current_setting('test.version_id')::uuid;
  raise exception 'Version update allowed';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.script_versions where id = current_setting('test.version_id')::uuid;
  raise exception 'Version delete allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.script_versions(project_id,version_number,content,settings_snapshot)
  values(current_setting('test.project_id')::uuid,99,'forged','{}');
  raise exception 'Direct insert allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_b'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.script_versions where project_id = current_setting('test.project_id')::uuid) then raise exception 'Foreign read allowed'; end if;
 begin
  perform public.save_script_version(current_setting('test.project_id')::uuid,'Foreign script');
  raise exception 'Foreign save allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
 begin
  perform 1 from public.script_versions;
  raise exception 'Anonymous read allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.save_script_version(current_setting('test.project_id')::uuid,'Anonymous script');
  raise exception 'Anonymous save allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
delete from public.projects where id = current_setting('test.project_id')::uuid;
reset role;
do $$ begin
 if exists(select 1 from public.script_versions where project_id = current_setting('test.project_id')::uuid) then raise exception 'Cascade deletion failed'; end if;
end $$;
rollback;
select 'Script version checks passed; test changes rolled back' as result;
