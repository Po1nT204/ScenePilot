-- Run after migration in SQL Editor, with two existing TEST users.
-- Replace the two UUIDs below with their Authentication > Users IDs.
-- All test rows and changes are rolled back. A failure raises an exception.
begin;
select set_config('test.user_a', 'REPLACE_WITH_USER_A_UUID', true);
select set_config('test.user_b', 'REPLACE_WITH_USER_B_UUID', true);
do $$
begin
 if current_setting('test.user_a') = current_setting('test.user_b') then raise exception 'Use two different test users'; end if;
 if not exists (select 1 from auth.users where id = current_setting('test.user_a')::uuid)
 or not exists (select 1 from auth.users where id = current_setting('test.user_b')::uuid)
 then raise exception 'Both test users must exist'; end if;
end;
$$;
select set_config('request.jwt.claims', json_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text, true);
set local role authenticated;
with inserted as (
 insert into public.projects(owner_id,title,topic,genre,language,style,target_duration_seconds)
 values (current_setting('test.user_a')::uuid,'RLS temporary A','test','test','ru','test',60) returning id
) select set_config('test.project_id',id::text,true) from inserted;
do $$
begin
 if (select count(*) from public.projects where id = current_setting('test.project_id')::uuid) <> 1 then raise exception 'Owner cannot read'; end if;
 update public.projects set title = 'RLS updated' where id = current_setting('test.project_id')::uuid;
 if not found then raise exception 'Owner cannot update'; end if;
 begin
  update public.projects set owner_id = current_setting('test.user_b')::uuid where id = current_setting('test.project_id')::uuid;
  raise exception 'Ownership transfer unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
end;
$$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_b'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare affected integer;
begin
 if exists (select 1 from public.projects where id = current_setting('test.project_id')::uuid) then raise exception 'Foreign read allowed'; end if;
 update public.projects set title = 'forbidden' where id = current_setting('test.project_id')::uuid;
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Foreign update allowed'; end if;
 delete from public.projects where id = current_setting('test.project_id')::uuid;
 get diagnostics affected = row_count;
 if affected <> 0 then raise exception 'Foreign delete allowed'; end if;
 begin
  insert into public.projects(owner_id,title,topic,genre,language,style,target_duration_seconds)
  values(current_setting('test.user_a')::uuid,'forbidden','test','test','ru','test',60);
  raise exception 'Foreign ownership insert allowed';
 exception when insufficient_privilege then null;
 end;
end;
$$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
begin
 begin
  perform 1 from public.projects;
  raise exception 'Anonymous read allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.projects(owner_id,title,topic,genre,language,style,target_duration_seconds)
  values(current_setting('test.user_a')::uuid,'forbidden','test','test','ru','test',60);
  raise exception 'Anonymous insert allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.projects set title = 'forbidden' where id = current_setting('test.project_id')::uuid;
  raise exception 'Anonymous update allowed';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.projects where id = current_setting('test.project_id')::uuid;
  raise exception 'Anonymous delete allowed';
 exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$
begin
 if not exists (select 1 from public.projects where id = current_setting('test.project_id')::uuid and title = 'RLS updated') then raise exception 'Project changed by foreign user'; end if;
 delete from public.projects where id = current_setting('test.project_id')::uuid;
 if not found then raise exception 'Owner cannot delete'; end if;
end;
$$;
reset role;
rollback;
select 'RLS checks passed; test changes rolled back' as result;
