-- Run after 202610190001_multiple_channel_profiles.sql, with TWO existing test users.
-- All changes roll back. This replaces channel_profiles_rls.sql for the latest schema.
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
with inserted as (
 insert into public.channel_profiles(owner_id,name,audience,topics,tone,format,avoid,language)
 values(auth.uid(),'Profile A','Beginners','History','Calm','Explainer','','ru') returning id
) select set_config('test.profile_a',id::text,true) from inserted;
with inserted as (
 insert into public.channel_profiles(owner_id,name,audience,topics,tone,format,avoid,language)
 values(auth.uid(),'Profile B','Experts','Space','Energetic','Essay','','en') returning id
) select set_config('test.profile_b',id::text,true) from inserted;
with inserted as (
 insert into public.projects(owner_id,title,topic,genre,style,language,target_duration_seconds,channel_profile_id,channel_profile_revision)
 select auth.uid(),'Selected A','History','Explainer','Calm','ru',60,id,updated_at from public.channel_profiles where id=current_setting('test.profile_a')::uuid returning id
) select set_config('test.project_a',id::text,true) from inserted;
with inserted as (
 insert into public.projects(owner_id,title,topic,genre,style,language,target_duration_seconds,channel_profile_id,channel_profile_revision)
 select auth.uid(),'Selected B','Space','Essay','Energetic','en',60,id,updated_at from public.channel_profiles where id=current_setting('test.profile_b')::uuid returning id
) select set_config('test.project_b',id::text,true) from inserted;
select public.save_script_version(current_setting('test.project_a')::uuid,'First script','manual');
update public.channel_profiles set tone='Changed' where id=current_setting('test.profile_a')::uuid;
select public.save_script_version(current_setting('test.project_a')::uuid,'Second script','manual');
do $$ declare none_snapshot jsonb; begin
 if (select count(*) from public.channel_profiles where id in (current_setting('test.profile_a')::uuid,current_setting('test.profile_b')::uuid)) <> 2 then raise exception 'Multiple profiles missing'; end if;
 if not exists(select 1 from public.projects where id=current_setting('test.project_a')::uuid and channel_snapshot->>'tone'='Calm') then raise exception 'Original snapshot changed'; end if;
 if not exists(select 1 from public.projects where id=current_setting('test.project_b')::uuid and channel_snapshot->>'tone'='Energetic') then raise exception 'Wrong profile captured'; end if;
 if (select count(*) from public.script_versions where project_id=current_setting('test.project_a')::uuid and settings_snapshot->'channel'->>'tone'='Calm') <> 2 then raise exception 'Version snapshots changed'; end if;
 if exists(select 1 from public.projects where id=current_setting('test.project_a')::uuid and (channel_snapshot ? 'id' or channel_snapshot ? 'owner_id' or channel_snapshot ? 'updated_at')) then raise exception 'Metadata leaked'; end if;
 insert into public.projects(owner_id,title,topic,genre,style,language,target_duration_seconds)
 values(auth.uid(),'No profile','x','x','x','ru',60) returning channel_snapshot into none_snapshot;
 if none_snapshot is not null then raise exception 'No-profile selection ignored'; end if;
 begin
  insert into public.projects(owner_id,title,topic,genre,style,language,target_duration_seconds,channel_profile_id,channel_profile_revision)
  values(auth.uid(),'Stale','x','x','x','ru',60,current_setting('test.profile_a')::uuid,'2000-01-01');
  raise exception 'Stale profile accepted';
 exception when serialization_failure then null; end;
 begin
  update public.channel_profiles set owner_id=current_setting('test.user_b')::uuid where id=current_setting('test.profile_a')::uuid;
  raise exception 'Owner changed';
 exception when insufficient_privilege then null; end;
 begin
  update public.channel_profiles set id=gen_random_uuid() where id=current_setting('test.profile_a')::uuid;
  raise exception 'Identity changed';
 exception when insufficient_privilege then null; end;
 begin
  update public.projects set channel_profile_id=current_setting('test.profile_b')::uuid where id=current_setting('test.project_a')::uuid;
  raise exception 'Project profile switched after creation';
 exception when insufficient_privilege then null; end;
 begin
  update public.projects set channel_snapshot='{}' where id=current_setting('test.project_a')::uuid;
  raise exception 'Snapshot modified';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.projects(owner_id,title,topic,genre,style,language,target_duration_seconds,channel_snapshot)
  values(auth.uid(),'Forged','x','x','x','ru',60,'{}');
  raise exception 'Snapshot injected';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_b'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare affected integer; begin
 if exists(select 1 from public.channel_profiles where owner_id=current_setting('test.user_a')::uuid) then raise exception 'Foreign profile visible'; end if;
 update public.channel_profiles set tone='Foreign' where id=current_setting('test.profile_a')::uuid;
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Foreign profile updated'; end if;
 delete from public.channel_profiles where id=current_setting('test.profile_a')::uuid;
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Foreign profile deleted'; end if;
 begin
  insert into public.projects(owner_id,title,topic,genre,style,language,target_duration_seconds,channel_profile_id,channel_profile_revision)
  values(auth.uid(),'Foreign','x','x','x','ru',60,current_setting('test.profile_a')::uuid,now());
  raise exception 'Foreign profile captured';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.channel_profiles(owner_id,name,audience,topics,tone,format,avoid,language)
  values(current_setting('test.user_a')::uuid,'Forged','x','x','x','x','','en');
  raise exception 'Foreign profile created';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
 begin
  perform 1 from public.channel_profiles;
  raise exception 'Anonymous read allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'Multiple profile checks passed; test changes rolled back' as result;
