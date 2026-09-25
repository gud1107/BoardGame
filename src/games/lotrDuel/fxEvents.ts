import { LANDMARKS, REGIONS } from "./data";
import type { AllianceRace, AllianceToken, Faction, LandmarkId, LotrDuelState, RegionId, TechSymbol } from "./types";

/**
 * What visibly happened between two replayed states — shared by the board's
 * visual FX (derived during render) and its sound cues (played in an effect),
 * so both always react to exactly the same events.
 */
export interface FxEvents {
  /** Pyramid slot taken this step (same chapter only). */
  taken: { slot: number; mode: "PLAY" | "DISCARD" } | null;
  flippedCardIds: string[];
  landmark: { id: LandmarkId; region: RegionId; faction: Faction } | null;
  combat: { region: RegionId; losses: number } | null;
  ring: { faction: Faction; from: number; to: number }[];
  alliance: { faction: Faction; token: AllianceToken } | null;
  chapter: 2 | 3 | null;
  unitsPlaced: boolean;
  moved: boolean;
  /** Regions where a side's unit count went up this step (placement or move arrival). */
  drops: { region: RegionId; faction: Faction; count: number }[];
  gameOver: Faction | null;
}

function unitTotal(s: LotrDuelState): number {
  return REGIONS.reduce((n, r) => n + s.boardRegions[r].fellowshipUnits + s.boardRegions[r].sauronUnits, 0);
}

export function diffFx(p: LotrDuelState, s: LotrDuelState): FxEvents | null {
  if (p === s || p.seed !== s.seed) return null;
  const sameChapter = p.chapter === s.chapter;
  const ev: FxEvents = {
    taken: null,
    flippedCardIds: [],
    landmark: null,
    combat: null,
    ring: [],
    alliance: null,
    chapter: !sameChapter && (s.chapter === 2 || s.chapter === 3) ? s.chapter : null,
    unitsPlaced: false,
    moved: false,
    drops: [],
    gameOver: s.phase === "GAME_OVER" && p.phase !== "GAME_OVER" ? s.winner : null,
  };
  if (s.lastAction && s.lastAction.no !== p.lastAction?.no) {
    const a = s.lastAction;
    if (a.kind === "LANDMARK" && a.landmarkId) ev.landmark = { id: a.landmarkId, region: LANDMARKS[a.landmarkId].targetRegion, faction: a.faction };
    else if (sameChapter && a.cardId) {
      const slot = p.pyramidGrid.findIndex((x) => x.card.id === a.cardId);
      if (slot >= 0) ev.taken = { slot, mode: a.kind === "DISCARD" ? "DISCARD" : "PLAY" };
    }
  }
  if (sameChapter) {
    s.pyramidGrid.forEach((slot, i) => {
      if (slot.isOpen && !slot.isTaken && p.pyramidGrid[i] && !p.pyramidGrid[i].isOpen) ev.flippedCardIds.push(slot.card.id);
    });
  }
  if (s.combatFlash && s.combatFlash.no !== p.combatFlash?.no) ev.combat = { region: s.combatFlash.region, losses: s.combatFlash.losses };
  if (s.ringTrack.frodoPosition > p.ringTrack.frodoPosition) ev.ring.push({ faction: "FELLOWSHIP", from: p.ringTrack.frodoPosition, to: s.ringTrack.frodoPosition });
  if (s.ringTrack.nazgulPosition > p.ringTrack.nazgulPosition) ev.ring.push({ faction: "SAURON", from: p.ringTrack.nazgulPosition, to: s.ringTrack.nazgulPosition });
  for (const f of ["FELLOWSHIP", "SAURON"] as const) {
    const before = p.players[f].allianceTokens.length;
    const after = s.players[f].allianceTokens;
    if (after.length > before) ev.alliance = { faction: f, token: after[after.length - 1] };
  }
  const newLogs = s.log.filter((e) => e.no > (p.log[p.log.length - 1]?.no ?? 0));
  ev.moved = newLogs.some((e) => e.kind === "MOVE");
  ev.unitsPlaced = !ev.moved && unitTotal(s) > unitTotal(p);
  for (const r of REGIONS) {
    const df = s.boardRegions[r].fellowshipUnits - p.boardRegions[r].fellowshipUnits;
    const ds = s.boardRegions[r].sauronUnits - p.boardRegions[r].sauronUnits;
    if (df > 0) ev.drops.push({ region: r, faction: "FELLOWSHIP", count: df });
    if (ds > 0) ev.drops.push({ region: r, faction: "SAURON", count: ds });
  }
  return ev;
}

/**
 * What a pyramid card would change, shown on the board while its center
 * modal is open (the "predictive highlight"): coins → the coin HUD, ring →
 * the track path, units/tactics → map regions, tech → HUD tech slots,
 * race → HUD race seal.
 */
export interface CardPreview {
  coins?: number;
  regions?: RegionId[];
  regionTone?: "red" | "violet";
  ring?: { faction: Faction; from: number; to: number };
  techs?: TechSymbol[];
  race?: AllianceRace;
}
