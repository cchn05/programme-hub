-- Programme Hub Storage policies
-- Run after creating the buckets:
--   public-assets   (Public)
--   project-photos (Private)

-- ADMIN UPLOADS: public-assets

drop policy if exists "project admins upload public assets" on storage.objects;
create policy "project admins upload public assets"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'public-assets'
  and public.can_manage_project(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "project admins update public assets" on storage.objects;
create policy "project admins update public assets"
on storage.objects for update to authenticated
using (
  bucket_id = 'public-assets'
  and public.can_manage_project(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'public-assets'
  and public.can_manage_project(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "project admins delete public assets" on storage.objects;
create policy "project admins delete public assets"
on storage.objects for delete to authenticated
using (
  bucket_id = 'public-assets'
  and public.can_manage_project(((storage.foldername(name))[1])::uuid)
);

-- PRIVATE PROJECT PHOTOS
-- A photo can be read only if its database row and album are visible to the user.

drop policy if exists "members read permitted project photos" on storage.objects;
create policy "members read permitted project photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'project-photos'
  and exists (
    select 1
    from public.photos p
    join public.albums a on a.id = p.album_id
    where p.storage_path = storage.objects.name
      and p.is_published = true
      and a.is_published = true
      and (
        public.can_manage_project(a.project_id)
        or (
          a.visibility = 'public'
          and public.has_project_access(a.project_id)
        )
        or (
          a.visibility = 'member'
          and public.is_project_member(a.project_id)
        )
      )
  )
);

drop policy if exists "project admins upload project photos" on storage.objects;
create policy "project admins upload project photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-photos'
  and public.can_manage_project(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "project admins update project photos" on storage.objects;
create policy "project admins update project photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'project-photos'
  and public.can_manage_project(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'project-photos'
  and public.can_manage_project(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "project admins delete project photos" on storage.objects;
create policy "project admins delete project photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'project-photos'
  and public.can_manage_project(((storage.foldername(name))[1])::uuid)
);
