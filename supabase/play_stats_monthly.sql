-- Monthly play counts for the lobby + reset of the old counts (2026-10-01).
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Requires supabase/game_events.sql first. Safe to re-run.

-- Lobby cards now read "🔥 10월 N회 플레이": real match starts (a host's
-- game_start event) this calendar month in Korea time, plus the all-time
-- total the 인기순 sort uses. Computed straight from game_events, so counts
-- from the retired "opening a game page = +1" path never show up here.
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

-- Reset: drop the counts the old "opening a game page = +1" path left in
-- game_play_counts and rebuild it from real starts only.
delete from game_play_counts;
insert into game_play_counts (game_id, plays, updated_at)
select game_id, count(*), max(created_at)
from game_events
where event = 'game_start' and is_host
group by game_id;
