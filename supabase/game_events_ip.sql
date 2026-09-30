-- Raw IP for admins (2026-10-01).
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Requires supabase/game_events.sql first. Safe to re-run.
--
-- Until now only a salted hash of the IP was stored, which can be compared
-- but never turned back into an address. From this point on the raw IP is
-- stored too, so /admin/games can show it when an admin clicks a device's
-- IP. Rows recorded before this ran keep the hash only.
-- Both tables stay RLS-locked with no policies: only the admin RPCs below
-- (is_site_admin) and the password-gated list_visitors can read them.

alter table game_events add column if not exists ip text;
alter table visitor_devices add column if not exists ip text;

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
  v_ip text := nullif(left(trim(coalesce(p_ip, '')), 45), '');
  iph text := hash_ip(p_ip);
begin
  if p_game_id is null or p_game_id !~ '^[a-z0-9-]{1,48}$'
     or p_event not in ('hub_click', 'room_create', 'invite_click', 'join', 'game_start')
     or (p_device_id is not null and p_device_id !~ '^[0-9a-f-]{36}$') then
    return;
  end if;

  insert into game_events (game_id, event, device_id, nickname, ip_hash, ip, room_code, is_host)
  values (p_game_id, p_event, p_device_id, nick, iph, v_ip, left(p_room_code, 16), coalesce(p_is_host, false));

  if p_device_id is not null then
    update visitor_devices
      set ip_hash = coalesce(iph, ip_hash),
          ip = coalesce(v_ip, visitor_devices.ip),
          nickname = coalesce(nick, nickname),
          last_seen = now()
      where device_id = p_device_id;
  end if;

  if p_event = 'game_start' then
    if p_device_id is not null then
      insert into visitor_devices (device_id, nickname, ip_hash, ip, play_count, games)
      values (p_device_id, nick, iph, v_ip, 1, jsonb_build_object(p_game_id, 1))
      on conflict (device_id) do update set
        play_count = visitor_devices.play_count + 1,
        games = jsonb_set(
          visitor_devices.games,
          array[p_game_id],
          to_jsonb(coalesce((visitor_devices.games ->> p_game_id)::int, 0) + 1)
        );
    end if;
    if coalesce(p_is_host, false) then
      insert into game_play_counts (game_id, plays, updated_at)
      values (p_game_id, 1, now())
      on conflict (game_id)
      do update set plays = game_play_counts.plays + 1, updated_at = now();
    end if;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

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
  v_ip text := nullif(left(trim(coalesce(p_ip, '')), 45), '');
  iph text := hash_ip(p_ip);
begin
  if p_device_id is null or p_device_id !~ '^[0-9a-f-]{36}$' then
    return;
  end if;
  insert into visitor_devices (device_id, nickname, device_type, os, browser, visit_count, last_path, ip_hash, ip)
  values (p_device_id, nick, left(p_device_type, 16), left(p_os, 24), left(p_browser, 24), 1, left(p_path, 120), iph, v_ip)
  on conflict (device_id) do update set
    visit_count = visitor_devices.visit_count + 1,
    last_seen = now(),
    nickname = coalesce(nick, visitor_devices.nickname),
    device_type = excluded.device_type,
    os = excluded.os,
    browser = excluded.browser,
    last_path = excluded.last_path,
    ip_hash = coalesce(iph, visitor_devices.ip_hash),
    ip = coalesce(excluded.ip, visitor_devices.ip);
end;
$$ language plpgsql security definer set search_path = public;

-- Return type changes (adds ip_map), so drop and recreate.
drop function if exists admin_game_participants(text, timestamptz);
create function admin_game_participants(p_game_id text, p_since timestamptz default null)
returns table (
  device_id text,
  nicknames text[],
  ip_hashes text[],
  -- { "<ip_hash>": "<raw ip>" } for rows recorded after this migration
  ip_map jsonb,
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
      coalesce(jsonb_object_agg(e.ip_hash, e.ip) filter (where e.ip_hash is not null and e.ip is not null), '{}'::jsonb),
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
revoke all on function admin_game_participants(text, timestamptz) from public, anon;
grant execute on function admin_game_participants(text, timestamptz) to authenticated;

-- Tighten helpers that Supabase's default privileges also exposed to anon.
revoke execute on function hash_ip(text) from anon, authenticated;
revoke execute on function admin_game_funnel(timestamptz) from anon;
revoke execute on function admin_list_visitors() from anon;
