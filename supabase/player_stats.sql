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
-- - Raw rows are owner-only. The public leaderboard is served by
--   public_leaderboard(), which exposes only the self-chosen ranking name
--   (public_name) / site avatar + counts — no user ids, emails, or the
--   provider-supplied (possibly real) name. Results come from lockstep clients the server
--   can't verify, so the checks below only reject impossible values and
--   floods, not cheating — the UI labels the ranking accordingly.
-- - `details` holds game-specific numbers. Merge rule (mirrors
--   src/lib/stats/details.ts): keys starting with `max` keep the highest,
--   keys starting with `min` keep the lowest, every other key is summed.

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

-- Added with the detail stats (2026-10-02); no-ops on a fresh install.
alter table player_game_stats add column if not exists details jsonb not null default '{}'::jsonb;
alter table player_match_log add column if not exists details jsonb not null default '{}'::jsonb;

-- Normally created by social_auth.sql; mirrored here (same definition) so the
-- leaderboard works even if that file hasn't been run yet.
create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname varchar(50) not null,
  avatar_url text,
  provider varchar(20) default 'email',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- What the public leaderboard shows. Deliberately separate from
-- user_profiles.nickname/avatar_url, which social logins fill from the
-- provider (often a real name / face photo): nothing appears publicly until
-- the player picks a ranking name themselves (set_my_public_name) or uploads
-- a site avatar (/api/profile/avatar mirrors it into public_avatar_url).
alter table public.user_profiles add column if not exists public_name varchar(12);
alter table public.user_profiles add column if not exists public_avatar_url text;
create unique index if not exists user_profiles_public_name_unique
  on public.user_profiles (lower(public_name)) where public_name is not null;

-- Set (or clear, with null/blank) the caller's ranking name. Raises
-- 'invalid name' / 'reserved name' / 'name taken' for the client to map.
create or replace function set_my_public_name(p_name text)
returns text as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if v_name is not null then
    if char_length(v_name) not between 2 and 12 or v_name !~ '^[가-힣ㄱ-ㅎa-zA-Z0-9_ ]+$' then
      raise exception 'invalid name';
    end if;
    if lower(v_name) in ('admin', 'administrator', '관리자', '운영자', '운영팀', 'gm')
       or v_name like '게이머\_%' then
      raise exception 'reserved name';
    end if;
    if exists (select 1 from public.user_profiles
               where lower(public_name) = lower(v_name) and id <> v_uid) then
      raise exception 'name taken';
    end if;
  end if;

  insert into public.user_profiles (id, nickname, public_name)
  values (v_uid, coalesce(v_name, '게이머_' || substring(v_uid::text from 1 for 6)), v_name)
  on conflict (id) do update set public_name = excluded.public_name, updated_at = now();
  return v_name;
exception when unique_violation then
  raise exception 'name taken';
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function set_my_public_name(text) from public, anon;
grant execute on function set_my_public_name(text) to authenticated;

alter table player_game_stats enable row level security;
alter table player_match_log enable row level security;

drop policy if exists "own player_game_stats" on player_game_stats;
create policy "own player_game_stats" on player_game_stats
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own player_match_log" on player_match_log;
create policy "own player_match_log" on player_match_log
  for select to authenticated using (auth.uid() = user_id);

create or replace function merge_stat_details(p_base jsonb, p_delta jsonb)
returns jsonb as $$
  select coalesce(p_base, '{}'::jsonb) || coalesce((
    select jsonb_object_agg(
      d.key,
      case
        when not (coalesce(p_base, '{}'::jsonb) ? d.key) then d.value
        when d.key like 'max%' then to_jsonb(greatest((p_base ->> d.key)::numeric, (d.value #>> '{}')::numeric))
        when d.key like 'min%' then to_jsonb(least((p_base ->> d.key)::numeric, (d.value #>> '{}')::numeric))
        else to_jsonb((p_base ->> d.key)::numeric + (d.value #>> '{}')::numeric)
      end)
    from jsonb_each(coalesce(p_delta, '{}'::jsonb)) d
  ), '{}'::jsonb);
$$ language sql immutable set search_path = public;

-- The pre-details 6-argument version, if an earlier copy of this file ran.
drop function if exists record_match_stats(text, text, boolean, integer, integer, timestamptz);

-- Returns true when the match was counted, false when it was already counted.
create or replace function record_match_stats(
  p_match_id text,
  p_game_id text,
  p_won boolean,
  p_rank integer,
  p_player_count integer,
  p_played_at timestamptz,
  p_details jsonb default '{}'::jsonb
) returns boolean as $$
declare
  v_uid uuid := auth.uid();
  v_inserted integer;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
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
  if jsonb_typeof(v_details) <> 'object'
     or (select count(*) from jsonb_object_keys(v_details)) > 24
     or exists (
       select 1 from jsonb_each(v_details) d
       where d.key !~ '^[a-zA-Z][a-zA-Z0-9]{0,39}$'
          or jsonb_typeof(d.value) <> 'number'
          or (d.value #>> '{}')::numeric not between 0 and 1000000000
     ) then
    raise exception 'bad details';
  end if;
  if (select count(*) from player_match_log
      where user_id = v_uid and recorded_at > now() - interval '1 hour') >= 300 then
    raise exception 'rate limited';
  end if;

  insert into player_match_log (user_id, match_id, game_id, won, rank, player_count, played_at, details)
  values (v_uid, p_match_id, p_game_id, p_won, p_rank, p_player_count, p_played_at, v_details)
  on conflict (user_id, match_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  insert into player_game_stats as s (user_id, game_id, played, wins, losses, best_rank, details, updated_at)
  values (v_uid, p_game_id, 1, case when p_won then 1 else 0 end, case when p_won then 0 else 1 end, p_rank, v_details, now())
  on conflict (user_id, game_id) do update set
    played = s.played + 1,
    wins = s.wins + excluded.wins,
    losses = s.losses + excluded.losses,
    best_rank = least(coalesce(s.best_rank, excluded.best_rank), excluded.best_rank),
    details = merge_stat_details(s.details, excluded.details),
    updated_at = now();
  return true;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function record_match_stats(text, text, boolean, integer, integer, timestamptz, jsonb) from public, anon;
grant execute on function record_match_stats(text, text, boolean, integer, integer, timestamptz, jsonb) to authenticated;

-- Public leaderboard. p_game_id null = all games combined.
-- p_sort 'wins' (default) = most wins; 'rate' = win rate among players with
-- at least p_min_played games. Returns the top p_limit rows plus the
-- caller's own row (is_me) even when it's outside the top.
drop function if exists public_leaderboard(text, text, integer, integer);
create or replace function public_leaderboard(
  p_game_id text default null,
  p_sort text default 'wins',
  p_min_played integer default 10,
  p_limit integer default 50
) returns table (
  rank bigint,
  nickname text,
  avatar_url text,
  played integer,
  wins integer,
  losses integer,
  win_rate numeric,
  best_rank integer,
  details jsonb,
  is_me boolean
) as $$
  with agg as (
    select s.user_id,
           sum(s.played)::integer as played,
           sum(s.wins)::integer as wins,
           sum(s.losses)::integer as losses,
           min(s.best_rank) as best_rank,
           case when p_game_id is null then '{}'::jsonb else (array_agg(s.details))[1] end as details
    from player_game_stats s
    where p_game_id is null or s.game_id = p_game_id
    group by s.user_id
  ),
  eligible as (
    select a.*, round(a.wins::numeric * 100 / nullif(a.played, 0), 1) as win_rate
    from agg a
    where a.played >= case when p_sort = 'rate' then greatest(coalesce(p_min_played, 1), 1) else 1 end
  ),
  ranked as (
    select e.*,
           case when p_sort = 'rate'
             then rank() over (order by e.win_rate desc, e.wins desc)
             else rank() over (order by e.wins desc, e.win_rate desc)
           end as rnk
    from eligible e
  )
  select r.rnk,
         coalesce(p.public_name, '게이머_' || substring(r.user_id::text from 1 for 6))::text,
         p.public_avatar_url,
         r.played, r.wins, r.losses, r.win_rate, r.best_rank, r.details,
         (r.user_id = auth.uid())
  from ranked r
  left join public.user_profiles p on p.id = r.user_id
  where r.rnk <= least(greatest(coalesce(p_limit, 50), 1), 100) or r.user_id = auth.uid()
  order by r.rnk, r.played desc;
$$ language sql stable security definer set search_path = public;

grant execute on function public_leaderboard(text, text, integer, integer) to anon, authenticated;
