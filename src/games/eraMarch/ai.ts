/**
 * 시대의 진격 bot, Lv.1–10. It only ever returns `Command`s through the same
 * validation the human HUD uses, so it can later drive a disconnected seat
 * (bot takeover) or both seats in self-play balance runs.
 *
 * What the level changes:
 * - reaction: how often it looks at the board (Lv.1 ≈ 3.6 s, Lv.10 ≈ 0.9 s)
 * - counter rate: chance a pick answers the enemy's main role
 * - planning: saving gold for the next era, evolving only when safe,
 *   timing the special on packs, turret upgrades
 * - mistakes: low levels sometimes skip a think entirely
 *
 * Its own rng lives in BotMemory so bots never consume `state.rng`.
 */

import { BEATS, DOCTRINES, ERA_DOCTRINES, ERA_TURRETS, ERAS, LANE, POP_CAP, SLOT_COST, TURRETS, UNITS, type DoctrineId, type Role, type UnitKind } from "./data";
import { commandError, evolveCost, nextEra, popOf, progress, rosterOf, type Command, type EraMarchState, type Side } from "./engine";

export type AiLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export const AI_LEVEL_INFO: Record<AiLevel, { label: string; desc: string }> = {
  1: { label: "Lv.1 신병", desc: "느리고 아무거나 뽑아요" },
  2: { label: "Lv.2 견습", desc: "가끔 상성을 맞춰요" },
  3: { label: "Lv.3 병장", desc: "진화 골드를 모으기 시작" },
  4: { label: "Lv.4 하사", desc: "안전할 때만 진화" },
  5: { label: "Lv.5 중사", desc: "상성 반반 · 포탑 사용" },
  6: { label: "Lv.6 소위", desc: "필살기를 뭉친 적에" },
  7: { label: "Lv.7 대위", desc: "포탑 교체 · 빠른 반응" },
  8: { label: "Lv.8 소령", desc: "거의 항상 상성 대응" },
  9: { label: "Lv.9 대령", desc: "교리 상성까지 계산" },
  10: { label: "Lv.10 대원수", desc: "1초마다 판단하는 지휘관" },
};

export function sanitizeAiLevel(v: unknown): AiLevel {
  const n = Math.round(Number(v));
  return (n >= 1 && n <= 10 ? n : 4) as AiLevel;
}

export interface BotMemory {
  rng: number;
  nextThink: number;
}

export function newBotMemory(seed: number): BotMemory {
  return { rng: (seed ^ 0x5bd1e995) | 0, nextThink: 40 };
}

function rand(m: BotMemory): number {
  let t = (m.rng = (m.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const ROLES: Role[] = ["melee", "ranged", "charge"];

/** Which role answers `r` (the one that beats it). */
function counterOf(r: Role): Role {
  return (ROLES.find((x) => BEATS[x] === r) ?? "melee") as Role;
}

export function botThink(s: EraMarchState, side: Side, level: AiLevel, mem: BotMemory): Command[] {
  if (s.winner !== null || s.tick < mem.nextThink) return [];
  const react = Math.max(18, 78 - level * 6);
  mem.nextThink = s.tick + react + Math.floor(rand(mem) * react * 0.4);
  if (level <= 3 && rand(mem) < 0.25 - level * 0.05) return [];

  const p = s.players[side];
  const foe: Side = side === 0 ? 1 : 0;
  const cmds: Command[] = [];
  let gold = p.gold;
  const ok = (c: Command) => {
    if (commandError({ ...s, players: s.players.map((pl, i) => (i === side ? { ...pl, gold } : pl)) as typeof s.players }, side, c)) return false;
    cmds.push(c);
    return true;
  };

  const enemies = s.units.filter((u) => u.side === foe);
  const mine = s.units.filter((u) => u.side === side);
  // how deep the enemy is in my half (0 = not at all, 1 = at my wall)
  const enemyDepth = enemies.reduce((m, e) => Math.max(m, progress(foe, e.x) / LANE), 0);
  const pressure = enemies.filter((e) => progress(foe, e.x) > LANE * 0.62).reduce((v, e) => v + UNITS[e.kind].cost, 0);
  const myValue = mine.reduce((v, u) => v + UNITS[u.kind].cost, 0);
  const underAttack = enemyDepth > 0.72 && pressure > myValue * 0.6;

  // 1. evolve
  const n = nextEra(p);
  let reserve = 0;
  if (n !== null && p.xp >= ERAS[n].xpNeed) {
    const safe = level < 4 || !underAttack;
    const cost = evolveCost(s, side);
    if (gold >= cost && safe) {
      const doctrine = pickDoctrine(s, side, n, level, mem);
      if (ok({ t: "evolve", doctrine })) gold -= cost;
    } else if (level >= 3 && !underAttack) {
      reserve = cost * Math.min(1, 0.4 + level * 0.07);
    }
  }
  const evolved = cmds.some((c) => c.t === "evolve");
  const era = evolved && n !== null ? n : p.era;

  // 2. special
  if (p.specialCd === 0) {
    const pack = enemies.filter((e) => progress(foe, e.x) > LANE * 0.35).length;
    const want = level <= 3 ? enemies.length > 0 && rand(mem) < 0.5 : level <= 6 ? pack >= 3 || underAttack : (pack >= 4 && pressure > myValue * 0.5) || underAttack || enemies.length >= 7;
    if (want) ok({ t: "special" });
  }

  // 3. turrets
  if (level >= 2) {
    const empty = p.turrets.findIndex((t, i) => i < p.slots && !t);
    const best = ERA_TURRETS[era][level >= 6 && enemies.length >= 5 ? 1 : 0];
    if (empty >= 0 && gold - reserve > TURRETS[best].cost * (level >= 6 ? 1.6 : 2.2) && (underAttack || enemyDepth > 0.5 || level >= 8)) {
      if (ok({ t: "turret", slot: empty, kind: best })) gold -= TURRETS[best].cost;
    } else if (level >= 5 && p.slots < SLOT_COST.length && gold - reserve > SLOT_COST[p.slots] * 2.5 && p.turrets.every((t, i) => i >= p.slots || t)) {
      if (ok({ t: "slot" })) gold -= SLOT_COST[p.slots];
    } else if (level >= 7) {
      const old = p.turrets.findIndex((t) => t && TURRETS[t.kind].era < era - 1);
      if (old >= 0 && gold - reserve > TURRETS[best].cost * 1.4) {
        if (ok({ t: "turret", slot: old, kind: best })) gold -= TURRETS[best].cost - Math.floor(TURRETS[p.turrets[old]!.kind].cost / 2);
      }
    }
  }

  // 4. train (not in the same think as an evolve — the new roster unlocks next tick)
  if (evolved) return cmds;
  const queueTarget = Math.min(5, 1 + Math.ceil(level / 2.5));
  const roster = rosterOf(p);
  let queued = p.queue.length;
  const pop = popOf(s, side);
  const spendable = () => (underAttack ? gold : gold - reserve);
  for (let guard = 0; guard < 4 && queued < queueTarget && pop + queued < POP_CAP; guard++) {
    const kind = pickUnit(s, side, roster, level, mem, enemies, mine);
    if (!kind || UNITS[kind].cost > spendable()) break;
    if (!ok({ t: "train", kind })) break;
    gold -= UNITS[kind].cost;
    queued++;
  }
  return cmds;
}

function pickDoctrine(s: EraMarchState, side: Side, era: number, level: number, mem: BotMemory): DoctrineId | undefined {
  const pair = ERA_DOCTRINES[era as 1];
  if (!pair) return undefined;
  if (level < 6) return pair[rand(mem) < 0.5 ? 0 : 1];
  // look at what the enemy fields most and lean into its counter
  const foe: Side = side === 0 ? 1 : 0;
  const roles: Record<Role, number> = { melee: 0, ranged: 0, charge: 0, support: 0 };
  for (const u of s.units) if (u.side === foe) roles[UNITS[u.kind].role] += UNITS[u.kind].cost;
  const main = (Object.keys(roles) as Role[]).sort((a, b) => roles[b] - roles[a])[0];
  const want = counterOf(main);
  const score = (d: DoctrineId) => (UNITS[DOCTRINES[d].unit].role === want ? 2 : 0) + rand(mem) * (level >= 9 ? 0.5 : 1.5);
  return score(pair[0]) >= score(pair[1]) ? pair[0] : pair[1];
}

function pickUnit(s: EraMarchState, side: Side, roster: UnitKind[], level: number, mem: BotMemory, enemies: EraMarchState["units"], mine: EraMarchState["units"]): UnitKind | null {
  const foe: Side = side === 0 ? 1 : 0;
  const counterRate = Math.min(0.95, 0.05 + level * 0.095);
  const roles: Record<Role, number> = { melee: 0, ranged: 0, charge: 0, support: 0 };
  for (const e of enemies) roles[UNITS[e.kind].role] += UNITS[e.kind].cost * (0.5 + progress(foe, e.x) / LANE);
  const queued = s.players[side].queue.map((q) => UNITS[q.kind].role);
  const myRoles = [...mine.map((u) => UNITS[u.kind].role), ...queued];
  let role: Role;
  const enemyMain = (Object.keys(roles) as Role[]).filter((r) => r !== "support").sort((a, b) => roles[b] - roles[a])[0];
  if (enemies.length && rand(mem) < counterRate) role = counterOf(enemyMain);
  else if (level >= 4 && myRoles.filter((r) => r === "melee").length < Math.max(1, myRoles.length / 3)) role = "melee";
  else role = ROLES[Math.floor(rand(mem) * 3)];
  const options = roster.filter((k) => UNITS[k].role === role || (role === "ranged" && UNITS[k].role === "support"));
  const gold = s.players[side].gold;
  const affordable = options.filter((k) => UNITS[k].cost <= gold);
  const pool = affordable.length ? affordable : roster.filter((k) => UNITS[k].cost <= gold);
  if (!pool.length) return null;
  // higher levels lean to the stronger (pricier) option, lower ones grab whatever
  if (level >= 5 && rand(mem) < 0.6) return pool.reduce((a, b) => (UNITS[b].cost > UNITS[a].cost ? b : a));
  return pool[Math.floor(rand(mem) * pool.length)];
}
