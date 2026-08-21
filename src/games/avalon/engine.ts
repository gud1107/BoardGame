/**
 * Pure Avalon (The Resistance: Avalon) rules engine — no React, no I/O.
 * Implements the 5-10 player base ruleset: team proposals with a clockwise
 * leader marker, simultaneous approve/reject voting (5 consecutive rejects
 * in one round is an instant Evil win), simultaneous quest-card submission
 * (Good players' cards are forced to "success" at the engine level — see
 * `playQuestCard` below), the round-4-at-7+-players two-fail exception, and
 * the post-3rd-success Assassin phase that can still flip a Good lead into
 * an Evil win.
 *
 * Same online-multiplayer trust model as Hanamikoji/Bang/Grid Poker: every
 * connected client computes and holds the FULL state (every seat's secret
 * role) from a shared RNG seed plus replayed `EngineAction`s — there is no
 * server authority. The view layer only ever *renders* the viewer's own
 * role and whatever extra knowledge that role grants (see `getKnowledge`).
 * Avalon's secrecy is even higher-stakes than Bang's: a role persists for
 * the *entire* game with no reveal-on-death moment to partially equalize
 * information, so the same "technically inclined player could inspect
 * client state" caveat applies with more force here. Accepted trade-off
 * for casual play among friends, see README.
 */

export type SeatIndex = number;

export type Role = "merlin" | "percival" | "loyalist" | "morgana" | "mordred" | "oberon" | "assassin";
export type Team = "good" | "evil";

export const GOOD_ROLES: Role[] = ["merlin", "percival", "loyalist"];
export const EVIL_ROLES: Role[] = ["morgana", "mordred", "oberon", "assassin"];

export function teamForRole(role: Role): Team {
  return (GOOD_ROLES as Role[]).includes(role) ? "good" : "evil";
}

export interface PlayerState {
  seat: SeatIndex;
  role: Role;
  team: Team;
}

export type Phase = "team-proposal" | "voting" | "quest" | "assassination" | "gameOver";

export type Vote = "approve" | "reject";
export type QuestCard = "success" | "fail";

export interface QuestResult {
  round: number;
  teamSize: number;
  team: SeatIndex[];
  failCount: number;
  success: boolean;
}

export type WinReason = "three-fails" | "five-rejects" | "assassin-correct" | "three-successes";

export interface AvalonState {
  playerCount: number;
  players: PlayerState[];
  round: number; // 1-5
  teamSizes: number[]; // teamSizes[round-1] = required team size for the current round
  leader: SeatIndex;
  proposedTeam: SeatIndex[];
  phase: Phase;
  votes: Partial<Record<SeatIndex, Vote>>; // cleared every new proposal (propose-team); left populated with the just-resolved tally between a vote resolving and the next proposal — see resolveVotes's doc
  consecutiveRejects: number;
  questResults: QuestResult[];
  questCards: Partial<Record<SeatIndex, QuestCard>>; // cleared every new quest
  questSuccesses: number;
  questFails: number;
  winner: Team | null;
  winReason: WinReason | null;
}

export type EngineAction =
  | { type: "propose-team"; seats: SeatIndex[] }
  | { type: "vote"; seat: SeatIndex; vote: Vote }
  | { type: "play-quest-card"; seat: SeatIndex; card: QuestCard }
  | { type: "assassinate"; targetSeat: SeatIndex };

/** Deterministic PRNG + shuffle, shared across every engine — see src/lib/rng.ts. */
import { seededRng, shuffle } from "@/lib/rng";
export { seededRng };
import { botTier, pickByLevel, type BotLevel, type BotTier, type ScoredCandidate } from "@/games/shared/bot/botDifficulty";

// ---------------------------------------------------------------------------
// Role composition & quest tables (exact per-player-count spec, deliberately
// hardcoded rather than derived — the source rulebook's "(또는 모드레드)" wording
// at 7 players is ambiguous, so this always prefers Mordred there for a clean
// good/evil-count progression across 5-10 players).
// ---------------------------------------------------------------------------

export const ROLE_SETS: Record<number, Role[]> = {
  5: ["merlin", "percival", "loyalist", "morgana", "assassin"],
  6: ["merlin", "percival", "loyalist", "loyalist", "morgana", "assassin"],
  7: ["merlin", "percival", "loyalist", "loyalist", "morgana", "assassin", "mordred"],
  8: ["merlin", "percival", "loyalist", "loyalist", "loyalist", "morgana", "assassin", "mordred"],
  9: ["merlin", "percival", "loyalist", "loyalist", "loyalist", "loyalist", "morgana", "assassin", "mordred"],
  10: ["merlin", "percival", "loyalist", "loyalist", "loyalist", "loyalist", "morgana", "assassin", "mordred", "oberon"],
};

/** teamSizes[playerCount][round-1] = number of seats sent on that round's quest. */
export const TEAM_SIZE_TABLE: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

/** Number of fail cards required to fail a given round's quest — always 1,
 * except round 4 at 7+ players, which requires 2 (the classic Avalon "hard mode" round). */
export function failThreshold(playerCount: number, round: number): number {
  if (round === 4 && playerCount >= 7) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function startGame(playerCount: number, seed: number): AvalonState {
  const roleSet = ROLE_SETS[playerCount];
  if (!roleSet) throw new Error(`Unsupported player count: ${playerCount}`);
  const rng = seededRng(seed);
  const roles = shuffle(roleSet, rng);
  const players: PlayerState[] = roles.map((role, seat) => ({ seat, role, team: teamForRole(role) }));
  const leader = Math.floor(rng() * playerCount);

  return {
    playerCount,
    players,
    round: 1,
    teamSizes: TEAM_SIZE_TABLE[playerCount],
    leader,
    proposedTeam: [],
    phase: "team-proposal",
    votes: {},
    consecutiveRejects: 0,
    questResults: [],
    questCards: {},
    questSuccesses: 0,
    questFails: 0,
    winner: null,
    winReason: null,
  };
}

// ---------------------------------------------------------------------------
// Knowledge — what each role privately knows at game start. Computed lazily
// from the role assignment rather than stored per-player, so the Board can
// ask "what does the viewer's own seat know" without the engine ever having
// to reveal anyone else's knowledge to state consumers.
// ---------------------------------------------------------------------------

export interface Knowledge {
  role: Role;
  team: Team;
  /** Seats the viewer knows are Evil. Populated for Merlin (all Evil except
   * Mordred, but including Oberon per the rulebook's explicit note) and for
   * Evil non-Oberon roles (every other Evil seat except Oberon). Empty otherwise. */
  evilSeatsKnown: SeatIndex[];
  /** Populated only for Percival: exactly [merlinSeat, morganaSeat] in seat
   * order (unordered/ambiguous on purpose — Percival cannot tell which is which). */
  merlinPercivalCandidates: SeatIndex[];
}

export function getKnowledge(state: AvalonState, viewerSeat: SeatIndex): Knowledge {
  const me = state.players[viewerSeat];
  const evilSeatsKnown: SeatIndex[] = [];
  const merlinPercivalCandidates: SeatIndex[] = [];

  if (me.role === "merlin") {
    for (const p of state.players) {
      if (p.team === "evil" && p.role !== "mordred") evilSeatsKnown.push(p.seat);
    }
  } else if (me.role === "percival") {
    for (const p of state.players) {
      if (p.role === "merlin" || p.role === "morgana") merlinPercivalCandidates.push(p.seat);
    }
  } else if (me.team === "evil" && me.role !== "oberon") {
    for (const p of state.players) {
      if (p.seat !== viewerSeat && p.team === "evil" && p.role !== "oberon") evilSeatsKnown.push(p.seat);
    }
  }

  return { role: me.role, team: me.team, evilSeatsKnown, merlinPercivalCandidates };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function nextSeat(seat: SeatIndex, playerCount: number): SeatIndex {
  return (seat + 1) % playerCount;
}

// ---------------------------------------------------------------------------
// Team proposal
// ---------------------------------------------------------------------------

function proposeTeam(state: AvalonState, action: Extract<EngineAction, { type: "propose-team" }>): AvalonState {
  if (state.phase !== "team-proposal") return state;
  const requiredSize = state.teamSizes[state.round - 1];
  if (action.seats.length !== requiredSize) return state;
  if (action.seats.some((s) => s < 0 || s >= state.playerCount)) return state;
  if (new Set(action.seats).size !== action.seats.length) return state;
  return { ...state, proposedTeam: [...action.seats], phase: "voting", votes: {} };
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

function resolveVotes(state: AvalonState): AvalonState {
  const approveCount = Object.values(state.votes).filter((v) => v === "approve").length;
  const rejectCount = state.playerCount - approveCount;

  // `state.votes` is deliberately left populated (the full, just-resolved
  // tally) in every branch below rather than cleared here — the view layer's
  // vote-reveal overlay (see AvalonEffects.tsx's `detectAvalonRevealEvents`)
  // needs the very last vote's actual value, which otherwise only ever
  // existed transiently inside `castVote`'s local merge and would never
  // reach an observable state snapshot. Harmless to leave around: every
  // reader of `state.votes` elsewhere is already gated on `phase ===
  // "voting"` (see its field doc below), and the next `propose-team` action
  // resets it fresh regardless (`proposeTeam` sets `votes: {}` itself).

  if (approveCount > rejectCount) {
    // Approved: the team heads to the quest with the SAME leader who
    // proposed it. The leader marker only advances once this round's
    // quest actually resolves (see `resolveQuest`), matching physical
    // Avalon's "leader passes after the round completes" flow.
    return { ...state, phase: "quest", questCards: {} };
  }

  // Rejected (including ties): leader passes immediately so someone new
  // proposes next, and the reject streak grows.
  const consecutiveRejects = state.consecutiveRejects + 1;
  const leader = nextSeat(state.leader, state.playerCount);
  if (consecutiveRejects >= 5) {
    return {
      ...state,
      phase: "gameOver",
      winner: "evil",
      winReason: "five-rejects",
      consecutiveRejects,
      leader,
    };
  }
  return {
    ...state,
    phase: "team-proposal",
    proposedTeam: [],
    consecutiveRejects,
    leader,
  };
}

function castVote(state: AvalonState, action: Extract<EngineAction, { type: "vote" }>): AvalonState {
  if (state.phase !== "voting") return state;
  const { seat, vote } = action;
  if (seat < 0 || seat >= state.playerCount) return state;
  if (state.votes[seat] !== undefined) return state; // already voted, no-op
  const votes = { ...state.votes, [seat]: vote };
  if (Object.keys(votes).length < state.playerCount) return { ...state, votes };
  return resolveVotes({ ...state, votes });
}

// ---------------------------------------------------------------------------
// Quest
// ---------------------------------------------------------------------------

function resolveQuest(state: AvalonState): AvalonState {
  const failCount = Object.values(state.questCards).filter((c) => c === "fail").length;
  const threshold = failThreshold(state.playerCount, state.round);
  const success = failCount < threshold;

  const questResult: QuestResult = {
    round: state.round,
    teamSize: state.proposedTeam.length,
    team: [...state.proposedTeam],
    failCount,
    success,
  };

  const questSuccesses = state.questSuccesses + (success ? 1 : 0);
  const questFails = state.questFails + (success ? 0 : 1);

  const base: AvalonState = {
    ...state,
    questResults: [...state.questResults, questResult],
    questSuccesses,
    questFails,
    questCards: {},
    proposedTeam: [],
    consecutiveRejects: 0,
  };

  // Win-condition priority, checked in this exact order every time a quest
  // resolves — 3 fails short-circuits Evil's win before Good's 3rd success
  // could ever matter, and 3 successes defers to the Assassination phase
  // rather than declaring Good the winner outright.
  if (questFails >= 3) {
    return { ...base, phase: "gameOver", winner: "evil", winReason: "three-fails" };
  }
  if (questSuccesses >= 3) {
    return { ...base, phase: "assassination" };
  }
  return {
    ...base,
    phase: "team-proposal",
    round: state.round + 1,
    leader: nextSeat(state.leader, state.playerCount),
  };
}

function playQuestCard(state: AvalonState, action: Extract<EngineAction, { type: "play-quest-card" }>): AvalonState {
  if (state.phase !== "quest") return state;
  const { seat, card } = action;
  if (!state.proposedTeam.includes(seat)) return state;
  if (state.questCards[seat] !== undefined) return state; // already submitted, no-op
  const player = state.players[seat];
  // Defensive: Good players can never submit "fail" — reject the action
  // outright (no-op) rather than silently coercing it, same convention as
  // Bang's engine rejecting illegal targets/plays instead of guessing intent.
  if (player.team === "good" && card === "fail") return state;

  const questCards = { ...state.questCards, [seat]: card };
  const s: AvalonState = { ...state, questCards };
  if (Object.keys(questCards).length < state.proposedTeam.length) return s;
  return resolveQuest(s);
}

// ---------------------------------------------------------------------------
// Assassination
// ---------------------------------------------------------------------------

function assassinate(state: AvalonState, action: Extract<EngineAction, { type: "assassinate" }>): AvalonState {
  if (state.phase !== "assassination") return state;
  const target = state.players[action.targetSeat];
  if (!target) return state;
  if (target.role === "merlin") {
    return { ...state, phase: "gameOver", winner: "evil", winReason: "assassin-correct" };
  }
  return { ...state, phase: "gameOver", winner: "good", winReason: "three-successes" };
}

// ---------------------------------------------------------------------------
// AI bot support (ARCHITECTURE.md §7) — getValidMoves / scoreMove /
// chooseBotAction(state, seat, level, rng?). Information fairness is the
// central constraint in this game: every scorer below reads only
// `getKnowledge(state, seat)` (the exact information that seat's role
// actually grants) plus fully public state (`questResults`, `proposedTeam`,
// `votes`) — never another seat's true hidden role directly.
//
// Simultaneous-decision phases (`voting` has every seat decide at once,
// `quest` has every proposed-team seat decide at once) can't expose a
// single "whose turn" the way team-proposal/assassination do — `<Game>Game.tsx`
// resolves this with the project's usual "lowest seat still undecided"
// workaround (see ARCHITECTURE.md §7.5's forSale/grid-poker note).
// ---------------------------------------------------------------------------

/** All k-length combinations of seats 0..playerCount-1, in ascending order — used to enumerate team proposals (bounded: at most C(10,5)=252 for this game's largest table). */
function seatCombinations(playerCount: number, k: number): SeatIndex[][] {
  const all = Array.from({ length: playerCount }, (_, i) => i);
  function combos(items: SeatIndex[], k: number): SeatIndex[][] {
    if (k === 0) return [[]];
    if (items.length < k) return [];
    const [first, ...rest] = items;
    return [...combos(rest, k - 1).map((c) => [first, ...c]), ...combos(rest, k)];
  }
  return combos(all, k);
}

/** How many failed quests each seat has ridden along on — fully public (every quest's team + outcome is visible to everyone), the classic Avalon "who keeps showing up on bad teams" tell. */
function suspicionFromFailedQuests(state: AvalonState): Record<SeatIndex, number> {
  const scores: Record<SeatIndex, number> = {};
  for (let s = 0; s < state.playerCount; s++) scores[s] = 0;
  for (const q of state.questResults) if (!q.success) for (const s of q.team) scores[s] += 1;
  return scores;
}

/** How many successful quests each seat has been part of — also fully public; used by the Assassin's expert-tier Merlin guess (a real Merlin tends to end up steering successful teams). */
function successParticipation(state: AvalonState): Record<SeatIndex, number> {
  const scores: Record<SeatIndex, number> = {};
  for (let s = 0; s < state.playerCount; s++) scores[s] = 0;
  for (const q of state.questResults) if (q.success) for (const s of q.team) scores[s] += 1;
  return scores;
}

export function getValidMoves(state: AvalonState, seat: SeatIndex): EngineAction[] {
  switch (state.phase) {
    case "team-proposal": {
      if (state.leader !== seat) return [];
      const size = state.teamSizes[state.round - 1];
      return seatCombinations(state.playerCount, size).map((seats) => ({ type: "propose-team", seats }) as EngineAction);
    }
    case "voting": {
      if (state.votes[seat] !== undefined) return [];
      return [
        { type: "vote", seat, vote: "approve" },
        { type: "vote", seat, vote: "reject" },
      ];
    }
    case "quest": {
      if (!state.proposedTeam.includes(seat) || state.questCards[seat] !== undefined) return [];
      const player = state.players[seat];
      const cards: QuestCard[] = player.team === "good" ? ["success"] : ["success", "fail"];
      return cards.map((card) => ({ type: "play-quest-card", seat, card }) as EngineAction);
    }
    case "assassination": {
      const player = state.players[seat];
      if (player.role !== "assassin") return [];
      return Array.from({ length: state.playerCount }, (_, s) => s)
        .filter((s) => s !== seat)
        .map((targetSeat) => ({ type: "assassinate", targetSeat }) as EngineAction);
    }
    default:
      return [];
  }
}

/**
 * Higher = more desirable for the bot. Tiers per ARCHITECTURE.md §7.5:
 * novice ~ uniform over every legal move. core uses only the seat's own
 * *direct* role knowledge (Merlin/evil's known-evil set) with no historical
 * pattern reading, and is otherwise close to random (team proposals, evil's
 * voting). expert (Lv.8-10, per the task brief) additionally reads public
 * quest history (`suspicionFromFailedQuests`/`successParticipation`) to
 * propose/vote more convincingly and to guess Merlin at the Assassination.
 */
export function scoreMove(state: AvalonState, seat: SeatIndex, move: EngineAction, tier: BotTier): number {
  if (tier === "novice") return 0;
  const expert = tier === "expert";
  const knowledge = getKnowledge(state, seat);

  switch (move.type) {
    case "propose-team": {
      const evilKnown = new Set(knowledge.evilSeatsKnown);
      if (knowledge.team === "good") {
        if (!expert) return 0;
        const evilIncluded = move.seats.filter((s) => evilKnown.has(s)).length;
        return -evilIncluded * 100 + (move.seats.includes(seat) ? 2 : 0);
      }
      // Evil leader: exactly one evil seat (ideally self) on the team is the
      // sweet spot — enough to fail it, not so many it's an obvious tell.
      if (!expert) return 0;
      const evilTeammates = new Set<SeatIndex>([seat, ...knowledge.evilSeatsKnown]);
      const evilIncluded = move.seats.filter((s) => evilTeammates.has(s)).length;
      return -Math.abs(evilIncluded - 1) * 50;
    }
    case "vote": {
      const team = state.proposedTeam;
      if (knowledge.team === "good") {
        const evilKnownInTeam = team.filter((s) => knowledge.evilSeatsKnown.includes(s)).length;
        const patternSuspicion = expert ? team.reduce((sum, s) => sum + (suspicionFromFailedQuests(state)[s] ?? 0), 0) : 0;
        const badness = evilKnownInTeam * 100 + patternSuspicion * 5;
        return move.vote === "approve" ? -badness : badness;
      }
      if (!expert) return 0; // core evil: no reliable read, stays close to random
      const evilTeammates = new Set<SeatIndex>([seat, ...knowledge.evilSeatsKnown]);
      const hasEvilTeammate = team.some((s) => evilTeammates.has(s));
      if (move.vote === "approve") return hasEvilTeammate ? 20 : -5;
      return hasEvilTeammate ? -20 : 5;
    }
    case "play-quest-card": {
      // Good seats only ever get "success" as a candidate (getValidMoves),
      // so this branch only meaningfully discriminates for evil seats.
      if (move.card === "success") return tier === "core" ? 9.5 : 0; // core: near-tied with fail -> genuinely probabilistic via pickByLevel's own noise
      return 10; // fail — expert always defects when it can, core usually does
    }
    case "assassinate": {
      const evilKnown = new Set(knowledge.evilSeatsKnown);
      if (evilKnown.has(move.targetSeat)) return -1000; // never shoot a known teammate
      if (!expert) return 0;
      return successParticipation(state)[move.targetSeat] ?? 0; // guess whoever's steered the most successful quests
    }
    default:
      return 0;
  }
}

export function chooseBotAction(
  state: AvalonState,
  seat: SeatIndex,
  level: BotLevel,
  rng: () => number = Math.random,
): EngineAction | null {
  const moves = getValidMoves(state, seat);
  if (moves.length === 0) return null;
  const tier = botTier(level);
  const candidates: ScoredCandidate<EngineAction>[] = moves.map((move) => ({ move, score: scoreMove(state, seat, move, tier) }));
  return pickByLevel(candidates, level, rng);
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** Single entry point applying any `EngineAction` to a state — the whole engine as one reducer. */
export function applyAction(state: AvalonState, action: EngineAction): AvalonState {
  switch (action.type) {
    case "propose-team":
      return proposeTeam(state, action);
    case "vote":
      return castVote(state, action);
    case "play-quest-card":
      return playQuestCard(state, action);
    case "assassinate":
      return assassinate(state, action);
    default:
      return state;
  }
}
