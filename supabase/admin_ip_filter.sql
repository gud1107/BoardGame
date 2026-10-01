-- Focus the admin stats on named IPs (2026-10-02): "이름 붙인 IP만" or
-- "철수네 집만".
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Requires supabase/admin_ip_labels_2.sql first. Only replaces one
-- function (same signature, no DROP or DELETE), so no destructive-operation
-- confirmation. Safe to re-run.
--
-- Every admin stat function filters rows with `not is_excluded_row(...)`.
-- p_ex_ip is a comma-separated list of items:
--   1.2.3.4         exclude this IP                     (since admin_ip_labels_2.sql)
--   @labeled        exclude every named IP              (since admin_ip_labels_2.sql)
--   @only-labeled   keep ONLY named IPs                 (new)
--   @only:1.2.3.4   keep ONLY this IP (may repeat)      (new)
-- Matching is on the raw IP, or its hash for rows recorded before raw IPs
-- were stored. Rows with no IP at all never pass an @only filter.
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
