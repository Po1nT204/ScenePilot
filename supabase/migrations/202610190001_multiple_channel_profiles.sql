-- Apply once after all preceding migrations. Existing snapshots are not rewritten.
begin;
alter table public.channel_profiles add column id uuid not null default gen_random_uuid();
alter table public.channel_profiles drop constraint channel_profiles_pkey;
alter table public.channel_profiles add primary key(id);
create index channel_profiles_owner_idx on public.channel_profiles(owner_id);
-- Existing ownership policies and column-level write grants remain in force.
-- Clients cannot change the generated id or owner_id.

alter table public.projects
 add column channel_profile_id uuid references public.channel_profiles(id) on delete set null,
 add column channel_profile_revision timestamptz;
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
commit;
