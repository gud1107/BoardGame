import { seededRng, shuffle } from "@/lib/rng";
import { tallyAdd, tallyMax, type StatTally } from "@/games/shared/statTally";

/**
 * 이상한 복도 — pure rules (rulebook: boardGameRule/이상한복도/이상한복도.md).
 *
 * Everyone walks the same night corridor. Round 0 is the study walk: the
 * corridor as it should be. Every later round shows the same corridor again,
 * either unchanged or with exactly one anomaly (a missing / recoloured /
 * enlarged / moved / tilted / swapped prop, or something that shouldn't be
 * there at all). All players answer at once: tap the odd thing, or say
 * "이상 없음". Right answers score 100 + a speed bonus + a streak bonus.
 *
 * The corridor layout and the round script are derived from the shared seed,
 * so every client renders the same thing (lockstep). `shownProps` is the one
 * function both the 3D scene and the 2D fallback draw from.
 */

export type Seat = number;
export type Side = "L" | "R" | "C" | "E" | "F";
export type PropKind = "door" | "painting" | "clock" | "extinguisher" | "plant" | "poster" | "vending" | "bench" | "cctv" | "lamp" | "exitSign" | "window" | "figure" | "handprint" | "footprints";

export interface Prop {
  id: string;
  kind: PropKind;
  /** L/R wall, C ceiling, E end wall, F floor. */
  side: Side;
  /** Distance down the hall, 0 (entrance) … CORRIDOR_LEN (end wall). */
  z: number;
  /** Height of the prop's centre above the floor (m). */
  y: number;
  w: number;
  h: number;
  color: string;
  icon: string;
  label?: string;
}

export type AnomalyKind = "missing" | "color" | "scale" | "shift" | "tilt" | "swap" | "extra";

export interface Anomaly {
  kind: AnomalyKind;
  /** The prop that changed (or the extra prop's id). */
  target: string;
  /** For "extra": the thing that appeared. For "swap"/"color": the new look. */
  extra?: Prop;
  icon?: string;
  label?: string;
  color?: string;
}

/** A prop as drawn this round. */
export interface ShownProp extends Prop {
  hidden: boolean;
  scale: number;
  tilt: number;
}

export const CORRIDOR_LEN = 14;
export const CORRIDOR_W = 3.2;
export const CORRIDOR_H = 3;
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;
export const STUDY_MS = 20_000;
export const LOOK_MS = 20_000;
export const REVEAL_MS = 4_500;
export const BASE_POINTS = 100;
export const SPEED_POINTS = 100;
export const STREAK_STEP = 25;
export const STREAK_CAP = 100;
/** Share of rounds that hide an anomaly. */
export const ANOMALY_RATE = 0.65;

export type RoundCount = 8 | 12;
export const ROUND_CHOICES: RoundCount[] = [8, 12];
export type Difficulty = "normal" | "hard";

export interface GameOptions {
  rounds: RoundCount;
  difficulty: Difficulty;
  /** 🫣 scarier anomalies (a figure at the end of the hall, a red flash on a miss). */
  scare: boolean;
}
export const DEFAULT_OPTIONS: GameOptions = { rounds: 8, difficulty: "normal", scare: true };

export function sanitizeOptions(o: Partial<GameOptions> | null | undefined): GameOptions {
  return { rounds: o?.rounds === 12 ? 12 : 8, difficulty: o?.difficulty === "hard" ? "hard" : "normal", scare: o?.scare !== false };
}

export const KIND_LABEL: Record<PropKind, string> = {
  door: "문",
  painting: "그림",
  clock: "시계",
  extinguisher: "소화기",
  plant: "화분",
  poster: "포스터",
  vending: "자판기",
  bench: "벤치",
  cctv: "CCTV",
  lamp: "천장 등",
  exitSign: "비상구 표지",
  window: "창문",
  figure: "사람 그림자",
  handprint: "손자국",
  footprints: "발자국",
};

export const ANOMALY_TEXT: Record<AnomalyKind, string> = {
  missing: "사라졌어요",
  color: "색이 바뀌었어요",
  scale: "커졌어요",
  shift: "자리가 옮겨졌어요",
  tilt: "기울어졌어요",
  swap: "그림·글자가 바뀌었어요",
  extra: "원래 없던 게 나타났어요",
};

/* ── layout ─────────────────────────────────────────────────────────── */

const PAINTINGS = ["🌄", "🌊", "🌻", "⛵", "🏔️", "🐟", "🌳", "🏠"];
const POSTERS: [string, string][] = [
  ["📢", "조용히"],
  ["🚭", "금연"],
  ["📚", "독서 주간"],
  ["🧼", "손 씻기"],
  ["🏃", "뛰지 마세요"],
];

/** The normal corridor for this game — doors, wall props, ceiling lamps, the end wall. */
export function buildLayout(seed: number): Prop[] {
  const rng = seededRng((seed ^ 0xc0441d0) | 0);
  const floor = 2 + Math.floor(rng() * 7);
  const props: Prop[] = [];
  // doors alternate down both walls
  const doorZ = [2.5, 6.5, 10.5];
  doorZ.forEach((z, i) => {
    props.push({ id: `door-L${i}`, kind: "door", side: "L", z, y: 1.05, w: 1, h: 2.1, color: "#6b4f3a", icon: "", label: `${floor}0${i * 2 + 1}` });
    props.push({ id: `door-R${i}`, kind: "door", side: "R", z: z + 1.6, y: 1.05, w: 1, h: 2.1, color: "#6b4f3a", icon: "", label: `${floor}0${i * 2 + 2}` });
  });
  // wall props in the gaps between doors
  const slots: { side: Side; z: number }[] = [];
  for (const z of [1, 4.4, 8.4, 12.3]) slots.push({ side: "L", z });
  for (const z of [1.2, 2.8, 6.4, 10.4, 12.6]) slots.push({ side: "R", z });
  const kinds: PropKind[] = shuffle(["painting", "painting", "clock", "extinguisher", "plant", "poster", "poster", "vending", "bench"], rng);
  const paintings = shuffle(PAINTINGS, rng);
  const posters = shuffle(POSTERS, rng);
  shuffle(slots, rng).forEach((slot, i) => {
    const kind = kinds[i % kinds.length];
    const id = `${kind}-${i}`;
    const base = { id, kind, side: slot.side, z: slot.z };
    if (kind === "painting") props.push({ ...base, y: 1.65, w: 0.8, h: 0.6, color: "#a16207", icon: paintings[i % paintings.length] });
    else if (kind === "clock") props.push({ ...base, y: 2.25, w: 0.42, h: 0.42, color: "#e7e5e4", icon: "🕒" });
    else if (kind === "extinguisher") props.push({ ...base, y: 0.38, w: 0.26, h: 0.62, color: "#dc2626", icon: "🧯" });
    else if (kind === "plant") props.push({ ...base, y: 0.45, w: 0.5, h: 0.9, color: "#15803d", icon: "🪴" });
    else if (kind === "poster") {
      const [icon, label] = posters[i % posters.length];
      props.push({ ...base, y: 1.55, w: 0.6, h: 0.82, color: "#f5f5f4", icon, label });
    } else if (kind === "vending") props.push({ ...base, y: 0.95, w: 0.9, h: 1.9, color: "#1d4ed8", icon: "🥤" });
    else props.push({ ...base, y: 0.25, w: 1.4, h: 0.5, color: "#78350f", icon: "" });
  });
  // ceiling
  for (let i = 0; i < 4; i++) props.push({ id: `lamp-${i}`, kind: "lamp", side: "C", z: 1.5 + i * 3.4, y: CORRIDOR_H - 0.02, w: 1.2, h: 0.25, color: "#f0fdf4", icon: "" });
  props.push({ id: "cctv", kind: "cctv", side: "C", z: 0.6 + rng() * 2, y: CORRIDOR_H - 0.25, w: 0.3, h: 0.2, color: "#d4d4d8", icon: "📹" });
  // end wall
  props.push({ id: "exit", kind: "exitSign", side: "E", z: CORRIDOR_LEN, y: 2.45, w: 0.9, h: 0.32, color: "#16a34a", icon: "🏃", label: "비상구" });
  props.push({ id: "window", kind: "window", side: "E", z: CORRIDOR_LEN, y: 1.4, w: 1.2, h: 0.9, color: "#1e293b", icon: "🌙" });
  return props;
}

/* ── the round script ────────────────────────────────────────────────── */

const CAN: Record<PropKind, AnomalyKind[]> = {
  door: ["color", "swap", "missing"],
  painting: ["missing", "color", "scale", "swap", "tilt", "shift"],
  clock: ["missing", "scale", "swap", "tilt", "shift"],
  extinguisher: ["missing", "color", "scale", "shift"],
  plant: ["missing", "scale", "color", "shift"],
  poster: ["missing", "swap", "tilt", "color", "shift"],
  vending: ["missing", "color", "shift"],
  bench: ["missing", "color", "shift"],
  cctv: ["missing", "tilt", "color"],
  lamp: ["missing", "color"],
  exitSign: ["color", "swap", "tilt"],
  window: ["swap", "color"],
  figure: [],
  handprint: [],
  footprints: [],
};
/** Subtle kinds that only appear on 어려움. */
const SUBTLE = new Set<AnomalyKind>(["shift", "tilt"]);

const SWAP_ICON: Partial<Record<PropKind, string[]>> = {
  painting: ["👁️", "😈", "💀", "🩸"],
  clock: ["🕘", "🕛", "🕞"],
  poster: ["👁️", "🚫", "❓"],
  window: ["👁️", "👤", "🩸"],
  exitSign: ["🏃"],
};

function makeAnomaly(layout: Prop[], rng: () => number, opts: GameOptions, avoid: string | null): Anomaly {
  // extras: something that was never there
  if (rng() < 0.22) {
    const pool: Prop[] = [
      { id: "x-hand", kind: "handprint", side: rng() < 0.5 ? "L" : "R", z: 3 + rng() * 8, y: 1.2 + rng() * 0.5, w: 0.35, h: 0.4, color: "#991b1b", icon: "🖐️" },
      { id: "x-feet", kind: "footprints", side: "F", z: 4 + rng() * 7, y: 0.005, w: 0.5, h: 1.4, color: "#3f3f46", icon: "👣" },
    ];
    if (opts.scare) pool.push({ id: "x-figure", kind: "figure", side: "E", z: CORRIDOR_LEN - 0.6, y: 0.9, w: 0.55, h: 1.8, color: "#09090b", icon: "🧍" });
    const extra = pool[Math.floor(rng() * pool.length)];
    return { kind: "extra", target: extra.id, extra };
  }
  for (let tries = 0; tries < 40; tries++) {
    const p = layout[Math.floor(rng() * layout.length)];
    if (p.id === avoid) continue;
    const kinds = CAN[p.kind].filter((k) => opts.difficulty === "hard" || !SUBTLE.has(k));
    if (kinds.length === 0) continue;
    const kind = kinds[Math.floor(rng() * kinds.length)];
    if (kind === "swap") {
      if (p.kind === "door") {
        const n = Number(p.label);
        return { kind, target: p.id, label: String(n + (rng() < 0.5 ? 10 : 6)) };
      }
      if (p.kind === "exitSign") return { kind, target: p.id, label: "출구 없음" };
      const icons = (SWAP_ICON[p.kind] ?? ["👁️"]).filter((i) => i !== p.icon);
      return { kind, target: p.id, icon: icons[Math.floor(rng() * icons.length)] };
    }
    if (kind === "color") {
      const reds = p.kind === "lamp" || p.kind === "exitSign" ? ["#ef4444"] : ["#b91c1c", "#7c3aed", "#0f766e", "#facc15"];
      return { kind, target: p.id, color: reds[Math.floor(rng() * reds.length)] };
    }
    return { kind, target: p.id };
  }
  return { kind: "missing", target: layout[0].id };
}

/** Round 0 is always the study walk (null); later rounds: ~65% one anomaly. */
export function buildScript(seed: number, layout: Prop[], opts: GameOptions): (Anomaly | null)[] {
  const rng = seededRng((seed ^ 0x5c41f7) | 0);
  const out: (Anomaly | null)[] = [null];
  let prev: string | null = null;
  let normals = 0;
  for (let r = 1; r <= opts.rounds; r++) {
    // never three normal rounds in a row, and at least two normal rounds a game
    const left = opts.rounds - r + 1;
    const needNormals = Math.max(0, 2 - out.filter((a, i) => i > 0 && a === null).length);
    const forceNormal = left <= needNormals;
    const anomaly = !forceNormal && (normals >= 2 || rng() < ANOMALY_RATE);
    if (anomaly) {
      const a = makeAnomaly(layout, rng, opts, prev);
      out.push(a);
      prev = a.target;
      normals = 0;
    } else {
      out.push(null);
      normals++;
    }
  }
  return out;
}

/** What the corridor looks like with `anomaly` applied. */
export function shownProps(layout: Prop[], anomaly: Anomaly | null): ShownProp[] {
  const out: ShownProp[] = layout.map((p) => ({ ...p, hidden: false, scale: 1, tilt: 0 }));
  if (!anomaly) return out;
  if (anomaly.kind === "extra" && anomaly.extra) {
    out.push({ ...anomaly.extra, hidden: false, scale: 1, tilt: 0 });
    return out;
  }
  const i = out.findIndex((p) => p.id === anomaly.target);
  if (i < 0) return out;
  const p = out[i];
  if (anomaly.kind === "missing") out[i] = { ...p, hidden: true };
  else if (anomaly.kind === "color") out[i] = { ...p, color: anomaly.color ?? "#b91c1c" };
  else if (anomaly.kind === "scale") out[i] = { ...p, scale: 1.55 };
  else if (anomaly.kind === "shift") out[i] = { ...p, z: Math.min(CORRIDOR_LEN - 0.6, p.z + 1.4) };
  else if (anomaly.kind === "tilt") out[i] = { ...p, tilt: p.kind === "painting" ? Math.PI : 0.42 };
  else if (anomaly.kind === "swap") out[i] = { ...p, icon: anomaly.icon ?? p.icon, label: anomaly.label ?? p.label };
  return out;
}

/* ── state ─────────────────────────────────────────────────────────── */

/** "none" = 이상 없음; otherwise a prop id. null = no answer (timed out). */
export type Pick = string;
export interface Answer {
  pick: Pick;
  ms: number;
}
export interface RoundResult {
  round: number;
  anomaly: Anomaly | null;
  answers: (Answer | null)[];
  points: number[];
}

export interface CorridorState {
  seed: number;
  playerCount: number;
  options: GameOptions;
  layout: Prop[];
  script: (Anomaly | null)[];
  /** 0 = study, 1..rounds = look rounds. */
  round: number;
  phase: "study" | "look" | "reveal" | "ended";
  /** Bumped on every phase change — timers / stale actions key off it. */
  step: number;
  ready: boolean[];
  answers: (Answer | null)[];
  scores: number[];
  streaks: number[];
  results: RoundResult[];
  statTally?: StatTally;
}

export type EngineAction =
  | { type: "ready"; seat: Seat; step: number }
  | { type: "answer"; seat: Seat; step: number; pick: Pick; ms: number }
  /** Sent by the driving client when the phase's time is up. */
  | { type: "advance"; step: number };

export function startGame(playerCount: number, seed: number, options: Partial<GameOptions> = DEFAULT_OPTIONS): CorridorState {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
  const opts = sanitizeOptions(options);
  const layout = buildLayout(seed);
  return {
    seed,
    playerCount: n,
    options: opts,
    layout,
    script: buildScript(seed, layout, opts),
    round: 0,
    phase: "study",
    step: 0,
    ready: Array(n).fill(false),
    answers: Array(n).fill(null),
    scores: Array(n).fill(0),
    streaks: Array(n).fill(0),
    results: [],
    statTally: {},
  };
}

export const currentAnomaly = (s: CorridorState): Anomaly | null => s.script[s.round] ?? null;
export const correctPick = (a: Anomaly | null): Pick => (a ? a.target : "none");

/** Points for one answer (rulebook §5). */
export function pointsFor(ans: Answer | null, anomaly: Anomaly | null, streakBefore: number): number {
  if (!ans || ans.pick !== correctPick(anomaly)) return 0;
  const speed = Math.round(SPEED_POINTS * Math.max(0, 1 - ans.ms / LOOK_MS));
  return BASE_POINTS + speed + Math.min(STREAK_CAP, streakBefore * STREAK_STEP);
}

function toLook(s: CorridorState, round: number): CorridorState {
  return { ...s, round, phase: "look", step: s.step + 1, answers: Array(s.playerCount).fill(null) };
}

function toReveal(s: CorridorState): CorridorState {
  const anomaly = currentAnomaly(s);
  const want = correctPick(anomaly);
  let t = s.statTally;
  const streaks = [...s.streaks];
  const points = s.answers.map((a, seat) => {
    const pts = pointsFor(a, anomaly, s.streaks[seat]);
    t = tallyAdd(t, seat, "rounds");
    if (!a) t = tallyAdd(t, seat, "timeouts");
    else if (a.pick === want) {
      t = tallyAdd(t, seat, "correct");
      t = tallyAdd(t, seat, anomaly ? "found" : "cleared");
      t = tallyMax(t, seat, "maxSpeed", Math.round(SPEED_POINTS * Math.max(0, 1 - a.ms / LOOK_MS)));
    } else t = tallyAdd(t, seat, anomaly && a.pick === "none" ? "missed" : "falseAlarms");
    streaks[seat] = pts > 0 ? streaks[seat] + 1 : 0;
    t = tallyMax(t, seat, "maxStreak", streaks[seat]);
    return pts;
  });
  const scores = s.scores.map((v, i) => v + points[i]);
  return { ...s, phase: "reveal", step: s.step + 1, scores, streaks, results: [...s.results, { round: s.round, anomaly, answers: s.answers, points }], statTally: t };
}

function finish(s: CorridorState): CorridorState {
  let t = s.statTally;
  const total = s.options.rounds;
  s.streaks.forEach((_, seat) => {
    const right = s.results.filter((r) => r.points[seat] > 0).length;
    if (right === total) t = tallyAdd(t, seat, "perfectGames");
  });
  return { ...s, phase: "ended", step: s.step + 1, statTally: t };
}

export function applyAction(s: CorridorState, a: EngineAction): CorridorState {
  if (s.phase === "ended" || a.step !== s.step) return s;
  if (a.type === "ready") {
    if (s.phase !== "study" || a.seat < 0 || a.seat >= s.playerCount || s.ready[a.seat]) return s;
    const ready = s.ready.map((v, i) => v || i === a.seat);
    const next = { ...s, ready };
    return ready.every(Boolean) ? toLook(next, 1) : next;
  }
  if (a.type === "answer") {
    if (s.phase !== "look" || a.seat < 0 || a.seat >= s.playerCount || s.answers[a.seat]) return s;
    const ms = Math.max(0, Math.min(LOOK_MS, Math.round(Number(a.ms) || 0)));
    const answers = s.answers.map((v, i) => (i === a.seat ? { pick: String(a.pick), ms } : v));
    const next = { ...s, answers };
    return answers.every(Boolean) ? toReveal(next) : next;
  }
  // advance: the phase's timer ran out
  if (s.phase === "study") return toLook(s, 1);
  if (s.phase === "look") return toReveal(s);
  return s.round >= s.options.rounds ? finish(s) : toLook(s, s.round + 1);
}

/** How long the current phase lasts before the driving client sends `advance`. */
export function phaseMs(s: CorridorState): number {
  return s.phase === "study" ? STUDY_MS : s.phase === "look" ? LOOK_MS : s.phase === "reveal" ? REVEAL_MS : 0;
}

export function computeRankings(s: CorridorState): { seat: Seat; rank: number; score: number }[] {
  const right = (seat: number) => s.results.filter((r) => r.points[seat] > 0).length;
  const rows = s.scores.map((score, seat) => ({ seat, score, right: right(seat) }));
  rows.sort((a, b) => b.score - a.score || b.right - a.right || a.seat - b.seat);
  return rows.map((r) => ({ seat: r.seat, score: r.score, rank: 1 + rows.filter((o) => o.score > r.score || (o.score === r.score && o.right > r.right)).length }));
}

/** Everything a player can tap this round (hidden props stay tappable where they used to be). */
export function tappable(s: CorridorState): ShownProp[] {
  return shownProps(s.layout, currentAnomaly(s));
}
