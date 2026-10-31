-- 🔒 서버 판정 대전 (secure matches) migration (2026-10-31).
-- Paste into Supabase Dashboard → SQL Editor → Run. Safe to re-run.
--
-- The real game state (every hand, role, the liar's word…) lives only here.
-- RLS is on with NO policies, so the anon/authenticated keys the browser
-- holds can't read a row — only the server's service-role key can
-- (src/lib/secureMatch/store.ts). Also needs SUPABASE_SERVICE_ROLE_KEY in
-- the Vercel environment; until both exist the games fall back to the old
-- lockstep mode on their own.

create table if not exists secure_matches (
  id text primary key,
  version integer not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists secure_matches_updated_at on secure_matches (updated_at);

alter table secure_matches enable row level security;
revoke all on secure_matches from anon, authenticated;
