-- Run once, after the projects migration.
begin;
create table public.script_versions (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 version_number integer not null check (version_number > 0),
 content text not null check (char_length(btrim(content)) between 1 and 20000),
 settings_snapshot jsonb not null,
 created_at timestamptz not null default now(),
 unique(project_id, version_number)
);
alter table public.script_versions enable row level security;
revoke all on public.script_versions from public, anon, authenticated;
grant select on public.script_versions to authenticated;
create policy script_versions_select_own on public.script_versions
 for select to authenticated using (exists (
  select 1 from public.projects p
  where p.id = project_id and p.owner_id = (select auth.uid())
 ));

-- Only this function can insert versions. It checks ownership itself because
-- SECURITY DEFINER runs with the function owner's privileges.
create function public.save_script_version(p_project_id uuid, p_content text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
 project_row public.projects%rowtype;
 next_number integer;
 saved_id uuid;
begin
 if auth.uid() is null then
  raise exception 'Authentication required' using errcode = '42501';
 end if;
 if p_content is null or char_length(btrim(p_content)) not between 1 and 20000 then
  raise exception 'Invalid script length' using errcode = '22023';
 end if;
 -- Serialize saves for the same project; snapshot and version are one transaction.
 select * into project_row from public.projects
 where id = p_project_id and owner_id = auth.uid() for update;
 if not found then
  raise exception 'Project unavailable' using errcode = '42501';
 end if;
 select coalesce(max(version_number), 0) + 1 into next_number
 from public.script_versions where project_id = p_project_id;
 insert into public.script_versions(project_id, version_number, content, settings_snapshot)
 values (p_project_id, next_number, btrim(p_content), jsonb_build_object(
  'title', project_row.title, 'topic', project_row.topic,
  'genre', project_row.genre, 'style', project_row.style,
  'language', project_row.language,
  'target_duration_seconds', project_row.target_duration_seconds
 )) returning id into saved_id;
 return saved_id;
end;
$$;
revoke all on function public.save_script_version(uuid, text) from public, anon;
grant execute on function public.save_script_version(uuid, text) to authenticated;
commit;
