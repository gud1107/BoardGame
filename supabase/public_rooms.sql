-- 🌐 공개방 (public rooms) migration (2026-10-07).
-- Paste into Supabase Dashboard → SQL Editor → Run. Safe to re-run.
--
-- Only needed if `active_rooms` already exists from an earlier run of
-- base_tables.sql. If it doesn't exist yet, run base_tables.sql instead —
-- it now includes everything below.

-- 🌐 공개방 / 🔒 비공개방 + room title (2026-10-07). Only public rooms are listed in the
-- lobby's room browser; private ones stay reachable by invite code only.
-- `add column if not exists` covers a table created before this column.
alter table active_rooms add column if not exists is_public boolean not null default true;
-- Optional host-typed room title shown in the public-room list (≤30 chars).
alter table active_rooms add column if not exists title text check (title is null or char_length(title) <= 30);
-- Live room-list updates (Realtime postgres_changes). The client also polls
-- every 15s, so this only makes new rooms show up faster.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'active_rooms') then
    alter publication supabase_realtime add table active_rooms;
  end if;
end $$;
