-- ===========================================================================
-- PROFILE PHOTOS
--
-- A bucket, the rules for who may write into it, and a column for a learner.
-- Instructors already have instructor_profiles.photo_url from sql/04; it has
-- never had anything to put in it.
--
-- THE PATH IS THE PERMISSION
--
-- Every file lives at <user-id>/<something>, and the write policies check
-- that the first folder is the caller's own id:
--
--   (storage.foldername(name))[1] = auth.uid()::text
--
-- So the rule is not "you may edit your photo" enforced by the app, which an
-- app can forget; it is "you may only write inside your own folder",
-- enforced by Postgres on every request. There is no path anyone can
-- construct that puts a file in somebody else's folder.
--
-- WHY READS ARE PUBLIC, AND WHAT THAT MEANS FOR A LEARNER
--
-- An instructor's photo is on a public directory listing — that is the point
-- of it, and a photo behind a signed URL that expires is a broken image on a
-- marketplace card. So the bucket is public for reading.
--
-- A learner's photo is in the same bucket and therefore also readable by
-- anyone holding the URL. The URL contains their account id and the file
-- name, so it is not guessable, but it is not a secret either. The learner
-- is told this in the app, in those words, before they choose a photo. An
-- unlisted private bucket for learners and a public one for instructors
-- would be more correct and is the thing to do if learner photos ever become
-- more than a courtesy to the instructor collecting them.
--
-- Safe to run twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Somewhere for a learner's photo to live
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists avatar_url text;

-- ---------------------------------------------------------------------------
-- 2. The bucket
--
-- Created through storage's own table so this file is idempotent. The
-- dashboard's "New bucket" button does the same thing.
--
-- 5 MB is generous for an avatar the app downscales to 512px before it
-- uploads; the limit is there to stop a 48-megapixel phone photo being
-- pushed straight up on a bad connection, not to be reached.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- ---------------------------------------------------------------------------
-- 3. Who may do what
--
-- Read: anyone. Write, replace, delete: only inside your own folder.
-- ---------------------------------------------------------------------------
do $$
begin
  -- storage.objects belongs to the storage extension, so these are created
  -- defensively: on a project where the role running this file cannot add a
  -- policy there, the rest of the migration should still apply and the
  -- reason should be legible rather than a bare permission error.
  begin
    drop policy if exists "avatars are publicly readable" on storage.objects;
    create policy "avatars are publicly readable" on storage.objects
      for select using (bucket_id = 'avatars');

    drop policy if exists "a person writes only their own avatar" on storage.objects;
    create policy "a person writes only their own avatar" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      );

    drop policy if exists "a person replaces only their own avatar" on storage.objects;
    create policy "a person replaces only their own avatar" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      );

    drop policy if exists "a person deletes only their own avatar" on storage.objects;
    create policy "a person deletes only their own avatar" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  exception when insufficient_privilege then
    raise notice
      'Could not create the storage policies (%). Add them in the Supabase dashboard under Storage > avatars > Policies: public SELECT, and INSERT/UPDATE/DELETE for authenticated where (storage.foldername(name))[1] = auth.uid()::text.',
      sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. A learner may set their own avatar_url and nothing else that matters
--
-- profiles already has a per-row policy from sql/01 and a trigger from
-- sql/07 that governs roles. avatar_url is an ordinary column: the existing
-- update policy covers it, and enforce_profile_roles still refuses anything
-- privileged in the same write. Nothing new is needed here, and this comment
-- exists so the next person does not go looking for it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. The photo a learner sees on a marketplace card
--
-- instructor_profiles already has photo_url and is already publicly
-- selectable for verified, listed instructors (sql/04), so the directory
-- needs no change. Stated here only because "where is the policy for the
-- photo" is the obvious question.
-- ---------------------------------------------------------------------------
