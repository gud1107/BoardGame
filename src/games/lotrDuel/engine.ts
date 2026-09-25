import {
  ADJACENCY,
  CHAPTER_DECKS,
  FACTION_LABEL,
  FRODO_START,
  LANDMARKS,
  LANDMARK_IDS,
  NAZGUL_START,
  PYRAMID_ROWS,
  RACE_INFO,
  RACES,
  REGIONS,
  OFFICIAL_RING_TRACK,
  REGION_INFO,
  TECHS,
  TOKENS,
  TOKEN_IDS_BY_RACE,
  TRACK_LENGTH,
  otherFaction,
} from "./data";
import type {
  AllianceRace,
  AllianceTokenId,
  EngineAction,
  Faction,
  LandmarkTile,
  LotrDuelCard,
  LotrDuelState,
  PendingStep,
  PlayerDuelState,
  PyramidSlot,
  RaceSymbol,
  RegionId,
  RegionState,
  Seat,
  TechSymbol,
  WinType,
  LogEntry,
  LogKind,
} from "./types";

export * from "./types";
export { otherFaction } from "./data";

/**
 * Pure lockstep reducer for 반지의 제왕: 가운데땅에서의 대결 (Duel for Middle-earth).
 *
 * Both clients replay the same `EngineAction` stream, so this file must stay
 * deterministic: no `Math.random()` (every shuffle draws from
 * `seed + rngCounter`), and an invalid/stale action is always a silent no-op
 * that returns the SAME state object. The game is strictly turn-based: only
 * `state.turn` may act, and every effect that needs a choice (unit placement,
 * moves, token picks, …) waits in `state.pending` for that same player.
 */

export const UNITS_PER_FACTION = 15;
export const FORTRESSES_PER_FACTION = 7;

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

export function seatOf(state: LotrDuelState, faction: Faction): Seat {
  return state.factionOf.p1 === faction ? "p1" : "p2";
}

function mulberry(seed: number): number {
  let x = (seed + 0x6d2b79f5) | 0;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

function nextRand(state: LotrDuelState): number {
  state.rngCounter += 1;
  return mulberry(state.seed * 7919 + state.rngCounter * 104729);
}

function shuffle<T>(state: LotrDuelState, list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand(state) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function emptyRegion(): RegionState {
  return { fellowshipUnits: 0, sauronUnits: 0, fellowshipFortress: false, sauronFortress: false };
}

function newPlayer(faction: Faction): PlayerDuelState {
  return {
    faction,
    coins: faction === "FELLOWSHIP" ? 3 : 2,
    unitsInSupply: UNITS_PER_FACTION - 2,
    fortressesInSupply: FORTRESSES_PER_FACTION,
    tableauCards: [],
    allianceTokens: [],
    constructedLandmarks: [],
    pairRacesClaimed: [],
    trioClaimed: false,
  };
}

export function startGame(seed: number, fellowshipSeat: Seat = "p1"): LotrDuelState {
  const boardRegions = Object.fromEntries(REGIONS.map((r) => [r, emptyRegion()])) as Record<RegionId, RegionState>;
  boardRegions.ARNOR.fellowshipUnits = 2;
  boardRegions.MORDOR.sauronUnits = 2;
  const state: LotrDuelState = {
    seed,
    rngCounter: 0,
    factionOf: fellowshipSeat === "p1" ? { p1: "FELLOWSHIP", p2: "SAURON" } : { p1: "SAURON", p2: "FELLOWSHIP" },
    phase: "PLAYING",
    chapter: 1,
    turn: "SAURON",
    startPlayerOfChapter: "SAURON",
    firstPlayerOverall: "SAURON",
    players: { FELLOWSHIP: newPlayer("FELLOWSHIP"), SAURON: newPlayer("SAURON") },
    boardRegions,
    ringTrack: { frodoPosition: FRODO_START, nazgulPosition: NAZGUL_START, trackLength: TRACK_LENGTH },
    pyramidGrid: [],
    removedCards: [],
    revealedLandmarks: [],
    landmarkDeck: [],
    allianceTokenDecks: { ELF: [], DWARF: [], HOBBIT: [], HUMAN: [], ENT: [], WIZARD: [] },
    discardedCards: [],
    pending: [],
    extraTurn: false,
    turnNumber: 1,
    lastAction: null,
    combatFlash: null,
    log: [],
    winner: null,
    winType: null,
  };
  for (const race of RACES) state.allianceTokenDecks[race] = shuffle(state, TOKEN_IDS_BY_RACE[race]);
  const landmarks = shuffle(
    state,
    LANDMARK_IDS.map((id) => LANDMARKS[id]),
  );
  state.revealedLandmarks = landmarks.slice(0, 3);
  state.landmarkDeck = landmarks.slice(3);
  dealChapter(state, 1);
  log(state, null, "1챕터 시작 — 사우론이 먼저 둡니다.");
  return state;
}

/** Builds the 20-card pyramid (3 of the 23 cards removed unseen). */
export function buildPyramid(chapter: 1 | 2 | 3, cards: LotrDuelCard[]): PyramidSlot[] {
  const rows = PYRAMID_ROWS[chapter];
  const slots: PyramidSlot[] = [];
  let k = 0;
  rows.forEach((xs, row) => {
    for (const x of xs) {
      slots.push({ card: cards[k++], row, x, isOpen: row % 2 === 0, coveredBy: [], isTaken: false });
    }
  });
  slots.forEach((s, i) => {
    s.coveredBy = slots.map((o, j) => (o.row === s.row + 1 && Math.abs(o.x - s.x) === 1 ? j : -1)).filter((j) => j >= 0);
    // Anything already uncovered at deal time (e.g. the bottom row) starts face-up.
    if (s.coveredBy.length === 0) slots[i].isOpen = true;
  });
  return slots;
}

function dealChapter(state: LotrDuelState, chapter: 1 | 2 | 3) {
  const deck = shuffle(state, CHAPTER_DECKS[chapter]);
  state.removedCards = deck.slice(0, 3);
  state.pyramidGrid = buildPyramid(chapter, deck.slice(3));
}

export function isSlotAvailable(state: LotrDuelState, index: number): boolean {
  const slot = state.pyramidGrid[index];
  if (!slot || slot.isTaken) return false;
  return slot.coveredBy.every((j) => state.pyramidGrid[j].isTaken);
}

export function availableSlots(state: LotrDuelState): number[] {
  return state.pyramidGrid.map((_, i) => i).filter((i) => isSlotAvailable(state, i));
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

export function hasToken(player: PlayerDuelState, id: AllianceTokenId): boolean {
  return player.allianceTokens.some((t) => t.id === id);
}

export function techProduction(player: PlayerDuelState): { fixed: Record<TechSymbol, number>; choices: TechSymbol[][]; wild: number } {
  const fixed = Object.fromEntries(TECHS.map((s) => [s, 0])) as Record<TechSymbol, number>;
  const choices: TechSymbol[][] = [];
  for (const c of player.tableauCards) {
    c.providesTech?.forEach((s) => (fixed[s] += 1));
    if (c.selectTechChoice) choices.push(c.selectTechChoice);
  }
  return { fixed, choices, wild: hasToken(player, "DWARF_WILD_TECH") ? 1 : 0 };
}

/**
 * How many of `needed` the player can NOT produce this turn — each costs 1
 * coin. Fixed symbols are used first, then choice cards / the Dwarf wild tech
 * are matched to the rest with a small bipartite matching (optimal, never
 * more than a handful of cards).
 */
export function missingTech(player: PlayerDuelState, needed: TechSymbol[] = []): number {
  return techCoverage(player, needed).filter((covered) => !covered).length;
}

/**
 * Per printed tech symbol (same order as `needed`): can my own production
 * cover it this turn? Fixed symbols first, then choice cards / the Dwarf wild
 * tech via an optimal bipartite matching — so the uncovered ones are exactly
 * the symbols the cost calculation charges 1 coin for (UI: ✓ vs +🪙1).
 */
export function techCoverage(player: PlayerDuelState, needed: TechSymbol[] = []): boolean[] {
  const { fixed, choices, wild } = techProduction(player);
  const left = { ...fixed };
  const covered = needed.map(() => false);
  const rest: number[] = []; // indices into `needed` not covered by fixed symbols
  needed.forEach((s, i) => {
    if (left[s] > 0) {
      left[s] -= 1;
      covered[i] = true;
    } else rest.push(i);
  });
  if (rest.length === 0) return covered;
  const suppliers: TechSymbol[][] = [...choices, ...Array.from({ length: wild }, () => TECHS)];
  const matchOf: number[] = rest.map(() => -1); // rest slot → supplier index
  const tryAssign = (sup: number, seen: boolean[]): boolean => {
    for (let n = 0; n < rest.length; n++) {
      if (seen[n] || !suppliers[sup].includes(needed[rest[n]])) continue;
      seen[n] = true;
      if (matchOf[n] === -1 || tryAssign(matchOf[n], seen)) {
        matchOf[n] = sup;
        return true;
      }
    }
    return false;
  };
  for (let sup = 0; sup < suppliers.length; sup++) tryAssign(sup, rest.map(() => false));
  rest.forEach((idx, n) => {
    if (matchOf[n] !== -1) covered[idx] = true;
  });
  return covered;
}

export function calculateCardCost(player: PlayerDuelState, card: LotrDuelCard): { canAfford: boolean; costInCoins: number; viaChain: boolean } {
  if (card.cost.chainSymbol && player.tableauCards.some((c) => c.providesChain === card.cost.chainSymbol)) {
    return { canAfford: true, costInCoins: 0, viaChain: true };
  }
  const costInCoins = (card.cost.coins ?? 0) + missingTech(player, card.cost.tech);
  return { canAfford: player.coins >= costInCoins, costInCoins, viaChain: false };
}

export function fortressesOnBoard(state: LotrDuelState, faction: Faction): number {
  return REGIONS.filter((r) => (faction === "FELLOWSHIP" ? state.boardRegions[r].fellowshipFortress : state.boardRegions[r].sauronFortress)).length;
}

export function calculateLandmarkCost(state: LotrDuelState, faction: Faction, tile: LandmarkTile): { canAfford: boolean; costInCoins: number } {
  const player = state.players[faction];
  const surcharge = hasToken(player, "DWARF_LANDMARK_DISCOUNT") ? 0 : fortressesOnBoard(state, faction);
  const costInCoins = tile.baseCost.coins + missingTech(player, tile.baseCost.tech) + surcharge;
  return { canAfford: player.coins >= costInCoins && player.fortressesInSupply > 0, costInCoins };
}

export function discardValue(state: LotrDuelState, faction: Faction): number {
  return state.chapter * (hasToken(state.players[faction], "HOBBIT_DISCARD_DOUBLE") ? 2 : 1);
}

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

export function unitsOf(region: RegionState, faction: Faction): number {
  return faction === "FELLOWSHIP" ? region.fellowshipUnits : region.sauronUnits;
}
export function fortressOf(region: RegionState, faction: Faction): boolean {
  return faction === "FELLOWSHIP" ? region.fellowshipFortress : region.sauronFortress;
}
export function isPresent(region: RegionState, faction: Faction): boolean {
  return unitsOf(region, faction) > 0 || fortressOf(region, faction);
}
export function controlledCount(state: LotrDuelState, faction: Faction): number {
  return REGIONS.filter((r) => isPresent(state.boardRegions[r], faction)).length;
}

function addUnits(region: RegionState, faction: Faction, n: number) {
  if (faction === "FELLOWSHIP") region.fellowshipUnits += n;
  else region.sauronUnits += n;
}

/**
 * Rulebook §7: no dice — both sides lose one unit at a time until only one
 * side (or nobody) has units left. Fortresses are never touched.
 */
export function resolveCombat(regionState: RegionState): {
  fellowshipUnits: number;
  sauronUnits: number;
  casualties: { fellowship: number; sauron: number };
} {
  const commonLoss = Math.min(regionState.fellowshipUnits, regionState.sauronUnits);
  return {
    fellowshipUnits: regionState.fellowshipUnits - commonLoss,
    sauronUnits: regionState.sauronUnits - commonLoss,
    casualties: { fellowship: commonLoss, sauron: commonLoss },
  };
}

function fight(state: LotrDuelState, regionId: RegionId) {
  const region = state.boardRegions[regionId];
  const res = resolveCombat(region);
  if (res.casualties.fellowship === 0) return;
  region.fellowshipUnits = res.fellowshipUnits;
  region.sauronUnits = res.sauronUnits;
  state.players.FELLOWSHIP.unitsInSupply += res.casualties.fellowship;
  state.players.SAURON.unitsInSupply += res.casualties.sauron;
  state.combatFlash = { no: (state.combatFlash?.no ?? 0) + 1, region: regionId, losses: res.casualties.fellowship };
  log(state, null, `⚔️ ${REGION_INFO[regionId].name}에서 유닛 격돌! 원정대 ${res.casualties.fellowship}개 vs 사우론 ${res.casualties.sauron}개 동시 전사`, "COMBAT");
}

/**
 * Moves `faction`'s ring marker `n` spaces and pays every space passed through
 * or landed on (from+1 … to), in order: coins at once, choices as pending steps
 * (returned, for the caller to queue). The Nazgûl reaching/passing Frodo, or
 * Frodo reaching Mount Doom, ends the game at once — no rewards for that move
 * (`settle()` declares the win right after).
 */
export function advanceRing(state: LotrDuelState, faction: Faction, n: number): PendingStep[] {
  if (n <= 0) return [];
  const track = state.ringTrack;
  const fellowship = faction === "FELLOWSHIP";
  const from = fellowship ? track.frodoPosition : track.nazgulPosition;
  const to = Math.min(track.trackLength, from + n);
  if (fellowship) track.frodoPosition = to;
  else track.nazgulPosition = to;
  log(state, faction, `${fellowship ? "🧝 프로도와 샘이" : "🐉 나즈굴이"} ${to - from}칸 전진해 원정 트랙 ${to}번 칸에 도착`, "TRACK");
  if (fellowship ? to >= track.trackLength : to >= track.frodoPosition) return [];
  const steps: PendingStep[] = [];
  for (let pos = from + 1; pos <= to; pos++) {
    const source = `원정 트랙 ${pos}번 칸`;
    switch (OFFICIAL_RING_TRACK[pos].reward) {
      case "COIN_1":
        state.players[faction].coins += 1;
        log(state, faction, `원정 트랙 ${pos}번 칸 보상 — ${who(faction)} 주화 1개 획득`, "COIN");
        break;
      case "ALLIANCE_TOKEN":
        steps.push({ kind: "TOKEN_RACE", source });
        break;
      case "PLACE_UNIT":
        steps.push({ kind: "PLACE", count: 1, regions: REGIONS, source });
        break;
      case "MOVE_UNIT":
        steps.push({ kind: "MOVE", remaining: 1, source });
        break;
      case "MOUNT_DOOM_VICTORY":
      case "NONE":
        break;
    }
  }
  return steps;
}

export function raceSymbols(player: PlayerDuelState): Set<RaceSymbol> {
  const races = new Set<RaceSymbol>();
  player.tableauCards.forEach((c) => c.color === "GREEN" && c.race && races.add(c.race));
  if (hasToken(player, "HOBBIT_EAGLE")) races.add("EAGLE");
  return races;
}

// ---------------------------------------------------------------------------
// Pending steps
// ---------------------------------------------------------------------------

export function tokenOptions(state: LotrDuelState, step: Extract<PendingStep, { kind: "TOKEN" }>): AllianceTokenId[] {
  if (step.races.length === 1) return state.allianceTokenDecks[step.races[0]].slice(0, 2);
  return step.races.map((r) => state.allianceTokenDecks[r][0]).filter((id): id is AllianceTokenId => !!id);
}

function stepPossible(state: LotrDuelState, faction: Faction, step: PendingStep): boolean {
  const me = state.players[faction];
  const opp = state.players[otherFaction(faction)];
  switch (step.kind) {
    case "PLACE":
      return me.unitsInSupply > 0 && step.count > 0;
    case "MOVE":
      return step.remaining > 0 && REGIONS.some((r) => unitsOf(state.boardRegions[r], faction) > 0);
    case "SNIPE":
      return step.count > 0 && REGIONS.some((r) => unitsOf(state.boardRegions[r], otherFaction(faction)) > 0);
    case "DESTROY_FORTRESS":
      return REGIONS.some((r) => fortressOf(state.boardRegions[r], otherFaction(faction)));
    case "DESTROY_GRAY":
      return opp.tableauCards.some((c) => c.color === "GRAY");
    case "DISCARD_PLAY":
      return state.discardedCards.length > 0;
    case "TOKEN_RACE":
      return RACES.some((r) => state.allianceTokenDecks[r].length > 0);
    case "TOKEN":
      return tokenOptions(state, step).length > 0;
    case "ENT_CHOICE":
      return step.remaining > 0;
  }
}

function prepend(state: LotrDuelState, steps: PendingStep[]) {
  state.pending = [...steps, ...state.pending];
}

function allianceSteps(player: PlayerDuelState, race: AllianceRace): PendingStep[] {
  const steps: PendingStep[] = [];
  const sameRace = player.tableauCards.filter((c) => c.color === "GREEN" && c.race === race).length;
  if (sameRace >= 2 && !player.pairRacesClaimed.includes(race)) {
    player.pairRacesClaimed.push(race);
    steps.push({ kind: "TOKEN", races: [race], source: `${RACE_INFO[race].name} 2장 동맹` });
  }
  const distinct = [...new Set(player.tableauCards.filter((c) => c.color === "GREEN" && c.race).map((c) => c.race!))];
  if (distinct.length >= 3 && !player.trioClaimed) {
    player.trioClaimed = true;
    // The three races that formed the trio: the new one plus the two oldest others.
    const races = [race, ...distinct.filter((r) => r !== race)].slice(0, 3);
    steps.push({ kind: "TOKEN", races, source: "서로 다른 3종족 동맹" });
  }
  return steps;
}

/** Applies a card's effect for `faction` (already paid for / already in the tableau). */
function cardEffects(state: LotrDuelState, faction: Faction, card: LotrDuelCard, viaChain: boolean) {
  const me = state.players[faction];
  const opp = state.players[otherFaction(faction)];
  const steps: PendingStep[] = [];
  switch (card.color) {
    case "GREEN":
      if (card.race) steps.push(...allianceSteps(me, card.race));
      if (hasToken(me, "ELF_GREEN_MOVES")) steps.push({ kind: "MOVE", remaining: 2, source: "엘프 행군" });
      break;
    case "RED": {
      const mu = card.militaryUnits!;
      const count = mu.count + (hasToken(me, "HUMAN_RED_EXTRA_UNIT") ? 1 : 0);
      const regions = hasToken(me, "ELF_RED_ANYWHERE") ? REGIONS : mu.allowedRegions;
      steps.push({ kind: "PLACE", count, regions, source: card.name });
      break;
    }
    case "YELLOW":
      me.coins += card.coinsReward ?? 0;
      if (hasToken(me, "ELF_YELLOW_EXTRA_TURN")) state.extraTurn = true;
      if (hasToken(me, "HUMAN_YELLOW_RING")) steps.push(...advanceRing(state, faction, 1));
      break;
    case "BLUE":
      steps.push(...advanceRing(state, faction, card.ringAdvance ?? 0));
      if (hasToken(me, "HOBBIT_BLUE_UNIT")) steps.push({ kind: "PLACE", count: 1, regions: REGIONS, source: "호빗 동행" });
      break;
    case "PURPLE":
      if (card.tacticsType === "MULTI_MOVE") steps.push({ kind: "MOVE", remaining: card.tacticsAmount ?? 2, source: card.name });
      else if (card.tacticsType === "SNIPE_UNIT") steps.push({ kind: "SNIPE", count: card.tacticsAmount ?? 1, source: card.name });
      else if (card.tacticsType === "DRAIN_COINS") {
        const n = Math.min(opp.coins, card.tacticsAmount ?? 3);
        opp.coins -= n;
        log(state, faction, `💸 ${who(otherFaction(faction))}의 주화 ${n}개를 은행으로 반납시킴`, "TACTIC");
      }
      break;
    case "GRAY":
      break;
  }
  if (viaChain && hasToken(me, "HUMAN_CHAIN_BONUS")) me.coins += 3;
  prepend(state, steps);
}

function landmarkEffects(state: LotrDuelState, faction: Faction, tile: LandmarkTile) {
  const region = state.boardRegions[tile.targetRegion];
  if (faction === "FELLOWSHIP") region.fellowshipFortress = true;
  else region.sauronFortress = true;
  state.players[faction].fortressesInSupply -= 1;
  const steps: PendingStep[] = [];
  switch (tile.id) {
    case "BARAD_DUR":
      steps.push({ kind: "DISCARD_PLAY", source: tile.name });
      break;
    case "BREE":
      placeUnits(state, faction, "ARNOR", 2);
      steps.push({ kind: "MOVE", remaining: 2, source: tile.name });
      break;
    case "EREBOR":
      state.players[faction].coins += 5;
      steps.push({ kind: "MOVE", remaining: 1, source: tile.name });
      break;
    case "GREY_HAVENS":
      steps.push({ kind: "TOKEN_RACE", source: tile.name });
      break;
    case "HELMS_DEEP":
      placeUnits(state, faction, "ROHAN", 3);
      break;
    case "ISENGARD":
      steps.push({ kind: "DESTROY_GRAY", source: tile.name });
      steps.push(...advanceRing(state, faction, 1));
      break;
    case "MINAS_TIRITH":
      placeUnits(state, faction, "GONDOR", 1);
      steps.push(...advanceRing(state, faction, 2));
      break;
  }
  if (hasToken(state.players[faction], "DWARF_LANDMARK_EXTRA_TURN")) state.extraTurn = true;
  prepend(state, steps);
}

function tokenEffects(state: LotrDuelState, faction: Faction, id: AllianceTokenId) {
  const steps: PendingStep[] = [];
  switch (id) {
    case "ENT_RING_TWO":
      steps.push(...advanceRing(state, faction, 2));
      break;
    case "ENT_DESTROY_FORTRESS":
      steps.push({ kind: "DESTROY_FORTRESS", source: TOKENS[id].name });
      break;
    case "ENT_TRIPLE":
      steps.push({ kind: "ENT_CHOICE", remaining: 3, source: TOKENS[id].name });
      break;
    case "WIZARD_EXTRA_TURN":
      state.extraTurn = true;
      break;
    case "WIZARD_TWO_UNITS":
      steps.push({ kind: "PLACE", count: 1, regions: REGIONS, source: TOKENS[id].name }, { kind: "PLACE", count: 1, regions: REGIONS, source: TOKENS[id].name });
      break;
    case "WIZARD_DISCARD_PLAY":
      steps.push({ kind: "DISCARD_PLAY", source: TOKENS[id].name });
      break;
    default:
      break;
  }
  prepend(state, steps);
}

function placeUnits(state: LotrDuelState, faction: Faction, regionId: RegionId, count: number) {
  const me = state.players[faction];
  const n = Math.min(count, me.unitsInSupply);
  if (n <= 0) return;
  me.unitsInSupply -= n;
  addUnits(state.boardRegions[regionId], faction, n);
  log(state, faction, `🪖 ${who(faction)}이(가) ${REGION_INFO[regionId].name}에 유닛 ${n}개 배치`, "UNIT");
  fight(state, regionId);
}

// ---------------------------------------------------------------------------
// Victory
// ---------------------------------------------------------------------------

export function checkInstantVictory(state: LotrDuelState, activeFirst: Faction = state.turn): { winner: Faction; type: Exclude<WinType, "TERRITORY_MAJORITY"> } | null {
  if (state.ringTrack.frodoPosition >= state.ringTrack.trackLength) return { winner: "FELLOWSHIP", type: "RING_QUEST" };
  if (state.ringTrack.nazgulPosition >= state.ringTrack.frodoPosition) return { winner: "SAURON", type: "RING_QUEST" };
  const order: Faction[] = [activeFirst, otherFaction(activeFirst)];
  for (const f of order) if (raceSymbols(state.players[f]).size >= 6) return { winner: f, type: "RACE_ALLIANCE" };
  for (const f of order) if (controlledCount(state, f) === REGIONS.length) return { winner: f, type: "CONQUEST" };
  return null;
}

/**
 * End of chapter 3: more regions with your units/fortress wins. The rulebook
 * has no tie-break, so (self-decided) ties go to more race symbols, then more
 * coins, then the Fellowship — the Ring was never caught.
 */
export function finalWinner(state: LotrDuelState): Faction {
  const cmp = (f: (x: Faction) => number) => f("FELLOWSHIP") - f("SAURON");
  const keys = [(x: Faction) => controlledCount(state, x), (x: Faction) => raceSymbols(state.players[x]).size, (x: Faction) => state.players[x].coins];
  for (const k of keys) {
    const d = cmp(k);
    if (d !== 0) return d > 0 ? "FELLOWSHIP" : "SAURON";
  }
  return "FELLOWSHIP";
}

const WIN_TEXT: Record<WinType, string> = {
  RING_QUEST: "반지 원정 승리",
  RACE_ALLIANCE: "종족 동맹 승리",
  CONQUEST: "가운데땅 완전 정복",
  TERRITORY_MAJORITY: "지역 지배 판정승",
};
export { WIN_TEXT };

function settle(state: LotrDuelState): boolean {
  const win = checkInstantVictory(state);
  if (!win) return false;
  state.phase = "GAME_OVER";
  state.winner = win.winner;
  state.winType = win.type;
  state.pending = [];
  log(state, win.winner, `🏆 ${FACTION_LABEL[win.winner]} — ${WIN_TEXT[win.type]}!`, "SYSTEM");
  return true;
}

/** Keeps the whole game's history for the log panel (a full game is ~150–250 entries). */
const LOG_LIMIT = 400;

function log(state: LotrDuelState, faction: Faction | null, text: string, kind: LogKind = "SYSTEM", card?: LogEntry["card"]) {
  const no = (state.log[state.log.length - 1]?.no ?? 0) + 1;
  state.log.push({ no, turn: state.turnNumber, faction, kind, text, ...(card ? { card } : {}) });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

const who = (f: Faction) => FACTION_LABEL[f];

/** Drops leading steps that can't do anything, then ends the turn if nothing is left. */
function advance(state: LotrDuelState) {
  if (settle(state)) return;
  while (state.pending.length > 0 && !stepPossible(state, state.turn, state.pending[0])) state.pending.shift();
  if (state.pending.length > 0) return;
  endTurn(state);
}

function endTurn(state: LotrDuelState) {
  state.turnNumber += 1;
  const allTaken = state.pyramidGrid.every((s) => s.isTaken);
  if (allTaken) {
    state.extraTurn = false;
    if (state.chapter === 3) {
      const w = finalWinner(state);
      state.phase = "GAME_OVER";
      state.winner = w;
      state.winType = "TERRITORY_MAJORITY";
      log(state, w, `🏆 3챕터 종료 — ${FACTION_LABEL[w]} 지역 지배 판정승 (${controlledCount(state, "FELLOWSHIP")} : ${controlledCount(state, "SAURON")})`);
      return;
    }
    const next = (state.chapter + 1) as 2 | 3;
    state.chapter = next;
    const refill = 3 - state.revealedLandmarks.length;
    state.revealedLandmarks = [...state.revealedLandmarks, ...state.landmarkDeck.slice(0, refill)];
    state.landmarkDeck = state.landmarkDeck.slice(Math.max(0, refill));
    dealChapter(state, next);
    // The player who took the chapter's last card hands the lead to the opponent.
    state.turn = otherFaction(state.turn);
    state.startPlayerOfChapter = state.turn;
    log(state, null, `📖 ${next}챕터 시작 — ${FACTION_LABEL[state.turn]} 선`);
    return;
  }
  if (state.extraTurn) {
    state.extraTurn = false;
    log(state, state.turn, `⏩ ${who(state.turn)} 추가 턴`, "SYSTEM");
    return;
  }
  state.turn = otherFaction(state.turn);
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function clone(state: LotrDuelState): LotrDuelState {
  return JSON.parse(JSON.stringify(state)) as LotrDuelState;
}

function playCard(state: LotrDuelState, faction: Faction, card: LotrDuelCard, viaChain: boolean) {
  state.players[faction].tableauCards.push(card);
  cardEffects(state, faction, card, viaChain);
}

export function applyAction(state: LotrDuelState, action: EngineAction): LotrDuelState {
  if (state.phase !== "PLAYING" || action.faction !== state.turn) return state;
  const f = action.faction;
  const front = state.pending[0];

  if (action.type === "TAKE_CARD" || action.type === "TAKE_LANDMARK") {
    if (front) return state;
    if (action.type === "TAKE_CARD") {
      if (!isSlotAvailable(state, action.slot)) return state;
      const card = state.pyramidGrid[action.slot].card;
      const cost = calculateCardCost(state.players[f], card);
      if (action.mode === "PLAY" && !cost.canAfford) return state;
      const s = clone(state);
      const me = s.players[f];
      s.pyramidGrid[action.slot].isTaken = true;
      s.pyramidGrid.forEach((slot, i) => {
        if (!slot.isTaken && !slot.isOpen && isSlotAvailable(s, i)) slot.isOpen = true;
      });
      s.lastAction = { no: (s.lastAction?.no ?? 0) + 1, faction: f, kind: action.mode, cardId: card.id };
      if (action.mode === "DISCARD") {
        const gain = discardValue(s, f);
        me.coins += gain;
        s.discardedCards.push(card);
        log(s, f, `🗑️ ${who(f)}이(가) 「${card.name}」 카드를 버리고 ${gain}주화를 획득`, "DISCARD", { id: card.id, use: "DISCARD", coins: gain });
      } else {
        me.coins -= cost.costInCoins;
        log(s, f, `🃏 ${who(f)}이(가) 「${card.name}」 카드를 획득${cost.viaChain ? " (연계 무료)" : cost.costInCoins > 0 ? ` (${cost.costInCoins}주화 지불)` : " (무료)"}`, "CARD", { id: card.id, use: "PLAY", coins: cost.costInCoins, viaChain: cost.viaChain });
        playCard(s, f, card, cost.viaChain);
      }
      advance(s);
      return s;
    }
    const tile = state.revealedLandmarks.find((l) => l.id === action.landmarkId);
    if (!tile) return state;
    const cost = calculateLandmarkCost(state, f, tile);
    if (!cost.canAfford) return state;
    const s = clone(state);
    const me = s.players[f];
    me.coins -= cost.costInCoins;
    s.revealedLandmarks = s.revealedLandmarks.filter((l) => l.id !== tile.id);
    me.constructedLandmarks.push(tile);
    s.lastAction = { no: (s.lastAction?.no ?? 0) + 1, faction: f, kind: "LANDMARK", landmarkId: tile.id };
    log(s, f, `🏰 ${who(f)}이(가) ${REGION_INFO[tile.targetRegion].name}에 「${tile.name}」 요새를 건설 (${cost.costInCoins}주화)`, "LANDMARK");
    landmarkEffects(s, f, tile);
    advance(s);
    return s;
  }

  if (!front) return state;
  const opp = otherFaction(f);

  switch (action.type) {
    case "PLACE": {
      if (front.kind !== "PLACE" || !front.regions.includes(action.region)) return state;
      const s = clone(state);
      s.pending.shift();
      placeUnits(s, f, action.region, front.count);
      advance(s);
      return s;
    }
    case "MOVE": {
      if (front.kind !== "MOVE") return state;
      if (!ADJACENCY[action.from].includes(action.to) || unitsOf(state.boardRegions[action.from], f) <= 0) return state;
      const s = clone(state);
      const step = s.pending.shift() as Extract<PendingStep, { kind: "MOVE" }>;
      addUnits(s.boardRegions[action.from], f, -1);
      addUnits(s.boardRegions[action.to], f, 1);
      log(s, f, `👣 ${who(f)} 유닛 이동: ${REGION_INFO[action.from].name} → ${REGION_INFO[action.to].name}`, "MOVE");
      fight(s, action.to);
      if (step.remaining > 1) prepend(s, [{ ...step, remaining: step.remaining - 1 }]);
      advance(s);
      return s;
    }
    case "SKIP": {
      if (front.kind !== "MOVE") return state;
      const s = clone(state);
      s.pending.shift();
      advance(s);
      return s;
    }
    case "SNIPE": {
      if (front.kind !== "SNIPE" || unitsOf(state.boardRegions[action.region], opp) <= 0) return state;
      const s = clone(state);
      s.pending.shift();
      addUnits(s.boardRegions[action.region], opp, -1);
      s.players[opp].unitsInSupply += 1;
      log(s, f, `🎯 ${who(f)}이(가) ${REGION_INFO[action.region].name}의 적 유닛 1개 제거`, "TACTIC");
      if (front.count > 1) prepend(s, [{ ...front, count: front.count - 1 }]);
      advance(s);
      return s;
    }
    case "DESTROY_FORTRESS": {
      if (front.kind !== "DESTROY_FORTRESS" || !fortressOf(state.boardRegions[action.region], opp)) return state;
      const s = clone(state);
      s.pending.shift();
      const r = s.boardRegions[action.region];
      if (opp === "FELLOWSHIP") r.fellowshipFortress = false;
      else r.sauronFortress = false;
      s.players[opp].fortressesInSupply += 1;
      log(s, f, `💥 ${who(f)}이(가) ${REGION_INFO[action.region].name}의 적 요새 파괴`, "TACTIC");
      advance(s);
      return s;
    }
    case "DESTROY_GRAY": {
      if (front.kind !== "DESTROY_GRAY") return state;
      const idx = state.players[opp].tableauCards.findIndex((c) => c.id === action.cardId && c.color === "GRAY");
      if (idx < 0) return state;
      const s = clone(state);
      s.pending.shift();
      const [card] = s.players[opp].tableauCards.splice(idx, 1);
      s.discardedCards.push(card);
      log(s, f, `🔥 ${who(f)}이(가) 상대의 「${card.name}」 카드를 파괴`, "TACTIC", { id: card.id, use: "DESTROYED", coins: 0 });
      advance(s);
      return s;
    }
    case "DISCARD_PLAY": {
      if (front.kind !== "DISCARD_PLAY") return state;
      const idx = state.discardedCards.findIndex((c) => c.id === action.cardId);
      if (idx < 0) return state;
      const s = clone(state);
      s.pending.shift();
      const [card] = s.discardedCards.splice(idx, 1);
      log(s, f, `♻️ ${who(f)}이(가) 버린 카드 「${card.name}」를 무료로 획득`, "CARD", { id: card.id, use: "FREE", coins: 0 });
      playCard(s, f, card, false);
      advance(s);
      return s;
    }
    case "PICK_RACE": {
      if (front.kind !== "TOKEN_RACE" || state.allianceTokenDecks[action.race].length === 0) return state;
      const s = clone(state);
      s.pending.shift();
      prepend(s, [{ kind: "TOKEN", races: [action.race], source: front.source }]);
      advance(s);
      return s;
    }
    case "PICK_TOKEN": {
      if (front.kind !== "TOKEN" || !tokenOptions(state, front).includes(action.tokenId)) return state;
      const s = clone(state);
      s.pending.shift();
      const token = TOKENS[action.tokenId];
      s.allianceTokenDecks[token.race] = s.allianceTokenDecks[token.race].filter((id) => id !== token.id);
      s.players[f].allianceTokens.push(token);
      log(s, f, `🤝 ${who(f)}이(가) 동맹 토큰 「${token.name}」 획득`, "TOKEN");
      tokenEffects(s, f, token.id);
      advance(s);
      return s;
    }
    case "ENT_PICK": {
      if (front.kind !== "ENT_CHOICE") return state;
      const s = clone(state);
      s.pending.shift();
      const rest: PendingStep[] = front.remaining > 1 ? [{ ...front, remaining: front.remaining - 1 }] : [];
      if (action.option === "DRAIN") {
        const n = Math.min(1, s.players[opp].coins);
        s.players[opp].coins -= n;
        log(s, f, `🌳 ${who(opp)}의 주화 ${n}개 차감`, "TACTIC");
        prepend(s, rest);
      } else if (action.option === "SNIPE") prepend(s, [{ kind: "SNIPE", count: 1, source: front.source }, ...rest]);
      else prepend(s, [{ kind: "MOVE", remaining: 1, source: front.source }, ...rest]);
      advance(s);
      return s;
    }
  }
  return state;
}

/** Only `state.turn` ever acts in this game. */
export function pendingFactions(state: LotrDuelState): Faction[] {
  return state.phase === "PLAYING" ? [state.turn] : [];
}

/** Every legal action for the active player — used by the bot and tests. */
export function legalActions(state: LotrDuelState): EngineAction[] {
  if (state.phase !== "PLAYING") return [];
  const f = state.turn;
  const me = state.players[f];
  const opp = otherFaction(f);
  const front = state.pending[0];
  const out: EngineAction[] = [];
  if (!front) {
    for (const slot of availableSlots(state)) {
      out.push({ type: "TAKE_CARD", faction: f, slot, mode: "DISCARD" });
      if (calculateCardCost(me, state.pyramidGrid[slot].card).canAfford) out.push({ type: "TAKE_CARD", faction: f, slot, mode: "PLAY" });
    }
    for (const tile of state.revealedLandmarks) if (calculateLandmarkCost(state, f, tile).canAfford) out.push({ type: "TAKE_LANDMARK", faction: f, landmarkId: tile.id });
    return out;
  }
  switch (front.kind) {
    case "PLACE":
      front.regions.forEach((region) => out.push({ type: "PLACE", faction: f, region }));
      break;
    case "MOVE":
      for (const from of REGIONS) if (unitsOf(state.boardRegions[from], f) > 0) ADJACENCY[from].forEach((to) => out.push({ type: "MOVE", faction: f, from, to }));
      out.push({ type: "SKIP", faction: f });
      break;
    case "SNIPE":
      REGIONS.filter((r) => unitsOf(state.boardRegions[r], opp) > 0).forEach((region) => out.push({ type: "SNIPE", faction: f, region }));
      break;
    case "DESTROY_FORTRESS":
      REGIONS.filter((r) => fortressOf(state.boardRegions[r], opp)).forEach((region) => out.push({ type: "DESTROY_FORTRESS", faction: f, region }));
      break;
    case "DESTROY_GRAY":
      state.players[opp].tableauCards.filter((c) => c.color === "GRAY").forEach((c) => out.push({ type: "DESTROY_GRAY", faction: f, cardId: c.id }));
      break;
    case "DISCARD_PLAY":
      state.discardedCards.forEach((c) => out.push({ type: "DISCARD_PLAY", faction: f, cardId: c.id }));
      break;
    case "TOKEN_RACE":
      RACES.filter((r) => state.allianceTokenDecks[r].length > 0).forEach((race) => out.push({ type: "PICK_RACE", faction: f, race }));
      break;
    case "TOKEN":
      tokenOptions(state, front).forEach((tokenId) => out.push({ type: "PICK_TOKEN", faction: f, tokenId }));
      break;
    case "ENT_CHOICE":
      (["SNIPE", "DRAIN", "MOVE"] as const).forEach((option) => out.push({ type: "ENT_PICK", faction: f, option }));
      break;
  }
  return out;
}
