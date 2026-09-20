/**
 * Pure Mafia (마피아) rules engine — no React, no I/O. Implements a dual-mode
 * ruleset per boardGameRule/마피아게임.md: [기본룰(Classic)] (시민/마피아/경찰/
 * 의사) and [확장룰(Expansion)] (+ 스파이/군인/정치인/영매/테러리스트).
 *
 * Same client-lockstep trust model as every other online game here (see
 * avalon/engine.ts's header doc for the fullest explanation): every connected
 * client computes and holds the FULL state — every seat's secret role, every
 * private investigation result — from a shared RNG seed plus replayed
 * `EngineAction`s. There is no server authority. The view layer only ever
 * *renders* the viewer's own role/knowledge (see `getKnowledge`) and masks
 * dead seats' roles per `config.revealRoleOnDeath` — a UI-layer convention
 * only, since the underlying state always carries the real role. Mafia's
 * secrecy stakes are the same as Avalon's: a technically inclined player
 * could inspect their own client state to see every role for the whole
 * game. Accepted trade-off for casual play among friends.
 *
 * Real-time phase timers (밤 25초, 낮 토론 30/60/90초 등) are handled the same
 * way HillOfTruth's cooldown system does it (see that engine's header
 * comment): every action that can trigger a phase transition carries its own
 * `atMs` timestamp, chosen once by whichever client dispatches it — the
 * reducer itself never calls `Date.now()`, so every client that replays the
 * same action arrives at the exact same `phaseStartedAt`. `forceAdvance` is
 * the "자율 상태 머신 가디언" from the work order: ANY client (not just the
 * host) may dispatch it once its own local clock says a phase's timer has
 * elapsed, and it's a safe no-op if the phase already moved on (checked via
 * `expectedPhase`) — so multiple clients racing to fire it is harmless.
 */

import { seededRng, shuffle } from "@/lib/rng";
import type { BotLevel } from "@/games/shared/bot/botDifficulty";

export type SeatIndex = number;
export type MafiaMode = "classic" | "expansion";
export type Team = "citizen" | "mafia";

export type Role =
  | "citizen"
  | "mafia"
  | "police"
  | "doctor"
  | "spy"
  | "soldier"
  | "politician"
  | "medium"
  | "terrorist";

export function teamForRole(role: Role): Team {
  return role === "mafia" || role === "spy" ? "mafia" : "citizen";
}

export interface PlayerState {
  readonly seat: SeatIndex;
  readonly role: Role;
  readonly team: Team;
  readonly alive: boolean;
  /** Soldier's one-time night-attack absorb (§2 확장 직업), consumed on first use. */
  readonly hasUsedArmor: boolean;
  /** Spy has successfully investigated a mafia-aligned seat — from that night onward they also gain `mafiaNightVote` rights (rulebook: "그날 밤부터 마피아 팀에 정식 합류"). */
  readonly spyContactedMafia: boolean;
}

export type Phase =
  | "night"
  | "dayAnnounce"
  | "dayDiscuss"
  | "nomination"
  | "defense"
  | "finalVote"
  | "execution"
  | "terroristRevenge"
  | "gameOver";

export type WinReason = "mafia-eliminated" | "mafia-majority";

export interface NightActionsState {
  readonly mafiaVotes: Readonly<Partial<Record<SeatIndex, SeatIndex>>>;
  readonly doctorTarget?: SeatIndex;
  readonly policeTarget?: SeatIndex;
  readonly policeResult?: { readonly target: SeatIndex; readonly isMafia: boolean };
  readonly spyTarget?: SeatIndex;
  readonly spyResult?: { readonly target: SeatIndex; readonly role: Role };
  readonly mediumTarget?: SeatIndex;
  readonly mediumResult?: { readonly target: SeatIndex; readonly role: Role };
}

/**
 * A single investigation result, kept FOREVER once learned (2026-09-20
 * "정체 영구 각인" 요청) — unlike `NightActionsState`'s transient
 * `policeResult`/`spyResult`/`mediumResult` (wiped every night resolution),
 * this list only ever grows. `isMafia` collapses police/spy/medium's
 * knowledge down to the one binary the persistent badge actually shows;
 * `role` is kept alongside for a spy/medium's exact-role tooltip. Readable
 * only by the investigator who earned it — see `knownRoleFor` below, which
 * is the one place UI should query this (never render `investigationLog`
 * directly for a seat other than the viewer).
 */
export interface InvestigationRecord {
  readonly investigator: SeatIndex;
  readonly target: SeatIndex;
  readonly kind: "police" | "spy" | "medium";
  readonly isMafia: boolean;
  readonly role: Role;
}

export interface NightOutcome {
  readonly night: number;
  readonly mafiaTarget: SeatIndex | null;
  readonly doctorTarget: SeatIndex | null;
  readonly savedByDoctor: boolean;
  readonly savedByArmor: boolean;
  readonly victim: SeatIndex | null;
}

export interface ExecutionOutcome {
  readonly day: number;
  readonly suspect: SeatIndex;
  readonly yes: number;
  readonly no: number;
  readonly executed: boolean;
  readonly blockedByPolitician: boolean;
}

/**
 * Publicly-observable game events (2026-09-20 "직업별 공개 행동 로그" 요청) —
 * unlike `investigationLog`/`deaths[].role`, every entry here is something the
 * existing UI already announces to ALL players via `dayAnnounce`/`execution`/
 * `terroristRevenge` phase text, so accumulating them costs no extra secrecy:
 * it only lets `RoleRosterTable` show a role's history after the moment
 * passes (e.g. `lastNightOutcome`/`lastExecution` only ever hold the LATEST
 * one). Never includes *who* has a role — a `doctorSave` entry proves "the
 * doctor acted" without naming a seat, same trade-off as the live
 * announcement text it mirrors.
 */
export type PublicLogEntry =
  | { readonly type: "mafiaAttack"; readonly night: number; readonly victim: SeatIndex | null; readonly savedByDoctor: boolean; readonly savedByArmor: boolean }
  | { readonly type: "execution"; readonly day: number; readonly suspect: SeatIndex; readonly executed: boolean; readonly blockedByPolitician: boolean }
  | { readonly type: "voteVoid"; readonly day: number }
  | { readonly type: "terroristRevenge"; readonly day: number; readonly terroristSeat: SeatIndex; readonly targetSeat: SeatIndex }
  /**
   * 2026-09-21 요청 — 경찰 조사의 성공/실패(마피아를 찾았는지)만 매일 밤
   * 즉시 전원에게 공개한다(누가 경찰인지, 누구를 조사했는지는 여전히
   * 비공개). 위 다른 항목들과 달리 기존 UI가 이미 공개하던 사실의 재구성이
   * 아니라, 이번 요청으로 새로 뚫린 유일한 의도적 정보 공개 — 스파이/영매
   * 조사는 범위 밖(요청이 "경찰"만 명시), 계속 완전 비공개로 유지.
   */
  | { readonly type: "policeCheck"; readonly night: number; readonly foundMafia: boolean };

export interface DeathRecord {
  readonly seat: SeatIndex;
  readonly role: Role;
  readonly cause: "mafiaKill" | "execution" | "terroristRevenge";
  /** Night number for `mafiaKill`, day number for the other two — informational only. */
  readonly at: number;
}

/**
 * One day-cycle's nomination/verdict shape, kept forever (2026-09-21 "스마트
 * AI" 요청) — appended right before `nominations`/`finalVotes` reset for the
 * next round. This is the ONLY place the engine retains WHO nominated/voted
 * for WHOM across rounds (`state.nominations`/`state.finalVotes` themselves
 * are wiped every round) — `computeSuspicion` below is the sole consumer.
 * Recorded even when nomination ties out with no execution (`suspect: null`)
 * since the nomination pattern alone is still a useful public signal.
 */
export interface RoundRecord {
  readonly day: number;
  readonly nominations: Readonly<Partial<Record<SeatIndex, SeatIndex>>>;
  readonly finalVotes: Readonly<Partial<Record<SeatIndex, "yes" | "no">>>;
  readonly suspect: SeatIndex | null;
  readonly executedSeat: SeatIndex | null;
  readonly executedRole: Role | null;
}

export interface MafiaGameConfig {
  readonly mode: MafiaMode;
  readonly discussionSeconds: 30 | 60 | 90;
  readonly revealRoleOnDeath: boolean;
  /** Applies ONLY to the doctor's first real action night (nightNumber === 1) — every later night forbids self-heal regardless of this toggle (2026-09-20 clarification). */
  readonly doctorSelfHeal: boolean;
}

export const DEFAULT_MAFIA_CONFIG: MafiaGameConfig = {
  mode: "classic",
  discussionSeconds: 60,
  revealRoleOnDeath: true,
  doctorSelfHeal: false,
};

export interface MafiaState {
  readonly playerCount: number;
  readonly config: MafiaGameConfig;
  readonly players: readonly PlayerState[];
  readonly phase: Phase;
  readonly phaseStartedAt: number;
  readonly phaseDurationMs: number;
  readonly dayNumber: number;
  /** 0 = orientation night (Phase 0 — rulebook: 살해/조사/치료 생략), 1+ = a real action night. */
  readonly nightNumber: number;
  readonly nightActions: NightActionsState;
  readonly lastNightOutcome: NightOutcome | null;
  readonly deaths: readonly DeathRecord[];
  readonly investigationLog: readonly InvestigationRecord[];
  readonly publicLog: readonly PublicLogEntry[];
  readonly roundHistory: readonly RoundRecord[];
  /**
   * "시간초 과반수 스킵" (2026-09-20 요청) — only meaningful while
   * `phase` is `"night"` or `"dayDiscuss"`, reset to `{}` every time either
   * phase is (re-)entered (see every `advancePhase` call site that lands on
   * one of those two phases). A seat toggles its own vote on/off;
   * crossing `> floor(aliveCount/2)` resolves the phase immediately via the
   * same path `forceAdvance` uses on a real timeout.
   */
  readonly skipVotes: Readonly<Partial<Record<SeatIndex, boolean>>>;
  readonly nominations: Readonly<Partial<Record<SeatIndex, SeatIndex>>>;
  readonly suspect: SeatIndex | null;
  readonly nominationVoidReason: "tie" | null;
  readonly finalVotes: Readonly<Partial<Record<SeatIndex, "yes" | "no">>>;
  readonly lastExecution: ExecutionOutcome | null;
  readonly pendingTerroristRevenge: { readonly terroristSeat: SeatIndex; readonly eligibleNominators: readonly SeatIndex[] } | null;
  readonly winner: Team | null;
  readonly winReason: WinReason | null;
}

export type EngineAction =
  | { type: "mafiaNightVote"; seat: SeatIndex; target: SeatIndex }
  | { type: "doctorNightAction"; seat: SeatIndex; target: SeatIndex }
  | { type: "policeNightAction"; seat: SeatIndex; target: SeatIndex }
  | { type: "spyNightAction"; seat: SeatIndex; target: SeatIndex }
  | { type: "mediumNightAction"; seat: SeatIndex; target: SeatIndex }
  | { type: "nominate"; seat: SeatIndex; target: SeatIndex; atMs: number }
  | { type: "finalVote"; seat: SeatIndex; vote: "yes" | "no"; atMs: number }
  | { type: "terroristRevenge"; seat: SeatIndex; target: SeatIndex; atMs: number }
  | { type: "toggleSkipVote"; seat: SeatIndex; atMs: number }
  | { type: "forceAdvance"; expectedPhase: Phase; atMs: number };

// ---------------------------------------------------------------------------
// Setup — role pools & player-count ranges per mode
// ---------------------------------------------------------------------------

export const MIN_PLAYERS_CLASSIC = 4;
export const MAX_PLAYERS_CLASSIC = 8;
export const MIN_PLAYERS_EXPANSION = 6;
export const MAX_PLAYERS_EXPANSION = 12;
export const MIN_PLAYERS = MIN_PLAYERS_CLASSIC;
export const MAX_PLAYERS = MAX_PLAYERS_EXPANSION;

export function playerRangeForMode(mode: MafiaMode): { min: number; max: number } {
  return mode === "classic"
    ? { min: MIN_PLAYERS_CLASSIC, max: MAX_PLAYERS_CLASSIC }
    : { min: MIN_PLAYERS_EXPANSION, max: MAX_PLAYERS_EXPANSION };
}

/** 6~7인: 마피아1, 경찰1, 의사1, 나머지 시민 / 7인 이상: 마피아 2. */
function classicRolePool(n: number): Role[] {
  const mafiaCount = n >= 7 ? 2 : 1;
  const fixed: Role[] = [...Array(mafiaCount).fill("mafia"), "police", "doctor"];
  const citizens = Math.max(0, n - fixed.length);
  return [...fixed, ...Array(citizens).fill("citizen")];
}

/**
 * 6인 최소 구성(마피아/경찰/의사/스파이/군인) 기준, 7인+ 정치인, 8인+ 마피아
 * 2번째+테러리스트, 9인+ 영매 순으로 추가 — 2026-09-20 확인된 배분 기준.
 */
function expansionRolePool(n: number): Role[] {
  const pool: Role[] = ["mafia", "police", "doctor", "spy", "soldier"];
  if (n >= 7) pool.push("politician");
  if (n >= 8) pool.push("mafia");
  if (n >= 8) pool.push("terrorist");
  if (n >= 9) pool.push("medium");
  while (pool.length < n) pool.push("citizen");
  return pool;
}

export function rolePoolFor(mode: MafiaMode, playerCount: number): Role[] {
  return mode === "classic" ? classicRolePool(playerCount) : expansionRolePool(playerCount);
}

const NIGHT0_DURATION_MS = 6_000;
const NIGHT_DURATION_MS = 25_000;
const DAY_ANNOUNCE_DURATION_MS = 6_000;
const NOMINATION_DURATION_MS = 15_000;
const DEFENSE_DURATION_MS = 20_000;
const FINAL_VOTE_DURATION_MS = 10_000;
const EXECUTION_DURATION_MS = 4_000;
const TERRORIST_REVENGE_DURATION_MS = 15_000;

function durationForPhase(phase: Phase, state: Pick<MafiaState, "config" | "nightNumber">): number {
  switch (phase) {
    case "night":
      return state.nightNumber === 0 ? NIGHT0_DURATION_MS : NIGHT_DURATION_MS;
    case "dayAnnounce":
      return DAY_ANNOUNCE_DURATION_MS;
    case "dayDiscuss":
      return state.config.discussionSeconds * 1000;
    case "nomination":
      return NOMINATION_DURATION_MS;
    case "defense":
      return DEFENSE_DURATION_MS;
    case "finalVote":
      return FINAL_VOTE_DURATION_MS;
    case "execution":
      return EXECUTION_DURATION_MS;
    case "terroristRevenge":
      return TERRORIST_REVENGE_DURATION_MS;
    default:
      return 0;
  }
}

export function startGame(playerCount: number, seed: number, config: MafiaGameConfig, atMs: number): MafiaState {
  const rng = seededRng(seed);
  const roles = shuffle(rolePoolFor(config.mode, playerCount), rng);
  const players: PlayerState[] = roles.map((role, seat) => ({
    seat,
    role,
    team: teamForRole(role),
    alive: true,
    hasUsedArmor: false,
    spyContactedMafia: false,
  }));

  const state: MafiaState = {
    playerCount,
    config,
    players,
    phase: "night",
    phaseStartedAt: atMs,
    phaseDurationMs: durationForPhase("night", { config, nightNumber: 0 }),
    dayNumber: 0,
    nightNumber: 0,
    nightActions: { mafiaVotes: {} },
    lastNightOutcome: null,
    deaths: [],
    investigationLog: [],
    publicLog: [],
    roundHistory: [],
    skipVotes: {},
    nominations: {},
    suspect: null,
    nominationVoidReason: null,
    finalVotes: {},
    lastExecution: null,
    pendingTerroristRevenge: null,
    winner: null,
    winReason: null,
  };
  return state;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isValidLivingTarget(state: MafiaState, target: SeatIndex): boolean {
  return target >= 0 && target < state.playerCount && state.players[target].alive;
}

function isMafiaAligned(p: PlayerState): boolean {
  return p.team === "mafia";
}

function canVoteMafiaKill(p: PlayerState): boolean {
  return p.alive && (p.role === "mafia" || (p.role === "spy" && p.spyContactedMafia));
}

/** Politician: "투표권 2표 행사" — applies to both nomination and final-vote tallies. */
function voteWeight(state: MafiaState, seat: SeatIndex): number {
  return state.players[seat].role === "politician" ? 2 : 1;
}

function checkWinCondition(state: MafiaState): MafiaState {
  if (state.winner) return state;
  const aliveMafia = state.players.filter((p) => p.alive && p.team === "mafia").length;
  const aliveCitizen = state.players.filter((p) => p.alive && p.team === "citizen").length;
  if (aliveMafia === 0) return { ...state, winner: "citizen", winReason: "mafia-eliminated" };
  if (aliveMafia >= aliveCitizen) return { ...state, winner: "mafia", winReason: "mafia-majority" };
  return state;
}

function advancePhase(state: MafiaState, phase: Phase, atMs: number): MafiaState {
  const merged: MafiaState = { ...state, phase, phaseStartedAt: atMs };
  return { ...merged, phaseDurationMs: durationForPhase(phase, merged) };
}

// ---------------------------------------------------------------------------
// Night actions (submitted independently, resolved all at once on timeout)
// ---------------------------------------------------------------------------

function submitMafiaVote(state: MafiaState, seat: SeatIndex, target: SeatIndex): MafiaState {
  if (state.phase !== "night" || state.nightNumber === 0) return state;
  const player = state.players[seat];
  if (!player || !canVoteMafiaKill(player)) return state;
  if (!isValidLivingTarget(state, target) || isMafiaAligned(state.players[target])) return state;
  return { ...state, nightActions: { ...state.nightActions, mafiaVotes: { ...state.nightActions.mafiaVotes, [seat]: target } } };
}

function submitDoctorAction(state: MafiaState, seat: SeatIndex, target: SeatIndex): MafiaState {
  if (state.phase !== "night" || state.nightNumber === 0) return state;
  const player = state.players[seat];
  if (!player || player.role !== "doctor" || !player.alive) return state;
  if (!isValidLivingTarget(state, target)) return state;
  if (target === seat && !(state.nightNumber === 1 && state.config.doctorSelfHeal)) return state;
  return { ...state, nightActions: { ...state.nightActions, doctorTarget: target } };
}

function submitPoliceAction(state: MafiaState, seat: SeatIndex, target: SeatIndex): MafiaState {
  if (state.phase !== "night" || state.nightNumber === 0) return state;
  const player = state.players[seat];
  if (!player || player.role !== "police" || !player.alive) return state;
  if (state.nightActions.policeTarget !== undefined) return state;
  if (!isValidLivingTarget(state, target) || target === seat) return state;
  const isMafia = state.players[target].team === "mafia";
  const record: InvestigationRecord = { investigator: seat, target, kind: "police", isMafia, role: state.players[target].role };
  return {
    ...state,
    nightActions: { ...state.nightActions, policeTarget: target, policeResult: { target, isMafia } },
    investigationLog: [...state.investigationLog, record],
    publicLog: [...state.publicLog, { type: "policeCheck", night: state.nightNumber, foundMafia: isMafia }],
  };
}

function submitSpyAction(state: MafiaState, seat: SeatIndex, target: SeatIndex): MafiaState {
  if (state.phase !== "night" || state.nightNumber === 0) return state;
  const player = state.players[seat];
  if (!player || player.role !== "spy" || !player.alive) return state;
  if (state.nightActions.spyTarget !== undefined) return state;
  if (!isValidLivingTarget(state, target) || target === seat) return state;
  const discoveredRole = state.players[target].role;
  const contacted = state.players[target].team === "mafia";
  const players = contacted
    ? state.players.map((p) => (p.seat === seat ? { ...p, spyContactedMafia: true } : p))
    : state.players;
  const record: InvestigationRecord = { investigator: seat, target, kind: "spy", isMafia: contacted, role: discoveredRole };
  return {
    ...state,
    players,
    nightActions: { ...state.nightActions, spyTarget: target, spyResult: { target, role: discoveredRole } },
    investigationLog: [...state.investigationLog, record],
  };
}

function submitMediumAction(state: MafiaState, seat: SeatIndex, target: SeatIndex): MafiaState {
  if (state.phase !== "night" || state.nightNumber === 0) return state;
  const player = state.players[seat];
  if (!player || player.role !== "medium" || !player.alive) return state;
  if (state.nightActions.mediumTarget !== undefined) return state;
  if (target < 0 || target >= state.playerCount || state.players[target].alive) return state;
  const role = state.players[target].role;
  const record: InvestigationRecord = { investigator: seat, target, kind: "medium", isMafia: state.players[target].team === "mafia", role };
  return {
    ...state,
    nightActions: { ...state.nightActions, mediumTarget: target, mediumResult: { target, role } },
    investigationLog: [...state.investigationLog, record],
  };
}

/** The one place UI should query persistent investigation knowledge — never render `state.investigationLog` directly for a seat other than the viewer (see `InvestigationRecord`'s doc). */
export function knownRoleFor(state: MafiaState, viewerSeat: SeatIndex, targetSeat: SeatIndex): { isMafia: boolean; role: Role } | null {
  const record = state.investigationLog.find((r) => r.investigator === viewerSeat && r.target === targetSeat);
  return record ? { isMafia: record.isMafia, role: record.role } : null;
}

function resolveNight(state: MafiaState, atMs: number): MafiaState {
  const night = state.nightNumber;
  if (night === 0) {
    const next = checkWinCondition({ ...state, lastNightOutcome: { night, mafiaTarget: null, doctorTarget: null, savedByDoctor: false, savedByArmor: false, victim: null }, dayNumber: state.dayNumber + 1 });
    return advancePhase(next, "dayAnnounce", atMs);
  }

  const tally = new Map<SeatIndex, number>();
  for (const target of Object.values(state.nightActions.mafiaVotes)) {
    if (target === undefined) continue;
    tally.set(target, (tally.get(target) ?? 0) + 1);
  }
  let mafiaTarget: SeatIndex | null = null;
  let bestCount = -1;
  for (const [seat, count] of [...tally.entries()].sort((a, b) => a[0] - b[0])) {
    if (count > bestCount) {
      bestCount = count;
      mafiaTarget = seat;
    }
  }

  const doctorTarget = state.nightActions.doctorTarget ?? null;
  let savedByDoctor = false;
  let savedByArmor = false;
  let victim: SeatIndex | null = null;
  let players = state.players;
  const deaths: DeathRecord[] = [];

  if (mafiaTarget !== null) {
    if (doctorTarget === mafiaTarget) {
      savedByDoctor = true;
    } else {
      const targetPlayer = state.players[mafiaTarget];
      if (targetPlayer.role === "soldier" && !targetPlayer.hasUsedArmor) {
        savedByArmor = true;
        players = players.map((p) => (p.seat === mafiaTarget ? { ...p, hasUsedArmor: true } : p));
      } else {
        victim = mafiaTarget;
        players = players.map((p) => (p.seat === mafiaTarget ? { ...p, alive: false } : p));
        deaths.push({ seat: mafiaTarget, role: targetPlayer.role, cause: "mafiaKill", at: night });
      }
    }
  }

  const outcome: NightOutcome = { night, mafiaTarget, doctorTarget, savedByDoctor, savedByArmor, victim };
  let next: MafiaState = {
    ...state,
    players,
    deaths: [...state.deaths, ...deaths],
    lastNightOutcome: outcome,
    publicLog: mafiaTarget === null ? state.publicLog : [...state.publicLog, { type: "mafiaAttack", night, victim, savedByDoctor, savedByArmor }],
    nightActions: { mafiaVotes: {} },
    dayNumber: state.dayNumber + 1,
  };
  next = checkWinCondition(next);
  if (next.winner) return advancePhase(next, "gameOver", atMs);
  return advancePhase(next, "dayAnnounce", atMs);
}

// ---------------------------------------------------------------------------
// Day: nomination (지목투표) → defense (최후변론) → finalVote (찬반투표) → execution
// ---------------------------------------------------------------------------

function nominate(state: MafiaState, action: Extract<EngineAction, { type: "nominate" }>): MafiaState {
  if (state.phase !== "nomination") return state;
  const player = state.players[action.seat];
  if (!player || !player.alive) return state;
  if (state.nominations[action.seat] !== undefined) return state;
  if (action.target === action.seat || !isValidLivingTarget(state, action.target)) return state;
  const nominations = { ...state.nominations, [action.seat]: action.target };
  const next = { ...state, nominations };
  const alive = state.players.filter((p) => p.alive).map((p) => p.seat);
  if (!alive.every((s) => nominations[s] !== undefined)) return next;
  return resolveNomination(next, action.atMs);
}

/** 동률 시 처리(2026-09-20 확인): 투표 무효 처리 후 처형 없이 바로 밤으로. */
function resolveNomination(state: MafiaState, atMs: number): MafiaState {
  const tally = new Map<SeatIndex, number>();
  for (const [nominatorStr, target] of Object.entries(state.nominations)) {
    if (target === undefined) continue;
    const weight = voteWeight(state, Number(nominatorStr));
    tally.set(target, (tally.get(target) ?? 0) + weight);
  }
  let best = -1;
  let winners: SeatIndex[] = [];
  for (const [seat, count] of tally) {
    if (count > best) {
      best = count;
      winners = [seat];
    } else if (count === best) {
      winners.push(seat);
    }
  }
  if (winners.length !== 1) {
    const record: RoundRecord = { day: state.dayNumber, nominations: state.nominations, finalVotes: {}, suspect: null, executedSeat: null, executedRole: null };
    return advancePhase(
      {
        ...state,
        suspect: null,
        nominationVoidReason: "tie",
        lastExecution: null,
        publicLog: [...state.publicLog, { type: "voteVoid", day: state.dayNumber }],
        roundHistory: [...state.roundHistory, record],
      },
      "execution",
      atMs,
    );
  }
  return advancePhase({ ...state, suspect: winners[0], nominationVoidReason: null, finalVotes: {} }, "defense", atMs);
}

function castFinalVote(state: MafiaState, action: Extract<EngineAction, { type: "finalVote" }>): MafiaState {
  if (state.phase !== "finalVote") return state;
  const player = state.players[action.seat];
  if (!player || !player.alive || action.seat === state.suspect) return state;
  if (state.finalVotes[action.seat] !== undefined) return state;
  const finalVotes = { ...state.finalVotes, [action.seat]: action.vote };
  const next = { ...state, finalVotes };
  const voters = state.players.filter((p) => p.alive && p.seat !== state.suspect).map((p) => p.seat);
  if (!voters.every((s) => finalVotes[s] !== undefined)) return next;
  return resolveFinalVote(next, action.atMs);
}

/** 정치인: 찬반 투표로 처형되지 않음(면제) — 표는 그대로 집계되지만 결과에 반영되지 않음. */
function resolveFinalVote(state: MafiaState, atMs: number): MafiaState {
  const suspect = state.suspect!;
  let yes = 0;
  let no = 0;
  for (const [voterStr, vote] of Object.entries(state.finalVotes)) {
    const weight = voteWeight(state, Number(voterStr));
    if (vote === "yes") yes += weight;
    else no += weight;
  }
  const suspectPlayer = state.players[suspect];
  const blockedByPolitician = suspectPlayer.role === "politician";
  const executed = yes > no && !blockedByPolitician;
  const outcome: ExecutionOutcome = { day: state.dayNumber, suspect, yes, no, executed, blockedByPolitician };
  const publicLog: readonly PublicLogEntry[] = [...state.publicLog, { type: "execution", day: state.dayNumber, suspect, executed, blockedByPolitician }];

  if (!executed) {
    const record: RoundRecord = { day: state.dayNumber, nominations: state.nominations, finalVotes: state.finalVotes, suspect, executedSeat: null, executedRole: null };
    return advancePhase({ ...state, lastExecution: outcome, publicLog, roundHistory: [...state.roundHistory, record] }, "execution", atMs);
  }

  const record: RoundRecord = { day: state.dayNumber, nominations: state.nominations, finalVotes: state.finalVotes, suspect, executedSeat: suspect, executedRole: suspectPlayer.role };
  const players = state.players.map((p) => (p.seat === suspect ? { ...p, alive: false } : p));
  const deaths = [...state.deaths, { seat: suspect, role: suspectPlayer.role, cause: "execution" as const, at: state.dayNumber }];
  let next: MafiaState = { ...state, players, deaths, lastExecution: outcome, publicLog, roundHistory: [...state.roundHistory, record] };
  next = checkWinCondition(next);
  if (next.winner) return advancePhase(next, "gameOver", atMs);

  if (suspectPlayer.role === "terrorist") {
    const eligibleNominators = Object.entries(state.nominations)
      .filter(([, target]) => target === suspect)
      .map(([nominator]) => Number(nominator))
      .filter((seat) => next.players[seat].alive);
    if (eligibleNominators.length > 0) {
      return advancePhase({ ...next, pendingTerroristRevenge: { terroristSeat: suspect, eligibleNominators } }, "terroristRevenge", atMs);
    }
  }

  return advancePhase(next, "execution", atMs);
}

function terroristRevenge(state: MafiaState, action: Extract<EngineAction, { type: "terroristRevenge" }>): MafiaState {
  if (state.phase !== "terroristRevenge" || !state.pendingTerroristRevenge) return state;
  if (action.seat !== state.pendingTerroristRevenge.terroristSeat) return state;
  if (!state.pendingTerroristRevenge.eligibleNominators.includes(action.target)) return state;
  return resolveTerroristRevenge(state, action.target, action.atMs);
}

function resolveTerroristRevenge(state: MafiaState, target: SeatIndex, atMs: number): MafiaState {
  const targetPlayer = state.players[target];
  const terroristSeat = state.pendingTerroristRevenge!.terroristSeat;
  const players = state.players.map((p) => (p.seat === target ? { ...p, alive: false } : p));
  const deaths = [...state.deaths, { seat: target, role: targetPlayer.role, cause: "terroristRevenge" as const, at: state.dayNumber }];
  const publicLog: readonly PublicLogEntry[] = [...state.publicLog, { type: "terroristRevenge", day: state.dayNumber, terroristSeat, targetSeat: target }];
  let next: MafiaState = { ...state, players, deaths, publicLog, pendingTerroristRevenge: null };
  next = checkWinCondition(next);
  if (next.winner) return advancePhase(next, "gameOver", atMs);
  return advancePhase({ ...next, skipVotes: {} }, "night", atMs);
}

// ---------------------------------------------------------------------------
// Autonomous phase guardian — see module doc. Any client may fire this once
// its local clock says `phaseDurationMs` has elapsed; stale calls (the phase
// already moved on) are a no-op via the `expectedPhase` check. `toggleSkipVote`
// below reaches the exact same transition logic the instant a majority
// forms, instead of waiting for the timeout.
// ---------------------------------------------------------------------------

function resolveCurrentPhase(state: MafiaState, atMs: number): MafiaState {
  switch (state.phase) {
    case "night":
      return resolveNight(state, atMs);
    case "dayAnnounce":
      return advancePhase({ ...state, skipVotes: {} }, "dayDiscuss", atMs);
    case "dayDiscuss":
      return advancePhase({ ...state, nominations: {} }, "nomination", atMs);
    case "nomination":
      return resolveNomination(state, atMs);
    case "defense":
      return advancePhase(state, "finalVote", atMs);
    case "finalVote":
      return resolveFinalVote(state, atMs);
    case "execution":
      return advancePhase({ ...state, nightNumber: state.nightNumber + 1, skipVotes: {} }, "night", atMs);
    case "terroristRevenge": {
      const pending = state.pendingTerroristRevenge;
      if (!pending) return advancePhase({ ...state, nightNumber: state.nightNumber + 1, skipVotes: {} }, "night", atMs);
      const fallback = Math.min(...pending.eligibleNominators);
      return resolveTerroristRevenge(state, fallback, atMs);
    }
    default:
      return state;
  }
}

function forceAdvance(state: MafiaState, action: Extract<EngineAction, { type: "forceAdvance" }>): MafiaState {
  if (state.phase !== action.expectedPhase) return state;
  return resolveCurrentPhase(state, action.atMs);
}

/**
 * "시간초 과반수 스킵" (2026-09-20 요청): only meaningful during `night`/
 * `dayDiscuss` (the two phases with a pure discussion/wait timer and no
 * per-seat decision the vote could interrupt). Toggling off never triggers
 * anything; crossing `> floor(aliveCount/2)` on a toggle-on resolves the
 * phase immediately via the exact same `resolveCurrentPhase` a real timeout
 * uses. Ghosts can't vote (not in `alive`), matching "생존 중인 플레이어가"
 * in the spec.
 */
function toggleSkipVote(state: MafiaState, action: Extract<EngineAction, { type: "toggleSkipVote" }>): MafiaState {
  if (state.phase !== "night" && state.phase !== "dayDiscuss") return state;
  const player = state.players[action.seat];
  if (!player || !player.alive) return state;
  const wasOn = state.skipVotes[action.seat] ?? false;
  const skipVotes = { ...state.skipVotes, [action.seat]: !wasOn };
  const next = { ...state, skipVotes };
  if (wasOn) return next; // turning a vote OFF never triggers a skip
  const aliveCount = state.players.filter((p) => p.alive).length;
  const yesCount = Object.values(skipVotes).filter(Boolean).length;
  if (yesCount > Math.floor(aliveCount / 2)) return resolveCurrentPhase(next, action.atMs);
  return next;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function applyAction(state: MafiaState, action: EngineAction): MafiaState {
  switch (action.type) {
    case "mafiaNightVote":
      return submitMafiaVote(state, action.seat, action.target);
    case "doctorNightAction":
      return submitDoctorAction(state, action.seat, action.target);
    case "policeNightAction":
      return submitPoliceAction(state, action.seat, action.target);
    case "spyNightAction":
      return submitSpyAction(state, action.seat, action.target);
    case "mediumNightAction":
      return submitMediumAction(state, action.seat, action.target);
    case "nominate":
      return nominate(state, action);
    case "finalVote":
      return castFinalVote(state, action);
    case "terroristRevenge":
      return terroristRevenge(state, action);
    case "toggleSkipVote":
      return toggleSkipVote(state, action);
    case "forceAdvance":
      return forceAdvance(state, action);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Knowledge — what each seat privately knows (mafia teammates only; every
// other role's "knowledge" is just its own night-action results, already
// stored directly on `nightActions` for the acting seat to read back).
// ---------------------------------------------------------------------------

export interface Knowledge {
  role: Role;
  team: Team;
  mafiaTeammates: SeatIndex[];
}

export function getKnowledge(state: MafiaState, seat: SeatIndex): Knowledge {
  const me = state.players[seat];
  const mafiaTeammates: SeatIndex[] = [];
  if (me.role === "mafia" || (me.role === "spy" && me.spyContactedMafia)) {
    for (const p of state.players) {
      if (p.seat !== seat && (p.role === "mafia" || (p.role === "spy" && p.spyContactedMafia))) mafiaTeammates.push(p.seat);
    }
  }
  return { role: me.role, team: me.team, mafiaTeammates };
}

// ---------------------------------------------------------------------------
// currentActor — "lowest still-undecided seat" convention shared by every
// simultaneous-decision phase in this project (see dalmuti/DalmutiGame.tsx's
// taxReturn/commonerExchange note). Night can have several DIFFERENT seats
// each with a pending decision; `useBotAutoplay` cycles through them one at a
// time as each dispatched action changes `state`'s identity and re-triggers
// the effect.
// ---------------------------------------------------------------------------

function seatHasPendingNightAction(state: MafiaState, seat: SeatIndex): boolean {
  const p = state.players[seat];
  if (!p.alive) return false;
  const na = state.nightActions;
  switch (p.role) {
    case "mafia":
      return na.mafiaVotes[seat] === undefined;
    case "doctor":
      return na.doctorTarget === undefined;
    case "police":
      return na.policeTarget === undefined;
    case "medium":
      return na.mediumTarget === undefined && state.players.some((q) => !q.alive);
    case "spy": {
      const investigatePending = na.spyTarget === undefined;
      const votePending = p.spyContactedMafia && na.mafiaVotes[seat] === undefined;
      return investigatePending || votePending;
    }
    default:
      return false;
  }
}

export function currentActor(state: MafiaState): SeatIndex | null {
  switch (state.phase) {
    case "night": {
      if (state.nightNumber === 0) return null;
      for (const p of state.players) if (seatHasPendingNightAction(state, p.seat)) return p.seat;
      return null;
    }
    case "nomination": {
      for (const p of state.players) if (p.alive && state.nominations[p.seat] === undefined) return p.seat;
      return null;
    }
    case "finalVote": {
      for (const p of state.players) {
        if (p.alive && p.seat !== state.suspect && state.finalVotes[p.seat] === undefined) return p.seat;
      }
      return null;
    }
    case "terroristRevenge":
      return state.pendingTerroristRevenge?.terroristSeat ?? null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — 2026-09-21 "스마트 AI" 요청으로
// 순수 랜덤 휴리스틱을 대체. 여전히 `_level`(BotLevel)과 무관하게 전부 같은
// 지능으로 행동한다(요청이 난이도 티어링을 요구하지 않음, Lv.1~10 선택 UI는
// 여전히 표시만 되고 실제 행동엔 영향 없음 — 기존 한계 유지, 이번 범위 밖).
// `chooseBotAction`은 UI/bot-loop 코드로 리듀서가 아니라서 `atMs`를
// `Date.now()`로 직접 채워도 안전(hillOfTruth의 동일 관례).
//
// 제외한 것: (1) "경찰 사칭 등 거짓 주장이 탄로났을 때 +60" — 자유 텍스트
// 채팅에서 "나는 경찰이다" 같은 주장을 구조적으로 파싱해야 하는데 이
// 엔진/채팅 시스템엔 그런 클레임 추적 인프라가 전혀 없어 범위 밖으로 명시.
// (2) 마피아가 "의사의 자힐/보호 확률을 역산"하는 상대 모델링 — 의사의
// 보호 대상은 마피아에게 완전히 비공개라 원칙적으로 추정할 신호가 없음.
// ---------------------------------------------------------------------------

function pickRandom<T>(candidates: readonly T[], rng: () => number): T | null {
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

/** 동점자는 `rng`로 무작위 선택 — 완전히 결정론적이면 매 게임 봇이 똑같은 순서로만 행동해 예측 가능해지는 것을 방지. */
function pickTopBy<T>(candidates: readonly T[], scoreFn: (item: T) => number, rng: () => number): T | null {
  if (candidates.length === 0) return null;
  let best = -Infinity;
  for (const c of candidates) best = Math.max(best, scoreFn(c));
  const top = candidates.filter((c) => scoreFn(c) === best);
  return pickRandom(top, rng);
}

/**
 * 공개 의심도 매트릭스(0~100, 기본 50) — 2026-09-21 "스마트 AI" 요청.
 * `state.roundHistory`(각 라운드가 끝나기 직전에 append됨, `resolveNomination`/
 * `resolveFinalVote` 참고)만으로 매번 새로 계산되는 순수 함수 — 봇 인스턴스가
 * 별도 메모리를 들고 있지 않는 이 엔진의 방식과 일치. 어떤 봇이 호출하든
 * 완전히 동일한 "공개적으로 관찰 가능한" 값이며(비공개 조사 지식은 절대
 * 섞이지 않음), 개인 지식(`knownRoleFor`)은 호출부가 별도로 얹는다.
 */
export function computeSuspicion(state: MafiaState): ReadonlyMap<SeatIndex, number> {
  const score = new Map<SeatIndex, number>();
  for (const p of state.players) score.set(p.seat, 50);
  const bump = (seat: SeatIndex, delta: number) => score.set(seat, (score.get(seat) ?? 50) + delta);

  for (const round of state.roundHistory) {
    if (round.suspect !== null) {
      for (const [nominatorStr, target] of Object.entries(round.nominations)) {
        if (target === round.suspect) bump(Number(nominatorStr), 8); // 여론 편승(밴드왜건) 투표 반복
      }
    }
    const executedTeam = round.executedRole !== null ? teamForRole(round.executedRole) : null;
    for (const [voterStr, vote] of Object.entries(round.finalVotes)) {
      if (vote !== "yes") continue;
      const voter = Number(voterStr);
      if (executedTeam === "mafia") bump(voter, -30); // 마피아를 처형시키는 결정적 표
      else if (executedTeam === "citizen") bump(voter, 25); // 결백한 시민을 몰아간 표
    }
  }

  for (const p of state.players) score.set(p.seat, Math.max(0, Math.min(100, score.get(p.seat) ?? 50)));
  return score;
}

/** 공개 의심도에 뷰어 본인의 비공개 조사 지식(있다면)을 덮어씌운 실질 점수 — 확정 정보가 있으면 항상 그게 우선. */
function effectiveSuspicion(state: MafiaState, viewerSeat: SeatIndex, targetSeat: SeatIndex, publicScore: ReadonlyMap<SeatIndex, number>): number {
  const known = knownRoleFor(state, viewerSeat, targetSeat);
  if (known !== null) return known.isMafia ? 100 : 0;
  return publicScore.get(targetSeat) ?? 50;
}

/** 마피아 팀(자신+접선된 스파이) 중 누군가 이미 저 좌석을 조사해 경찰로 확인했는지 — 확인됐다면 최우선 저격 대상. */
function teamKnowsPolice(state: MafiaState, teamSeats: readonly SeatIndex[], targetSeat: SeatIndex): boolean {
  return state.investigationLog.some((r) => teamSeats.includes(r.investigator) && r.target === targetSeat && r.role === "police");
}

/** 과거 라운드에서 이 마피아 팀의 용의자 지명에 앞장선("찬성" 표를 던지거나 그 용의자를 지목한) 좌석일수록 위협도가 높다 — "낮에 우리를 강하게 추리한 위험 인물" 근사치. */
function mafiaThreatScore(state: MafiaState, teamSeats: readonly SeatIndex[], candidateSeat: SeatIndex): number {
  let score = 0;
  for (const round of state.roundHistory) {
    if (round.suspect === null || !teamSeats.includes(round.suspect)) continue;
    if (round.finalVotes[candidateSeat] === "yes") score += 40;
    if (round.nominations[candidateSeat] === round.suspect) score += 20;
  }
  return score;
}

export function chooseBotAction(
  state: MafiaState,
  seat: SeatIndex,
  _level: BotLevel,
  rng: () => number = Math.random,
): EngineAction | null {
  const atMs = Date.now();
  const player = state.players[seat];
  if (!player) return null;
  const aliveOthers = state.players.filter((p) => p.alive && p.seat !== seat);
  const knowledge = getKnowledge(state, seat);
  const actsAsMafia = player.role === "mafia" || (player.role === "spy" && player.spyContactedMafia);

  if (state.phase === "night") {
    const na = state.nightActions;

    if (actsAsMafia && na.mafiaVotes[seat] === undefined) {
      const candidates = aliveOthers.filter((p) => !knowledge.mafiaTeammates.includes(p.seat)).map((p) => p.seat);
      const alreadyChosen = Object.values(na.mafiaVotes).find((t): t is SeatIndex => t !== undefined && candidates.includes(t));
      if (alreadyChosen !== undefined) return { type: "mafiaNightVote", seat, target: alreadyChosen };
      const teamSeats = [seat, ...knowledge.mafiaTeammates];
      const suspicion = computeSuspicion(state);
      const target = pickTopBy(
        candidates,
        (c) => (teamKnowsPolice(state, teamSeats, c) ? 1000 : mafiaThreatScore(state, teamSeats, c) + (suspicion.get(c) ?? 50) * 0.2),
        rng,
      );
      return target === null ? null : { type: "mafiaNightVote", seat, target };
    }
    if (player.role === "spy" && na.spyTarget === undefined) {
      const investigated = new Set(state.investigationLog.filter((r) => r.investigator === seat).map((r) => r.target));
      const fresh = aliveOthers.filter((p) => !investigated.has(p.seat)).map((p) => p.seat);
      const pool = fresh.length > 0 ? fresh : aliveOthers.map((p) => p.seat);
      const suspicion = computeSuspicion(state);
      const target = pickTopBy(pool, (c) => suspicion.get(c) ?? 50, rng);
      return target === null ? null : { type: "spyNightAction", seat, target };
    }
    if (player.role === "doctor" && na.doctorTarget === undefined) {
      const canSelf = state.nightNumber === 1 && state.config.doctorSelfHeal;
      if (canSelf && rng() < 0.25) return { type: "doctorNightAction", seat, target: seat };
      const candidates = state.players.filter((p) => p.alive && p.seat !== seat).map((p) => p.seat);
      const suspicion = computeSuspicion(state);
      // 가장 신뢰받는(의심도 낮은) 생존자를 수호 — "핵심 인물/유력 추리자" 대리 지표(의사는 누가 경찰인지 알 방법이 없음).
      const target = pickTopBy(candidates, (c) => -(suspicion.get(c) ?? 50), rng);
      return target === null ? null : { type: "doctorNightAction", seat, target: target ?? seat };
    }
    if (player.role === "police" && na.policeTarget === undefined) {
      const investigated = new Set(state.investigationLog.filter((r) => r.investigator === seat).map((r) => r.target));
      const fresh = aliveOthers.filter((p) => !investigated.has(p.seat)).map((p) => p.seat);
      const pool = fresh.length > 0 ? fresh : aliveOthers.map((p) => p.seat); // 전원 조사 완료 시에만 부득이 재조사 허용
      const suspicion = computeSuspicion(state);
      const target = pickTopBy(pool, (c) => suspicion.get(c) ?? 50, rng);
      return target === null ? null : { type: "policeNightAction", seat, target };
    }
    if (player.role === "medium" && na.mediumTarget === undefined) {
      const investigated = new Set(state.investigationLog.filter((r) => r.investigator === seat).map((r) => r.target));
      const dead = state.players.filter((p) => !p.alive).map((p) => p.seat);
      const fresh = dead.filter((s) => !investigated.has(s));
      const target = pickRandom(fresh.length > 0 ? fresh : dead, rng); // 사망자 사이엔 공개 의심도가 의미 없어 무작위 유지
      return target === null ? null : { type: "mediumNightAction", seat, target };
    }
    return null;
  }

  if (state.phase === "nomination") {
    const suspicion = computeSuspicion(state);

    if (actsAsMafia) {
      // 동료는 절대 지목하지 않고, 가장 의심도 높은(=여론이 이미 쏠려있는) 시민을 밀어준다.
      const candidates = aliveOthers.filter((p) => !knowledge.mafiaTeammates.includes(p.seat)).map((p) => p.seat);
      const target = pickTopBy(candidates, (c) => effectiveSuspicion(state, seat, c, suspicion), rng);
      return target === null ? null : { type: "nominate", seat, target, atMs };
    }

    // 조사 결과 이미 마피아로 확정된 생존자가 있다면 100% 그쪽을 지목.
    const confirmedMafia = aliveOthers.find((p) => knownRoleFor(state, seat, p.seat)?.isMafia === true);
    if (confirmedMafia) return { type: "nominate", seat, target: confirmedMafia.seat, atMs };

    // 여론 밴드왜건: 의심도 + 이번 라운드 이미 제출된 지목 득표수(가중치 15)를 합산.
    const liveTally = new Map<SeatIndex, number>();
    for (const target of Object.values(state.nominations)) {
      if (target !== undefined) liveTally.set(target, (liveTally.get(target) ?? 0) + 1);
    }
    const candidates = aliveOthers.map((p) => p.seat);
    const target = pickTopBy(candidates, (c) => effectiveSuspicion(state, seat, c, suspicion) + (liveTally.get(c) ?? 0) * 15, rng);
    return target === null ? null : { type: "nominate", seat, target, atMs };
  }

  if (state.phase === "finalVote") {
    const suspect = state.suspect!;

    if (actsAsMafia) {
      if (knowledge.mafiaTeammates.includes(suspect)) {
        // 꼬리 자르기: 이미 제출된 표가 유죄 쪽으로 기울어 있으면(과반 분위기) 동료를 버리고 동조, 아니면 방어.
        const votes = Object.values(state.finalVotes);
        const yesSoFar = votes.filter((v) => v === "yes").length;
        const noSoFar = votes.filter((v) => v === "no").length;
        return { type: "finalVote", seat, vote: yesSoFar > noSoFar ? "yes" : "no", atMs };
      }
      // 피고인이 시민이면 몰래 찬성표를 던져 처형을 유도(블러핑).
      return { type: "finalVote", seat, vote: "yes", atMs };
    }

    const known = knownRoleFor(state, seat, suspect);
    if (known !== null) return { type: "finalVote", seat, vote: known.isMafia ? "yes" : "no", atMs };

    const suspicion = computeSuspicion(state);
    return { type: "finalVote", seat, vote: (suspicion.get(suspect) ?? 50) >= 60 ? "yes" : "no", atMs };
  }

  if (state.phase === "terroristRevenge" && state.pendingTerroristRevenge) {
    const target = pickRandom(state.pendingTerroristRevenge.eligibleNominators, rng);
    return target === null ? null : { type: "terroristRevenge", seat, target, atMs };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Ranking (feeds the betting/completion system) — binary win/lose like Avalon.
// ---------------------------------------------------------------------------

export function computeRankings(state: MafiaState): { seat: SeatIndex; rank: number }[] {
  const winner = state.winner;
  return state.players.map((p) => ({ seat: p.seat, rank: winner && p.team === winner ? 1 : 2 }));
}
