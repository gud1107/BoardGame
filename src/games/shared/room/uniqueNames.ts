/**
 * Two people may join a room with the same nickname (a profile 게임 닉네임 is filled in
 * automatically, so it happens). Every online game reads its roster from Realtime
 * presence through this, so seats, results and logs tell them apart: the lowest seat
 * keeps the name, later ones become "상어 2", "상어 3"… Every client sees the same
 * presence set, so they all derive the same labels — nothing is renamed on the wire.
 */
export function withUniqueNames<T extends { name?: string; seat?: unknown; deviceId?: string }>(occupants: T[]): T[] {
  const key = (s: string) => s.trim().toLowerCase();
  const order = [...occupants].sort((a, b) => {
    const sa = typeof a.seat === "number" ? a.seat : Number.MAX_SAFE_INTEGER;
    const sb = typeof b.seat === "number" ? b.seat : Number.MAX_SAFE_INTEGER;
    return sa - sb || String(a.deviceId ?? "").localeCompare(String(b.deviceId ?? ""));
  });
  const used = new Set(occupants.map((o) => key(o.name ?? "")).filter(Boolean));
  const seen = new Set<string>();
  const renamed = new Map<T, string>();
  for (const o of order) {
    const name = (o.name ?? "").trim();
    if (!name) continue;
    if (!seen.has(key(name))) {
      seen.add(key(name));
      continue;
    }
    let n = 2;
    while (used.has(key(`${name} ${n}`)) || seen.has(key(`${name} ${n}`))) n++;
    const label = `${name} ${n}`;
    seen.add(key(label));
    renamed.set(o, label);
  }
  if (!renamed.size) return occupants;
  return occupants.map((o) => (renamed.has(o) ? { ...o, name: renamed.get(o)! } : o));
}
