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
