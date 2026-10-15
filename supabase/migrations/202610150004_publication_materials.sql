-- Run after 202610150003_scene_editing.sql. Existing scripts/scenes stay unchanged.
begin;
create table public.publication_materials (
 script_version_id uuid primary key references public.script_versions(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 100 and char_length(btrim(title)) > 0),
 titles jsonb not null default '[]' check(jsonb_typeof(titles)='array' and jsonb_array_length(titles) <= 3),
 description text not null check(char_length(description) between 1 and 5000 and char_length(btrim(description)) > 0),
 source text not null check(source in ('manual','test','yandex')),
 updated_at timestamptz not null default now()
);
alter table public.publication_materials enable row level security;
revoke all on public.publication_materials from public,anon,authenticated;
grant select on public.publication_materials to authenticated;
create policy publication_select_own on public.publication_materials for select to authenticated using(exists(
 select 1 from public.script_versions v join public.projects p on p.id=v.project_id
 where v.id=script_version_id and p.owner_id=(select auth.uid())
));

create function public.save_publication_materials(p_version_id uuid,p_material jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare variant jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 perform p.id from public.projects p join public.script_versions v on v.project_id=p.id
 where v.id=p_version_id and p.owner_id=auth.uid() for update of p;
 if not found then raise exception 'Version unavailable' using errcode='42501'; end if;
 if p_material is null or jsonb_typeof(p_material) <> 'object' then raise exception 'Invalid material' using errcode='22023'; end if;
 if jsonb_typeof(p_material->'title') is distinct from 'string'
  or char_length(p_material->>'title') not between 1 and 100 or char_length(btrim(p_material->>'title'))=0
  or jsonb_typeof(p_material->'description') is distinct from 'string'
  or char_length(p_material->>'description') not between 1 and 5000 or char_length(btrim(p_material->>'description'))=0
  or jsonb_typeof(p_material->'source') is distinct from 'string' or p_material->>'source' not in ('manual','test','yandex') then
  raise exception 'Invalid fields' using errcode='22023';
 end if;
 if jsonb_typeof(p_material->'titles') is distinct from 'array' then raise exception 'Invalid titles' using errcode='22023'; end if;
 if jsonb_array_length(p_material->'titles') > 3 then raise exception 'Too many titles' using errcode='22023'; end if;
 for variant in select value from jsonb_array_elements(p_material->'titles') loop
  if jsonb_typeof(variant) <> 'string' or char_length(variant #>> '{}') not between 1 and 100 or char_length(btrim(variant #>> '{}'))=0 then
   raise exception 'Invalid title variant' using errcode='22023';
  end if;
 end loop;
 insert into public.publication_materials(script_version_id,title,titles,description,source)
 values(p_version_id,btrim(p_material->>'title'),p_material->'titles',btrim(p_material->>'description'),p_material->>'source')
 on conflict(script_version_id) do update set title=excluded.title,titles=excluded.titles,description=excluded.description,source=excluded.source,updated_at=now();
end;
$$;
revoke all on function public.save_publication_materials(uuid,jsonb) from public,anon;
grant execute on function public.save_publication_materials(uuid,jsonb) to authenticated;
commit;
