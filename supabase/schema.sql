-- Programme Hub Cloud
-- Initial database schema for GitHub Pages + Supabase
-- Run this file in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name_zh text not null,
  name_en text,
  subtitle_zh text,
  subtitle_en text,
  theme_color text not null default '#007aff',
  start_date date,
  end_date date,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  is_public boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_home (
  project_id uuid primary key references public.projects(id) on delete cascade,
  welcome_zh text,
  welcome_en text,
  weather_city_zh text default '上海',
  weather_city_en text default 'Shanghai',
  weather_temperature text,
  weather_summary_zh text,
  weather_summary_en text,
  weather_rain_probability text,
  weather_humidity text,
  weather_tip_zh text,
  weather_tip_en text,
  show_course boolean not null default true,
  show_weather boolean not null default true,
  show_notices boolean not null default true,
  show_photos boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.project_admins (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner','editor','photos')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  full_name text not null,
  login_name text not null,
  pin_hash text not null,
  group_name text,
  member_role text default 'student',
  auth_user_id uuid unique references auth.users(id) on delete set null,
  is_active boolean not null default true,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, login_name)
);

create table if not exists public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  event_date date not null,
  start_time time,
  end_time time,
  title_zh text not null,
  title_en text,
  location_zh text,
  location_en text,
  speaker_zh text,
  speaker_en text,
  description_zh text,
  description_en text,
  sort_order integer not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title_zh text not null,
  title_en text,
  body_zh text not null,
  body_en text,
  priority integer not null default 0 check (priority between 0 and 2),
  is_pinned boolean not null default false,
  publish_at timestamptz not null default now(),
  expire_at timestamptz,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title_zh text not null,
  title_en text,
  event_date date,
  cover_path text,
  visibility text not null default 'member' check (visibility in ('public','member','admin')),
  sort_order integer not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  storage_path text not null unique,
  caption_zh text,
  caption_en text,
  sort_order integer not null default 0,
  is_published boolean not null default true,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists schedule_project_date_idx on public.schedule_items(project_id, event_date, sort_order);
create index if not exists notices_project_publish_idx on public.notices(project_id, is_published, publish_at desc);
create index if not exists albums_project_date_idx on public.albums(project_id, event_date desc, sort_order);
create index if not exists photos_album_order_idx on public.photos(album_id, sort_order);
create index if not exists members_project_auth_idx on public.members(project_id, auth_user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists project_home_set_updated_at on public.project_home;
create trigger project_home_set_updated_at before update on public.project_home
for each row execute function public.set_updated_at();

drop trigger if exists schedule_set_updated_at on public.schedule_items;
create trigger schedule_set_updated_at before update on public.schedule_items
for each row execute function public.set_updated_at();

drop trigger if exists notices_set_updated_at on public.notices;
create trigger notices_set_updated_at before update on public.notices
for each row execute function public.set_updated_at();

drop trigger if exists albums_set_updated_at on public.albums;
create trigger albums_set_updated_at before update on public.albums
for each row execute function public.set_updated_at();

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_profiles a
    where a.user_id = auth.uid() and a.is_super_admin = true
  );
$$;

create or replace function public.can_manage_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin() or exists (
    select 1 from public.project_admins pa
    where pa.project_id = p_project_id and pa.user_id = auth.uid()
  );
$$;

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.project_id = p_project_id
      and m.auth_user_id = auth.uid()
      and m.is_active = true
  );
$$;

create or replace function public.has_project_access(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and p.status = 'published'
      and (p.is_public = true or public.is_project_member(p.id) or public.can_manage_project(p.id))
  );
$$;

create or replace function public.claim_member(
  p_project_slug text,
  p_login_name text,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  select m.* into v_member
  from public.members m
  where m.project_id = v_project.id
    and lower(trim(m.login_name)) = lower(trim(p_login_name))
    and m.is_active = true;

  if not found or crypt(p_pin, v_member.pin_hash) <> v_member.pin_hash then
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

grant usage on schema public to anon, authenticated;
grant select on public.projects to anon, authenticated;
grant select, insert, update, delete on public.project_home, public.project_admins, public.members, public.schedule_items, public.notices, public.albums, public.photos to authenticated;
grant select on public.admin_profiles to authenticated;
grant execute on function public.claim_member(text, text, text) to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.can_manage_project(uuid) to authenticated;
grant execute on function public.is_project_member(uuid) to authenticated;
grant execute on function public.has_project_access(uuid) to authenticated;

alter table public.projects enable row level security;
alter table public.project_home enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.project_admins enable row level security;
alter table public.members enable row level security;
alter table public.schedule_items enable row level security;
alter table public.notices enable row level security;
alter table public.albums enable row level security;
alter table public.photos enable row level security;

drop policy if exists "published projects are visible" on public.projects;
create policy "published projects are visible"
on public.projects for select
using (status = 'published' or public.can_manage_project(id));

drop policy if exists "super admins create projects" on public.projects;
create policy "super admins create projects"
on public.projects for insert to authenticated
with check (public.is_super_admin());

drop policy if exists "project admins update projects" on public.projects;
create policy "project admins update projects"
on public.projects for update to authenticated
using (public.can_manage_project(id))
with check (public.can_manage_project(id));

drop policy if exists "super admins delete projects" on public.projects;
create policy "super admins delete projects"
on public.projects for delete to authenticated
using (public.is_super_admin());

drop policy if exists "home visible with project access" on public.project_home;
create policy "home visible with project access"
on public.project_home for select to authenticated
using (public.has_project_access(project_id) or public.can_manage_project(project_id));

drop policy if exists "project admins manage home" on public.project_home;
create policy "project admins manage home"
on public.project_home for all to authenticated
using (public.can_manage_project(project_id))
with check (public.can_manage_project(project_id));

drop policy if exists "admins see own profile" on public.admin_profiles;
create policy "admins see own profile"
on public.admin_profiles for select to authenticated
using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "project admins see assignments" on public.project_admins;
create policy "project admins see assignments"
on public.project_admins for select to authenticated
using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "super admins manage assignments" on public.project_admins;
create policy "super admins manage assignments"
on public.project_admins for all to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists "members see own record" on public.members;
create policy "members see own record"
on public.members for select to authenticated
using (auth_user_id = auth.uid() or public.can_manage_project(project_id));

drop policy if exists "project admins manage members" on public.members;
create policy "project admins manage members"
on public.members for all to authenticated
using (public.can_manage_project(project_id))
with check (public.can_manage_project(project_id));

drop policy if exists "schedule visible with access" on public.schedule_items;
create policy "schedule visible with access"
on public.schedule_items for select to authenticated
using ((is_published and public.has_project_access(project_id)) or public.can_manage_project(project_id));

drop policy if exists "project admins manage schedule" on public.schedule_items;
create policy "project admins manage schedule"
on public.schedule_items for all to authenticated
using (public.can_manage_project(project_id))
with check (public.can_manage_project(project_id));

drop policy if exists "notices visible with access" on public.notices;
create policy "notices visible with access"
on public.notices for select to authenticated
using (
  ((is_published and publish_at <= now() and (expire_at is null or expire_at > now()))
    and public.has_project_access(project_id))
  or public.can_manage_project(project_id)
);

drop policy if exists "project admins manage notices" on public.notices;
create policy "project admins manage notices"
on public.notices for all to authenticated
using (public.can_manage_project(project_id))
with check (public.can_manage_project(project_id));

drop policy if exists "albums visible with access" on public.albums;
create policy "albums visible with access"
on public.albums for select to authenticated
using (
  public.can_manage_project(project_id)
  or (
    is_published
    and visibility <> 'admin'
    and (
      (visibility = 'public' and public.has_project_access(project_id))
      or (visibility = 'member' and (public.is_project_member(project_id) or public.can_manage_project(project_id)))
    )
  )
);

drop policy if exists "project admins manage albums" on public.albums;
create policy "project admins manage albums"
on public.albums for all to authenticated
using (public.can_manage_project(project_id))
with check (public.can_manage_project(project_id));

drop policy if exists "photos visible through album" on public.photos;
create policy "photos visible through album"
on public.photos for select to authenticated
using (
  exists (
    select 1 from public.albums a
    where a.id = album_id
      and (
        public.can_manage_project(a.project_id)
        or (
          is_published
          and a.is_published
          and a.visibility <> 'admin'
          and (
            (a.visibility = 'public' and public.has_project_access(a.project_id))
            or (a.visibility = 'member' and public.is_project_member(a.project_id))
          )
        )
      )
  )
);

drop policy if exists "project admins manage photos" on public.photos;
create policy "project admins manage photos"
on public.photos for all to authenticated
using (
  exists (
    select 1 from public.albums a
    where a.id = album_id and public.can_manage_project(a.project_id)
  )
)
with check (
  exists (
    select 1 from public.albums a
    where a.id = album_id and public.can_manage_project(a.project_id)
  )
);

-- STORAGE SETUP
-- Create two buckets manually in Supabase Dashboard > Storage:
-- 1. public-assets   (Public bucket)
-- 2. project-photos (Private bucket)
-- Store files using paths such as:
--   <project_uuid>/<album_uuid>/<filename>.jpg

-- Example: create the first admin after creating a user in Authentication > Users.
-- Replace the UUID and run:
-- insert into public.admin_profiles (user_id, display_name, is_super_admin)
-- values ('00000000-0000-0000-0000-000000000000', 'Fynn', true);

-- Example: hash a member PIN before importing:
-- select crypt('2716', gen_salt('bf'));
