-- Run once after the five existing migrations. Existing versions are not updated.
begin;
create table public.channel_profiles (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 name text not null check(char_length(btrim(name)) between 1 and 120),
 audience text not null check(char_length(btrim(audience)) between 1 and 400),
 topics text not null check(char_length(btrim(topics)) between 1 and 1000),
 tone text not null check(char_length(btrim(tone)) between 1 and 100),
 format text not null check(char_length(btrim(format)) between 1 and 100),
 avoid text not null default '' check(char_length(avoid) <= 500),
 language text not null check(language in ('ru','en')),
 updated_at timestamptz not null default now()
);
alter table public.channel_profiles enable row level security;
revoke all on public.channel_profiles from public, anon, authenticated;
grant select, delete on public.channel_profiles to authenticated;
grant insert(owner_id,name,audience,topics,tone,format,avoid,language) on public.channel_profiles to authenticated;
grant update(name,audience,topics,tone,format,avoid,language) on public.channel_profiles to authenticated;
create policy channel_select_own on public.channel_profiles for select to authenticated using ((select auth.uid()) = owner_id);
create policy channel_insert_own on public.channel_profiles for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy channel_update_own on public.channel_profiles for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy channel_delete_own on public.channel_profiles for delete to authenticated using ((select auth.uid()) = owner_id);
create trigger channel_updated_at before update on public.channel_profiles for each row execute function public.set_project_updated_at();

alter table public.projects add column channel_snapshot jsonb;
alter table public.projects add column brief_source text not null default 'unknown' check(brief_source in ('unknown','manual','test','yandex'));
grant insert(brief_source) on public.projects to authenticated;
-- The snapshot is assigned by the database, not supplied by the client.
create function public.capture_project_channel() returns trigger
language plpgsql set search_path = '' as $$
begin
 select jsonb_build_object('name',c.name,'audience',c.audience,'topics',c.topics,'tone',c.tone,'format',c.format,'avoid',c.avoid,'language',c.language)
 into new.channel_snapshot from public.channel_profiles c where c.owner_id = new.owner_id;
 return new;
end;
$$;
revoke all on function public.capture_project_channel() from public;
create trigger project_channel_snapshot before insert on public.projects for each row execute function public.capture_project_channel();

-- Keep the existing wrapper and permissions; extend only future snapshots.
create or replace function public.save_script_version_internal(p_project_id uuid, p_content text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
 project_row public.projects%rowtype;
 next_number integer;
 saved_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
 if p_content is null or char_length(btrim(p_content)) not between 1 and 20000 then
  raise exception 'Invalid script length' using errcode = '22023';
 end if;
 select * into project_row from public.projects where id=p_project_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Project unavailable' using errcode = '42501'; end if;
 select coalesce(max(version_number),0)+1 into next_number from public.script_versions where project_id=p_project_id;
 insert into public.script_versions(project_id,version_number,content,settings_snapshot)
 values(p_project_id,next_number,btrim(p_content),jsonb_build_object(
  'title',project_row.title,'topic',project_row.topic,'genre',project_row.genre,'style',project_row.style,
  'language',project_row.language,'target_duration_seconds',project_row.target_duration_seconds,
  'channel',project_row.channel_snapshot,'brief_source',project_row.brief_source
 )) returning id into saved_id;
 return saved_id;
end;
$$;
revoke all on function public.save_script_version_internal(uuid,text) from public,anon,authenticated;
commit;
