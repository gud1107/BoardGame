-- Base tables the app already reads on every page (2026-10-02).
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run. Safe to
-- re-run (policies are only created when missing).
--
-- These four come from schema.sql, which was never applied to the live
-- project, so every page logged 404s for them in the browser console. The
-- app already falls back to its built-in defaults when they're missing, and
-- the defaults below are the same values — creating them changes nothing
-- users see, except that the desktop lobby's "N개 방 오픈" badges and the
-- lobby chat history start working as designed.
--   app_settings  — site settings (guest mode ON, play limits OFF by default)
--   guest_usage   — per-device daily usage for guests (only enforced if limits are turned on)
--   active_rooms  — joinable rooms: lobby "N개 방 오픈" badges + 🌐 공개방 list
--   chat_messages — lobby chat history
-- Note: the editor may ask to confirm because of the word "delete" (the
-- active_rooms policy, and the 30-day chat pruning at the end) — expected;
-- choose "Run this query". Nothing is dropped; only chat older than 30 days is ever removed.

-- ── app_settings ──
create table if not exists app_settings (
  id int primary key default 1,
  guest_mode_enabled boolean not null default true,
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
alter table app_settings enable row level security;

-- ── guest_usage ──
create table if not exists guest_usage (
  device_id text not null,
  date date not null,
  games_used int not null default 0,
  minutes_used int not null default 0,
  primary key (device_id, date)
);
alter table guest_usage enable row level security;

-- ── active_rooms ──
create table if not exists active_rooms (
  id text primary key,
  game_id text not null,
  room_code text not null,
  host_name text,
  player_count int not null default 1,
  max_players int not null default 1,
  updated_at timestamptz not null default now()
);
create index if not exists active_rooms_updated_idx on active_rooms (updated_at desc);
create index if not exists active_rooms_game_idx on active_rooms (game_id);
alter table active_rooms enable row level security;
-- 🌐 공개방 / 🔒 비공개방 + room title (2026-10-07). Only public rooms are listed in the
-- lobby's room browser; private ones stay reachable by invite code only.
-- `add column if not exists` covers a table created before this column.
alter table active_rooms add column if not exists is_public boolean not null default true;
-- Optional host-typed room title shown in the public-room list (≤30 chars).
alter table active_rooms add column if not exists title text check (title is null or char_length(title) <= 30);
-- Live room-list updates (Realtime postgres_changes). The client also polls
-- every 15s, so this only makes new rooms show up faster.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'active_rooms') then
    alter publication supabase_realtime add table active_rooms;
  end if;
end $$;

-- ── chat_messages ──
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

-- ── Policies (same as schema.sql), created only if missing ──
do $$
declare
  p record;
begin
  for p in
    select * from (values
      ('app_settings',  'anyone read app_settings', 'create policy "anyone read app_settings" on app_settings for select to anon, authenticated using (true)'),
      ('guest_usage',   'anon read guest_usage',    'create policy "anon read guest_usage" on guest_usage for select to anon using (true)'),
      ('guest_usage',   'anon write guest_usage',   'create policy "anon write guest_usage" on guest_usage for insert to anon with check (true)'),
      ('guest_usage',   'anon update guest_usage',  'create policy "anon update guest_usage" on guest_usage for update to anon using (true)'),
      ('active_rooms',  'anon read active_rooms',   'create policy "anon read active_rooms" on active_rooms for select to anon, authenticated using (true)'),
      ('active_rooms',  'anon write active_rooms',  'create policy "anon write active_rooms" on active_rooms for insert to anon, authenticated with check (true)'),
      ('active_rooms',  'anon update active_rooms', 'create policy "anon update active_rooms" on active_rooms for update to anon, authenticated using (true)'),
      ('active_rooms',  'anon delete active_rooms', 'create policy "anon delete active_rooms" on active_rooms for delete to anon, authenticated using (true)'),
      ('chat_messages', 'anon read chat_messages',  'create policy "anon read chat_messages" on chat_messages for select to anon using (true)'),
      ('chat_messages', 'anon insert chat_messages','create policy "anon insert chat_messages" on chat_messages for insert to anon with check (true)')
    ) as t(tbl, name, ddl)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = p.name) then
      execute p.ddl;
    end if;
  end loop;
end $$;

-- ── Lobby chat retention: keep 30 days ──
-- The lobby only ever shows the latest few dozen messages, so older rows
-- are dead weight. Rather than a scheduled job, roughly one insert in 20
-- clears messages older than 30 days (cheap, and needs no extension).
-- Change the interval below to keep more or less.
create or replace function prune_old_chat_messages() returns trigger as $$
begin
  if random() < 0.05 then
    delete from chat_messages where created_at < now() - interval '30 days';
  end if;
  return new;
exception when others then
  return new; -- pruning must never block a message from being saved
end;
$$ language plpgsql security definer set search_path = public;
revoke all on function prune_old_chat_messages() from public, anon, authenticated;

create or replace trigger chat_messages_prune after insert on chat_messages
  for each row execute function prune_old_chat_messages();
