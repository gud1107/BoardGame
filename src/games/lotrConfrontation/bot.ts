import type { BotLevel } from "@/games/shared/bot/botDifficulty";
import { effectiveBase, resolveCards, type Side } from "./combat";
import { CARDS, CHARACTERS, FACTION_CHARACTERS, FLYING, MORDOR, ORC_KIND, REGIONS, SHIRE, otherFaction } from "./data";
import { randomPlacement } from "./engine";
import { allLegalMoves, eaglesTarget, escapeTargets, piecesIn } from "./movement";
import type { CharacterId, EngineAction, Faction, LotrState } from "./types";

/**
 * Heuristic AI for both factions. Runs only on the host (outside the
 * reducer), so `Math.random` is fine here — the chosen action is broadcast
 * like a human click.
 *
 * Fair play: the bot never peeks at hidden identities. An unrevealed enemy is
 * treated as the average of every enemy character that is still unaccounted
 * for. Hands are public knowledge in this game (both decks are fixed and every
 * used card goes face-up to the discard), so card selection simulates
 * `resolveCards` against each card still in the opponent's hand.
 */

/** Frodo is the whole game for both sides; everyone else is worth roughly their strength. */
function charValue(id: CharacterId): number {
  if (id === "FRODO") return 60;
  return CHARACTERS[id].basePower + 2;
}

/** Unrevealed enemy characters that are still alive, as far as `faction` can know. */
function hiddenEnemyPool(state: LotrState, faction: Faction): CharacterId[] {
  const enemy = otherFaction(faction);
  const known = new Set<CharacterId>(state.graveyard);
  for (const p of Object.values(state.pieces)) if (p && p.faction === enemy && p.isRevealed) known.add(p.characterId);
  return FACTION_CHARACTERS[enemy].filter((c) => !known.has(c));
}

/** Rough [-1..1]-ish value of `me` attacking `them` (before cards). */
function matchup(me: CharacterId, them: CharacterId, meAttacking: boolean): number {
  if (me === "GIMLI" && ORC_KIND.includes(them)) return charValue(them);
  if (me === "LEGOLAS" && FLYING.includes(them)) return charValue(them);
  if (me === "MERRY" && them === "WITCH_KING") return charValue(them);
  if (them === "GIMLI" && ORC_KIND.includes(me)) return -charValue(me);
  if (them === "LEGOLAS" && FLYING.includes(me)) return -charValue(me);
  if (them === "MERRY" && me === "WITCH_KING") return -charValue(me);
  if (me === "BOROMIR" || them === "BOROMIR") return charValue(them) - charValue(me);
  let myBase = CHARACTERS[me].basePower;
  if (me === "ARAGORN" && meAttacking) myBase = 5;
  let theirBase = CHARACTERS[them].basePower;
  if (me === "SHELOB") theirBase = 0;
  if (them === "SHELOB") myBase = 0;
  const diff = myBase - theirBase;
  const p = Math.max(0.05, Math.min(0.95, 0.5 + diff * 0.09));
  let ev = p * charValue(them) - (1 - p) * charValue(me);
  if (me === "FRODO") ev -= 30;
  return ev;
}

/** Enemy pieces adjacent to `regionId` that could legally step into it on their turn. */
function attackersOf(state: LotrState, regionId: string, faction: Faction): number {
  const tier = REGIONS[regionId].tier;
  let n = 0;
  for (const r of REGIONS[regionId].adjacentRegions) {
    const t = REGIONS[r].tier;
    const canReach = faction === "FELLOWSHIP" ? t >= tier : t <= tier;
    if (!canReach) continue;
    n += piecesIn(state, r).filter((p) => p.faction !== faction).length;
  }
  return n;
}

function sauronNearShire(state: LotrState): number {
  return Object.values(state.pieces).filter((p) => p && p.faction === "SAURON" && REGIONS[p.regionId].tier <= 2).length;
}

function scoreMove(state: LotrState, faction: Faction, pieceId: CharacterId, to: string): number {
  const piece = state.pieces[pieceId]!;
  const from = REGIONS[piece.regionId];
  const target = REGIONS[to];
  const fwd = faction === "FELLOWSHIP" ? target.tier - from.tier : from.tier - target.tier;
  const enemy = piecesIn(state, to).find((p) => p.faction !== faction);
  let score = fwd * 2;

  if (faction === "FELLOWSHIP") {
    if (pieceId === "FRODO") {
      if (to === MORDOR && !enemy) return 10_000;
      score += fwd * 4;
      // Enemies that could step into the destination next turn threaten the ring-bearer.
      score -= attackersOf(state, to, faction) * 7;
      score += attackersOf(state, piece.regionId, faction) * 5;
    } else {
      // Anyone else parked in Mordor is stuck for good and eats the ring-bearer's slot.
      if (to === MORDOR) score -= 20;
      // Holding the line near the Shire matters more than trading blows up north.
      if (enemy) score += (4 - target.tier) * 1.5;
      if (from.tier <= 1 && target.tier >= 2) score -= sauronNearShire(state) * 1.5;
    }
  } else {
    if (to === SHIRE) {
      const invaders = piecesIn(state, SHIRE).filter((p) => p.faction === "SAURON").length;
      score += invaders >= 2 && !enemy ? 10_000 : 25;
    }
  }

  if (enemy) {
    if (enemy.isRevealed) {
      if (faction === "SAURON" && enemy.characterId === "FRODO") {
        // A Frodo with somewhere to run just flees again — chasing him only loops.
        const canFlee = escapeTargets(state, "FRODO", { emptyOnly: false }).length > 0;
        if (canFlee) return fwd * 2 - 6;
        score += matchup(pieceId, enemy.characterId, true) + 40;
      } else {
        score += matchup(pieceId, enemy.characterId, true);
      }
    } else {
      const pool = hiddenEnemyPool(state, faction);
      const avg = pool.reduce((s, c) => s + matchup(pieceId, c, true), 0) / Math.max(1, pool.length);
      score += avg;
      if (faction === "SAURON" && pool.includes("FRODO")) score += 40 / Math.max(1, pool.length);
    }
  }
  return score;
}

function chooseSetup(faction: Faction, level: BotLevel): Record<string, string> {
  const placement = randomPlacement(faction, Math.floor(Math.random() * 1e9));
  if (level >= 4) {
    // Fellowship: the ring-bearer starts on a flank, where 도주 always has the Shire behind it.
    // Sauron: the troll leads from the front line.
    const guard = faction === "FELLOWSHIP" ? "FRODO" : "CAVE_TROLL";
    const want = faction === "FELLOWSHIP" ? ["ERIADOR", "GONDOR"] : ["GORGOROTH", "BARAD_DUR", "CIRITH_UNGOL"];
    if (!want.includes(placement[guard])) {
      const swapWith = Object.keys(placement).find((c) => c !== guard && want.includes(placement[c]));
      if (swapWith) [placement[guard], placement[swapWith]] = [placement[swapWith], placement[guard]];
    }
  }
  return placement;
}

function chooseCard(state: LotrState, faction: Faction, level: BotLevel): string {
  const c = state.combat!;
  const mySide: Side = CHARACTERS[c.attackerId].faction === faction ? "A" : "D";
  const myId = mySide === "A" ? c.attackerId : c.defenderId;
  const theirId = mySide === "A" ? c.defenderId : c.attackerId;
  const myHand = state.hands[faction];
  const theirHand = state.hands[otherFaction(faction)];
  if (level <= 2 && Math.random() < 0.6) return myHand[Math.floor(Math.random() * myHand.length)];

  let best = myHand[0];
  let bestScore = -Infinity;
  for (const mine of myHand) {
    let total = 0;
    for (const theirs of theirHand) {
      const res = resolveCards({
        A: { faction: CHARACTERS[c.attackerId].faction, characterId: c.attackerId, cardId: mySide === "A" ? mine : theirs },
        D: { faction: CHARACTERS[c.defenderId].faction, characterId: c.defenderId, cardId: mySide === "A" ? theirs : mine },
        baseZeroed: c.baseZeroed,
        frodoAttackers: state.frodoAttackers,
        findEscape: (side, kind) => {
          const id = side === "A" ? c.attackerId : c.defenderId;
          return kind === "EAGLES" ? eaglesTarget(state, id) : (escapeTargets(state, id, { emptyOnly: true })[0] ?? null);
        },
      });
      const theirSide: Side = mySide === "A" ? "D" : "A";
      total += (res.dead[theirSide] ? charValue(theirId) : 0) - (res.dead[mySide] ? charValue(myId) : 0);
    }
    const card = CARDS[mine];
    const cost = card.power * 0.35 + (card.type === "SPECIAL" ? 1.2 : 0);
    const noise = (10 - level) * Math.random() * 0.8;
    const score = total / Math.max(1, theirHand.length) - cost + noise;
    if (score > bestScore) {
      bestScore = score;
      best = mine;
    }
  }
  return best;
}

export function chooseBotAction(state: LotrState, faction: Faction, level: BotLevel): EngineAction | null {
  switch (state.phase) {
    case "SETUP":
      if (state.setupDone[faction]) return null;
      return { type: "setup", faction, placement: chooseSetup(faction, level) as Partial<Record<CharacterId, string>> };
    case "MOVEMENT": {
      if (state.turn !== faction) return null;
      const moves = allLegalMoves(state, faction);
      if (moves.length === 0) return null;
      let best = moves[0];
      let bestScore = -Infinity;
      for (const m of moves) {
        const s = scoreMove(state, faction, m.pieceId, m.to) + (10 - level) * Math.random() * 2.5;
        if (s > bestScore) {
          bestScore = s;
          best = m;
        }
      }
      return { type: "move", faction, pieceId: best.pieceId, to: best.to };
    }
    case "COMBAT": {
      const c = state.combat;
      if (!c) return null;
      if (c.step === "PRE_COMBAT") {
        const pending = c.pendingChoice;
        if (!pending || pending.faction !== faction) return null;
        const enemyId = pending.pieceId === c.attackerId ? c.defenderId : c.attackerId;
        const enemyBase = effectiveBase(pending.pieceId === c.attackerId ? "D" : "A", { faction: otherFaction(faction), characterId: enemyId }, { faction, characterId: pending.pieceId }, c.baseZeroed, state.frodoAttackers);
        if (pending.kind === "FRODO_FLEE") {
          if (level <= 2 && Math.random() < 0.4) return { type: "preChoice", faction, choice: { kind: "stay" } };
          return { type: "preChoice", faction, choice: { kind: "flee", to: pending.options[0] } };
        }
        if (enemyBase >= 3 && pending.options.length > 0) return { type: "preChoice", faction, choice: { kind: "sidestep", to: pending.options[0] } };
        return { type: "preChoice", faction, choice: { kind: "peek" } };
      }
      if (c.picks[faction]) return null;
      return { type: "pickCard", faction, cardId: chooseCard(state, faction, level) };
    }
    default:
      return null;
  }
}
