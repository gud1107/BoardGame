import { CHARACTERS, HOME, REGIONS } from "./data";
import type { BoardPiece, CharacterId, Faction, LotrState } from "./types";

/**
 * Movement & terrain validation — pure functions over `LotrState`.
 *
 * Entry rule for any region (normal move, flight, escape):
 * - total pieces after entering must fit the region's capacity (일반 2, 산맥 1, 본거지 4),
 * - a region holding 2+ enemies can't be entered (only one battle per move),
 * - a region where an ally already faces an enemy (교전 칸) can't be entered.
 * Entering a region with exactly one enemy starts a combat.
 */

export function piecesIn(state: LotrState, regionId: string): BoardPiece[] {
  const out: BoardPiece[] = [];
  for (const p of Object.values(state.pieces)) if (p && p.regionId === regionId) out.push(p);
  return out;
}

export function canEnter(state: LotrState, faction: Faction, regionId: string): boolean {
  const region = REGIONS[regionId];
  if (!region) return false;
  const occ = piecesIn(state, regionId);
  if (occ.length + 1 > region.capacity) return false;
  const enemies = occ.filter((p) => p.faction !== faction).length;
  const allies = occ.length - enemies;
  if (enemies >= 2) return false;
  if (enemies >= 1 && allies >= 1) return false;
  return true;
}

/** Forward (toward the enemy home) or sideways. */
export function isForwardOrSide(faction: Faction, fromId: string, toId: string): boolean {
  const from = REGIONS[fromId].tier;
  const to = REGIONS[toId].tier;
  return faction === "FELLOWSHIP" ? to >= from : to <= from;
}

/** Backward (toward own home) or sideways — used by 도주/퇴각/정찰. */
export function isBackwardOrSide(faction: Faction, fromId: string, toId: string): boolean {
  const from = REGIONS[fromId].tier;
  const to = REGIONS[toId].tier;
  return faction === "FELLOWSHIP" ? to <= from : to >= from;
}

function isStrictlyForward(faction: Faction, fromId: string, toId: string): boolean {
  const from = REGIONS[fromId].tier;
  const to = REGIONS[toId].tier;
  return faction === "FELLOWSHIP" ? to > from : to < from;
}

export function getLegalMoves(state: LotrState, pieceId: CharacterId): string[] {
  const piece = state.pieces[pieceId];
  if (!piece) return [];
  if (state.immobile[pieceId] === state.turnNumber) return [];
  const current = REGIONS[piece.regionId];
  if (!current) return [];
  const faction = piece.faction;
  const targets = new Set<string>();

  for (const nextId of current.adjacentRegions) {
    if (!isForwardOrSide(faction, current.id, nextId)) continue;
    if (!canEnter(state, faction, nextId)) continue;
    targets.add(nextId);
  }

  // 나즈굴 비행 급습: two strictly-forward steps, the intermediate region ignored entirely.
  if (piece.characterId === "NAZGUL") {
    for (const midId of current.adjacentRegions) {
      if (!isStrictlyForward(faction, current.id, midId)) continue;
      for (const nextId of REGIONS[midId].adjacentRegions) {
        if (nextId === current.id || !isStrictlyForward(faction, midId, nextId)) continue;
        if (canEnter(state, faction, nextId)) targets.add(nextId);
      }
    }
  }

  // 동부인 돌파력: two forward/side steps across an EMPTY plain (never over or into a mountain).
  if (piece.characterId === "EASTERLING") {
    for (const midId of current.adjacentRegions) {
      const mid = REGIONS[midId];
      if (mid.isMountain || !isForwardOrSide(faction, current.id, midId)) continue;
      if (piecesIn(state, midId).length > 0) continue;
      for (const nextId of mid.adjacentRegions) {
        if (nextId === current.id || REGIONS[nextId].isMountain) continue;
        if (!isForwardOrSide(faction, midId, nextId)) continue;
        if (canEnter(state, faction, nextId)) targets.add(nextId);
      }
    }
  }

  return [...targets];
}

export function allLegalMoves(state: LotrState, faction: Faction): { pieceId: CharacterId; to: string }[] {
  const out: { pieceId: CharacterId; to: string }[] = [];
  for (const p of Object.values(state.pieces)) {
    if (!p || p.faction !== faction) continue;
    for (const to of getLegalMoves(state, p.characterId)) out.push({ pieceId: p.characterId, to });
  }
  return out;
}

/** Destinations for an escape that must land somewhere peaceful. `emptyOnly` = 퇴각 카드 (빈 칸만). */
export function escapeTargets(state: LotrState, pieceId: CharacterId, opts: { emptyOnly: boolean; sidewaysOnly?: boolean }): string[] {
  const piece = state.pieces[pieceId];
  if (!piece) return [];
  const current = REGIONS[piece.regionId];
  const out: string[] = [];
  // Prefer backward regions first (deterministic order — also used for auto-picks).
  const ordered = [...current.adjacentRegions].sort((a, b) => {
    const back = (id: string) => (piece.faction === "FELLOWSHIP" ? REGIONS[id].tier : -REGIONS[id].tier);
    return back(a) - back(b);
  });
  for (const id of ordered) {
    if (opts.sidewaysOnly ? REGIONS[id].tier !== current.tier : !isBackwardOrSide(piece.faction, current.id, id)) continue;
    const occ = piecesIn(state, id).filter((p) => p.characterId !== pieceId);
    if (occ.length + 1 > REGIONS[id].capacity) continue;
    if (occ.some((p) => p.faction !== piece.faction)) continue;
    if (opts.emptyOnly && occ.length > 0) continue;
    out.push(id);
  }
  return out;
}

/** 독수리의 구원: home if it's safe and has room, else the retreat-card rules. */
export function eaglesTarget(state: LotrState, pieceId: CharacterId): string | null {
  const piece = state.pieces[pieceId];
  if (!piece) return null;
  const home = HOME[piece.faction];
  if (home !== piece.regionId) {
    const occ = piecesIn(state, home);
    if (occ.length + 1 <= REGIONS[home].capacity && !occ.some((p) => p.faction !== piece.faction)) return home;
  }
  return escapeTargets(state, pieceId, { emptyOnly: true })[0] ?? null;
}

export function basePowerOf(id: CharacterId): number {
  return CHARACTERS[id].basePower;
}
