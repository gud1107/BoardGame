/**
 * Duplicate-user review for /admin/games. The database stores one anonymous
 * id per browser, so one person can show up as several "devices" (phone +
 * PC, a second browser, cleared storage). Two signals point at that:
 * the same hashed IP, and the same nickname — both only hints (a household
 * or café shares one IP; nicknames aren't unique), so they're flagged for a
 * human to judge, never merged automatically.
 */
export interface DeviceIdentity {
  device_id: string;
  ip_hashes: string[];
  nicknames: string[];
}

export interface DuplicateFlags {
  /** Other devices seen on any of this device's IP hashes. */
  sameIpDevices: number;
  /** Other devices that used any of this device's nicknames. */
  sameNicknameDevices: number;
  /** This device used 2+ different nicknames. */
  multipleNicknames: boolean;
}

function normalizeNickname(n: string): string {
  return n.trim().toLowerCase();
}

export function computeDuplicateFlags(rows: DeviceIdentity[]): Map<string, DuplicateFlags> {
  const devicesByIp = new Map<string, Set<string>>();
  const devicesByNick = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const ip of r.ip_hashes) {
      if (!devicesByIp.has(ip)) devicesByIp.set(ip, new Set());
      devicesByIp.get(ip)!.add(r.device_id);
    }
    for (const n of r.nicknames) {
      const key = normalizeNickname(n);
      if (!key) continue;
      if (!devicesByNick.has(key)) devicesByNick.set(key, new Set());
      devicesByNick.get(key)!.add(r.device_id);
    }
  }

  const flags = new Map<string, DuplicateFlags>();
  for (const r of rows) {
    const ipPeers = new Set<string>();
    for (const ip of r.ip_hashes) for (const d of devicesByIp.get(ip) ?? []) ipPeers.add(d);
    ipPeers.delete(r.device_id);

    const nickPeers = new Set<string>();
    for (const n of r.nicknames) for (const d of devicesByNick.get(normalizeNickname(n)) ?? []) nickPeers.add(d);
    nickPeers.delete(r.device_id);

    flags.set(r.device_id, {
      sameIpDevices: ipPeers.size,
      sameNicknameDevices: nickPeers.size,
      multipleNicknames: new Set(r.nicknames.map(normalizeNickname).filter(Boolean)).size >= 2,
    });
  }
  return flags;
}

export function isSuspectedDuplicate(f: DuplicateFlags | undefined): boolean {
  return !!f && (f.sameIpDevices > 0 || f.sameNicknameDevices > 0);
}
