/**
 * Core types for 반지의 제왕: 가운데땅에서의 대결 (The Confrontation).
 *
 * The online room maps its two lockstep seats (p1/p2) onto the two asymmetric
 * factions via `LotrState.factionOf` — the host may pick either side, so
 * "p1" is NOT always the Fellowship. Every engine function below speaks in
 * factions; only the Game/Board layer ever translates to seats.
 */

export type Seat = "p1" | "p2";
export type Faction = "FELLOWSHIP" | "SAURON";

export type CharacterId =
  // 원정대 9종
  | "FRODO"
  | "SAM"
  | "ARAGORN"
  | "GANDALF"
  | "LEGOLAS"
  | "GIMLI"
  | "BOROMIR"
  | "MERRY"
  | "PIPPIN"
  // 사우론 9종
  | "WITCH_KING"
  | "SARUMAN"
  | "BALROG"
  | "NAZGUL"
  | "SHELOB"
  | "EASTERLING"
  | "CAVE_TROLL"
  | "ORCS"
  | "GOBLIN";

export interface LotrCharacter {
  id: CharacterId;
  name: string;
  nameEn: string;
  faction: Faction;
  basePower: number;
  emoji: string;
  abilityName: string;
  abilityDescription: string;
}

export type CardType = "BASIC" | "SPECIAL";

export type CardEffect =
  | "MAGIC"
  | "RETREAT"
  | "ELVEN_BOW"
  | "ELVEN_CLOAK"
  | "MITHRIL_MAIL"
  | "PHIAL"
  | "ANDURIL"
  | "ENTS"
  | "EAGLES"
  | "SMITE"
  | "ATHELAS"
  | "EYE_OF_SAURON"
  | "MORGUL_BLADE"
  | "DARK_DESPAIR"
  | "GROND"
  | "BLACK_SORCERY"
  | "TREACHERY"
  | "ORC_MOB"
  | "NAZGUL_SHRIEK"
  | "WEB";

export interface LotrCard {
  id: string;
  name: string;
  faction: Faction;
  type: CardType;
  power: number;
  effectType?: CardEffect;
  description: string;
}

export interface BoardPiece {
  /** Every character exists exactly once, so the character id doubles as the instance id. */
  instanceId: CharacterId;
  characterId: CharacterId;
  faction: Faction;
  regionId: string;
  /** Flipped face-up by a combat — stays public for the rest of the game. */
  isRevealed: boolean;
}

export interface RegionNode {
  id: string;
  name: string;
  nameEn: string;
  /** 0: Shire ~ 4: Mordor. */
  tier: number;
  /** 일반 2, 산맥 1, 본거지(샤이어/모르도르) 4. */
  capacity: number;
  adjacentRegions: string[];
  isShire?: boolean;
  isMordor?: boolean;
  isMountain?: boolean;
  /** Layout position on the map, in % of the map box (Mordor at the top). */
  x: number;
  y: number;
}

export type PreCombatChoiceKind = "FRODO_FLEE" | "PIPPIN";

export interface PendingPreChoice {
  faction: Faction;
  kind: PreCombatChoiceKind;
  pieceId: CharacterId;
  /** Legal escape/sidestep destinations (may be empty for Pippin → peek only). */
  options: string[];
}

export type PreStepKind = "KILL" | "BOROMIR" | "SHELOB" | "GOBLIN_PEEK" | "FRODO_FLEE" | "PIPPIN";

export interface PreStep {
  side: "A" | "D";
  kind: PreStepKind;
}

export interface CombatContext {
  regionId: string;
  attackerId: CharacterId;
  defenderId: CharacterId;
  /** Where the attacker came from — it walks back here if both sides survive. */
  attackerOrigin: string;
  step: "PRE_COMBAT" | "CARD_PICK";
  preQueue: PreStep[];
  preIndex: number;
  pendingChoice: PendingPreChoice | null;
  /** Characters whose base power Shelob pinned to 0 for this combat. */
  baseZeroed: CharacterId[];
  picks: Partial<Record<Faction, string>>;
  log: string[];
}

export type CombatOutcome =
  | "attacker-wins"
  | "defender-wins"
  | "both-die"
  | "both-survive"
  | "escaped"
  | "pre-kill";

/** Public record of the last finished combat — drives the result cinematic. */
export interface CombatReport {
  no: number;
  regionId: string;
  attacker: { faction: Faction; characterId: CharacterId; card: string | null; power: number | null; died: boolean };
  defender: { faction: Faction; characterId: CharacterId; card: string | null; power: number | null; died: boolean };
  outcome: CombatOutcome;
  log: string[];
}

export interface PeekInfo {
  viewer: Faction;
  cardId: string;
  by: CharacterId;
  combatNo: number;
}

export interface LotrState {
  seed: number;
  /** Deterministic RNG cursor — never `Math.random()` inside the reducer (lockstep). */
  rngCounter: number;
  factionOf: Record<Seat, Faction>;
  phase: "SETUP" | "MOVEMENT" | "COMBAT" | "GAME_OVER";
  setupDone: Record<Faction, boolean>;
  pieces: Partial<Record<CharacterId, BoardPiece>>;
  graveyard: CharacterId[];
  hands: Record<Faction, string[]>;
  discards: Record<Faction, string[]>;
  /** Cards removed for good by the Orcs' 물량 공세. */
  destroyed: string[];
  turn: Faction;
  turnNumber: number;
  /** Grond: character → the turnNumber on which it may not move. */
  immobile: Partial<Record<CharacterId, number>>;
  /** Sauron characters that have ever attacked Frodo (Sam's 헌신 trigger). */
  frodoAttackers: CharacterId[];
  combat: CombatContext | null;
  combatCount: number;
  lastCombat: CombatReport | null;
  peek: PeekInfo | null;
  lastMove: { faction: Faction; pieceId: CharacterId; from: string; to: string } | null;
  shireInvadersCount: number;
  winner: Faction | null;
  winReason: string | null;
  log: string[];
}

export type PreChoice = { kind: "stay" } | { kind: "flee"; to: string } | { kind: "peek" } | { kind: "sidestep"; to: string };

export type EngineAction =
  | { type: "setup"; faction: Faction; placement: Partial<Record<CharacterId, string>> }
  | { type: "move"; faction: Faction; pieceId: CharacterId; to: string }
  | { type: "preChoice"; faction: Faction; choice: PreChoice }
  | { type: "pickCard"; faction: Faction; cardId: string };
