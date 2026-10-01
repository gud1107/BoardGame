-- Monthly stats for /admin/games (2026-10-02).
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Requires supabase/admin_suite.sql first. Only adds functions (no DROP or
-- DELETE), so the editor won't ask for a destructive-operation confirmation.
-- Safe to re-run.

-- Site-wide numbers per Korea-time calendar month. visitors / active_players
-- are distinct devices within the month (not a sum of daily counts).
create or replace function admin_monthly_stats(
  p_months int default 12,
  p_ex_ip text default null,
  p_ex_device text default null
) returns table (
  month date,
  visitors bigint,
  new_visitors bigint,
  returning_visitors bigint,
  visits bigint,
  room_creates bigint,
  joins bigint,
  game_starts bigint,
  game_ends bigint,
  active_players bigint
) as $$
declare
  v_ex_hash text := hash_ip(p_ex_ip);
  v_this date := date_trunc('month', now() at time zone 'Asia/Seoul')::date;
  v_from date := (v_this - make_interval(months => greatest(p_months, 1) - 1))::date;
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    with months as (
      select generate_series(v_from, v_this, interval '1 month')::date as m
    ),
    v as (
      select date_trunc('month', s.created_at at time zone 'Asia/Seoul')::date as m,
        count(distinct s.device_id) as n_visitors,
        count(distinct s.device_id) filter (where s.is_new) as n_new,
        count(*) as n_visits
      from site_visits s
      where s.created_at >= (v_from::timestamp at time zone 'Asia/Seoul')
        and not is_excluded_row(s.device_id, s.ip, s.ip_hash, p_ex_device, p_ex_ip, v_ex_hash)
      group by 1
    ),
    g as (
      select date_trunc('month', e.created_at at time zone 'Asia/Seoul')::date as m,
        count(*) filter (where e.event = 'room_create') as n_rooms,
        count(*) filter (where e.event = 'join') as n_joins,
        count(*) filter (where e.event = 'game_start' and e.is_host) as n_starts,
        count(*) filter (where e.event = 'game_end' and e.is_host) as n_ends,
        count(distinct e.device_id) filter (where e.event = 'game_start') as n_players
      from game_events e
      where e.created_at >= (v_from::timestamp at time zone 'Asia/Seoul')
        and not is_excluded_row(e.device_id, e.ip, e.ip_hash, p_ex_device, p_ex_ip, v_ex_hash)
      group by 1
    )
    select months.m,
      coalesce(v.n_visitors, 0), coalesce(v.n_new, 0),
      coalesce(v.n_visitors, 0) - coalesce(v.n_new, 0),
      coalesce(v.n_visits, 0),
      coalesce(g.n_rooms, 0), coalesce(g.n_joins, 0),
      coalesce(g.n_starts, 0), coalesce(g.n_ends, 0), coalesce(g.n_players, 0)
    from months
    left join v on v.m = months.m
    left join g on g.m = months.m
    order by months.m;
end;
$$ language plpgsql stable security definer set search_path = public;

-- Per game, per month.
create or replace function admin_monthly_game_stats(
  p_months int default 12,
  p_ex_ip text default null,
  p_ex_device text default null
) returns table (
  month date,
  game_id text,
  hub_clicks bigint,
  room_creates bigint,
  joins bigint,
  game_starts bigint,
  players bigint
) as $$
declare
  v_ex_hash text := hash_ip(p_ex_ip);
  v_this date := date_trunc('month', now() at time zone 'Asia/Seoul')::date;
  v_from date := (v_this - make_interval(months => greatest(p_months, 1) - 1))::date;
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    select date_trunc('month', e.created_at at time zone 'Asia/Seoul')::date,
      e.game_id,
      count(*) filter (where e.event = 'hub_click'),
      count(*) filter (where e.event = 'room_create'),
      count(*) filter (where e.event = 'join'),
      count(*) filter (where e.event = 'game_start' and e.is_host),
      count(distinct e.device_id) filter (where e.event = 'game_start')
    from game_events e
    where e.created_at >= (v_from::timestamp at time zone 'Asia/Seoul')
      and not is_excluded_row(e.device_id, e.ip, e.ip_hash, p_ex_device, p_ex_ip, v_ex_hash)
    group by 1, 2;
end;
$$ language plpgsql stable security definer set search_path = public;

revoke all on function admin_monthly_stats(int, text, text) from public, anon;
revoke all on function admin_monthly_game_stats(int, text, text) from public, anon;
grant execute on function admin_monthly_stats(int, text, text) to authenticated;
grant execute on function admin_monthly_game_stats(int, text, text) to authenticated;
