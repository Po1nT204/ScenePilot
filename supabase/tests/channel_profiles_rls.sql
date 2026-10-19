-- HISTORICAL: before 202610190001 only. After it use multiple_channel_profiles_rls.sql.
-- Replace with two existing TEST accounts. Run after 202610150002_channel_profile_limits.sql.
-- Existing test-account profile edits below are rolled back with all other changes.
begin;
select set_config('test.user_a','REPLACE_WITH_USER_A_UUID',true);
select set_config('test.user_b','REPLACE_WITH_USER_B_UUID',true);
do $$ begin
 if current_setting('test.user_a') = current_setting('test.user_b') then raise exception 'Use different users'; end if;
 if not exists(select 1 from auth.users where id=current_setting('test.user_a')::uuid)
 or not exists(select 1 from auth.users where id=current_setting('test.user_b')::uuid) then raise exception 'Both test users must exist'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
insert into public.channel_profiles(owner_id,name,audience,topics,tone,format,avoid,language)
values(current_setting('test.user_a')::uuid,'Test channel','Beginners','Inventions','Calm','Explainer','Hype','en')
on conflict(owner_id) do update set name='Test channel',audience='Beginners',topics='Inventions',tone='Calm',format='Explainer',avoid='Hype',language='en';
with inserted as (
 insert into public.projects(owner_id,title,topic,genre,style,language,target_duration_seconds,brief_source)
 values(current_setting('test.user_a')::uuid,'Channel test','Idea','Explainer','Calm','en',60,'test') returning id
) select set_config('test.project_id',id::text,true) from inserted;
select set_config('test.version_id',public.save_script_version(current_setting('test.project_id')::uuid,'First script','manual')::text,true);
update public.channel_profiles set tone='New tone' where owner_id=current_setting('test.user_a')::uuid;
select public.save_script_version(current_setting('test.project_id')::uuid,'Second script','manual');
do $$ begin
 if not exists(select 1 from public.projects where id=current_setting('test.project_id')::uuid and channel_snapshot->>'tone'='Calm' and brief_source='test') then raise exception 'Project snapshot changed or missing'; end if;
 if (select count(*) from public.script_versions where project_id=current_setting('test.project_id')::uuid and settings_snapshot->'channel'->>'tone'='Calm' and settings_snapshot->>'brief_source'='test') <> 2 then raise exception 'Version snapshot mismatch'; end if;
 if exists(select 1 from public.projects where id=current_setting('test.project_id')::uuid and (channel_snapshot ? 'owner_id' or channel_snapshot ? 'updated_at')) then raise exception 'Private metadata in snapshot'; end if;
 begin
  update public.channel_profiles set owner_id=current_setting('test.user_b')::uuid where owner_id=current_setting('test.user_a')::uuid;
  raise exception 'Owner update allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.projects set channel_snapshot='{}' where id=current_setting('test.project_id')::uuid;
  raise exception 'Snapshot update allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.projects(owner_id,title,topic,genre,style,language,target_duration_seconds,channel_snapshot)
  values(current_setting('test.user_a')::uuid,'Forged','x','x','x','en',60,'{}');
  raise exception 'Snapshot injection allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.channel_profiles set audience='' where owner_id=current_setting('test.user_a')::uuid;
  raise exception 'Invalid profile allowed';
 exception when check_violation then null; end;
 begin
  perform public.save_script_version_internal(current_setting('test.project_id')::uuid,'Bypass');
  raise exception 'Internal version writer exposed';
 exception when insufficient_privilege then null; end;
end $$;
with inserted as (
 insert into public.projects(owner_id,title,topic,genre,style,language,target_duration_seconds)
 values(current_setting('test.user_a')::uuid,'New profile test','Idea','Explainer','Calm','en',60) returning id,channel_snapshot
) select set_config('test.new_tone',channel_snapshot->>'tone',true) from inserted;
do $$ begin
 if current_setting('test.new_tone') <> 'New tone' then raise exception 'New project did not capture changed profile'; end if;
end $$;
-- Regression: expanded fields accept 1000 characters, but still reject 1001.
update public.channel_profiles set tone=repeat('t',1000),format=repeat('f',1000),avoid=repeat('a',1000)
where owner_id=current_setting('test.user_a')::uuid;
do $$ declare field_name text; begin
 if not exists(select 1 from public.channel_profiles where owner_id=current_setting('test.user_a')::uuid
  and char_length(tone)=1000 and char_length(format)=1000 and char_length(avoid)=1000) then
  raise exception 'Expanded profile was not saved';
 end if;
 foreach field_name in array array['tone','format','avoid'] loop
  begin
   execute format('update public.channel_profiles set %I = $1 where owner_id = $2',field_name)
    using repeat('x',1001),current_setting('test.user_a')::uuid;
   raise exception 'Oversized profile field allowed: %',field_name;
  exception when check_violation then null; end;
 end loop;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_b'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare affected integer; begin
 if exists(select 1 from public.channel_profiles where owner_id=current_setting('test.user_a')::uuid) then raise exception 'Foreign profile read allowed'; end if;
 if exists(select 1 from public.projects where id=current_setting('test.project_id')::uuid) then raise exception 'Foreign snapshot read allowed'; end if;
 update public.channel_profiles set tone='Foreign' where owner_id=current_setting('test.user_a')::uuid;
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Foreign profile update allowed'; end if;
 delete from public.channel_profiles where owner_id=current_setting('test.user_a')::uuid;
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Foreign profile delete allowed'; end if;
 begin
  insert into public.channel_profiles(owner_id,name,audience,topics,tone,format,avoid,language)
  values(current_setting('test.user_a')::uuid,'Forged','x','x','x','x','','en');
  raise exception 'Foreign profile insert allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
 begin
  perform 1 from public.channel_profiles;
  raise exception 'Anonymous profile read allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.channel_profiles(owner_id,name,audience,topics,tone,format,avoid,language)
  values(current_setting('test.user_a')::uuid,'Anon','x','x','x','x','','en');
  raise exception 'Anonymous profile insert allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'Channel profile checks passed; test changes rolled back' as result;
