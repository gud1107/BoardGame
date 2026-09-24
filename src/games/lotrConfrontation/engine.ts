import { preCombatSteps, resolveCards, type Side } from "./combat";
import { CARDS, CHARACTERS, FACTION_CHARACTERS, FACTION_LABEL, HOME, MORDOR, REGIONS, SETUP_SLOTS, SHIRE, factionDeck, otherFaction } from "./data";
import { allLegalMoves, eaglesTarget, escapeTargets, getLegalMoves, piecesIn } from "./movement";
import type { CharacterId, CombatOutcome, CombatReport, EngineAction, Faction, LotrState, PreChoice, Seat } from "./types";

export * from "./types";
export { otherFaction } from "./data";

/**
 * Pure lockstep reducer for 반지의 제왕: 가운데땅에서의 대결.
 *
 * Both clients replay the same `EngineAction` stream, so this file must stay
 * deterministic: no `Math.random()` (peeks draw from `seed + rngCounter`),
 * and an invalid/stale action is always a silent no-op that returns the SAME
 * state object.
 *
 * Two steps are simultaneous — secret setup and blind card selection — and
 * both factions broadcast independently there. Those actions are written to be
 * commutative (each only fills its own faction's slot; the transition fires
 * when the second slot is filled), so the broadcast arrival order can differ
 * between clients without desyncing them.
 */

/**
 * House rule (not in the rulebook): the rulebook has no draw, but Frodo's
 * 도주 lets the same attack/flee exchange repeat forever (observed in bot
 * self-play). At this turn the ring-bearer has simply run out of time and
 * Sauron wins. A normal game ends around turn 30.
 */
export const TURN_LIMIT = 200;

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

export function seatOf(state: LotrState, faction: Faction): Seat {
  return state.factionOf.p1 === faction ? "p1" : "p2";
}

function mulberry(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function nextRand(state: LotrState): number {
  state.rngCounter += 1;
  return mulberry(state.seed * 7919 + state.rngCounter * 104729);
}

export function startGame(seed: number, fellowshipSeat: Seat = "p1"): LotrState {
  return {
    seed,
    rngCounter: 0,
    factionOf: fellowshipSeat === "p1" ? { p1: "FELLOWSHIP", p2: "SAURON" } : { p1: "SAURON", p2: "FELLOWSHIP" },
    phase: "SETUP",
    setupDone: { FELLOWSHIP: false, SAURON: false },
    pieces: {},
    graveyard: [],
    hands: { FELLOWSHIP: factionDeck("FELLOWSHIP"), SAURON: factionDeck("SAURON") },
    discards: { FELLOWSHIP: [], SAURON: [] },
    destroyed: [],
    turn: "FELLOWSHIP",
    turnNumber: 0,
    immobile: {},
    frodoAttackers: [],
    combat: null,
    combatCount: 0,
    lastCombat: null,
    peek: null,
    lastMove: null,
    shireInvadersCount: 0,
    winner: null,
    winReason: null,
    log: [],
  };
}

/** Seed-derived default arrangement — used for the setup screen's starting layout and for bots. */
export function randomPlacement(faction: Faction, seed: number): Record<string, string> {
  const chars = [...FACTION_CHARACTERS[faction]];
  let s = seed;
  for (let i = chars.length - 1; i > 0; i--) {
    s += 1;
    const j = Math.floor(mulberry(s * 31337) * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const slots: string[] = [];
  for (const [region, n] of Object.entries(SETUP_SLOTS[faction])) for (let k = 0; k < n; k++) slots.push(region);
  const out: Record<string, string> = {};
  chars.forEach((c, i) => (out[c] = slots[i]));
  return out;
}

export function isValidPlacement(faction: Faction, placement: Partial<Record<CharacterId, string>>): boolean {
  const counts: Record<string, number> = {};
  for (const c of FACTION_CHARACTERS[faction]) {
    const r = placement[c];
    if (!r || !(r in SETUP_SLOTS[faction])) return false;
    counts[r] = (counts[r] ?? 0) + 1;
  }
  if (Object.keys(placement).length !== FACTION_CHARACTERS[faction].length) return false;
  return Object.entries(counts).every(([r, n]) => n <= SETUP_SLOTS[faction][r]);
}

/** Factions whose decision the game is currently waiting on (two during simultaneous steps). */
export function pendingFactions(state: LotrState): Faction[] {
  switch (state.phase) {
    case "SETUP":
      return (["FELLOWSHIP", "SAURON"] as Faction[]).filter((f) => !state.setupDone[f]);
    case "MOVEMENT":
      return [state.turn];
    case "COMBAT": {
      const c = state.combat;
      if (!c) return [];
      if (c.step === "PRE_COMBAT") return c.pendingChoice ? [c.pendingChoice.faction] : [];
      return (["FELLOWSHIP", "SAURON"] as Faction[]).filter((f) => !c.picks[f]);
    }
    default:
      return [];
  }
}

export function evaluateVictory(state: LotrState): { winner: Faction; reason: string } | null {
  const frodo = state.pieces.FRODO;
  if (!frodo) return { winner: "SAURON", reason: "프로도가 쓰러졌습니다 — 절대반지는 사우론의 손에." };
  if (frodo.regionId === MORDOR) return { winner: "FELLOWSHIP", reason: "프로도가 모르도르에 잠입했습니다!" };
  const invaders = piecesIn(state, SHIRE).filter((p) => p.faction === "SAURON").length;
  if (invaders >= 3) return { winner: "SAURON", reason: "사우론의 군세 3기가 샤이어를 점령했습니다." };
  const sauronAlive = Object.values(state.pieces).some((p) => p && p.faction === "SAURON");
  if (!sauronAlive) return { winner: "FELLOWSHIP", reason: "사우론의 모든 군세가 전멸했습니다." };
  return null;
}

function pushLog(state: LotrState, line: string) {
  state.log = [...state.log, line].slice(-40);
}

function endGame(state: LotrState, winner: Faction, reason: string) {
  state.phase = "GAME_OVER";
  state.winner = winner;
  state.winReason = reason;
  state.combat = null;
  pushLog(state, `🏆 ${FACTION_LABEL[winner]} 승리 — ${reason}`);
}

function endTurn(state: LotrState) {
  state.shireInvadersCount = piecesIn(state, SHIRE).filter((p) => p.faction === "SAURON").length;
  const v = evaluateVictory(state);
  if (v) return endGame(state, v.winner, v.reason);
  state.phase = "MOVEMENT";
  state.turn = otherFaction(state.turn);
  state.turnNumber += 1;
  if (state.turnNumber > TURN_LIMIT) {
    return endGame(state, "SAURON", `${TURN_LIMIT}턴이 지나도록 반지가 파괴되지 않았습니다 — 어둠이 가운데땅을 뒤덮습니다.`);
  }
  if (allLegalMoves(state, state.turn).length === 0) {
    endGame(state, otherFaction(state.turn), `${FACTION_LABEL[state.turn]}에게 움직일 수 있는 말이 없습니다(기동 불가 패배).`);
  }
}

function kill(state: LotrState, id: CharacterId) {
  if (!state.pieces[id]) return;
  delete state.pieces[id];
  state.graveyard = [...state.graveyard, id];
}

function sideId(state: LotrState, side: Side): CharacterId {
  const c = state.combat!;
  return side === "A" ? c.attackerId : c.defenderId;
}

function finishCombat(
  state: LotrState,
  outcome: CombatOutcome,
  died: { A: boolean; D: boolean },
  extra: { cards?: { A: string; D: string }; power?: { A: number; D: number } | null } = {},
) {
  const c = state.combat!;
  const attacker = CHARACTERS[c.attackerId];
  const defender = CHARACTERS[c.defenderId];
  const report: CombatReport = {
    no: state.combatCount,
    regionId: c.regionId,
    attacker: { faction: attacker.faction, characterId: c.attackerId, card: extra.cards?.A ?? null, power: extra.power?.A ?? null, died: died.A },
    defender: { faction: defender.faction, characterId: c.defenderId, card: extra.cards?.D ?? null, power: extra.power?.D ?? null, died: died.D },
    outcome,
    log: c.log,
  };
  state.lastCombat = report;
  const verdict =
    died.A && died.D ? "양측 전사" : died.A ? `${attacker.name} 전사` : died.D ? `${defender.name} 전사` : outcome === "escaped" ? "전투 회피" : "양측 생존";
  pushLog(state, `⚔️ ${REGIONS[c.regionId].name}: ${attacker.name} vs ${defender.name} — ${verdict}`);
  state.combat = null;
  endTurn(state);
}

function startCombat(state: LotrState, attackerId: CharacterId, defenderId: CharacterId, origin: string) {
  state.combatCount += 1;
  state.phase = "COMBAT";
  state.pieces[attackerId]!.isRevealed = true;
  state.pieces[defenderId]!.isRevealed = true;
  if (defenderId === "FRODO" && !state.frodoAttackers.includes(attackerId)) state.frodoAttackers = [...state.frodoAttackers, attackerId];
  const att = state.pieces[attackerId]!;
  const def = state.pieces[defenderId]!;
  state.combat = {
    regionId: def.regionId,
    attackerId,
    defenderId,
    attackerOrigin: origin,
    step: "PRE_COMBAT",
    preQueue: preCombatSteps({ faction: att.faction, characterId: attackerId }, { faction: def.faction, characterId: defenderId }),
    preIndex: 0,
    pendingChoice: null,
    baseZeroed: [],
    picks: {},
    log: [`⚔️ ${REGIONS[def.regionId].name}에서 전투! ${CHARACTERS[attackerId].name}(공격) vs ${CHARACTERS[defenderId].name}(방어)`],
  };
  runPreCombat(state);
}

function randomPeek(state: LotrState, viewer: Faction, by: CharacterId) {
  const hand = state.hands[otherFaction(viewer)];
  if (hand.length === 0) return;
  const cardId = hand[Math.floor(nextRand(state) * hand.length)];
  state.peek = { viewer, cardId, by, combatNo: state.combatCount };
  state.combat!.log.push(`${CHARACTERS[by].name}의 정찰 — 상대 손패 1장이 ${FACTION_LABEL[viewer]}에게 공개되었습니다.`);
}

function runPreCombat(state: LotrState) {
  const c = state.combat!;
  while (c.preIndex < c.preQueue.length) {
    const step = c.preQueue[c.preIndex];
    const me = sideId(state, step.side);
    const them = sideId(state, step.side === "A" ? "D" : "A");
    const meName = CHARACTERS[me].name;
    const themName = CHARACTERS[them].name;
    switch (step.kind) {
      case "KILL": {
        const verb = me === "GIMLI" ? "오크 학살" : me === "LEGOLAS" ? "사격" : "기습";
        c.log.push(`${meName}의 ${verb}! 카드를 내기도 전에 ${themName}을(를) 쓰러뜨립니다.`);
        kill(state, them);
        return finishCombat(state, "pre-kill", { A: step.side === "D", D: step.side === "A" });
      }
      case "BOROMIR":
        c.log.push(`보로미르의 희생! 수치 대결 없이 ${themName}과(와) 함께 장렬히 산화합니다.`);
        kill(state, me);
        kill(state, them);
        return finishCombat(state, "both-die", { A: true, D: true });
      case "SHELOB":
        c.baseZeroed = [...c.baseZeroed, them];
        c.log.push(`쉐롭의 맹독 거미줄 — ${themName}의 기본 전투력이 0으로 고정됩니다.`);
        break;
      case "GOBLIN_PEEK":
        randomPeek(state, "SAURON", me);
        break;
      case "FRODO_FLEE": {
        const options = escapeTargets(state, me, { emptyOnly: false });
        if (options.length === 0) {
          c.log.push("프로도는 도망칠 곳이 없습니다.");
          break;
        }
        c.pendingChoice = { faction: "FELLOWSHIP", kind: "FRODO_FLEE", pieceId: me, options };
        return;
      }
      case "PIPPIN": {
        const options = escapeTargets(state, me, { emptyOnly: false, sidewaysOnly: true });
        if (options.length === 0) {
          randomPeek(state, "FELLOWSHIP", me);
          break;
        }
        c.pendingChoice = { faction: "FELLOWSHIP", kind: "PIPPIN", pieceId: me, options };
        return;
      }
    }
    c.preIndex += 1;
  }
  c.step = "CARD_PICK";
}

function applyPreChoice(state: LotrState, faction: Faction, choice: PreChoice) {
  const c = state.combat!;
  const pending = c.pendingChoice!;
  const name = CHARACTERS[pending.pieceId].name;
  if (choice.kind === "flee" || choice.kind === "sidestep") {
    state.pieces[pending.pieceId]!.regionId = choice.to;
    c.log.push(
      choice.kind === "flee"
        ? `${name}이(가) ${REGIONS[choice.to].name}(으)로 도주! 전투가 취소됩니다.`
        : `${name}이(가) ${REGIONS[choice.to].name}(으)로 슬쩍 비켜섭니다. 전투가 취소됩니다.`,
    );
    c.pendingChoice = null;
    return finishCombat(state, "escaped", { A: false, D: false });
  }
  if (choice.kind === "peek") randomPeek(state, faction, pending.pieceId);
  else c.log.push(`${name}은(는) 물러서지 않고 맞서 싸웁니다.`);
  c.pendingChoice = null;
  c.preIndex += 1;
  runPreCombat(state);
}

function resolveCardStep(state: LotrState) {
  const c = state.combat!;
  const attacker = state.pieces[c.attackerId]!;
  const defender = state.pieces[c.defenderId]!;
  const cardA = c.picks[attacker.faction]!;
  const cardD = c.picks[defender.faction]!;
  c.log.push(`카드 공개 — ${CHARACTERS[c.attackerId].name}: [${CARDS[cardA].name}] / ${CHARACTERS[c.defenderId].name}: [${CARDS[cardD].name}]`);

  const res = resolveCards({
    A: { faction: attacker.faction, characterId: c.attackerId, cardId: cardA },
    D: { faction: defender.faction, characterId: c.defenderId, cardId: cardD },
    baseZeroed: c.baseZeroed,
    frodoAttackers: state.frodoAttackers,
    findEscape: (side, kind) => {
      const id = sideId(state, side);
      return kind === "EAGLES" ? eaglesTarget(state, id) : (escapeTargets(state, id, { emptyOnly: true })[0] ?? null);
    },
  });
  c.log.push(...res.log);

  // Cards leave the hand, then go wherever the result says.
  for (const [side, cardId, faction] of [
    ["A", cardA, attacker.faction],
    ["D", cardD, defender.faction],
  ] as const) {
    const fate = res.cardFate[side];
    if (fate === "hand") continue;
    state.hands[faction] = state.hands[faction].filter((id) => id !== cardId);
    if (fate === "discard") state.discards[faction] = [...state.discards[faction], cardId];
    else state.destroyed = [...state.destroyed, cardId];
  }

  if (res.athelas) {
    const faction = res.athelas === "A" ? attacker.faction : defender.faction;
    const best = [...state.discards[faction]].filter((id) => CARDS[id].type === "BASIC").sort((a, b) => CARDS[b].power - CARDS[a].power)[0];
    if (best) {
      state.discards[faction] = state.discards[faction].filter((id) => id !== best);
      state.hands[faction] = [...state.hands[faction], best];
      c.log.push(`희망의 빛 — 버린 더미에서 [${CARDS[best].name}] 카드를 회수합니다.`);
    }
  }

  const origin = c.attackerOrigin;
  if (res.escape) {
    state.pieces[sideId(state, res.escape.side)]!.regionId = res.escape.to;
  }
  if (res.dead.A) kill(state, c.attackerId);
  if (res.dead.D) kill(state, c.defenderId);

  if (res.grond) {
    const id = sideId(state, res.grond);
    const f = CHARACTERS[id].faction;
    state.immobile = { ...state.immobile, [id]: state.turn === f ? state.turnNumber + 2 : state.turnNumber + 1 };
    c.log.push(`그론드의 반동 — ${CHARACTERS[id].name}은(는) 다음 턴에 움직일 수 없습니다.`);
  }

  const bothHere = !res.escape && !res.dead.A && !res.dead.D;
  if (bothHere) {
    state.pieces[c.attackerId]!.regionId = origin;
    c.log.push(`양측 모두 살아남아 ${CHARACTERS[c.attackerId].name}이(가) ${REGIONS[origin].name}(으)로 물러납니다.`);
  }

  for (const f of ["FELLOWSHIP", "SAURON"] as Faction[]) {
    if (state.hands[f].length === 0 && state.discards[f].length > 0) {
      state.hands[f] = state.discards[f];
      state.discards[f] = [];
      c.log.push(`${FACTION_LABEL[f]}의 손패가 바닥나 버린 카드 ${state.hands[f].length}장을 모두 회수합니다.`);
    }
  }

  const outcome: CombatOutcome = res.escape
    ? "escaped"
    : res.dead.A && res.dead.D
      ? "both-die"
      : res.dead.D
        ? "attacker-wins"
        : res.dead.A
          ? "defender-wins"
          : "both-survive";
  finishCombat(state, outcome, res.dead, { cards: { A: cardA, D: cardD }, power: res.power });
}

export function applyAction(prev: LotrState, action: EngineAction): LotrState {
  if (prev.phase === "GAME_OVER") return prev;
  switch (action.type) {
    case "setup": {
      if (prev.phase !== "SETUP" || prev.setupDone[action.faction]) return prev;
      if (!isValidPlacement(action.faction, action.placement)) return prev;
      const state = structuredClone(prev);
      for (const c of FACTION_CHARACTERS[action.faction]) {
        state.pieces[c] = { instanceId: c, characterId: c, faction: action.faction, regionId: action.placement[c]!, isRevealed: false };
      }
      state.setupDone[action.faction] = true;
      // Canonical key order, so both clients hold identical state whichever setup arrived first.
      const ordered: LotrState["pieces"] = {};
      for (const c of [...FACTION_CHARACTERS.FELLOWSHIP, ...FACTION_CHARACTERS.SAURON]) if (state.pieces[c]) ordered[c] = state.pieces[c];
      state.pieces = ordered;
      if (!(state.setupDone.FELLOWSHIP && state.setupDone.SAURON)) pushLog(state, "한 진영이 배치를 마쳤습니다");
      if (state.setupDone.FELLOWSHIP && state.setupDone.SAURON) {
        state.phase = "MOVEMENT";
        state.turn = "FELLOWSHIP";
        state.turnNumber = 1;
        pushLog(state, "안개가 내려앉았습니다 — 원정대의 첫 턴!");
      }
      return state;
    }
    case "move": {
      if (prev.phase !== "MOVEMENT" || prev.turn !== action.faction) return prev;
      const piece = prev.pieces[action.pieceId];
      if (!piece || piece.faction !== action.faction) return prev;
      if (!getLegalMoves(prev, action.pieceId).includes(action.to)) return prev;
      const state = structuredClone(prev);
      const from = piece.regionId;
      const enemy = piecesIn(state, action.to).find((p) => p.faction !== action.faction);
      state.pieces[action.pieceId]!.regionId = action.to;
      state.lastMove = { faction: action.faction, pieceId: action.pieceId, from, to: action.to };
      state.peek = null;
      if (enemy) {
        startCombat(state, action.pieceId, enemy.characterId, from);
      } else {
        pushLog(state, `${FACTION_LABEL[action.faction]}: ${REGIONS[from].name} → ${REGIONS[action.to].name}`);
        endTurn(state);
      }
      return state;
    }
    case "preChoice": {
      const pending = prev.combat?.pendingChoice;
      if (prev.phase !== "COMBAT" || !pending || pending.faction !== action.faction) return prev;
      const ch = action.choice;
      if (pending.kind === "FRODO_FLEE" && ch.kind !== "stay" && ch.kind !== "flee") return prev;
      if (pending.kind === "PIPPIN" && ch.kind !== "peek" && ch.kind !== "sidestep") return prev;
      if ((ch.kind === "flee" || ch.kind === "sidestep") && !pending.options.includes(ch.to)) return prev;
      const state = structuredClone(prev);
      applyPreChoice(state, action.faction, ch);
      return state;
    }
    case "pickCard": {
      const c = prev.combat;
      if (prev.phase !== "COMBAT" || !c || c.step !== "CARD_PICK" || c.picks[action.faction]) return prev;
      if (!prev.hands[action.faction].includes(action.cardId)) return prev;
      const state = structuredClone(prev);
      state.combat!.picks[action.faction] = action.cardId;
      if (state.combat!.picks.FELLOWSHIP && state.combat!.picks.SAURON) resolveCardStep(state);
      return state;
    }
  }
  return prev;
}

/** Home region label helper for UI copy. */
export function homeOf(faction: Faction): string {
  return HOME[faction];
}
