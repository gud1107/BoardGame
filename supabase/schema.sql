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
  -- Site-wide kill switch for the entire entitlement/quota gate (see
  -- src/lib/entitlements/evaluate.ts). Restricted in the admin API to the
  -- super-admin account (src/lib/admin/superAdmin.ts) — other admins can
  -- still edit every other setting on this row, just not this one.
  -- Defaults to OFF (unlimited play, per explicit request) rather than the
  -- pre-existing per-tier caps — flip to true from /admin to re-enable them.
  entitlements_enabled boolean not null default false,
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
-- Safe to re-run even if app_settings was already created live before this column existed.
-- Also flips an existing row's caps off (matches the singleton's only real row, id=1).
alter table app_settings add column if not exists entitlements_enabled boolean not null default false;
update app_settings set entitlements_enabled = false where id = 1;

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

-- ---------------------------------------------------------------------------
-- Analytics: site visit tracking + game play tracking (admin stats
-- dashboard, see HANDOFF.md). Written by `src/app/api/analytics/*` route
-- handlers using the anon client (never the service role — see
-- `src/lib/supabase/serviceClient.ts`'s "admin routes only" rule) and read
-- exclusively by `src/app/api/admin/analytics/*` via `requireAdmin()` +
-- the service role.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- Raw per-visit log. `device_id` is the existing client-generated
-- `bg_device_id` (src/lib/identity/deviceId.ts) — same "weak signal, not
-- tamper-proof" caveat as device_sightings/guest_usage above.
create table if not exists site_visit_log (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  path text not null,
  device_type text not null default 'unknown' check (device_type in ('desktop', 'mobile', 'tablet', 'unknown')),
  created_at timestamptz not null default now()
);
create index if not exists site_visit_log_created_at_idx on site_visit_log (created_at);
create index if not exists site_visit_log_device_created_idx on site_visit_log (device_id, created_at);

-- Monthly rollup ('YYYY-MM'), maintained ONLY by the trigger below — never
-- written directly by app code, so it needs no client-reachable RLS policy.
create table if not exists monthly_visit_stats (
  month text primary key,
  total_visits int not null default 0,
  unique_visitors int not null default 0,
  updated_at timestamptz not null default now()
);

-- One row per game session, from "게임 시작" (insert) to "게임 종료"
-- (update sets ended_at + is_completed). `device_id` is best-effort and may
-- be null for older/edge-case clients — never required for the count itself.
create table if not exists game_play_log (
  id uuid primary key default gen_random_uuid(),
  game_id text not null,
  player_count int not null default 0,
  device_id text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  is_completed boolean not null default false
);
create index if not exists game_play_log_game_idx on game_play_log (game_id);
create index if not exists game_play_log_started_idx on game_play_log (started_at);

alter table site_visit_log enable row level security;
alter table monthly_visit_stats enable row level security;
alter table game_play_log enable row level security;

-- site_visit_log: anyone can insert (that's the whole point — anonymous
-- visitors have no session), but nobody can select/update via the anon key.
-- No select policy means the raw device_id+path history can only be read
-- with the service role (admin API) — unlike device_sightings/guest_usage,
-- this table is never read back by its own writer, so it doesn't need one.
create policy "anon insert site_visit_log" on site_visit_log
  for insert to anon, authenticated with check (true);

-- game_play_log: insert on start, update on end (isCompleted/ended_at).
-- Same "soft counter, not a security boundary" caveat as guest_usage/
-- device_sightings — anyone holding the anon key could in principle flip
-- another row's is_completed, but no per-player identity or entitlement
-- decision depends on this table, so that's an acceptable ceiling.
create policy "anon insert game_play_log" on game_play_log
  for insert to anon, authenticated with check (true);
create policy "anon update game_play_log" on game_play_log
  for update to anon, authenticated using (true);

-- monthly_visit_stats deliberately has NO anon/authenticated policies at
-- all — see the trigger below.

-- Atomically folds a new site_visit_log row into monthly_visit_stats.
-- Done as a DB trigger (SECURITY DEFINER, bypasses RLS) rather than an
-- app-level read-modify-write upsert so that concurrent visits from
-- different tabs/users can never race each other into an undercount, and
-- so this table never needs a client-reachable write policy.
create or replace function bump_monthly_visit_stats() returns trigger as $$
declare
  month_key text := to_char(new.created_at, 'YYYY-MM');
  already_seen boolean;
begin
  select exists (
    select 1 from site_visit_log
    where device_id = new.device_id
      and id <> new.id
      and to_char(created_at, 'YYYY-MM') = month_key
  ) into already_seen;

  insert into monthly_visit_stats (month, total_visits, unique_visitors, updated_at)
  values (month_key, 1, case when already_seen then 0 else 1 end, now())
  on conflict (month) do update set
    total_visits = monthly_visit_stats.total_visits + 1,
    unique_visitors = monthly_visit_stats.unique_visitors + (case when already_seen then 0 else 1 end),
    updated_at = now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_bump_monthly_visit_stats on site_visit_log;
create trigger trg_bump_monthly_visit_stats
  after insert on site_visit_log
  for each row execute function bump_monthly_visit_stats();

-- ---------------------------------------------------------------------------
-- Chat: global lobby ('global:lobby') + per-room waiting/in-game chat
-- ('room:<gameId>:<roomCode>', e.g. 'room:perudo:4821'). Live delivery
-- happens over Supabase Realtime broadcast (event 'chat-message') on the
-- SAME channel each online game already opens for its own state sync — this
-- table only exists so the last 30 messages can be reloaded on join/refresh,
-- it is not the live delivery path. Same "anon-permissive, not a security
-- boundary, fine for a small group app" posture as device_sightings/
-- guest_usage above — no auth layer gates this.
-- ---------------------------------------------------------------------------

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  device_id text not null,
  sender_name text not null,
  body text not null,
  msg_type text not null default 'USER' check (msg_type in ('USER', 'SYSTEM', 'EMOJI')),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_channel_idx on chat_messages (channel, created_at desc);

alter table chat_messages enable row level security;

create policy "anon read chat_messages" on chat_messages
  for select to anon using (true);
create policy "anon insert chat_messages" on chat_messages
  for insert to anon with check (true);

-- No retention job: this is a small-scale app with no scheduled jobs
-- anywhere else in the schema either. The loader always does
-- `... order by created_at desc limit 30`, so read cost never grows with
-- table size. If this table ever gets large, a manual
-- `delete from chat_messages where created_at < now() - interval '30 days'`
-- in the SQL editor is enough — no infrastructure needed for that today.
