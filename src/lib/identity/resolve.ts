import { getDeviceId } from "./deviceId";
import {
  createPlayer,
  findPlayersByNameLike,
  getIdentity,
  getPlayer,
  linkDeviceToPlayer,
  renamePlayer,
} from "@/lib/db/repository";
import type { PlayerRecord } from "@/lib/db/types";
import { recordDeviceSighting, findSameIpCandidates } from "@/lib/supabase/sync";

export type IdentityResolution =
  | { kind: "known-device"; player: PlayerRecord }
  | { kind: "needs-confirmation"; nickname: string; candidates: PlayerRecord[] }
  | { kind: "new"; nickname: string };

async function fetchClientIp(): Promise<string | undefined> {
  try {
    const res = await fetch("/api/ip");
    if (!res.ok) return undefined;
    const data = (await res.json()) as { ip?: string };
    return data.ip;
  } catch {
    return undefined;
  }
}

/**
 * Identity resolution for a nickname typed into the betting roster.
 *
 * Note the roster is typically filled in by ONE organizer, on ONE shared
 * device, entering everyone's names in sequence (pass-and-play, not one
 * phone per player) — so "this device == one person" cannot be assumed the
 * way it could for a personal account system. Device ID is therefore only
 * ever a *weak hint* offered up for user confirmation, never something that
 * silently claims a new nickname for an existing player.
 *
 * Resolution order:
 *  1. Exact match on a player's *current* name -> reuse silently (typing
 *     the same nickname again, same or later day, is unambiguous).
 *  2. Otherwise, gather weak signals — this device's last-used player, this
 *     IP's other devices, or a match against someone's *old* nickname — and
 *     surface them as candidates the organizer must explicitly confirm.
 *  3. No signals at all -> brand new player.
 */
export async function resolvePlayerIdentity(
  nickname: string,
): Promise<IdentityResolution> {
  const trimmed = nickname.trim();
  const deviceId = getDeviceId();

  const nameMatches = await findPlayersByNameLike(trimmed);
  const exactCurrent = nameMatches.find(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (exactCurrent) {
    void linkDeviceToPlayer(deviceId, exactCurrent.id);
    void syncIp(deviceId, exactCurrent.id, trimmed);
    return { kind: "known-device", player: exactCurrent };
  }

  const ip = await fetchClientIp();
  const byIp = ip ? await findSameIpCandidates(ip, deviceId) : [];
  const deviceIdentity = await getIdentity(deviceId);

  const candidateIds = new Set<string>([
    ...nameMatches.map((p) => p.id), // matched via an old alias
    ...byIp,
    ...(deviceIdentity ? [deviceIdentity.playerId] : []),
  ]);

  if (candidateIds.size > 0) {
    const candidates = (
      await Promise.all([...candidateIds].map((id) => getPlayer(id)))
    ).filter((p): p is PlayerRecord => Boolean(p));
    if (candidates.length > 0) {
      return { kind: "needs-confirmation", nickname: trimmed, candidates };
    }
  }

  return { kind: "new", nickname: trimmed };
}

async function syncIp(deviceId: string, playerId: string, name: string) {
  const ip = await fetchClientIp();
  if (ip) await recordDeviceSighting(ip, deviceId, playerId, name);
}

/** User confirmed "this is the same person as `existingPlayerId`". */
export async function confirmMerge(
  existingPlayerId: string,
  nickname: string,
): Promise<PlayerRecord> {
  const deviceId = getDeviceId();
  const updated = (await renamePlayer(existingPlayerId, nickname)) as PlayerRecord;
  await linkDeviceToPlayer(deviceId, existingPlayerId);
  void syncIp(deviceId, existingPlayerId, nickname);
  return updated;
}

/** User confirmed "this is a different / new person". */
export async function createFresh(nickname: string): Promise<PlayerRecord> {
  const deviceId = getDeviceId();
  const player = await createPlayer(nickname);
  await linkDeviceToPlayer(deviceId, player.id);
  void syncIp(deviceId, player.id, nickname);
  return player;
}
