-- Phone alerts via ntfy (2026-10-02): "🏷️ 철수네 집 접속" on the admin's
-- phone when a named IP with its 🔔 switch on visits or starts a game.
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Requires supabase/admin_ip_labels.sql first. No DROP or DELETE, so no
-- destructive-operation confirmation. Safe to re-run.
--
-- How it works: AFTER INSERT triggers on site_visits / game_events check
-- the IP against ip_labels (alert on), apply a cooldown, and POST to
-- https://ntfy.sh with pg_net — the database sends it, so no extra server
-- key is needed. Messages carry the admin's name for the IP and the game's
-- name, never the IP itself. Anyone who knows the ntfy topic can read the
-- messages, so the topic is a long random string set from /admin/games.

create extension if not exists pg_net;

-- Which named IPs alert, and when they last did (cooldowns).
alter table ip_labels add column if not exists alert boolean not null default false;
alter table ip_labels add column if not exists last_visit_alert_at timestamptz;
alter table ip_labels add column if not exists last_start_alert_at timestamptz;

-- Single settings row. RLS on, no policies: admin functions only.
create table if not exists alert_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  ntfy_topic text,
  notify_visits boolean not null default true,
  notify_starts boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table alert_settings enable row level security;
insert into alert_settings (id) values (1) on conflict do nothing;

-- Korean game names for the messages (refreshed on every run of this file).
create table if not exists game_names (
  game_id text primary key,
  name text not null
);
alter table game_names enable row level security;
insert into game_names (game_id, name) values
  ('hanamikoji', '하나미코지'),
  ('splendor', '스플렌더'),
  ('splendor-duel', '스플렌더 대결'),
  ('lotr-duel', '반지의 제왕: 가운데땅에서의 대결'),
  ('city-chase', '시티 체이스: 경찰 vs 도둑'),
  ('doodle-phone', '그림 전화기: 낙서 릴레이'),
  ('catan', '카탄의 개척자들'),
  ('ticket-to-ride', '티켓 투 라이드'),
  ('dominion', '도미니언'),
  ('avalon', '아발론'),
  ('codenames', '코드네임'),
  ('bang', '뱅!'),
  ('grid-poker', '그리드 포커'),
  ('no-thanks', '노땡스'),
  ('perudo', '페루도'),
  ('century', '센추리: 향신료의 길'),
  ('mafia', '마피아'),
  ('uno', '우노'),
  ('rummikub', '루미큐브'),
  ('halli-galli', '할리갈리'),
  ('agricola', '아그리콜라'),
  ('7-wonders', '세븐 원더스'),
  ('dixit', '딕싯'),
  ('jenga', '젠가'),
  ('spot-difference', '틀린 그림 찾기'),
  ('five-cucumbers', '오이 다섯 개'),
  ('las-vegas', '라스베가스'),
  ('dalmuti', '달무티'),
  ('summoners-rift', '소환사의 협곡'),
  ('coyote', '코요테'),
  ('love-letter', '러브레터'),
  ('for-sale', '포세일'),
  ('mal-dalli-ja', '말달리자'),
  ('pieces-of-language', '언어의 조각'),
  ('coup', '레지스탕스 쿠'),
  ('destiny-war-39', '운명전쟁39'),
  ('show-me-the-coin', '쇼미더코인'),
  ('love-wins-all', '러브 윈즈 올'),
  ('worm', '지렁이'),
  ('hungry-shark', '배고픈 상어: 딥 에볼루션'),
  ('crab-survival', '꽃게 서바이벌'),
  ('lost-cities', '로스트 시티'),
  ('rat-a-tat-cat', '랫어탯캣'),
  ('mine-of-oblivion', '망각의 지뢰'),
  ('mine-of-oblivion-2', '망각의 지뢰 2'),
  ('hill-of-truth', '진실의 고개'),
  ('great-legacy', '최고의 투자'),
  ('memory-feast', '기억의 만찬')
on conflict (game_id) do update set name = excluded.name;

-- Sends one ntfy message (no-op unless alerts are on and a topic is set).
create or replace function send_admin_alert(p_title text, p_message text, p_tags text[] default array['bell'])
returns void as $$
declare
  s alert_settings;
begin
  select * into s from alert_settings where id = 1;
  if s.id is null or not s.enabled or coalesce(s.ntfy_topic, '') = '' then return; end if;
  perform net.http_post(
    url := 'https://ntfy.sh',
    body := jsonb_build_object(
      'topic', s.ntfy_topic,
      'title', left(p_title, 120),
      'message', left(p_message, 500),
      'tags', to_jsonb(p_tags),
      'click', 'https://board-game-tau-navy.vercel.app/admin/games'
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
end;
$$ language plpgsql security definer set search_path = public;
revoke all on function send_admin_alert(text, text, text[]) from public, anon, authenticated;

-- Visit → 🔔 (once per 30 minutes per IP).
create or replace function alert_on_visit() returns trigger as $$
declare
  v_label text;
  s alert_settings;
begin
  if new.ip is null then return new; end if;
  select * into s from alert_settings where id = 1;
  if s.id is null or not s.enabled or not s.notify_visits then return new; end if;
  update ip_labels
    set last_visit_alert_at = now()
    where ip = new.ip and alert and label is not null and label <> ''
      and (last_visit_alert_at is null or last_visit_alert_at < now() - interval '30 minutes')
    returning label into v_label;
  if v_label is null then return new; end if;
  perform send_admin_alert(
    '🏷️ ' || v_label || ' 접속',
    '방금 보드게임 허브에 들어왔어요' || coalesce(' · ' || nullif(new.device_type, ''), '') || coalesce(' · ' || nullif(new.source, ''), ''),
    array['bell']
  );
  return new;
exception when others then
  return new; -- an alert must never block recording the visit
end;
$$ language plpgsql security definer set search_path = public;

-- Game start → 🎲 (once per 10 minutes per IP).
create or replace function alert_on_game_start() returns trigger as $$
declare
  v_label text;
  v_game text;
  s alert_settings;
begin
  if new.ip is null or new.event <> 'game_start' then return new; end if;
  select * into s from alert_settings where id = 1;
  if s.id is null or not s.enabled or not s.notify_starts then return new; end if;
  update ip_labels
    set last_start_alert_at = now()
    where ip = new.ip and alert and label is not null and label <> ''
      and (last_start_alert_at is null or last_start_alert_at < now() - interval '10 minutes')
    returning label into v_label;
  if v_label is null then return new; end if;
  select g.name into v_game from game_names g where g.game_id = new.game_id;
  perform send_admin_alert(
    '🎲 ' || v_label || ' 게임 시작',
    coalesce(v_game, new.game_id) || case when new.is_host then ' · 방장으로 시작' else ' · 참가자로 시작' end
      || coalesce(' · 닉네임 ' || nullif(new.nickname, ''), ''),
    array['game_die']
  );
  return new;
exception when others then
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace trigger site_visits_alert after insert on site_visits
  for each row execute function alert_on_visit();
create or replace trigger game_events_alert after insert on game_events
  for each row execute function alert_on_game_start();

-- ── Admin functions ──
create or replace function admin_get_alert_settings()
returns table (enabled boolean, ntfy_topic text, notify_visits boolean, notify_starts boolean) as $$
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query select a.enabled, a.ntfy_topic, a.notify_visits, a.notify_starts from alert_settings a where a.id = 1;
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function admin_set_alert_settings(p_enabled boolean, p_topic text, p_visits boolean, p_starts boolean)
returns void as $$
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_topic is not null and p_topic <> '' and p_topic !~ '^[A-Za-z0-9_-]{12,64}$' then
    raise exception 'topic must be 12-64 letters, digits, - or _' using errcode = '22023';
  end if;
  update alert_settings
    set enabled = coalesce(p_enabled, false),
        ntfy_topic = nullif(p_topic, ''),
        notify_visits = coalesce(p_visits, true),
        notify_starts = coalesce(p_starts, true),
        updated_at = now()
    where id = 1;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function admin_send_test_alert()
returns void as $$
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  perform send_admin_alert('🔔 테스트 알림', '보드게임 허브 관리자 알림이 잘 도착했어요!', array['white_check_mark']);
end;
$$ language plpgsql security definer set search_path = public;

-- Per-IP 🔔 switch, and the list of named IPs with their switch.
create or replace function admin_set_ip_alert(p_ip text, p_alert boolean)
returns void as $$
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update ip_labels set alert = coalesce(p_alert, false), updated_at = now() where ip_labels.ip = trim(p_ip);
end;
$$ language plpgsql security definer set search_path = public;

create or replace function admin_ip_alert_flags()
returns table (ip text, alert boolean) as $$
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query select l.ip, l.alert from ip_labels l where l.label is not null and l.label <> '';
end;
$$ language plpgsql stable security definer set search_path = public;

do $$
declare f text;
begin
  foreach f in array array[
    'admin_get_alert_settings()',
    'admin_set_alert_settings(boolean, text, boolean, boolean)',
    'admin_send_test_alert()',
    'admin_set_ip_alert(text, boolean)',
    'admin_ip_alert_flags()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function alert_on_visit() from public, anon, authenticated;
revoke all on function alert_on_game_start() from public, anon, authenticated;
