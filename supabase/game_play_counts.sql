-- Standalone copy of the game_play_counts block at the end of schema.sql —
-- paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- game_play_counts — durable all-time play counter per game (2026-10-01).
--
-- Backs the lobby's default "인기순" sort. The file-based analytics store
-- (`src/lib/analytics/localStore.ts`) is ephemeral on Vercel, so it can't
-- rank games in production; this table is the one durable number. Bumped
-- once per game start from `/api/analytics/game-play` via the
-- `increment_game_play` RPC (an online match counts once per participating
-- device, same as the admin stats' "starts"). Same anon-permissive trust
-- ceiling as game_play_log/active_rooms: anyone with the anon key can bump a
-- count, which is acceptable for a cosmetic popularity ranking.
-- Direct writes are closed; only the security-definer RPC can change a row.
-- ---------------------------------------------------------------------------

create table if not exists game_play_counts (
  game_id text primary key,
  plays bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table game_play_counts enable row level security;

drop policy if exists "anyone read game_play_counts" on game_play_counts;
create policy "anyone read game_play_counts" on game_play_counts
  for select to anon, authenticated using (true);

create or replace function increment_game_play(p_game_id text) returns void as $$
begin
  if p_game_id is null or p_game_id !~ '^[a-z0-9-]{1,48}$' then
    return;
  end if;
  insert into game_play_counts (game_id, plays, updated_at)
  values (p_game_id, 1, now())
  on conflict (game_id)
  do update set plays = game_play_counts.plays + 1, updated_at = now();
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function increment_game_play(text) from public;
grant execute on function increment_game_play(text) to anon, authenticated;
