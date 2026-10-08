-- Enough of Supabase to run the migrations against: the auth schema, the
-- helper functions every policy calls, and the two tables sql/01 created
-- (which is not in the repo, so it is reconstructed from what 02 and 03
-- alter).
create extension if not exists pgcrypto;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Settable from a test so a policy can be exercised as a given user.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role');
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz default now()
);

create table if not exists public.progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  category text,
  best_score int,
  attempts int default 0,
  answered jsonb
);

-- ---------------------------------------------------------------------------
-- Enough of Supabase Storage to run sql/15 against.
--
-- Shapes only — no actual file handling. What is being checked is that the
-- bucket row and the four policies are valid SQL against tables of the right
-- shape, and in particular that storage.foldername() is used correctly,
-- since that expression IS the permission.
-- ---------------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  metadata jsonb
);

alter table storage.objects enable row level security;

/* Supabase's own: the path's folders, without the file name.
   'abc/123.jpg' -> {abc} */
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;
