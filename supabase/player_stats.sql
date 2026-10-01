-- Personal per-game stats (내 전적) — paste this whole file into
-- Supabase Dashboard → SQL Editor → Run. Safe to re-run.
--
-- Client side: src/lib/stats/playerStats.ts. Design review:
-- docs/player-stats-hybrid-sync-spec.md.
--
-- - Browsers never write these tables directly (no insert/update policies).
--   The only write path is record_match_stats(), which uses auth.uid() —
--   there is no user-id argument, so nobody can write someone else's stats.
-- - Each match is uploaded once as a delta with a client-generated match_id.
--   player_match_log's (user_id, match_id) key makes re-uploads no-ops, so
--   retries, re-logins and two devices can't double-count or overwrite.
-- - Rows are private (owner-only read) until a public leaderboard is decided.
--   Results come from lockstep clients the server can't verify, so the
--   checks below only reject impossible values and floods, not cheating.

create table if not exists player_game_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null,
  played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  best_rank integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create table if not exists player_match_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id text not null,
  game_id text not null,
  won boolean not null,
  rank integer not null,
  player_count integer not null,
  played_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  primary key (user_id, match_id)
);

create index if not exists player_match_log_user_recorded
  on player_match_log (user_id, recorded_at desc);

alter table player_game_stats enable row level security;
alter table player_match_log enable row level security;

drop policy if exists "own player_game_stats" on player_game_stats;
create policy "own player_game_stats" on player_game_stats
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own player_match_log" on player_match_log;
create policy "own player_match_log" on player_match_log
  for select to authenticated using (auth.uid() = user_id);

-- Returns true when the match was counted, false when it was already counted.
create or replace function record_match_stats(
  p_match_id text,
  p_game_id text,
  p_won boolean,
  p_rank integer,
  p_player_count integer,
  p_played_at timestamptz
) returns boolean as $$
declare
  v_uid uuid := auth.uid();
  v_inserted integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_match_id is null or length(p_match_id) not between 8 and 64 then
    raise exception 'bad match id';
  end if;
  if p_game_id is null or p_game_id !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'bad game id';
  end if;
  if p_player_count is null or p_player_count not between 1 and 20
     or p_rank is null or p_rank not between 1 and p_player_count then
    raise exception 'bad rank';
  end if;
  if p_won is distinct from (p_rank = 1) then
    raise exception 'won must match rank 1';
  end if;
  -- Guest matches can be old (they wait for the first login), but not from the future.
  if p_played_at is null or p_played_at > now() + interval '10 minutes'
     or p_played_at < now() - interval '400 days' then
    raise exception 'bad played_at';
  end if;
  if (select count(*) from player_match_log
      where user_id = v_uid and recorded_at > now() - interval '1 hour') >= 300 then
    raise exception 'rate limited';
  end if;

  insert into player_match_log (user_id, match_id, game_id, won, rank, player_count, played_at)
  values (v_uid, p_match_id, p_game_id, p_won, p_rank, p_player_count, p_played_at)
  on conflict (user_id, match_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  insert into player_game_stats as s (user_id, game_id, played, wins, losses, best_rank, updated_at)
  values (v_uid, p_game_id, 1, case when p_won then 1 else 0 end, case when p_won then 0 else 1 end, p_rank, now())
  on conflict (user_id, game_id) do update set
    played = s.played + 1,
    wins = s.wins + excluded.wins,
    losses = s.losses + excluded.losses,
    best_rank = least(coalesce(s.best_rank, excluded.best_rank), excluded.best_rank),
    updated_at = now();
  return true;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function record_match_stats(text, text, boolean, integer, integer, timestamptz) from public, anon;
grant execute on function record_match_stats(text, text, boolean, integer, integer, timestamptz) to authenticated;
