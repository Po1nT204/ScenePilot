-- Apply after 202610150001_channel_profiles.sql. Keep existing data and RLS.
begin;
alter table public.channel_profiles
 drop constraint channel_profiles_tone_check,
 drop constraint channel_profiles_format_check,
 drop constraint channel_profiles_avoid_check,
 add constraint channel_profiles_tone_check check(char_length(btrim(tone)) between 1 and 1000),
 add constraint channel_profiles_format_check check(char_length(btrim(format)) between 1 and 1000),
 add constraint channel_profiles_avoid_check check(char_length(avoid) <= 1000);
commit;
