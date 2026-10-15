-- Run after 202610150005_long_pilot_duration.sql with two existing TEST accounts.
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
 values(current_setting('test.user_a')::uuid,'Long pilot test','Test','Essay','Calm','en',900) returning id
) select set_config('test.project_id',id::text,true) from inserted;
select set_config('test.version_a',public.save_script_version(current_setting('test.project_id')::uuid,'First script','manual')::text,true);
update public.projects set target_duration_seconds=480 where id=current_setting('test.project_id')::uuid;
select set_config('test.version_b',public.save_script_version(current_setting('test.project_id')::uuid,'Second script','manual')::text,true);
do $$ declare invalid_duration integer; begin
 if not exists(select 1 from public.script_versions where id=current_setting('test.version_a')::uuid and settings_snapshot->>'target_duration_seconds'='900') then raise exception 'Old duration snapshot changed'; end if;
 if not exists(select 1 from public.script_versions where id=current_setting('test.version_b')::uuid and settings_snapshot->>'target_duration_seconds'='480') then raise exception 'New duration snapshot incorrect'; end if;
 foreach invalid_duration in array array[0,-1,901] loop
  begin
   update public.projects set target_duration_seconds=invalid_duration where id=current_setting('test.project_id')::uuid;
   raise exception 'Invalid duration accepted';
  exception when check_violation then null; end;
 end loop;
 if not exists(select 1 from public.projects where id=current_setting('test.project_id')::uuid and target_duration_seconds=480) then raise exception 'Invalid write damaged project'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_b'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare affected integer; begin
 if exists(select 1 from public.projects where id=current_setting('test.project_id')::uuid) then raise exception 'Foreign read allowed'; end if;
 update public.projects set target_duration_seconds=600 where id=current_setting('test.project_id')::uuid;
 get diagnostics affected=row_count;
 if affected <> 0 then raise exception 'Foreign duration update allowed'; end if;
end $$;
reset role;
rollback;
select 'Long pilot checks passed; test changes rolled back' as result;
