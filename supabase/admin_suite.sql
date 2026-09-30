-- Admin suite (2026-10-01): trends, hours, drop-off, rooms, traffic
-- sources, "exclude me", bug reports, site notice, game visibility.
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Requires game_play_counts.sql, visitors.sql and game_events.sql to have
-- been run first. Also covers everything in game_events_ip.sql and
-- play_stats_monthly.sql, so those two don't need running separately.
-- Compatible with the app version already deployed. Safe to re-run.

-- ═══════════════════════ 0. Raw IP columns (from game_events_ip.sql) ═══════════════════════
alter table game_events add column if not exists ip text;
alter table visitor_devices add column if not exists ip text;

-- ═══════════════════════ 1. Per-visit log (trends, hours, sources) ═══════════════════════
create table if not exists site_visits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device_id text,
  is_new boolean not null default false,
  ip text,
  ip_hash text,
  -- 카카오톡 / 인스타그램 / 검색(네이버) / 직접 방문 … (classified by the app)
  source text,
  referrer_host text,
  device_type text,
  path text
);
create index if not exists site_visits_created_idx on site_visits (created_at desc);
alter table site_visits enable row level security;

drop function if exists record_visitor_visit(text, text, text, text, text, text);
drop function if exists record_visitor_visit(text, text, text, text, text, text, text);
create or replace function record_visitor_visit(
  p_device_id text,
  p_path text,
  p_device_type text,
  p_os text,
  p_browser text,
  p_nickname text,
  p_ip text default null,
  p_source text default null,
  p_referrer_host text default null
) returns void as $$
declare
  nick text := nullif(left(trim(coalesce(p_nickname, '')), 24), '');
  v_ip text := nullif(left(trim(coalesce(p_ip, '')), 45), '');
  iph text := hash_ip(p_ip);
  v_is_new boolean;
begin
  if p_device_id is null or p_device_id !~ '^[0-9a-f-]{36}$' then
    return;
  end if;
  v_is_new := not exists (select 1 from visitor_devices d where d.device_id = p_device_id);

  insert into site_visits (device_id, is_new, ip, ip_hash, source, referrer_host, device_type, path)
  values (p_device_id, v_is_new, v_ip, iph, left(p_source, 24), left(p_referrer_host, 80), left(p_device_type, 16), left(p_path, 120));

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
revoke all on function record_visitor_visit(text, text, text, text, text, text, text, text, text) from public;
grant execute on function record_visitor_visit(text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- ═══════════════════════ 2. Events: add game_end (room durations) ═══════════════════════

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
     or p_event not in ('hub_click', 'room_create', 'invite_click', 'join', 'game_start', 'game_end')
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

-- ═══════════════════════ 3. "Exclude me" helper ═══════════════════════
-- True when a row belongs to the admin being excluded (their device id, or
-- their current IP — matched on the raw IP or, for older rows, its hash).
create or replace function is_excluded_row(
  r_device text, r_ip text, r_ip_hash text,
  p_ex_device text, p_ex_ip text, p_ex_hash text
) returns boolean as $$
  select (p_ex_device is not null and r_device = p_ex_device)
      or (p_ex_ip is not null and r_ip = p_ex_ip)
      or (p_ex_hash is not null and r_ip_hash = p_ex_hash);
$$ language sql immutable;

-- ═══════════════════════ 4. Admin read functions ═══════════════════════
drop function if exists admin_game_funnel(timestamptz);
create or replace function admin_game_funnel(
  p_since timestamptz default null,
  p_ex_ip text default null,
  p_ex_device text default null
) returns table (
  game_id text, hub_clicks bigint, room_creates bigint, invite_clicks bigint,
  joins bigint, game_starts bigint, game_ends bigint, unique_devices bigint, unique_ips bigint
) as $$
declare v_ex_hash text := hash_ip(p_ex_ip);
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    select e.game_id,
      count(*) filter (where e.event = 'hub_click'),
      count(*) filter (where e.event = 'room_create'),
      count(*) filter (where e.event = 'invite_click'),
      count(*) filter (where e.event = 'join'),
      count(*) filter (where e.event = 'game_start' and e.is_host),
      count(*) filter (where e.event = 'game_end' and e.is_host),
      count(distinct e.device_id),
      count(distinct e.ip_hash)
    from game_events e
    where (p_since is null or e.created_at >= p_since)
      and not is_excluded_row(e.device_id, e.ip, e.ip_hash, p_ex_device, p_ex_ip, v_ex_hash)
    group by e.game_id;
end;
$$ language plpgsql stable security definer set search_path = public;

drop function if exists admin_game_participants(text, timestamptz);
create or replace function admin_game_participants(
  p_game_id text,
  p_since timestamptz default null,
  p_ex_ip text default null,
  p_ex_device text default null
) returns table (
  device_id text, nicknames text[], ip_hashes text[], ip_map jsonb,
  hub_clicks bigint, room_creates bigint, invite_clicks bigint, joins bigint, game_starts bigint,
  first_at timestamptz, last_at timestamptz, device_type text, os text, browser text
) as $$
declare v_ex_hash text := hash_ip(p_ex_ip);
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
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
      min(e.created_at), max(e.created_at),
      max(v.device_type), max(v.os), max(v.browser)
    from game_events e
    left join visitor_devices v on v.device_id = e.device_id
    where e.game_id = p_game_id
      and (p_since is null or e.created_at >= p_since)
      and not is_excluded_row(e.device_id, e.ip, e.ip_hash, p_ex_device, p_ex_ip, v_ex_hash)
    group by e.device_id
    order by max(e.created_at) desc;
end;
$$ language plpgsql stable security definer set search_path = public;

-- Daily trend (Korea days): visitors, new vs returning, visits, room creates, game starts.
create or replace function admin_daily_stats(
  p_days int default 30,
  p_ex_ip text default null,
  p_ex_device text default null
) returns table (
  day date, visitors bigint, new_visitors bigint, returning_visitors bigint,
  visits bigint, room_creates bigint, game_starts bigint
) as $$
declare
  v_ex_hash text := hash_ip(p_ex_ip);
  v_from date := (now() at time zone 'Asia/Seoul')::date - (greatest(p_days, 1) - 1);
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    with days as (
      select generate_series(v_from, (now() at time zone 'Asia/Seoul')::date, interval '1 day')::date as d
    ),
    v as (
      select (s.created_at at time zone 'Asia/Seoul')::date as d,
        count(distinct s.device_id) as visitors,
        count(distinct s.device_id) filter (where s.is_new) as new_visitors,
        count(*) as visits
      from site_visits s
      where s.created_at >= (v_from::timestamp at time zone 'Asia/Seoul')
        and not is_excluded_row(s.device_id, s.ip, s.ip_hash, p_ex_device, p_ex_ip, v_ex_hash)
      group by 1
    ),
    g as (
      select (e.created_at at time zone 'Asia/Seoul')::date as d,
        count(*) filter (where e.event = 'room_create') as room_creates,
        count(*) filter (where e.event = 'game_start' and e.is_host) as game_starts
      from game_events e
      where e.created_at >= (v_from::timestamp at time zone 'Asia/Seoul')
        and not is_excluded_row(e.device_id, e.ip, e.ip_hash, p_ex_device, p_ex_ip, v_ex_hash)
      group by 1
    )
    select days.d,
      coalesce(v.visitors, 0), coalesce(v.new_visitors, 0),
      coalesce(v.visitors, 0) - coalesce(v.new_visitors, 0),
      coalesce(v.visits, 0), coalesce(g.room_creates, 0), coalesce(g.game_starts, 0)
    from days
    left join v on v.d = days.d
    left join g on g.d = days.d
    order by days.d;
end;
$$ language plpgsql stable security definer set search_path = public;

-- Weekday × hour heatmap (Korea time). dow: 0 = Sunday.
create or replace function admin_hourly_stats(
  p_since timestamptz default null,
  p_ex_ip text default null,
  p_ex_device text default null
) returns table (dow int, hour int, visits bigint, game_starts bigint) as $$
declare v_ex_hash text := hash_ip(p_ex_ip);
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    with v as (
      select extract(dow from s.created_at at time zone 'Asia/Seoul')::int as dw,
             extract(hour from s.created_at at time zone 'Asia/Seoul')::int as hr,
             count(*) as n
      from site_visits s
      where (p_since is null or s.created_at >= p_since)
        and not is_excluded_row(s.device_id, s.ip, s.ip_hash, p_ex_device, p_ex_ip, v_ex_hash)
      group by 1, 2
    ),
    g as (
      select extract(dow from e.created_at at time zone 'Asia/Seoul')::int as dw,
             extract(hour from e.created_at at time zone 'Asia/Seoul')::int as hr,
             count(*) as n
      from game_events e
      where e.event = 'game_start' and e.is_host
        and (p_since is null or e.created_at >= p_since)
        and not is_excluded_row(e.device_id, e.ip, e.ip_hash, p_ex_device, p_ex_ip, v_ex_hash)
      group by 1, 2
    )
    select coalesce(v.dw, g.dw), coalesce(v.hr, g.hr), coalesce(v.n, 0), coalesce(g.n, 0)
    from v full outer join g on g.dw = v.dw and g.hr = v.hr;
end;
$$ language plpgsql stable security definer set search_path = public;

-- One row per room (game + room code + Korea day — 4-digit codes get reused).
create or replace function admin_rooms(
  p_since timestamptz default null,
  p_ex_ip text default null,
  p_ex_device text default null
) returns table (
  game_id text, room_code text, day date, opened_at timestamptz, host_nickname text,
  players bigint, joins bigint, starts bigint, ends bigint, minutes numeric, last_at timestamptz
) as $$
declare v_ex_hash text := hash_ip(p_ex_ip);
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    select e.game_id, e.room_code, (e.created_at at time zone 'Asia/Seoul')::date,
      min(e.created_at),
      max(e.nickname) filter (where e.event = 'room_create'),
      count(distinct e.device_id) filter (where e.event in ('room_create', 'join')),
      count(*) filter (where e.event = 'join'),
      count(*) filter (where e.event = 'game_start' and e.is_host),
      count(*) filter (where e.event = 'game_end' and e.is_host),
      round((extract(epoch from (
        max(e.created_at) filter (where e.event = 'game_end' and e.is_host)
        - min(e.created_at) filter (where e.event = 'game_start' and e.is_host)
      )) / 60)::numeric, 1),
      max(e.created_at)
    from game_events e
    where e.room_code is not null
      and (p_since is null or e.created_at >= p_since)
      and not is_excluded_row(e.device_id, e.ip, e.ip_hash, p_ex_device, p_ex_ip, v_ex_hash)
    group by 1, 2, 3
    order by max(e.created_at) desc
    limit 500;
end;
$$ language plpgsql stable security definer set search_path = public;

-- Where visits come from.
create or replace function admin_traffic_sources(
  p_since timestamptz default null,
  p_ex_ip text default null,
  p_ex_device text default null
) returns table (source text, visits bigint, visitors bigint, new_visitors bigint) as $$
declare v_ex_hash text := hash_ip(p_ex_ip);
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    select coalesce(s.source, '알 수 없음'), count(*), count(distinct s.device_id),
      count(distinct s.device_id) filter (where s.is_new)
    from site_visits s
    where (p_since is null or s.created_at >= p_since)
      and not is_excluded_row(s.device_id, s.ip, s.ip_hash, p_ex_device, p_ex_ip, v_ex_hash)
    group by 1
    order by 2 desc;
end;
$$ language plpgsql stable security definer set search_path = public;

-- ═══════════════════════ 5. Site notice banner ═══════════════════════
create table if not exists site_notice (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  message text not null default '',
  -- info | warning | maintenance
  level text not null default 'info' check (level in ('info', 'warning', 'maintenance')),
  updated_at timestamptz not null default now()
);
alter table site_notice enable row level security;
drop policy if exists "anyone read site_notice" on site_notice;
create policy "anyone read site_notice" on site_notice for select to anon, authenticated using (true);
insert into site_notice (id) values (1) on conflict do nothing;

create or replace function admin_set_notice(p_enabled boolean, p_message text, p_level text)
returns void as $$
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update site_notice
    set enabled = coalesce(p_enabled, false),
        message = left(coalesce(p_message, ''), 300),
        level = case when p_level in ('info', 'warning', 'maintenance') then p_level else 'info' end,
        updated_at = now()
    where id = 1;
end;
$$ language plpgsql security definer set search_path = public;

-- ═══════════════════════ 6. Game visibility overrides ═══════════════════════
create table if not exists game_overrides (
  game_id text primary key,
  hidden boolean not null default false,
  coming_soon boolean not null default false,
  featured boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table game_overrides enable row level security;
drop policy if exists "anyone read game_overrides" on game_overrides;
create policy "anyone read game_overrides" on game_overrides for select to anon, authenticated using (true);

create or replace function admin_set_game_override(
  p_game_id text, p_hidden boolean, p_coming_soon boolean, p_featured boolean
) returns void as $$
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_game_id is null or p_game_id !~ '^[a-z0-9-]{1,48}$' then return; end if;
  insert into game_overrides (game_id, hidden, coming_soon, featured, updated_at)
  values (p_game_id, coalesce(p_hidden, false), coalesce(p_coming_soon, false), coalesce(p_featured, false), now())
  on conflict (game_id) do update set
    hidden = excluded.hidden, coming_soon = excluded.coming_soon,
    featured = excluded.featured, updated_at = now();
end;
$$ language plpgsql security definer set search_path = public;

-- ═══════════════════════ 7. Bug reports (existing app feature) ═══════════════════════
-- The app's bug-report routes already exist; they need these two tables
-- plus SUPABASE_SERVICE_ROLE_KEY set in Vercel (see the setup notes).
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  nickname text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);
alter table profiles add column if not exists avatar_url text;
alter table profiles enable row level security;
drop policy if exists "self read profile" on profiles;
create policy "self read profile" on profiles for select to authenticated using (auth.uid() = id);

create table if not exists bug_reports (
  id uuid primary key default gen_random_uuid(),
  game_id text,
  game_name text,
  title text not null,
  description text not null,
  author_id uuid references profiles (id) on delete cascade,
  author_name text not null,
  password_hash text,
  is_guest boolean not null default false,
  device_id text,
  phone text,
  attachment jsonb,
  status text not null default '접수됨' check (status in ('접수됨', '확인 중', '수정 완료')),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bug_reports_created_idx on bug_reports (created_at desc) where is_deleted = false;
create index if not exists bug_reports_author_idx on bug_reports (author_id);
create index if not exists bug_reports_guest_device_idx on bug_reports (device_id, created_at desc) where is_guest = true;
alter table bug_reports enable row level security;

-- The admin's own profile row, marked admin.
insert into profiles (id, email, role)
select u.id, u.email, 'admin' from auth.users u
where lower(u.email) in (select lower(a.email) from site_admins a)
on conflict (id) do update set role = 'admin';

-- ═══════════════════════ 8. Lobby monthly counts + reset (from play_stats_monthly.sql) ═══════════════════════
-- Lobby cards read "🔥 10월 N회 플레이" (real host starts this Korea-time
-- month) and 인기순 sorts by the all-time total — both counted straight
-- from game_events, so the retired "opening a game page = +1" counts can't
-- appear.
create or replace function public_game_play_stats()
returns table (game_id text, total_plays bigint, month_plays bigint) as $$
  select e.game_id,
    count(*),
    count(*) filter (
      where e.created_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
    )
  from game_events e
  where e.event = 'game_start' and e.is_host
  group by e.game_id;
$$ language sql stable security definer set search_path = public;
revoke all on function public_game_play_stats() from public;
grant execute on function public_game_play_stats() to anon, authenticated;

-- Reset game_play_counts to real starts only.
delete from game_play_counts;
insert into game_play_counts (game_id, plays, updated_at)
select e.game_id, count(*), max(e.created_at)
from game_events e
where e.event = 'game_start' and e.is_host
group by e.game_id;

-- ═══════════════════════ 9. Permissions ═══════════════════════
-- Supabase's default privileges also grant anon EXECUTE on new functions;
-- admin functions are for signed-in admins only (and re-check inside).
do $$
declare f text;
begin
  foreach f in array array[
    'admin_game_funnel(timestamptz, text, text)',
    'admin_game_participants(text, timestamptz, text, text)',
    'admin_daily_stats(int, text, text)',
    'admin_hourly_stats(timestamptz, text, text)',
    'admin_rooms(timestamptz, text, text)',
    'admin_traffic_sources(timestamptz, text, text)',
    'admin_set_notice(boolean, text, text)',
    'admin_set_game_override(text, boolean, boolean, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function is_excluded_row(text, text, text, text, text, text) from anon;
revoke execute on function hash_ip(text) from anon, authenticated;
revoke execute on function admin_list_visitors() from anon;
