-- Run after 202610150004_publication_materials.sql. No rows or snapshots rewritten.
begin;
alter table public.projects drop constraint projects_target_duration_seconds_check;
alter table public.projects add constraint projects_target_duration_seconds_check
 check(target_duration_seconds between 1 and 900);
commit;
