# Programme Hub Cloud

A GitHub Pages student portal with a Supabase-powered administration console.

## Live URLs

- Student portal: `https://cchn05.github.io/programme-hub/`
- Admin console: `https://cchn05.github.io/programme-hub/admin/`
- Project link example: `https://cchn05.github.io/programme-hub/?project=2026-uae`

## One-time Supabase setup

1. Open Supabase **SQL Editor** and run `supabase/schema.sql`.
2. Run `supabase/upgrade.sql`.
3. In **Storage**, create:
   - `public-assets` as a public bucket
   - `project-photos` as a private bucket
4. Run `supabase/storage-policies.sql`.
5. In **Authentication → Providers**, enable anonymous sign-ins for student access.
6. In **Authentication → Users**, create the administrator email/password account.
7. Open `/admin/` and sign in. The page will generate the one-time SQL needed to promote that account to super administrator.
8. In **Authentication → URL Configuration**, set the Site URL to the student portal and allow `https://cchn05.github.io/programme-hub/**` as a redirect URL.

## Daily operation

Use `/admin/` to manage projects, homepage text and weather, schedules, notices, albums, photos, members, PIN resets and project QR codes. Published changes are read directly from Supabase, so the GitHub site does not need to be rebuilt for normal content updates.

## Security

`config.js` contains only the browser-safe Supabase publishable key. Never add a database password, secret key, or service-role key to this repository.
