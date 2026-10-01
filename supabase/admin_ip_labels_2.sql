-- IP labels, part 2 (2026-10-02): "exclude named IPs" + "a named person
-- just came back" alerts.
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Requires supabase/admin_ip_labels.sql first. Only replaces/adds functions
-- (no DROP or DELETE), so no destructive-operation confirmation. Safe to re-run.

-- The "exclude" check every admin stat function already calls, widened
-- without changing its signature: p_ex_ip may now be a comma-separated
-- list of IPs, and the token @labeled excludes every IP the admin has
-- named (matched on the raw IP, or its hash for older rows).
create or replace function is_excluded_row(
  r_device text, r_ip text, r_ip_hash text,
  p_ex_device text, p_ex_ip text, p_ex_hash text
) returns boolean as $$
  select (p_ex_device is not null and r_device = p_ex_device)
      or (p_ex_hash is not null and r_ip_hash = p_ex_hash)
      or (p_ex_ip is not null and exists (
            select 1
            from unnest(string_to_array(p_ex_ip, ',')) as t(item)
            where trim(t.item) <> '@labeled'
              and (r_ip = trim(t.item) or r_ip_hash = hash_ip(trim(t.item)))
          ))
      or (p_ex_ip is not null and position('@labeled' in p_ex_ip) > 0 and exists (
            select 1 from ip_labels l
            where l.label is not null and l.label <> ''
              and (l.ip = r_ip or hash_ip(l.ip) = r_ip_hash)
          ));
$$ language sql stable security definer set search_path = public;
revoke all on function is_excluded_row(text, text, text, text, text, text) from public, anon;

-- Every named IP with its latest activity, and what it did since p_since
-- (the admin's "last checked" time) — powers the 🔔 panel on /admin/games.
create or replace function admin_labeled_activity(p_since timestamptz default null)
returns table (
  ip text,
  label text,
  memo text,
  last_at timestamptz,
  visits_since bigint,
  starts_since bigint,
  games_since text[],
  nicknames_since text[]
) as $$
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    with hits as (
      select s.ip as hip, s.created_at as at, 'visit'::text as kind, null::text as game, null::text as nick
      from site_visits s
      where s.ip in (select l.ip from ip_labels l where l.label is not null and l.label <> '')
      union all
      select e.ip, e.created_at, e.event, e.game_id, e.nickname
      from game_events e
      where e.ip in (select l.ip from ip_labels l where l.label is not null and l.label <> '')
    )
    select l.ip, l.label, l.memo,
      max(h.at),
      count(*) filter (where h.kind = 'visit' and (p_since is null or h.at > p_since)),
      count(*) filter (where h.kind = 'game_start' and (p_since is null or h.at > p_since)),
      array_remove(array_agg(distinct h.game) filter (where h.kind = 'game_start' and (p_since is null or h.at > p_since)), null),
      array_remove(array_agg(distinct h.nick) filter (where p_since is null or h.at > p_since), null)
    from ip_labels l
    left join hits h on h.hip = l.ip
    where l.label is not null and l.label <> ''
    group by l.ip, l.label, l.memo
    order by max(h.at) desc nulls last;
end;
$$ language plpgsql stable security definer set search_path = public;

revoke all on function admin_labeled_activity(timestamptz) from public, anon;
grant execute on function admin_labeled_activity(timestamptz) to authenticated;
