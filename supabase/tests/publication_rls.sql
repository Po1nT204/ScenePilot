-- Run after 202610150004_publication_materials.sql with two existing TEST accounts.
-- No model requests. Temporary rows are rolled back.
begin;
select set_config('test.user_a','REPLACE_WITH_USER_A_UUID',true);
select set_config('test.user_b','REPLACE_WITH_USER_B_UUID',true);
do $$ begin
 if current_setting('test.user_a')=current_setting('test.user_b') then raise exception 'Use different users'; end if;
 if not exists(select 1 from auth.users where id=current_setting('test.user_a')::uuid)
 or not exists(select 1 from auth.users where id=current_setting('test.user_b')::uuid) then raise exception 'Users must exist'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
with inserted as (
 insert into public.projects(owner_id,title,topic,genre,style,language,target_duration_seconds)
 values(current_setting('test.user_a')::uuid,'Publication test','Topic','Essay','Calm','en',60) returning id
) select set_config('test.project_id',id::text,true) from inserted;
select set_config('test.version_a',public.save_script_version(current_setting('test.project_id')::uuid,'First saved script','manual')::text,true);
select set_config('test.version_b',public.save_script_version(current_setting('test.project_id')::uuid,'Second saved script','manual')::text,true);
select set_config('test.snapshot',(select settings_snapshot::text from public.script_versions where id=current_setting('test.version_a')::uuid),true);
select public.save_publication_materials(current_setting('test.version_a')::uuid,
 '{"title":"Manual title","titles":[],"description":"Manual description","source":"manual","script_version_id":"forged","owner_id":"forged"}');
do $$ begin
 if not exists(select 1 from public.publication_materials where script_version_id=current_setting('test.version_a')::uuid and title='Manual title' and source='manual') then raise exception 'Owner save/read failed'; end if;
 if exists(select 1 from public.publication_materials where script_version_id=current_setting('test.version_b')::uuid) then raise exception 'Materials leaked to another version'; end if;
end $$;
select public.save_publication_materials(current_setting('test.version_a')::uuid,
 '{"title":"Selected title","titles":["First","Second","Third"],"description":"Saved description","source":"yandex"}');
select public.save_publication_materials(current_setting('test.version_b')::uuid,
 '{"title":"Version B","titles":[],"description":"Keep B","source":"test"}');
do $$ declare bad jsonb; begin
 for bad in select value from jsonb_array_elements('[
  null,[],{},
  {"title":" ","titles":[],"description":"x","source":"manual"},
  {"title":"x","titles":[],"description":" ","source":"manual"},
  {"title":"x","titles":[],"description":"x","source":"invalid"},
  {"title":"x","titles":[],"description":"x","source":null},
  {"title":"x","titles":[],"description":"x"},
  {"title":"x","titles":{},"description":"x","source":"manual"},
  {"title":"x","titles":[null],"description":"x","source":"manual"},
  {"title":"x","titles":[" "],"description":"x","source":"manual"},
  {"title":"x","titles":["a","b","c","d"],"description":"x","source":"manual"}
 ]'::jsonb) loop
  begin
   perform public.save_publication_materials(current_setting('test.version_a')::uuid,bad);
   raise exception 'Invalid material accepted';
  exception when invalid_parameter_value then null; end;
 end loop;
 begin
  perform public.save_publication_materials(current_setting('test.version_a')::uuid,jsonb_build_object('title',repeat('x',101),'titles','[]'::jsonb,'description','x','source','manual'));
  raise exception 'Oversized title accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.save_publication_materials(current_setting('test.version_a')::uuid,jsonb_build_object('title','x','titles','[]'::jsonb,'description',repeat('x',5001),'source','manual'));
  raise exception 'Oversized description accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.save_publication_materials(current_setting('test.version_a')::uuid,jsonb_build_object('title','x','titles',jsonb_build_array(repeat('x',101)),'description','x','source','manual'));
  raise exception 'Oversized variant accepted';
 exception when invalid_parameter_value then null; end;
 if not exists(select 1 from public.publication_materials where script_version_id=current_setting('test.version_a')::uuid and title='Selected title' and description='Saved description' and source='yandex' and titles='["First","Second","Third"]') then raise exception 'Failed write damaged materials'; end if;
 if not exists(select 1 from public.publication_materials where script_version_id=current_setting('test.version_b')::uuid and description='Keep B') then raise exception 'Other version changed'; end if;
 if not exists(select 1 from public.script_versions where id=current_setting('test.version_a')::uuid and content='First saved script' and settings_snapshot=current_setting('test.snapshot')::jsonb) then raise exception 'Script/snapshot changed'; end if;
 begin
  insert into public.publication_materials(script_version_id,title,titles,description,source) values(current_setting('test.version_a')::uuid,'x','[]','x','manual');
  raise exception 'Direct insert allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.publication_materials set title='Bypass' where script_version_id=current_setting('test.version_a')::uuid;
  raise exception 'Direct update allowed';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.publication_materials where script_version_id=current_setting('test.version_a')::uuid;
  raise exception 'Direct delete allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_b'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.publication_materials where script_version_id=current_setting('test.version_a')::uuid) then raise exception 'Foreign read allowed'; end if;
 begin
  perform public.save_publication_materials(current_setting('test.version_a')::uuid,'{"title":"Foreign","titles":[],"description":"x","source":"manual"}');
  raise exception 'Foreign write allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
 begin
  perform 1 from public.publication_materials;
  raise exception 'Anonymous read allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.save_publication_materials(current_setting('test.version_a')::uuid,'{}');
  raise exception 'Anonymous write allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
delete from public.projects where id=current_setting('test.project_id')::uuid;
reset role;
do $$ begin
 if exists(select 1 from public.publication_materials where script_version_id in (current_setting('test.version_a')::uuid,current_setting('test.version_b')::uuid)) then raise exception 'Cascade failed'; end if;
end $$;
rollback;
select 'Publication checks passed; test changes rolled back' as result;
