-- Theme (🌙 다크 / ☀️ 라이트 / 🖥️ 시스템) stats for /admin/games' 🌗 테마 tab (2026-10-04).
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Requires game_events.sql (is_site_admin) first. Only adds a table and
-- functions (no DROP or DELETE), so the editor won't ask for a
-- destructive-operation confirmation. Safe to re-run.
--
-- The theme *preference itself* syncs across a signed-in user's devices via
-- Supabase Auth user_metadata.theme_pref — no table needed for that.

-- One row per browser (device id): what it first saw, and what it uses now.
create table if not exists visitor_themes (
  device_id text primary key,
  -- new       = first visit after 2026-10-04 → defaulted to 🖥️ 시스템 (follows the OS)
  -- returning = visited before but never picked → pinned to 🌙 다크
  -- legacy    = had already picked dark/light with the old two-way toggle
  origin text not null,
  -- The OS / browser color scheme at the first report (prefers-color-scheme).
  os_scheme text,
  first_pref text not null,
  first_theme text not null,
  current_pref text not null,
  current_theme text not null,
  change_count int not null default 0,
  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists visitor_themes_first_seen_idx on visitor_themes (first_seen desc);
alter table visitor_themes enable row level security;

-- Called by /api/analytics/theme (production only, bots already dropped).
create or replace function record_visitor_theme(
  p_device_id text,
  p_event text,
  p_origin text,
  p_os_scheme text,
  p_pref text,
  p_theme text
) returns void as $$
begin
  if p_device_id is null or length(p_device_id) = 0 or length(p_device_id) > 64 then return; end if;
  if p_pref not in ('dark', 'light', 'system') or p_theme not in ('dark', 'light') then return; end if;
  if p_os_scheme is not null and p_os_scheme not in ('dark', 'light') then p_os_scheme := null; end if;
  if p_origin is null or p_origin not in ('new', 'returning', 'legacy') then p_origin := 'legacy'; end if;

  if p_event = 'first' then
    insert into visitor_themes (device_id, origin, os_scheme, first_pref, first_theme, current_pref, current_theme)
    values (p_device_id, p_origin, p_os_scheme, p_pref, p_theme, p_pref, p_theme)
    on conflict (device_id) do nothing;
  elsif p_event = 'change' then
    insert into visitor_themes (device_id, origin, os_scheme, first_pref, first_theme, current_pref, current_theme, change_count)
    values (p_device_id, p_origin, p_os_scheme, p_pref, p_theme, p_pref, p_theme, 1)
    on conflict (device_id) do update set
      current_pref = excluded.current_pref,
      current_theme = excluded.current_theme,
      change_count = visitor_themes.change_count + 1,
      updated_at = now();
  end if;
end;
$$ language plpgsql security definer set search_path = public;
revoke all on function record_visitor_theme(text, text, text, text, text, text) from public;
grant execute on function record_visitor_theme(text, text, text, text, text, text) to anon, authenticated;

-- Counts grouped by first-visit kind × OS scheme × first theme × current choice.
-- p_ex_ip is accepted (the admin page's "내 기록 제외" sends it) but unused:
-- this table keeps no IP.
create or replace function admin_theme_stats(
  p_since timestamptz default null,
  p_ex_ip text default null,
  p_ex_device text default null
) returns table (
  origin text,
  os_scheme text,
  first_theme text,
  current_pref text,
  devices bigint,
  changed bigint
) as $$
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    select v.origin, coalesce(v.os_scheme, '?'), v.first_theme, v.current_pref,
      count(*), count(*) filter (where v.change_count > 0)
    from visitor_themes v
    where (p_since is null or v.first_seen >= p_since)
      and (p_ex_device is null or v.device_id <> p_ex_device)
    group by 1, 2, 3, 4;
end;
$$ language plpgsql stable security definer set search_path = public;
revoke all on function admin_theme_stats(timestamptz, text, text) from public, anon;
grant execute on function admin_theme_stats(timestamptz, text, text) to authenticated;
