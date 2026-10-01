-- Claude's test runs, kept and labelled (2026-10-02).
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Requires supabase/admin_ip_filter.sql and supabase/admin_alerts.sql first. Only replaces/adds functions
-- (same signatures, no DROP or DELETE), so no destructive-operation
-- confirmation. Safe to re-run.
--
-- Until now the app dropped automated browsers (Claude's Playwright tests)
-- entirely. From now on the app records them under ONE fixed device id with
-- the nickname "🤖 클로드", so they show up as Claude in the admin pages
-- instead of vanishing. They never count toward the public play numbers,
-- and admin stats leave them out unless "🤖 클로드 테스트 포함" is on
-- (the @no-claude item, sent by default).

create or replace function claude_device_id() returns text as $$
  select '00000000-0000-4000-8000-00000c1a0de0'::text;
$$ language sql immutable;

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
    -- Claude's test runs never count toward the public number.
    if coalesce(p_is_host, false) and p_device_id is distinct from claude_device_id() then
      insert into game_play_counts (game_id, plays, updated_at)
      values (p_game_id, 1, now())
      on conflict (game_id)
      do update set plays = game_play_counts.plays + 1, updated_at = now();
    end if;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

-- Lobby "🔥 10월 N회 플레이" / 인기순: real people only.
create or replace function public_game_play_stats()
returns table (game_id text, total_plays bigint, month_plays bigint) as $$
  select e.game_id,
    count(*),
    count(*) filter (
      where e.created_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
    )
  from game_events e
  where e.event = 'game_start' and e.is_host
    and e.device_id is distinct from claude_device_id()
  group by e.game_id;
$$ language sql stable security definer set search_path = public;
revoke all on function public_game_play_stats() from public;
grant execute on function public_game_play_stats() to anon, authenticated;

-- Same keep/exclude list as admin_ip_filter.sql, plus @no-claude.
create or replace function is_excluded_row(
  r_device text, r_ip text, r_ip_hash text,
  p_ex_device text, p_ex_ip text, p_ex_hash text
) returns boolean as $$
  with items as (
    select trim(x) as item
    from unnest(string_to_array(coalesce(p_ex_ip, ''), ',')) as t(x)
    where trim(x) <> ''
  ),
  named as (
    select exists (
      select 1 from ip_labels l
      where l.label is not null and l.label <> ''
        and (l.ip = r_ip or (r_ip_hash is not null and hash_ip(l.ip) = r_ip_hash))
    ) as is_named
  )
  select
       (p_ex_device is not null and r_device = p_ex_device)
    -- @no-claude: leave out Claude's automated test runs
    or (r_device = claude_device_id() and exists (select 1 from items where item = '@no-claude'))
    or (p_ex_hash is not null and r_ip_hash = p_ex_hash)
    -- plain IPs: exclude
    or exists (
         select 1 from items
         where item not like '@%'
           and (r_ip = item or (r_ip_hash is not null and r_ip_hash = hash_ip(item)))
       )
    -- @labeled: exclude named IPs
    or (exists (select 1 from items where item = '@labeled') and (select is_named from named))
    -- @only…: exclude everything that isn't on the keep-list
    or (
         exists (select 1 from items where item = '@only-labeled' or item like '@only:%')
         and not (
              (exists (select 1 from items where item = '@only-labeled') and (select is_named from named))
           or exists (
                select 1 from items
                where item like '@only:%'
                  and (r_ip = substr(item, 7) or (r_ip_hash is not null and r_ip_hash = hash_ip(substr(item, 7))))
              )
         )
       );
$$ language sql stable security definer set search_path = public;
revoke all on function is_excluded_row(text, text, text, text, text, text) from public, anon;

-- Phone alerts (admin_alerts.sql): Claude tests from the admin's own PC
-- share the admin's IP, so they must never trigger an alert.
create or replace function alert_on_visit() returns trigger as $$
declare
  v_label text;
  s alert_settings;
begin
  if new.device_id = claude_device_id() then return new; end if; -- Claude's tests never alert
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

create or replace function alert_on_game_start() returns trigger as $$
declare
  v_label text;
  v_game text;
  s alert_settings;
begin
  if new.device_id = claude_device_id() then return new; end if; -- Claude's tests never alert
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
