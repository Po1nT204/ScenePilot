-- Execute once in the ScenePilot Supabase SQL Editor.
begin;
create table public.projects (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (char_length(btrim(title)) between 1 and 120),
 topic text not null check (char_length(btrim(topic)) between 1 and 4000),
 genre text not null check (char_length(btrim(genre)) between 1 and 100),
 language text not null check (language in ('ru', 'en')),
 style text not null check (char_length(btrim(style)) between 1 and 100),
 target_duration_seconds integer not null check (target_duration_seconds between 1 and 300),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index projects_owner_updated_idx on public.projects(owner_id, updated_at desc);
alter table public.projects enable row level security;
revoke all on public.projects from anon, authenticated;
grant select, delete on public.projects to authenticated;
grant insert (owner_id,title,topic,genre,language,style,target_duration_seconds) on public.projects to authenticated;
grant update (title,topic,genre,language,style,target_duration_seconds) on public.projects to authenticated;
create policy projects_select_own on public.projects for select to authenticated using ((select auth.uid()) = owner_id);
create policy projects_insert_own on public.projects for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy projects_update_own on public.projects for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy projects_delete_own on public.projects for delete to authenticated using ((select auth.uid()) = owner_id);
create function public.set_project_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
 new.updated_at = now();
 return new;
end;
$$;
revoke all on function public.set_project_updated_at() from public;
create trigger projects_updated_at before update on public.projects for each row execute function public.set_project_updated_at();
commit;
