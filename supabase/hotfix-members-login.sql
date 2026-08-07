-- Programme Hub hotfix: member duplicate handling + name/PIN login
-- Safe to run repeatedly in Supabase SQL Editor.

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
  v_created boolean := false;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'Not permitted to manage this project';
  end if;

  if trim(coalesce(p_full_name,'')) = '' then
    raise exception 'Full name is required';
  end if;
  if trim(coalesce(p_login_name,'')) = '' then
    p_login_name := p_full_name;
  end if;
  if length(trim(coalesce(p_pin,''))) < 4 or length(trim(coalesce(p_pin,''))) > 8 then
    raise exception 'PIN must contain 4 to 8 characters';
  end if;

  -- Prefer an existing member with the same login name, case-insensitively.
  select id into v_member_id
  from public.members
  where project_id = p_project_id
    and lower(trim(login_name)) = lower(trim(p_login_name))
  order by created_at
  limit 1;

  if v_member_id is not null then
    update public.members
    set full_name = trim(p_full_name),
        login_name = trim(p_login_name),
        pin_hash = extensions.crypt(trim(p_pin), extensions.gen_salt('bf')),
        group_name = nullif(trim(coalesce(p_group_name,'')),''),
        member_role = coalesce(nullif(trim(coalesce(p_member_role,'')),''),'student'),
        is_active = true
    where id = v_member_id;
  else
    insert into public.members (
      project_id, full_name, login_name, pin_hash,
      group_name, member_role, is_active
    ) values (
      p_project_id,
      trim(p_full_name),
      trim(p_login_name),
      extensions.crypt(trim(p_pin), extensions.gen_salt('bf')),
      nullif(trim(coalesce(p_group_name,'')),''),
      coalesce(nullif(trim(coalesce(p_member_role,'')),''),'student'),
      true
    )
    on conflict (project_id, login_name) do update
    set full_name = excluded.full_name,
        pin_hash = excluded.pin_hash,
        group_name = excluded.group_name,
        member_role = excluded.member_role,
        is_active = true
    returning id into v_member_id;
    v_created := true;
  end if;

  return jsonb_build_object('member_id',v_member_id,'created',v_created);
end;
$$;

grant execute on function public.create_member_with_pin(uuid,text,text,text,text,text) to authenticated;

create or replace function public.claim_member(
  p_project_slug text,
  p_login_name text,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.members%rowtype;
  v_project public.projects%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select p.* into v_project
  from public.projects p
  where p.slug = lower(trim(p_project_slug))
    and p.status = 'published';

  if not found then
    raise exception 'Project not found';
  end if;

  -- Accept either the configured login name or the displayed full name,
  -- but the PIN must match the same member record.
  select m.* into v_member
  from public.members m
  where m.project_id = v_project.id
    and m.is_active = true
    and (
      lower(trim(m.login_name)) = lower(trim(p_login_name))
      or lower(trim(m.full_name)) = lower(trim(p_login_name))
    )
    and extensions.crypt(trim(p_pin), m.pin_hash) = m.pin_hash
  order by
    case when lower(trim(m.login_name)) = lower(trim(p_login_name)) then 0 else 1 end,
    m.created_at
  limit 1;

  if not found then
    raise exception 'Invalid name or PIN';
  end if;

  if v_member.auth_user_id is not null and v_member.auth_user_id <> v_uid then
    raise exception 'This member account has already been claimed';
  end if;

  update public.members
  set auth_user_id = v_uid,
      claimed_at = coalesce(claimed_at, now())
  where id = v_member.id;

  return jsonb_build_object(
    'member_id', v_member.id,
    'project_id', v_project.id,
    'project_slug', v_project.slug,
    'display_name', v_member.full_name,
    'group_name', v_member.group_name
  );
end;
$$;

grant execute on function public.claim_member(text,text,text) to authenticated;
