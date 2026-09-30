-- Visitor tracking (2026-10-01) — who visited, and who came back.
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- BEFORE RUNNING: change the password on the `pw text := ...` line near the
-- bottom (8+ characters). That password unlocks the /visitors page.
-- Safe to re-run (re-running with a new password replaces the old one).
--
-- One row per anonymous browser (`bg_device_id` in localStorage). No IP
-- address is stored. The table has RLS on and NO policies, so the anon key
-- can neither read nor write it directly — writes go through the two
-- security-definer record_* functions (called by the app's server routes,
-- production only, automated browsers excluded), and reads only through
-- list_visitors(password).

create table if not exists visitor_devices (
  device_id text primary key,
  nickname text,
  device_type text,
  os text,
  browser text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  visit_count int not null default 0,
  play_count int not null default 0,
  -- { "<gameId>": <plays>, ... }
  games jsonb not null default '{}'::jsonb,
  last_path text
);
create index if not exists visitor_devices_last_seen_idx on visitor_devices (last_seen desc);

alter table visitor_devices enable row level security;

-- Single-row table holding the SHA-256 of the /visitors page password.
-- RLS on, no policies: unreadable from the anon key.
create table if not exists visitor_admin_key (
  id int primary key default 1 check (id = 1),
  key_hash text not null
);
alter table visitor_admin_key enable row level security;

create or replace function record_visitor_visit(
  p_device_id text,
  p_path text,
  p_device_type text,
  p_os text,
  p_browser text,
  p_nickname text
) returns void as $$
declare
  nick text := nullif(left(trim(coalesce(p_nickname, '')), 24), '');
begin
  if p_device_id is null or p_device_id !~ '^[0-9a-f-]{36}$' then
    return;
  end if;
  insert into visitor_devices (device_id, nickname, device_type, os, browser, visit_count, last_path)
  values (p_device_id, nick, left(p_device_type, 16), left(p_os, 24), left(p_browser, 24), 1, left(p_path, 120))
  on conflict (device_id) do update set
    visit_count = visitor_devices.visit_count + 1,
    last_seen = now(),
    nickname = coalesce(nick, visitor_devices.nickname),
    device_type = excluded.device_type,
    os = excluded.os,
    browser = excluded.browser,
    last_path = excluded.last_path;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function record_visitor_play(
  p_device_id text,
  p_game_id text,
  p_nickname text
) returns void as $$
declare
  nick text := nullif(left(trim(coalesce(p_nickname, '')), 24), '');
begin
  if p_device_id is null or p_device_id !~ '^[0-9a-f-]{36}$'
     or p_game_id is null or p_game_id !~ '^[a-z0-9-]{1,48}$' then
    return;
  end if;
  insert into visitor_devices (device_id, nickname, play_count, games)
  values (p_device_id, nick, 1, jsonb_build_object(p_game_id, 1))
  on conflict (device_id) do update set
    play_count = visitor_devices.play_count + 1,
    games = jsonb_set(
      visitor_devices.games,
      array[p_game_id],
      to_jsonb(coalesce((visitor_devices.games ->> p_game_id)::int, 0) + 1)
    ),
    last_seen = now(),
    nickname = coalesce(nick, visitor_devices.nickname);
end;
$$ language plpgsql security definer set search_path = public;

create or replace function list_visitors(p_password text)
returns setof visitor_devices as $$
begin
  if not exists (
    select 1 from visitor_admin_key
    where key_hash = encode(sha256(convert_to(coalesce(p_password, ''), 'UTF8')), 'hex')
  ) then
    perform pg_sleep(1); -- slow down password guessing
    raise exception 'invalid password' using errcode = '28P01';
  end if;
  return query select * from visitor_devices order by last_seen desc limit 5000;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function record_visitor_visit(text, text, text, text, text, text) from public;
revoke all on function record_visitor_play(text, text, text) from public;
revoke all on function list_visitors(text) from public;
grant execute on function record_visitor_visit(text, text, text, text, text, text) to anon, authenticated;
grant execute on function record_visitor_play(text, text, text) to anon, authenticated;
grant execute on function list_visitors(text) to anon, authenticated;

-- ▼▼▼ Set the /visitors page password here (8+ characters) ▼▼▼
do $$
declare
  pw text := '여기에-비밀번호-입력';
begin
  if pw = '여기에-비밀번호-입력' or length(pw) < 8 then
    raise exception '비밀번호를 8자 이상으로 바꾼 뒤 실행하세요 (pw 줄)';
  end if;
  insert into visitor_admin_key (id, key_hash)
  values (1, encode(sha256(convert_to(pw, 'UTF8')), 'hex'))
  on conflict (id) do update set key_hash = excluded.key_hash;
end $$;
