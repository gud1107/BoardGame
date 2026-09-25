/**
 * 반지의 제왕: 가운데땅에서의 대결 (Duel for Middle-earth) — data model.
 *
 * Based on the request's schema, with a few changes needed by this repo's
 * lockstep online play: seat ↔ faction mapping (`factionOf`), a seeded RNG
 * (`seed`/`rngCounter`), counted tech symbols instead of a Set (two gray cards
 * of the same symbol really do produce two), and an explicit `pending` queue
 * for every effect that needs a player choice (unit placement, moves, token
 * picks, …).
 */

export type Faction = "FELLOWSHIP" | "SAURON";
export type Seat = "p1" | "p2";

export type RegionId = "ARNOR" | "MORDOR" | "LINDON" | "ENEDWAITH" | "ROHAN" | "GONDOR" | "RHOVANION";

export type TechSymbol = "BOOK" | "FLAG" | "SWORD" | "MASK" | "COURAGE";
/** The six alliance races. EAGLE only ever comes from the Hobbit eagle token. */
export type AllianceRace = "ELF" | "DWARF" | "HOBBIT" | "HUMAN" | "ENT" | "WIZARD";
export type RaceSymbol = AllianceRace | "EAGLE";
export type CardColor = "GRAY" | "GREEN" | "RED" | "YELLOW" | "BLUE" | "PURPLE";
export type TacticsType = "MULTI_MOVE" | "SNIPE_UNIT" | "DRAIN_COINS";

export interface LotrDuelCard {
  id: string;
  chapter: 1 | 2 | 3;
  color: CardColor;
  name: string;
  cost: {
    coins?: number;
    tech?: TechSymbol[];
    /** Owning a played card that provides this chain symbol makes this card free. */
    chainSymbol?: string;
  };
  providesChain?: string;
  providesTech?: TechSymbol[];
  /** Gray "choice" card: produces ONE of these per turn. */
  selectTechChoice?: TechSymbol[];
  race?: AllianceRace;
  militaryUnits?: { count: number; allowedRegions: RegionId[] };
  coinsReward?: number;
  ringAdvance?: number;
  tacticsType?: TacticsType;
  /** MULTI_MOVE: moves, SNIPE_UNIT: units removed, DRAIN_COINS: coins drained. */
  tacticsAmount?: number;
}

export type LandmarkId = "BARAD_DUR" | "BREE" | "EREBOR" | "GREY_HAVENS" | "HELMS_DEEP" | "ISENGARD" | "MINAS_TIRITH";

export interface LandmarkTile {
  id: LandmarkId;
  name: string;
  targetRegion: RegionId;
  baseCost: { coins: number; tech?: TechSymbol[] };
  description: string;
}

export type AllianceTokenId =
  | "ELF_YELLOW_EXTRA_TURN"
  | "ELF_RED_ANYWHERE"
  | "ELF_GREEN_MOVES"
  | "DWARF_LANDMARK_DISCOUNT"
  | "DWARF_LANDMARK_EXTRA_TURN"
  | "DWARF_WILD_TECH"
  | "HOBBIT_EAGLE"
  | "HOBBIT_BLUE_UNIT"
  | "HOBBIT_DISCARD_DOUBLE"
  | "HUMAN_YELLOW_RING"
  | "HUMAN_RED_EXTRA_UNIT"
  | "HUMAN_CHAIN_BONUS"
  | "ENT_RING_TWO"
  | "ENT_DESTROY_FORTRESS"
  | "ENT_TRIPLE"
  | "WIZARD_EXTRA_TURN"
  | "WIZARD_TWO_UNITS"
  | "WIZARD_DISCARD_PLAY";

export interface AllianceToken {
  id: AllianceTokenId;
  race: AllianceRace;
  isOneShot: boolean;
  name: string;
  description: string;
}

export interface PlayerDuelState {
  faction: Faction;
  coins: number;
  unitsInSupply: number;
  fortressesInSupply: number;
  tableauCards: LotrDuelCard[];
  allianceTokens: AllianceToken[];
  constructedLandmarks: LandmarkTile[];
  /** Races for which the "2 cards of the same race" token has already been claimed. */
  pairRacesClaimed: AllianceRace[];
  /** The once-per-game "3 different races" token has been claimed. */
  trioClaimed: boolean;
}

export interface RegionState {
  fellowshipUnits: number;
  sauronUnits: number;
  fellowshipFortress: boolean;
  sauronFortress: boolean;
}

export interface PyramidSlot {
  card: LotrDuelCard;
  row: number;
  /** Horizontal position in half-card units, centred on 0. */
  x: number;
  isOpen: boolean;
  /** Slot indices (into `pyramidGrid`) of the cards lying on top of this one. */
  coveredBy: number[];
  isTaken: boolean;
}

export type EntOption = "SNIPE" | "DRAIN" | "MOVE";

/** One effect waiting on the active player's choice — resolved front-to-back. */
export type PendingStep =
  | { kind: "PLACE"; count: number; regions: RegionId[]; source: string }
  | { kind: "MOVE"; remaining: number; source: string }
  | { kind: "SNIPE"; count: number; source: string }
  | { kind: "DESTROY_FORTRESS"; source: string }
  | { kind: "DESTROY_GRAY"; source: string }
  | { kind: "DISCARD_PLAY"; source: string }
  | { kind: "TOKEN_RACE"; source: string }
  /** Pick 1 of the revealed tops: 1 race → its top 2; several races → the top of each. */
  | { kind: "TOKEN"; races: AllianceRace[]; source: string }
  | { kind: "ENT_CHOICE"; remaining: number; source: string };

export type WinType = "RING_QUEST" | "RACE_ALLIANCE" | "CONQUEST" | "TERRITORY_MAJORITY";

export type LogKind = "CARD" | "DISCARD" | "TRACK" | "COIN" | "COMBAT" | "UNIT" | "MOVE" | "LANDMARK" | "TOKEN" | "TACTIC" | "SYSTEM";

export interface LogEntry {
  no: number;
  /** Turn the entry happened on (the history log's "timestamp" — wall-clock time would differ between lockstep clients). */
  turn: number;
  faction: Faction | null;
  kind: LogKind;
  text: string;
}

export interface LotrDuelState {
  seed: number;
  rngCounter: number;
  factionOf: Record<Seat, Faction>;
  phase: "PLAYING" | "GAME_OVER";
  chapter: 1 | 2 | 3;
  turn: Faction;
  startPlayerOfChapter: Faction;
  firstPlayerOverall: "SAURON";
  players: Record<Faction, PlayerDuelState>;
  boardRegions: Record<RegionId, RegionState>;
  ringTrack: {
    frodoPosition: number;
    nazgulPosition: number;
    trackLength: number;
  };
  pyramidGrid: PyramidSlot[];
  /** The 3 cards secretly removed from the current chapter's deck. */
  removedCards: LotrDuelCard[];
  revealedLandmarks: LandmarkTile[];
  landmarkDeck: LandmarkTile[];
  /** Each pile is face-down; index 0 is the top. */
  allianceTokenDecks: Record<AllianceRace, AllianceTokenId[]>;
  discardedCards: LotrDuelCard[];
  pending: PendingStep[];
  /** The current turn grants one more turn to the same player once it ends. */
  extraTurn: boolean;
  turnNumber: number;
  lastAction: { no: number; faction: Faction; kind: "PLAY" | "DISCARD" | "LANDMARK"; cardId?: string; landmarkId?: LandmarkId } | null;
  combatFlash: { no: number; region: RegionId; losses: number } | null;
  log: LogEntry[];
  winner: Faction | null;
  winType: WinType | null;
}

export type EngineAction =
  | { type: "TAKE_CARD"; faction: Faction; slot: number; mode: "PLAY" | "DISCARD" }
  | { type: "TAKE_LANDMARK"; faction: Faction; landmarkId: LandmarkId }
  | { type: "PLACE"; faction: Faction; region: RegionId }
  | { type: "MOVE"; faction: Faction; from: RegionId; to: RegionId }
  | { type: "SKIP"; faction: Faction }
  | { type: "SNIPE"; faction: Faction; region: RegionId }
  | { type: "DESTROY_FORTRESS"; faction: Faction; region: RegionId }
  | { type: "DESTROY_GRAY"; faction: Faction; cardId: string }
  | { type: "DISCARD_PLAY"; faction: Faction; cardId: string }
  | { type: "PICK_RACE"; faction: Faction; race: AllianceRace }
  | { type: "PICK_TOKEN"; faction: Faction; tokenId: AllianceTokenId }
  | { type: "ENT_PICK"; faction: Faction; option: EntOption };
