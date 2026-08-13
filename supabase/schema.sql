-- Optional Supabase schema. Only needed if you set NEXT_PUBLIC_SUPABASE_URL
-- and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example). IndexedDB remains
-- the primary datastore either way; these tables only support:
--   1) cross-device player identity matching (device_sightings)
--   2) cloud backup of finalized betting sessions (daily_records)

create table if not exists device_sightings (
  ip text not null,
  device_id text not null,
  player_id text not null,
  name text not null,
  seen_at timestamptz not null default now(),
  primary key (ip, device_id)
);

create table if not exists daily_records (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table device_sightings enable row level security;
alter table daily_records enable row level security;

-- Demo-friendly policies using the anon key. This app has no auth layer,
-- so anyone with your anon key can read/write these two tables — that's
-- fine for a private group scoreboard, but tighten this (e.g. via a
-- Postgres function + service role, or add Supabase Auth) before treating
-- it as anything more sensitive.
create policy "anon read device_sightings" on device_sightings
  for select to anon using (true);
create policy "anon write device_sightings" on device_sightings
  for insert to anon with check (true);
create policy "anon update device_sightings" on device_sightings
  for update to anon using (true);

create policy "anon read daily_records" on daily_records
  for select to anon using (true);
create policy "anon write daily_records" on daily_records
  for insert to anon with check (true);
create policy "anon upsert daily_records" on daily_records
  for update to anon using (true);

-- ---------------------------------------------------------------------------
-- Accounts / subscriptions / admin dashboard (phase 1 — see HANDOFF.md).
-- Unlike the tables above, these require Supabase Auth to be enabled on the
-- project (Authentication > Providers > Email) and are only meaningful once
-- SUPABASE_SERVICE_ROLE_KEY + ADMIN_EMAILS are set server-side (.env.example).
-- Real card billing is NOT wired up — `subscriptions` is a data model for
-- admin-granted / trial tiers only; a payment gateway can be layered on top
-- later without a schema change (it would just start writing these same
-- rows instead of the admin API / signup route doing it).
-- ---------------------------------------------------------------------------

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  nickname text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  user_id uuid primary key references profiles (id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'lite', 'max')),
  status text not null default 'active' check (status in ('active', 'expired')),
  period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  source text not null default 'signup' check (source in ('signup', 'trial', 'admin', 'coupon', 'payment')),
  updated_at timestamptz not null default now()
);

create table if not exists usage_daily (
  user_id uuid not null references profiles (id) on delete cascade,
  date date not null,
  games_used int not null default 0,
  minutes_used int not null default 0,
  primary key (user_id, date)
);

-- Keyed by the existing client-generated `bg_device_id` (src/lib/identity/deviceId.ts).
-- Same "weak signal, not tamper-proof" caveat as device_sightings above — a
-- guest can reset this by clearing localStorage. Good enough to nudge people
-- toward signing up, not a security boundary.
create table if not exists guest_usage (
  device_id text not null,
  date date not null,
  games_used int not null default 0,
  minutes_used int not null default 0,
  primary key (device_id, date)
);

-- Singleton settings row the admin dashboard edits (guest mode on/off, which
-- single metering dimension is active site-wide, and the tier/guest limit
-- numbers themselves) so none of this is hardcoded in the app bundle.
create table if not exists app_settings (
  id int primary key default 1,
  guest_mode_enabled boolean not null default true,
  metering_mode text not null default 'coin' check (metering_mode in ('coin', 'time')),
  tier_limits jsonb not null default '{
    "free": {"gamesPerDay": 7, "minutesPerDay": 60},
    "lite": {"gamesPerDay": 25, "minutesPerDay": 240},
    "max": {"gamesPerDay": 100, "minutesPerDay": 600}
  }'::jsonb,
  guest_limits jsonb not null default '{"gamesPerDay": 5, "minutesPerDay": 60}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);
insert into app_settings (id) values (1) on conflict (id) do nothing;

alter table profiles enable row level security;
alter table subscriptions enable row level security;
alter table usage_daily enable row level security;
alter table guest_usage enable row level security;
alter table app_settings enable row level security;

-- profiles: a user can read their own row. All writes go through the
-- signup route handler / admin API using the service role key (which
-- bypasses RLS), so no anon/authenticated insert or update policy exists
-- here on purpose.
create policy "self read profile" on profiles
  for select to authenticated using (id = auth.uid());

-- subscriptions: a user can read their own row. Writes — including the
-- user-facing "해지 예약" (cancel_at_period_end) toggle — deliberately have
-- NO client-reachable policy: Postgres RLS can only allow/deny a whole-row
-- UPDATE, not restrict it to one column, so a same-user UPDATE policy here
-- would let any authenticated user set their own tier to 'max' for free.
-- The toggle instead goes through src/app/api/subscription/toggle-cancel,
-- which uses the service role after verifying the caller owns the row.
create policy "self read subscription" on subscriptions
  for select to authenticated using (user_id = auth.uid());

-- usage_daily: a user can read (not write) their own usage rows; writes
-- happen server-side (service role) when a game is played.
create policy "self read usage" on usage_daily
  for select to authenticated using (user_id = auth.uid());

-- guest_usage: no auth session exists yet for guests, so this has to stay
-- open to the anon key like device_sightings/daily_records above — same
-- "fine for a soft nudge, not a security boundary" caveat.
create policy "anon read guest_usage" on guest_usage
  for select to anon using (true);
create policy "anon write guest_usage" on guest_usage
  for insert to anon with check (true);
create policy "anon update guest_usage" on guest_usage
  for update to anon using (true);

-- app_settings: readable by everyone (client needs it to show remaining
-- limits and whether guest mode is on) but only writable via the admin API
-- (service role), so there is no insert/update policy for anon/authenticated.
create policy "anyone read app_settings" on app_settings
  for select to anon, authenticated using (true);
