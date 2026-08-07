-- Programme Hub Cloud - admin helper functions
-- Run after supabase/schema.sql.
-- Supabase installs pgcrypto in the extensions schema, so crypto functions are qualified explicitly.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.create_member_with_pin(
  p_project_id uuid,
  p_full_name text,
  p_login_name text,
  p_pin text,
  p_group_name text default null,
  p_member_role text default 'student'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_member_id uuid;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'Not permitted to manage this project';
  end if;
  if length(trim(p_pin)) < 4 or length(trim(p_pin)) > 8 then
    raise exception 'PIN must contain 4 to 8 characters';
  end if;

  insert into public.members (
    project_id, full_name, login_name, pin_hash,
    group_name, member_role, is_active
  ) values (
    p_project_id, trim(p_full_name), trim(p_login_name),
    extensions.crypt(trim(p_pin), extensions.gen_salt('bf')),
    nullif(trim(p_group_name), ''),
    coalesce(nullif(trim(p_member_role), ''), 'student'), true
  )
  returning id into v_member_id;

  return jsonb_build_object('member_id', v_member_id);
end;
$$;

create or replace function public.reset_member_pin(
  p_member_id uuid,
  p_new_pin text,
  p_unclaim boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id
  from public.members where id = p_member_id;

  if v_project_id is null or not public.can_manage_project(v_project_id) then
    raise exception 'Not permitted to manage this member';
  end if;
  if length(trim(p_new_pin)) < 4 or length(trim(p_new_pin)) > 8 then
    raise exception 'PIN must contain 4 to 8 characters';
  end if;

  update public.members
  set pin_hash = extensions.crypt(trim(p_new_pin), extensions.gen_salt('bf')),
      auth_user_id = case when p_unclaim then null else auth_user_id end,
      claimed_at = case when p_unclaim then null else claimed_at end,
      is_active = true
  where id = p_member_id;

  return true;
end;
$$;

grant execute on function public.create_member_with_pin(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.reset_member_pin(uuid,text,boolean) to authenticated;

-- Make the member login function resolve pgcrypto correctly on Supabase.
alter function public.claim_member(text,text,text) set search_path = public, extensions;

-- Starter projects. Existing slugs are not overwritten.
insert into public.projects (slug,name_zh,name_en,subtitle_en,theme_color,status,is_public)
values
  ('2026-uae','2026 UAE','2026 UAE','Summer Chinese Programme','#007aff','published',false),
  ('2026-principals','2026 华校校长','2026 Overseas Chinese School Leaders','Overseas Chinese Educators','#af1f2d','draft',false),
  ('2025-vietnam','2025 越南大学生','2025 Vietnam University Programme','Vietnam University Programme','#008f74','archived',false)
on conflict (slug) do nothing;

insert into public.project_home (project_id,welcome_zh,welcome_en,weather_city_zh,weather_city_en,show_course,show_weather,show_notices,show_photos)
select id,'今天的重要信息，都在这里。','Everything important for today, in one place.','上海','Shanghai',true,true,true,true
from public.projects
on conflict (project_id) do nothing;
