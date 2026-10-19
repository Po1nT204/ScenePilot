-- Safe to repeat THIS migration after all preceding migrations.
-- Existing profile IDs and project/version snapshots are preserved.
begin;
alter table public.channel_profiles add column if not exists id uuid not null default gen_random_uuid();
do $$
declare pk_name text; pk_columns smallint[]; id_att smallint; owner_att smallint;
begin
 select attnum into id_att from pg_attribute where attrelid='public.channel_profiles'::regclass and attname='id' and not attisdropped and atttypid='uuid'::regtype;
 select attnum into owner_att from pg_attribute where attrelid='public.channel_profiles'::regclass and attname='owner_id' and not attisdropped;
 if id_att is null then raise exception 'channel_profiles.id must be uuid; no changes committed'; end if;
 if exists(select 1 from public.channel_profiles where id is null) then raise exception 'channel_profiles.id contains NULL; inspect schema before retrying'; end if;
 select conname,conkey into pk_name,pk_columns from pg_constraint where conrelid='public.channel_profiles'::regclass and contype='p';
 if pk_columns = array[owner_att] then
  execute format('alter table public.channel_profiles drop constraint %I',pk_name);
 elsif pk_name is not null and pk_columns <> array[id_att] then
  raise exception 'Unexpected channel_profiles primary key; no changes committed';
 end if;
 if pk_name is null or pk_columns = array[owner_att] then
  alter table public.channel_profiles add primary key(id);
 end if;
end $$;
alter table public.channel_profiles alter column id set default gen_random_uuid();
alter table public.channel_profiles alter column id set not null;
create index if not exists channel_profiles_owner_idx on public.channel_profiles(owner_id);
-- Existing ownership policies and column-level write grants remain in force.
-- Never drop the id primary key: existing projects may reference it.
alter table public.projects add column if not exists channel_profile_id uuid;
alter table public.projects add column if not exists channel_profile_revision timestamptz;
do $$
declare profile_att smallint; id_att smallint;
begin
 select attnum into profile_att from pg_attribute where attrelid='public.projects'::regclass and attname='channel_profile_id' and not attisdropped and atttypid='uuid'::regtype;
 select attnum into id_att from pg_attribute where attrelid='public.channel_profiles'::regclass and attname='id' and not attisdropped;
 if profile_att is null or not exists(select 1 from pg_attribute where attrelid='public.projects'::regclass and attname='channel_profile_revision' and not attisdropped and atttypid='timestamptz'::regtype) then
  raise exception 'Unexpected project profile column types; no changes committed';
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.projects'::regclass and contype='f' and conkey=array[profile_att]) then
  alter table public.projects add constraint projects_channel_profile_id_fkey foreign key(channel_profile_id) references public.channel_profiles(id) on delete set null;
 elsif not exists(select 1 from pg_constraint where conrelid='public.projects'::regclass and contype='f' and conkey=array[profile_att] and confrelid='public.channel_profiles'::regclass and confkey=array[id_att] and confdeltype='n') then
  raise exception 'Unexpected profile foreign key; no changes committed';
 end if;
end $$;
grant insert(channel_profile_id,channel_profile_revision) on public.projects to authenticated;

create or replace function public.capture_project_channel() returns trigger
language plpgsql set search_path = '' as $$
declare
 selected_profile public.channel_profiles%rowtype;
begin
 if auth.uid() is null or new.owner_id is distinct from auth.uid() then
  raise exception 'Project owner unavailable' using errcode='42501';
 end if;
 if new.channel_profile_id is null then
  if new.channel_profile_revision is not null then
   raise exception 'Profile selection required' using errcode='22023';
  end if;
  new.channel_snapshot := null;
  return new;
 end if;
 -- Serialize snapshot capture against profile updates/deletion, closing the
 -- gap between the server's preflight check and the actual project INSERT.
 select * into selected_profile from public.channel_profiles
 where id=new.channel_profile_id and owner_id=new.owner_id for share;
 if not found then raise exception 'Profile unavailable' using errcode='42501'; end if;
 if new.channel_profile_revision is null or new.channel_profile_revision is distinct from selected_profile.updated_at then
  raise exception 'Channel profile changed' using errcode='40001';
 end if;
 new.channel_snapshot := jsonb_build_object(
  'name',selected_profile.name,'audience',selected_profile.audience,
  'topics',selected_profile.topics,'tone',selected_profile.tone,
  'format',selected_profile.format,'avoid',selected_profile.avoid,
  'language',selected_profile.language);
 return new;
end;
$$;
revoke all on function public.capture_project_channel() from public,anon,authenticated;
-- No UPDATE of existing projects/versions and no new SECURITY DEFINER entry point.
notify pgrst, 'reload schema';
commit;
select 'Multiple channel profiles migration complete' as result;
