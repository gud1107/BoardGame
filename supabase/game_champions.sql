-- Per-game champions (이번 달 1위 / 전체 랭킹 on each game page) + public
-- character portraits — paste this whole file into Supabase Dashboard →
-- SQL Editor → Run, AFTER supabase/player_stats.sql. Safe to re-run.
--
-- Client side: src/lib/stats/gameChampions.ts,
-- src/components/stats/GameChampionChip.tsx.
--
-- - Boards show public_portrait (the player's own 3D character, see
--   player_stats.sql), else a photo uploaded before upload was removed.
-- - The month board aggregates player_match_log by recorded_at (server
--   time), not the client-supplied played_at, in KST months.

-- public_portrait + set_my_public_portrait live in player_stats.sql (the
-- /stats ranking shows the portrait too), which this file runs after.

-- One game's board. p_period 'month' = this KST month, anything else = all
-- time. Most wins first (then win rate), matches with bots included — the
-- same order as /stats' default view. Returns the top p_limit rows plus the
-- caller's own row (is_me) even when it's outside the top.
create or replace function public_game_board(
  p_game_id text,
  p_period text default 'all',
  p_limit integer default 10
) returns table (
  rank bigint,
  nickname text,
  portrait text,
  played integer,
  wins integer,
  win_rate numeric,
  is_me boolean
) as $$
  with month_start as (
    select (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as t
  ),
  agg as (
    select s.user_id, s.played, s.wins
    from player_game_stats s
    where p_period is distinct from 'month' and s.game_id = p_game_id and s.played > 0
    union all
    select l.user_id, count(*)::integer, (count(*) filter (where l.won))::integer
    from player_match_log l, month_start m
    where p_period = 'month' and l.game_id = p_game_id and l.recorded_at >= m.t
    group by l.user_id
  ),
  ranked as (
    select a.*,
           round(a.wins::numeric * 100 / nullif(a.played, 0), 1) as rate,
           rank() over (order by a.wins desc, a.wins::numeric / nullif(a.played, 0) desc) as rnk
    from agg a
  )
  select r.rnk,
         coalesce(p.public_name, '게이머_' || substring(r.user_id::text from 1 for 6))::text,
         coalesce(p.public_portrait, p.public_avatar_url),
         r.played, r.wins, r.rate,
         (r.user_id = auth.uid())
  from ranked r
  left join public.user_profiles p on p.id = r.user_id
  where r.rnk <= least(greatest(coalesce(p_limit, 10), 1), 50) or r.user_id = auth.uid()
  order by r.rnk, r.played desc;
$$ language sql stable security definer set search_path = public;

grant execute on function public_game_board(text, text, integer) to anon, authenticated;
