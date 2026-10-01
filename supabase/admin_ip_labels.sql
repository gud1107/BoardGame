-- Admin IP labels (2026-10-02): "this IP is 철수네 집".
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Requires supabase/admin_suite.sql first. Only adds a table and functions
-- (no DROP or DELETE), so the editor won't ask for a destructive-operation
-- confirmation. Safe to re-run.

-- One row per labelled IP. RLS on with no policies: only the admin
-- functions below can read or change it.
create table if not exists ip_labels (
  ip text primary key,
  label text,
  memo text,
  updated_at timestamptz not null default now()
);
alter table ip_labels enable row level security;

-- Labelled IPs (a cleared label is stored as null and left out).
create or replace function admin_list_ip_labels()
returns table (ip text, label text, memo text, updated_at timestamptz) as $$
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    select l.ip, l.label, l.memo, l.updated_at
    from ip_labels l
    where l.label is not null and l.label <> ''
    order by l.updated_at desc;
end;
$$ language plpgsql stable security definer set search_path = public;

-- Set (or clear, with an empty label) the name for one IP.
create or replace function admin_set_ip_label(p_ip text, p_label text, p_memo text default null)
returns void as $$
declare
  v_ip text := nullif(left(trim(coalesce(p_ip, '')), 45), '');
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if v_ip is null then return; end if;
  insert into ip_labels (ip, label, memo, updated_at)
  values (v_ip, nullif(left(trim(coalesce(p_label, '')), 40), ''), nullif(left(trim(coalesce(p_memo, '')), 200), ''), now())
  on conflict on constraint ip_labels_pkey do update set
    label = excluded.label, memo = excluded.memo, updated_at = now();
end;
$$ language plpgsql security definer set search_path = public;

-- The IPs seen most often (raw IPs only — rows from before the raw IP was
-- stored can't be attributed), with what they did and any label.
create or replace function admin_top_ips(p_since timestamptz default null, p_limit int default 100)
returns table (
  ip text,
  visits bigint,
  game_starts bigint,
  events bigint,
  devices bigint,
  nicknames text[],
  first_at timestamptz,
  last_at timestamptz,
  label text,
  memo text
) as $$
begin
  if not is_site_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
    with hits as (
      select s.ip as hip, s.device_id as dev, null::text as nick, s.created_at as at, 'visit'::text as kind
      from site_visits s
      where s.ip is not null and (p_since is null or s.created_at >= p_since)
      union all
      select e.ip, e.device_id, e.nickname, e.created_at,
        case when e.event = 'game_start' then 'start' else 'event' end
      from game_events e
      where e.ip is not null and (p_since is null or e.created_at >= p_since)
    )
    select h.hip,
      count(*) filter (where h.kind = 'visit'),
      count(*) filter (where h.kind = 'start'),
      count(*) filter (where h.kind <> 'visit'),
      count(distinct h.dev),
      array_remove(array_agg(distinct h.nick), null),
      min(h.at), max(h.at),
      max(l.label), max(l.memo)
    from hits h
    left join ip_labels l on l.ip = h.hip
    group by h.hip
    order by count(*) desc, max(h.at) desc
    limit greatest(least(p_limit, 500), 1);
end;
$$ language plpgsql stable security definer set search_path = public;

revoke all on function admin_list_ip_labels() from public, anon;
revoke all on function admin_set_ip_label(text, text, text) from public, anon;
revoke all on function admin_top_ips(timestamptz, int) from public, anon;
grant execute on function admin_list_ip_labels() to authenticated;
grant execute on function admin_set_ip_label(text, text, text) to authenticated;
grant execute on function admin_top_ips(timestamptz, int) to authenticated;
