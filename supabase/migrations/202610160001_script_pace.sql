-- Future snapshots only. Existing RPC and historical versions remain compatible.
begin;
create function public.save_script_version_with_pace(p_project_id uuid,p_content text,p_source text,p_narration_pace integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare saved_id uuid;
begin
 if p_narration_pace is null or p_narration_pace not between 80 and 220 then
  raise exception 'Invalid narration pace' using errcode='22023';
 end if;
 -- Existing writer authenticates, checks ownership and locks the project.
 saved_id := public.save_script_version(p_project_id,p_content,p_source);
 update public.script_versions set settings_snapshot=settings_snapshot || jsonb_build_object('narration_pace',p_narration_pace) where id=saved_id;
 return saved_id;
end;
$$;
revoke all on function public.save_script_version_with_pace(uuid,text,text,integer) from public,anon;
grant execute on function public.save_script_version_with_pace(uuid,text,text,integer) to authenticated;
-- Read-only capability probe: fail before a paid request if the writer is missing.
create function public.script_pace_ready() returns boolean language sql stable set search_path = '' as $$ select true; $$;
revoke all on function public.script_pace_ready() from public,anon;
grant execute on function public.script_pace_ready() to authenticated;
commit;
