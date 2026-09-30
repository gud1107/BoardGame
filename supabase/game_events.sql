-- Game funnel events + admin access (2026-10-01).
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Requires supabase/game_play_counts.sql and supabase/visitors.sql to have
-- been run first. Safe to re-run.
--
-- What it adds:
--   * game_events — one row per funnel step (hub click, room created,
--     invite-code button, joined a room, game started), with the anonymous
--     device id, nickname and a salted hash of the IP (never the raw IP).
--   * log_game_event() — the only write path (security definer), called by
--     the app's /api/analytics/event route (production only, automated
--     browsers excluded). A host's game_start is what bumps the public
--     game_play_counts now — opening a game page no longer does.
--   * site_admins + is_site_admin() — admin = a logged-in Supabase account
--     whose CONFIRMED email is listed here (freedom_03@naver.com).
--   * admin_* read functions for the /admin/games dashboard, each checking
--     is_site_admin() inside the database.

-- ── IP hashing salt (random per project, unreadable from the anon key) ──
create table if not exists analytics_secret (
  id int primary key default 1 check (id = 1),
  ip_salt text not null
);
alter table analytics_secret enable row level security;
insert into analytics_secret (id, ip_salt)
values (1, md5(random()::text || clock_timestamp()::text))
on conflict (id) do nothing;

create or replace function hash_ip(p_ip text) returns text as $$
  select case
    when p_ip is null or p_ip = '' then null
    else left(encode(sha256(convert_to(p_ip || (select ip_salt from analytics_secret where id = 1), 'UTF8')), 'hex'), 12)
  end;
$$ language sql stable security definer set search_path = public;
revoke all on function hash_ip(text) from public;

-- ── Events ──
create table if not exists game_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  game_id text not null,
  -- hub_click | room_create | invite_click | join | game_start
  event text not null,
  device_id text,
  nickname text,
  ip_hash text,
  room_code text,
  is_host boolean not null default false
);
create index if not exists game_events_game_idx on game_events (game_id, event);
create index if not exists game_events_created_idx on game_events (created_at desc);
create index if not exists game_events_device_idx on game_events (device_id);
alter table game_events enable row level security;

alter table visitor_devices add column if not exists ip_hash text;

create or replace function log_game_event(
  p_device_id text,
  p_game_id text,
  p_event text,
  p_room_code text,
  p_nickname text,
  p_ip text,
  p_is_host boolean
) returns void as $$
declare
  nick text := nullif(left(trim(coalesce(p_nickname, '')), 24), '');
  iph text := hash_ip(p_ip);
begin
  if p_game_id is null or p_game_id !~ '^[a-z0-9-]{1,48}$'
     or p_event not in ('hub_click', 'room_create', 'invite_click', 'join', 'game_start')
     or (p_device_id is not null and p_device_id !~ '^[0-9a-f-]{36}$') then
    return;
  end if;

  insert into game_events (game_id, event, device_id, nickname, ip_hash, room_code, is_host)
  values (p_game_id, p_event, p_device_id, nick, iph, left(p_room_code, 16), coalesce(p_is_host, false));

  if p_device_id is not null then
    update visitor_devices
      set ip_hash = coalesce(iph, ip_hash),
          nickname = coalesce(nick, nickname),
          last_seen = now()
      where device_id = p_device_id;
  end if;

  if p_event = 'game_start' then
    -- Everyone who actually played gets it on their visitor record…
    if p_device_id is not null then
      insert into visitor_devices (device_id, nickname, ip_hash, play_count, games)
      values (p_device_id, nick, iph, 1, jsonb_build_object(p_game_id, 1))
      on conflict (device_id) do update set
        play_count = visitor_devices.play_count + 1,
        games = jsonb_set(
          visitor_devices.games,
          array[p_game_id],
          to_jsonb(coalesce((visitor_devices.games ->> p_game_id)::int, 0) + 1)
        );
    end if;
    -- …but the public per-game count is one per match: the host's start.
    if coalesce(p_is_host, false) then
      insert into game_play_counts (game_id, plays, updated_at)
      values (p_game_id, 1, now())
      on conflict (game_id)
      do update set plays = game_play_counts.plays + 1, updated_at = now();
    end if;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function log_game_event(text, text, text, text, text, text, boolean) from public;
grant execute on function log_game_event(text, text, text, text, text, text, boolean) to anon, authenticated;

-- Visits now also carry the hashed IP (replaces the 6-arg version).
drop function if exists record_visitor_visit(text, text, text, text, text, text);
create or replace function record_visitor_visit(
  p_device_id text,
  p_path text,
  p_device_type text,
  p_os text,
  p_browser text,
  p_nickname text,
  p_ip text default null
) returns void as $$
declare
  nick text := nullif(left(trim(coalesce(p_nickname, '')), 24), '');
  iph text := hash_ip(p_ip);
begin
  if p_device_id is null or p_device_id !~ '^[0-9a-f-]{36}$' then
    return;
  end if;
  insert into visitor_devices (device_id, nickname, device_type, os, browser, visit_count, last_path, ip_hash)
  values (p_device_id, nick, left(p_device_type, 16), left(p_os, 24), left(p_browser, 24), 1, left(p_path, 120), iph)
  on conflict (device_id) do update set
    visit_count = visitor_devices.visit_count + 1,
    last_seen = now(),
    nickname = coalesce(nick, visitor_devices.nickname),
    device_type = excluded.device_type,
    os = excluded.os,
    browser = excluded.browser,
    last_path = excluded.last_path,
    ip_hash = coalesce(iph, visitor_devices.ip_hash);
end;
$$ language plpgsql security definer set search_path = public;
revoke all on function record_visitor_visit(text, text, text, text, text, text, text) from public;
grant execute on function record_visitor_visit(text, text, text, text, text, text, text) to anon, authenticated;

-- ── Admins ──
create table if not exists site_admins (
  email text primary key
);
alter table site_admins enable row level security;
insert into site_admins (email) values ('freedom_03@naver.com') on conflict do nothing;

create or replace function is_site_admin() returns boolean as $$
  select exists (
    select 1
    from auth.users u
    join site_admins a on lower(a.email) = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$ language sql stable security definer set search_path = public, auth;
revoke all on function is_site_admin() from public;
grant execute on function is_site_admin() to anon, authenticated;

-- Per-game funnel counts (optionally since a timestamp).
create or replace function admin_game_funnel(p_since timestamptz default null)
returns table (
  game_id text,
  hub_clicks bigint,
  room_creates bigint,
  invite_clicks bigint,
  joins bigint,
  game_starts bigint,
  unique_devices bigint,
  unique_ips bigint
) as $$
begin
  if not is_site_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select e.game_id,
      count(*) filter (where e.event = 'hub_click'),
      count(*) filter (where e.event = 'room_create'),
      count(*) filter (where e.event = 'invite_click'),
      count(*) filter (where e.event = 'join'),
      count(*) filter (where e.event = 'game_start' and e.is_host),
      count(distinct e.device_id),
      count(distinct e.ip_hash)
    from game_events e
    where p_since is null or e.created_at >= p_since
    group by e.game_id;
end;
$$ language plpgsql stable security definer set search_path = public;
revoke all on function admin_game_funnel(timestamptz) from public;
grant execute on function admin_game_funnel(timestamptz) to authenticated;

-- Every device that touched one game, for duplicate review (same IP hash /
-- same or several nicknames).
create or replace function admin_game_participants(p_game_id text, p_since timestamptz default null)
returns table (
  device_id text,
  nicknames text[],
  ip_hashes text[],
  hub_clicks bigint,
  room_creates bigint,
  invite_clicks bigint,
  joins bigint,
  game_starts bigint,
  first_at timestamptz,
  last_at timestamptz,
  device_type text,
  os text,
  browser text
) as $$
begin
  if not is_site_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select e.device_id,
      array_remove(array_agg(distinct e.nickname), null),
      array_remove(array_agg(distinct e.ip_hash), null),
      count(*) filter (where e.event = 'hub_click'),
      count(*) filter (where e.event = 'room_create'),
      count(*) filter (where e.event = 'invite_click'),
      count(*) filter (where e.event = 'join'),
      count(*) filter (where e.event = 'game_start'),
      min(e.created_at),
      max(e.created_at),
      max(v.device_type),
      max(v.os),
      max(v.browser)
    from game_events e
    left join visitor_devices v on v.device_id = e.device_id
    where e.game_id = p_game_id and (p_since is null or e.created_at >= p_since)
    group by e.device_id
    order by max(e.created_at) desc;
end;
$$ language plpgsql stable security definer set search_path = public;
revoke all on function admin_game_participants(text, timestamptz) from public;
grant execute on function admin_game_participants(text, timestamptz) to authenticated;

-- Site-wide visitor list for admins (same rows as /visitors, no password).
create or replace function admin_list_visitors()
returns setof visitor_devices as $$
begin
  if not is_site_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query select * from visitor_devices order by last_seen desc limit 5000;
end;
$$ language plpgsql stable security definer set search_path = public;
revoke all on function admin_list_visitors() from public;
grant execute on function admin_list_visitors() to authenticated;

-- The old "every game-page open" counter path is retired: plays now come
-- only from log_game_event('game_start', is_host = true).
revoke execute on function increment_game_play(text) from anon, authenticated;
revoke execute on function record_visitor_play(text, text, text) from anon, authenticated;
