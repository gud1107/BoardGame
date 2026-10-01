-- ---------------------------------------------------------------------------
-- Social login (Kakao / Google / GitHub / Discord) — public display profile.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- `user_profiles` is the PUBLIC nickname/avatar card everyone may read.
-- It's deliberately separate from the private `profiles` table in
-- schema.sql (email + role, self-read only, service-role writes).
--
-- The trigger fills it from the OAuth provider's metadata the first time a
-- user appears in auth.users (email signups get a `게이머_xxxxxx` nickname).
-- See docs/social-login.md for the provider/dashboard setup.
-- ---------------------------------------------------------------------------

create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname varchar(50) not null,
  avatar_url text,
  provider varchar(20) default 'email',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.user_profiles enable row level security;

drop policy if exists "Public profiles are viewable by everyone" on public.user_profiles;
create policy "Public profiles are viewable by everyone" on public.user_profiles
  for select using (true);

drop policy if exists "Users can update own profile" on public.user_profiles;
create policy "Users can update own profile" on public.user_profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  user_nickname text;
  user_avatar text;
  auth_provider text := coalesce(new.raw_app_meta_data ->> 'provider', 'email');
begin
  -- Kakao: name/user_name/nickname, Google: name/full_name,
  -- GitHub: user_name/preferred_username, Discord: full_name/name.
  user_nickname := coalesce(
    nullif(raw_meta ->> 'name', ''),
    nullif(raw_meta ->> 'full_name', ''),
    nullif(raw_meta ->> 'user_name', ''),
    nullif(raw_meta ->> 'nickname', ''),
    nullif(raw_meta ->> 'preferred_username', ''),
    '게이머_' || substring(new.id::text from 1 for 6)
  );

  user_avatar := coalesce(
    nullif(raw_meta ->> 'avatar_url', ''),
    nullif(raw_meta ->> 'picture', ''),
    nullif(raw_meta ->> 'profile_image', '')
  );

  insert into public.user_profiles (id, nickname, avatar_url, provider)
  values (new.id, left(user_nickname, 50), user_avatar, left(auth_provider, 20))
  on conflict (id) do update
  set
    nickname = excluded.nickname,
    avatar_url = coalesce(excluded.avatar_url, public.user_profiles.avatar_url),
    updated_at = now();

  return new;
exception when others then
  -- A trigger error on auth.users aborts the signup itself — never let a
  -- profile hiccup lock someone out of logging in.
  raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill accounts that existed before this trigger.
insert into public.user_profiles (id, nickname, avatar_url, provider)
select
  u.id,
  left(coalesce(
    nullif(u.raw_user_meta_data ->> 'name', ''),
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(u.raw_user_meta_data ->> 'user_name', ''),
    '게이머_' || substring(u.id::text from 1 for 6)
  ), 50),
  coalesce(nullif(u.raw_user_meta_data ->> 'avatar_url', ''), nullif(u.raw_user_meta_data ->> 'picture', '')),
  left(coalesce(u.raw_app_meta_data ->> 'provider', 'email'), 20)
from auth.users u
on conflict (id) do nothing;
