/**
 * Static data for 섬광전대 프리즘파이브 — heroes, frame data, enemies, bosses,
 * stages. Every number here is in engine units: 1 tick = 1/60 s, distance in
 * world units (the camera shows VIEW_W × ~360). The design doc
 * (boardGameRule/섬광전대프리즘파이브/) explains the why behind each table;
 * keep the two in sync.
 */

export const TICK = 60;
export const VIEW_W = 640;
/** Depth band: z=0 is the back of the street, z=Z_MAX the front. */
export const Z_MAX = 150;
export const GRAVITY = 0.55;
export const JUMP_VY = 9.6;
/** Air juggle: each hit adds weight; past JUGGLE_MAX the target drops untouchable. */
export const JUGGLE_MAX = 14;
/** Combo counter survives this long without a new hit. */
export const COMBO_WINDOW = 90;
export const GETUP_INVULN = 40;
export const DODGE_TICKS = 22;
/** Dodge i-frames [from, to). A hit absorbed in the first PERFECT_TICKS = 섬광 회피. */
export const DODGE_INVULN: [number, number] = [1, 16];
export const PERFECT_TICKS = 8;
export const PRISM_MAX = 100;
export const EN_MAX = 100;
export const ASSIST_MAX = 3;
/** Seconds of combat (hits landed) per assist stock, as style-independent fallback. */
export const ASSIST_HITS = 40;

export type HitKind = "flinch" | "stagger" | "launch" | "knockdown" | "spike" | "spin" | "bind" | "grab";

export interface HitDef {
  /** First active tick (relative to move start). */
  at: number;
  len: number;
  /** Forward reach [from, to] (negative = behind). */
  x: [number, number];
  /** Depth half-width. */
  z: number;
  /** Height band relative to the attacker's feet; air targets above y[1] are missed. */
  y: [number, number];
  dmg: number;
  kind: HitKind;
  stun?: number;
  /** Knockback (units/tick away from the attacker). */
  kb?: number;
  /** Launch velocity. */
  lift?: number;
  /** Hit-stop ticks (global freeze). */
  stop?: number;
  /** Break-gauge damage vs bosses/elites. */
  brk?: number;
  /** Breaks shields/guard stances. */
  guardBreak?: boolean;
  /** Hits targets lying on the ground (once). */
  otg?: boolean;
  /** Hits every enemy on screen regardless of range (ultimates). */
  screen?: boolean;
  /** Pull toward the attacker instead of pushing away. */
  pull?: boolean;
}

export type AnimKind =
  | "jab" | "straight" | "hook" | "kick" | "spinKick" | "uppercut"
  | "slashH" | "slashB" | "slashUp" | "slashDown" | "thrust" | "spin"
  | "shoot" | "shootUp" | "throw" | "slam" | "dive" | "rise" | "dash"
  | "whip" | "heal" | "guard" | "roar" | "charge" | "cast" | "pose" | "grab";

export type ProjKind = "shot" | "arrow" | "bomb" | "grenade" | "orb" | "rock" | "pillar" | "wave" | "beam" | "fist" | "bubble" | "laser" | "heart" | "darkBlast";

export interface ProjSpawn {
  at: number;
  kind: ProjKind;
  /** Spawn offset (forward, up). */
  dx: number;
  dy: number;
  vx: number;
  vy?: number;
  /** Extra projectiles fanned in depth. */
  fanZ?: number[];
  life: number;
  hit: Omit<HitDef, "at" | "len" | "x" | "y"> & { r: number };
  pierce?: boolean;
  /** Explodes on landing / expiry with this radius. */
  blast?: number;
  /** Homing strength toward the nearest enemy (units/tick²). */
  home?: number;
}

export type Special =
  | "charge" | "teleport" | "blink" | "summon" | "clones" | "parry" | "guard"
  | "rockRain" | "pillars" | "darkBlast" | "heal" | "ironWall" | "grabThrow" | "rush" | "hop" | "quake";

export interface MoveDef {
  id: string;
  name: string;
  anim: AnimKind;
  total: number;
  hits: HitDef[];
  /** From this tick the move can chain into the next one (on any outcome). */
  cancel?: number;
  /** Forward self-velocity [fromTick, toTick, vx]. */
  lunge?: [number, number, number][];
  /** Self vertical velocity set at tick [tick, vy]. */
  hop?: [number, number];
  proj?: ProjSpawn[];
  invuln?: [number, number];
  /** Super armor for the whole move (no flinch, still takes damage). */
  armor?: boolean;
  /** Energy cost / cooldown ticks (skills). */
  en?: number;
  cd?: number;
  special?: Special;
  /** Air move that lasts until landing (dives). */
  untilLand?: boolean;
  /** Short line shown when the move fires (skills/ults). */
  shout?: string;
  /** Enemy telegraph length before the move starts. */
  tell?: number;
}

const H = (at: number, x: [number, number], dmg: number, kind: HitKind, extra: Partial<HitDef> = {}): HitDef => ({
  at,
  len: extra.len ?? 3,
  x,
  z: extra.z ?? 22,
  y: extra.y ?? [-10, 70],
  dmg,
  kind,
  stun: extra.stun ?? (kind === "flinch" ? 18 : kind === "stagger" ? 32 : undefined),
  kb: extra.kb ?? (kind === "flinch" ? 1.4 : kind === "stagger" ? 3 : 0),
  stop: extra.stop ?? (dmg >= 60 ? 7 : dmg >= 35 ? 5 : 3),
  brk: extra.brk ?? Math.round(dmg * 0.4),
  ...extra,
});

// ---------------------------------------------------------------- heroes

export type HeroId = "red" | "blue" | "yellow" | "green" | "pink";

export interface HeroDef {
  id: HeroId;
  name: string;
  short: string;
  role: string;
  weapon: string;
  color: string;
  dark: string;
  /** Visor silhouette drawn on the helmet. */
  visor: "v" | "diamond" | "bar" | "arch" | "heart";
  hp: number;
  speed: number;
  /** Damage multiplier on everything this hero deals. */
  atk: number;
  chain: MoveDef[];
  heavy: MoveDef;
  finisher: MoveDef;
  air: MoveDef[];
  airHeavy: MoveDef;
  dashAtk: MoveDef;
  slide: MoveDef;
  skills: [MoveDef, MoveDef, MoveDef];
  ult: MoveDef;
  assist: MoveDef;
  /** Heavy-family moves carry super armor (탱커). */
  heavyArmor?: boolean;
  blurb: string;
}

const airChain = (anim: AnimKind, dmgs: number[], reach = 54): MoveDef[] =>
  dmgs.map((d, i) => ({
    id: `air${i}`,
    name: `공중 ${i + 1}타`,
    anim,
    total: 16,
    cancel: 9,
    hits: [H(5, [6, reach], d, i === dmgs.length - 1 ? "knockdown" : "flinch", { y: [-40, 70], kb: i === dmgs.length - 1 ? 5 : 0.6, lift: i === dmgs.length - 1 ? 2 : 3.6, stun: 22 })],
  }));

const dive = (name: string, dmg: number, vx: number): MoveDef => ({
  id: "dive",
  name,
  anim: "dive",
  total: 60,
  untilLand: true,
  hop: [0, -11],
  lunge: [[0, 60, vx]],
  hits: [H(2, [-6, 40], dmg, "spike", { len: 58, y: [-60, 30], z: 24, lift: -9, brk: 30 })],
});

export const HEROES: Record<HeroId, HeroDef> = {
  red: {
    id: "red",
    name: "프리즘 레드",
    short: "레드",
    role: "밸런스 · 검사",
    weapon: "프리즘 소드",
    color: "#e11d2e",
    dark: "#7f1018",
    visor: "v",
    hp: 1000,
    speed: 2.6,
    atk: 1,
    blurb: "검 4연격과 띄우기 → 점프 추격 공중 콤보의 정석. 처음이라면 레드!",
    chain: [
      { id: "l1", name: "가로베기", anim: "slashH", total: 20, cancel: 10, hits: [H(6, [8, 62], 28, "flinch")] },
      { id: "l2", name: "되베기", anim: "slashB", total: 20, cancel: 10, hits: [H(6, [8, 62], 30, "flinch")] },
      { id: "l3", name: "찌르기", anim: "thrust", total: 24, cancel: 12, lunge: [[4, 9, 2.4]], hits: [H(7, [8, 76], 34, "flinch", { kb: 2 })] },
      { id: "l4", name: "회전베기", anim: "spin", total: 34, hits: [H(8, [-30, 64], 30, "flinch", { z: 30 }), H(15, [-30, 66], 44, "knockdown", { z: 30, kb: 6.5, lift: 4.5 })] },
    ],
    heavy: { id: "h", name: "섬광 올려베기", anim: "slashUp", total: 34, cancel: 15, hits: [H(9, [6, 62], 50, "launch", { lift: 9.6, brk: 24, len: 5 })] },
    finisher: { id: "f", name: "크로스 브레이크", anim: "slashDown", total: 40, hits: [H(10, [6, 64], 40, "stagger"), H(19, [6, 70], 62, "knockdown", { kb: 8.5, lift: 3.5, brk: 34, stop: 9 })] },
    air: airChain("slashH", [24, 24, 32]),
    airHeavy: dive("메테오 다이브", 46, 3.4),
    dashAtk: { id: "da", name: "돌진 찌르기", anim: "thrust", total: 30, lunge: [[0, 14, 7]], hits: [H(3, [6, 66], 42, "knockdown", { len: 11, kb: 7, lift: 3 })] },
    slide: { id: "sl", name: "슬라이딩 베기", anim: "dash", total: 30, lunge: [[0, 16, 6]], hits: [H(3, [4, 56], 30, "launch", { len: 12, lift: 7.5, y: [-10, 30] })] },
    skills: [
      {
        id: "s1", name: "섬광 돌진베기", anim: "dash", total: 34, en: 25, cd: 240, invuln: [0, 16], shout: "섬광 돌진베기!",
        lunge: [[0, 16, 10.5]],
        hits: [H(2, [-10, 50], 30, "flinch", { z: 30 }), H(6, [-10, 50], 30, "flinch", { z: 30 }), H(10, [-10, 50], 30, "flinch", { z: 30 }), H(17, [-20, 70], 52, "knockdown", { z: 32, kb: 7, lift: 4, stop: 8 })],
      },
      {
        id: "s2", name: "승룡 베기", anim: "rise", total: 44, en: 30, cd: 300, invuln: [0, 14], shout: "승룡 베기!", hop: [3, 9.4],
        hits: [H(3, [0, 56], 40, "launch", { lift: 11, len: 4, y: [-10, 110] }), H(8, [0, 56], 40, "launch", { lift: 11.5, len: 4, y: [-10, 130] }), H(13, [0, 56], 46, "launch", { lift: 12, len: 4, y: [-10, 150], brk: 40 })],
      },
      {
        id: "s3", name: "프리즘 회전참", anim: "spin", total: 46, en: 35, cd: 420, armor: true, shout: "프리즘 회전참!",
        hits: [6, 12, 18, 24, 30].map((t) => H(t, [-74, 74], 22, "flinch", { z: 36, kb: 0.4, len: 2 })).concat([H(37, [-80, 80], 54, "knockdown", { z: 40, kb: 7, lift: 5, stop: 9 })]),
      },
    ],
    ult: {
      id: "ult", name: "레드 피닉스 슬래시", anim: "slashDown", total: 90, invuln: [0, 90], shout: "레드 피닉스 슬래시!",
      hits: [10, 18, 26, 34, 42, 50].map((t) => H(t, [0, 0], 45, "flinch", { screen: true, stun: 40, kb: 0, stop: 2, brk: 20 })).concat([H(66, [0, 0], 260, "spin", { screen: true, kb: 9, lift: 9, stop: 14, brk: 120 })]),
    },
    assist: { id: "as", name: "레드 돌진베기", anim: "dash", total: 40, lunge: [[6, 26, 13]], hits: [H(6, [-10, 60], 60, "knockdown", { len: 20, z: 40, kb: 6, lift: 4 })] },
  },
  blue: {
    id: "blue",
    name: "프리즘 블루",
    short: "블루",
    role: "스피드 · 격투가",
    weapon: "아쿠아 너클",
    color: "#1d4ed8",
    dark: "#172a6b",
    visor: "diamond",
    hp: 900,
    speed: 3.05,
    atk: 1,
    blurb: "5연타 주먹·발차기와 순보(순간이동)로 콤보 수를 쌓는 격투가. 스타일 랭크 올리기 최강.",
    chain: [
      { id: "l1", name: "잽", anim: "jab", total: 14, cancel: 7, hits: [H(4, [6, 46], 17, "flinch", { stun: 16 })] },
      { id: "l2", name: "원투", anim: "straight", total: 14, cancel: 7, hits: [H(4, [6, 48], 18, "flinch", { stun: 16 })] },
      { id: "l3", name: "훅", anim: "hook", total: 18, cancel: 9, hits: [H(6, [6, 50], 22, "flinch")] },
      { id: "l4", name: "미들킥", anim: "kick", total: 20, cancel: 11, hits: [H(7, [6, 58], 26, "flinch", { kb: 1.8 })] },
      { id: "l5", name: "회축", anim: "spinKick", total: 30, hits: [H(9, [6, 62], 42, "knockdown", { kb: 7.5, lift: 4 })] },
    ],
    heavy: { id: "h", name: "라이징 어퍼", anim: "uppercut", total: 30, cancel: 13, hits: [H(8, [6, 50], 40, "launch", { lift: 10, brk: 22, len: 4 })] },
    finisher: { id: "f", name: "붕권", anim: "straight", total: 38, lunge: [[6, 12, 4]], hits: [H(12, [6, 60], 70, "knockdown", { kb: 11, lift: 2.5, brk: 40, stop: 10 })] },
    air: airChain("kick", [18, 18, 20, 28], 50),
    airHeavy: dive("낙뢰각", 42, 5.2),
    dashAtk: { id: "da", name: "숄더 태클", anim: "dash", total: 26, lunge: [[0, 12, 7.5]], hits: [H(2, [4, 48], 38, "knockdown", { len: 11, kb: 8, lift: 3 })] },
    slide: { id: "sl", name: "슬라이딩", anim: "dash", total: 28, lunge: [[0, 14, 6.5]], hits: [H(3, [4, 52], 26, "launch", { len: 11, lift: 7.5, y: [-10, 30] })] },
    skills: [
      {
        id: "s1", name: "연환각", anim: "kick", total: 46, en: 25, cd: 210, shout: "연환각!", lunge: [[0, 36, 1.4]],
        hits: [4, 8, 12, 16, 20, 24, 28, 32].map((t) => H(t, [4, 58], 14, "flinch", { stun: 20, kb: 0.3, len: 2, stop: 2 })).concat([H(38, [4, 62], 40, "knockdown", { kb: 8, lift: 4, stop: 8 })]),
      },
      { id: "s2", name: "질풍 어퍼", anim: "uppercut", total: 40, en: 25, cd: 270, invuln: [0, 12], hop: [6, 8], shout: "질풍 어퍼!", hits: [H(5, [0, 52], 70, "launch", { lift: 12.5, brk: 40, y: [-10, 120], len: 6, stop: 8 })] },
      { id: "s3", name: "순보 백스탭", anim: "hook", total: 30, en: 20, cd: 180, invuln: [0, 10], special: "blink", shout: "순보!", hits: [H(9, [4, 54], 60, "stagger", { brk: 45, stun: 50, stop: 8 })] },
    ],
    ult: {
      id: "ult", name: "청룡 백열권", anim: "straight", total: 96, invuln: [0, 96], shout: "청룡 백열권!",
      hits: Array.from({ length: 16 }, (_, i) => H(8 + i * 4, [0, 0], 18, "flinch", { screen: true, stun: 30, kb: 0, stop: 1, brk: 10 })).concat([H(80, [0, 0], 240, "knockdown", { screen: true, kb: 12, lift: 6, stop: 14, brk: 120 })]),
    },
    assist: { id: "as", name: "블루 연속 차기", anim: "spinKick", total: 44, lunge: [[4, 30, 6]], hits: [6, 12, 18, 24].map((t) => H(t, [-20, 60], 18, "flinch", { z: 40, len: 3 })).concat([H(32, [-20, 64], 40, "launch", { z: 40, lift: 9 })]) },
  },
  yellow: {
    id: "yellow",
    name: "프리즘 옐로",
    short: "옐로",
    role: "원거리 · 사수",
    weapon: "프리즘 블래스터",
    color: "#eab308",
    dark: "#7a5a05",
    visor: "bar",
    hp: 850,
    speed: 2.7,
    atk: 1,
    blurb: "거리를 벌리고 쏘는 사수. 저격병·폭탄병을 먼저 지우고, 수류탄으로 무리를 띄운다.",
    chain: [
      { id: "l1", name: "속사", anim: "shoot", total: 14, cancel: 8, hits: [], proj: [{ at: 4, kind: "shot", dx: 30, dy: 38, vx: 11, life: 40, hit: { r: 12, dmg: 18, kind: "flinch", stun: 16, kb: 1, stop: 2, brk: 6, z: 18 } }] },
      { id: "l2", name: "속사", anim: "shoot", total: 14, cancel: 8, hits: [], proj: [{ at: 4, kind: "shot", dx: 30, dy: 38, vx: 11, life: 40, hit: { r: 12, dmg: 18, kind: "flinch", stun: 16, kb: 1, stop: 2, brk: 6, z: 18 } }] },
      { id: "l3", name: "더블샷", anim: "shoot", total: 20, cancel: 11, hits: [], proj: [4, 9].map((at) => ({ at, kind: "shot" as const, dx: 30, dy: 38, vx: 11, life: 40, hit: { r: 12, dmg: 18, kind: "flinch" as const, stun: 18, kb: 1, stop: 2, brk: 6, z: 18 } })) },
      { id: "l4", name: "차지 블래스트", anim: "shoot", total: 30, hits: [], proj: [{ at: 10, kind: "shot", dx: 32, dy: 38, vx: 12, life: 40, pierce: true, hit: { r: 18, dmg: 44, kind: "knockdown", kb: 6, lift: 3, stop: 6, brk: 22, z: 22 } }] },
    ],
    heavy: { id: "h", name: "개머리판 어퍼", anim: "uppercut", total: 30, cancel: 13, hits: [H(8, [6, 48], 36, "launch", { lift: 9.8, brk: 20 })] },
    finisher: {
      id: "f", name: "스프레드 샷", anim: "shoot", total: 32, hits: [],
      proj: [{ at: 8, kind: "shot", dx: 30, dy: 38, vx: 11, life: 34, fanZ: [-28, 28], pierce: true, hit: { r: 14, dmg: 34, kind: "knockdown", kb: 5, lift: 3, stop: 4, brk: 16, z: 18 } }],
    },
    air: [0, 1, 2].map((i) => ({ id: `air${i}`, name: "공중 사격", anim: "shoot" as const, total: 14, cancel: 8, hits: [], proj: [{ at: 4, kind: "shot" as const, dx: 26, dy: 30, vx: 10, vy: -2.2, life: 36, hit: { r: 14, dmg: 20, kind: "flinch" as const, stun: 22, kb: 0.5, lift: 3.4, stop: 2, brk: 6, z: 20 } }] })),
    airHeavy: { id: "dive", name: "공중 폭격", anim: "throw", total: 26, hits: [], proj: [{ at: 6, kind: "grenade", dx: 10, dy: 20, vx: 2.5, vy: -1, life: 80, blast: 60, hit: { r: 14, dmg: 60, kind: "launch", lift: 8, stop: 6, brk: 30, z: 30 } }] },
    dashAtk: { id: "da", name: "슬라이드 샷", anim: "shoot", total: 30, lunge: [[0, 14, 6]], hits: [], proj: [{ at: 6, kind: "shot", dx: 30, dy: 26, vx: 12, life: 40, pierce: true, hit: { r: 16, dmg: 36, kind: "knockdown", kb: 6, lift: 3, stop: 5, brk: 16, z: 20 } }] },
    slide: { id: "sl", name: "로우 킥", anim: "kick", total: 26, lunge: [[0, 12, 6]], hits: [H(3, [4, 50], 26, "launch", { len: 10, lift: 7.5, y: [-10, 30] })] },
    skills: [
      {
        id: "s1", name: "차지 빔", anim: "shoot", total: 56, en: 30, cd: 300, shout: "차지 빔!", hits: [],
        proj: [{ at: 18, kind: "beam", dx: 30, dy: 38, vx: 0, life: 30, pierce: true, hit: { r: 18, dmg: 26, kind: "flinch", stun: 30, kb: 1.5, stop: 2, brk: 14, z: 22 } }],
      },
      { id: "s2", name: "그레네이드", anim: "throw", total: 30, en: 20, cd: 200, shout: "그레네이드!", hits: [], proj: [{ at: 8, kind: "grenade", dx: 20, dy: 50, vx: 5.6, vy: 6.5, life: 120, blast: 70, hit: { r: 14, dmg: 64, kind: "launch", lift: 9.5, stop: 7, brk: 36, z: 34 } }] },
      {
        id: "s3", name: "백스텝 3연사", anim: "shoot", total: 36, en: 15, cd: 150, invuln: [0, 14], shout: "백스텝 샷!", lunge: [[0, 10, -6]], hop: [0, 4],
        hits: [], proj: [8, 14, 20].map((at) => ({ at, kind: "shot" as const, dx: 30, dy: 38, vx: 12, life: 40, hit: { r: 14, dmg: 30, kind: "stagger" as const, stun: 26, kb: 2.5, stop: 3, brk: 12, z: 22 } })),
      },
    ],
    ult: {
      id: "ult", name: "썬더 캐논", anim: "shoot", total: 100, invuln: [0, 100], shout: "썬더 캐논 — 발사!",
      hits: Array.from({ length: 12 }, (_, i) => H(24 + i * 5, [0, 0], 24, "flinch", { screen: true, stun: 30, kb: 0.6, stop: 1, brk: 12 })).concat([H(88, [0, 0], 220, "knockdown", { screen: true, kb: 10, lift: 6, stop: 14, brk: 110 })]),
    },
    assist: { id: "as", name: "옐로 포격", anim: "throw", total: 40, hits: [], proj: [6, 12, 18].map((at, i) => ({ at, kind: "grenade" as const, dx: 20, dy: 50, vx: 3.6 + i * 1.6, vy: 7, life: 120, blast: 64, hit: { r: 14, dmg: 50, kind: "launch" as const, lift: 9, stop: 5, brk: 30, z: 36 } })) },
  },
  green: {
    id: "green",
    name: "프리즘 그린",
    short: "그린",
    role: "파워 · 탱커",
    weapon: "가이아 해머",
    color: "#16a34a",
    dark: "#0b4d24",
    visor: "arch",
    hp: 1300,
    speed: 2.2,
    atk: 1.08,
    heavyArmor: true,
    blurb: "느리지만 묵직하다. 강공격 중엔 슈퍼아머로 맞아도 밀리지 않고, 자이언트 스윙으로 졸개를 무기 삼아 휘두른다.",
    chain: [
      { id: "l1", name: "해머 휘두르기", anim: "slashH", total: 26, cancel: 14, hits: [H(10, [10, 66], 40, "flinch", { stun: 24 })] },
      { id: "l2", name: "되치기", anim: "slashB", total: 26, cancel: 14, hits: [H(10, [10, 66], 42, "flinch", { stun: 24 })] },
      { id: "l3", name: "내려찍기", anim: "slam", total: 36, hits: [H(14, [10, 70], 64, "knockdown", { kb: 3, lift: 6, brk: 36, z: 28 })] },
    ],
    heavy: { id: "h", name: "올려치기", anim: "slashUp", total: 38, cancel: 18, armor: true, hits: [H(12, [8, 64], 60, "launch", { lift: 10, brk: 34, len: 5 })] },
    finisher: { id: "f", name: "대회전", anim: "spin", total: 46, armor: true, hits: [H(12, [-60, 70], 46, "stagger", { z: 34 }), H(22, [-60, 74], 70, "knockdown", { z: 36, kb: 9, lift: 4, brk: 40, stop: 10 })] },
    air: airChain("slashDown", [32, 40], 60),
    airHeavy: { ...dive("대지 낙하", 60, 1.6), hits: [H(2, [-30, 50], 60, "spike", { len: 58, y: [-60, 30], z: 30, lift: -9, brk: 40 })] },
    dashAtk: { id: "da", name: "숄더 차지", anim: "dash", total: 34, armor: true, lunge: [[0, 16, 6.5]], hits: [H(2, [4, 56], 46, "knockdown", { len: 14, kb: 8, lift: 3 })] },
    slide: { id: "sl", name: "해머 쓸기", anim: "slashUp", total: 34, lunge: [[0, 10, 4]], hits: [H(6, [4, 62], 38, "launch", { len: 8, lift: 8, y: [-10, 30] })] },
    skills: [
      { id: "s1", name: "대지 강타", anim: "slam", total: 40, en: 25, cd: 240, armor: true, shout: "대지 강타!", hits: [H(14, [0, 60], 50, "launch", { lift: 8, z: 34 })], proj: [{ at: 14, kind: "wave", dx: 60, dy: 0, vx: 7, life: 50, pierce: true, hit: { r: 22, dmg: 46, kind: "launch", lift: 8.5, stop: 4, brk: 26, z: 26 } }] },
      {
        id: "s2", name: "자이언트 스윙", anim: "grab", total: 80, en: 30, cd: 330, armor: true, special: "grabThrow", shout: "자이언트 스윙!",
        hits: [H(6, [4, 54], 20, "grab", { len: 6, stun: 70, stop: 4 })].concat([22, 32, 42, 52, 62].map((t) => H(t, [-84, 84], 30, "knockdown", { z: 44, kb: 7, lift: 4, len: 2 }))),
      },
      { id: "s3", name: "철벽", anim: "guard", total: 34, en: 25, cd: 600, special: "ironWall", shout: "철벽!", hits: [H(10, [-60, 60], 30, "knockdown", { z: 40, kb: 7, lift: 3 })] },
    ],
    ult: {
      id: "ult", name: "가이아 브레이크", anim: "slam", total: 96, invuln: [0, 96], shout: "가이아 브레이크!",
      hits: [H(30, [0, 0], 90, "launch", { screen: true, lift: 10, stop: 8, brk: 50 }), H(52, [0, 0], 90, "launch", { screen: true, lift: 9, stop: 8, brk: 50 }), H(76, [0, 0], 200, "spike", { screen: true, lift: -10, stop: 14, brk: 100 })],
    },
    assist: { id: "as", name: "그린 지진", anim: "slam", total: 46, hits: [H(22, [0, 0], 60, "launch", { screen: true, lift: 9, brk: 30 })] },
  },
  pink: {
    id: "pink",
    name: "프리즘 핑크",
    short: "핑크",
    role: "서포트 · 궁수",
    weapon: "하트 리본 & 보우",
    color: "#ec4899",
    dark: "#80184c",
    visor: "heart",
    hp: 850,
    speed: 2.8,
    atk: 1,
    blurb: "리본 채찍의 긴 사거리와 회복. 힐링 하트로 버티며 리본 바인드로 보스를 묶는다.",
    chain: [
      { id: "l1", name: "리본 채찍", anim: "whip", total: 18, cancel: 9, hits: [H(6, [10, 80], 20, "flinch", { z: 18 })] },
      { id: "l2", name: "리본 채찍", anim: "whip", total: 18, cancel: 9, hits: [H(6, [10, 80], 20, "flinch", { z: 18 })] },
      { id: "l3", name: "리본 회오리", anim: "spin", total: 24, cancel: 12, hits: [H(8, [-50, 70], 26, "flinch", { z: 30 })] },
      { id: "l4", name: "하트 애로우", anim: "shoot", total: 28, hits: [], proj: [{ at: 10, kind: "arrow", dx: 30, dy: 40, vx: 12, life: 40, pierce: true, hit: { r: 14, dmg: 38, kind: "knockdown", kb: 6, lift: 3, stop: 5, brk: 16, z: 20 } }] },
    ],
    heavy: { id: "h", name: "리본 리프트", anim: "whip", total: 32, cancel: 14, hits: [H(9, [10, 80], 34, "launch", { lift: 9.8, brk: 20, len: 4 })] },
    finisher: { id: "f", name: "리본 끌어당기기", anim: "whip", total: 40, hits: [H(10, [20, 120], 30, "stagger", { pull: true, kb: 5, stun: 40 }), H(24, [6, 60], 50, "knockdown", { kb: 7, lift: 4, brk: 30 })] },
    air: [0, 1, 2].map((i) => ({ id: `air${i}`, name: "공중 화살", anim: "shoot" as const, total: 14, cancel: 8, hits: [], proj: [{ at: 4, kind: "arrow" as const, dx: 26, dy: 30, vx: 10, vy: -2.4, life: 36, hit: { r: 14, dmg: 20, kind: "flinch" as const, stun: 22, kb: 0.5, lift: 3.4, stop: 2, brk: 6, z: 20 } }] })),
    airHeavy: dive("하트 다이브", 40, 3.6),
    dashAtk: { id: "da", name: "리본 돌진", anim: "whip", total: 30, lunge: [[0, 12, 6.5]], hits: [H(4, [10, 84], 36, "knockdown", { len: 8, kb: 7, lift: 3 })] },
    slide: { id: "sl", name: "슬라이딩", anim: "dash", total: 28, lunge: [[0, 14, 6.5]], hits: [H(3, [4, 52], 26, "launch", { len: 11, lift: 7.5, y: [-10, 30] })] },
    skills: [
      { id: "s1", name: "3연발 화살", anim: "shoot", total: 30, en: 20, cd: 180, shout: "트리플 애로우!", hits: [], proj: [{ at: 8, kind: "arrow", dx: 30, dy: 40, vx: 12, life: 46, fanZ: [-30, 30], pierce: true, hit: { r: 14, dmg: 44, kind: "knockdown", kb: 5, lift: 3, stop: 5, brk: 20, z: 18 } }] },
      { id: "s2", name: "힐링 하트", anim: "heal", total: 50, en: 40, cd: 720, invuln: [0, 60], special: "heal", shout: "힐링 하트!", hits: [H(12, [-70, 70], 20, "knockdown", { z: 44, kb: 7, lift: 3 })] },
      { id: "s3", name: "리본 바인드", anim: "whip", total: 40, en: 25, cd: 300, shout: "리본 바인드!", hits: [H(12, [10, 240], 30, "bind", { stun: 130, z: 26, len: 4, brk: 40, kb: 0, stop: 6 })] },
    ],
    ult: {
      id: "ult", name: "러브 스톰", anim: "shootUp", total: 100, invuln: [0, 100], special: "heal", shout: "러브 스톰!",
      hits: Array.from({ length: 10 }, (_, i) => H(24 + i * 6, [0, 0], 30, "flinch", { screen: true, stun: 30, kb: 0, stop: 1, brk: 14 })).concat([H(88, [0, 0], 180, "knockdown", { screen: true, kb: 8, lift: 6, stop: 12, brk: 90 })]),
    },
    assist: { id: "as", name: "핑크 회복 화살", anim: "shootUp", total: 40, special: "heal", hits: [], proj: [{ at: 8, kind: "arrow", dx: 30, dy: 40, vx: 12, life: 50, fanZ: [-30, 30], pierce: true, hit: { r: 14, dmg: 40, kind: "knockdown", kb: 5, lift: 3, stop: 4, brk: 16, z: 18 } }] },
  },
};

export const HERO_ORDER: HeroId[] = ["red", "blue", "yellow", "green", "pink"];

/** 5인 합체포 (assist gauge 3 stocks). */
export const TEAM_ULT: MoveDef = {
  id: "team",
  name: "프리즘 블래스터",
  anim: "pose",
  total: 130,
  invuln: [0, 130],
  shout: "5인 합체 — 프리즘 블래스터!",
  hits: Array.from({ length: 8 }, (_, i) => H(60 + i * 5, [0, 0], 40, "flinch", { screen: true, stun: 40, kb: 0, stop: 1, brk: 24 })).concat([H(110, [0, 0], 420, "spin", { screen: true, kb: 12, lift: 10, stop: 18, brk: 200 })]),
};

// ---------------------------------------------------------------- mecha (giant battle)

export interface MechaDef {
  name: string;
  hp: number;
  speed: number;
  chain: MoveDef[];
  heavy: MoveDef;
  rocket: MoveDef;
  finish: MoveDef;
}

export const MECHA: MechaDef = {
  name: "프리즘 킹로보",
  hp: 2600,
  speed: 2.2,
  chain: [
    { id: "m1", name: "킹 펀치", anim: "jab", total: 26, cancel: 14, hits: [H(9, [20, 150], 80, "flinch", { z: 80, y: [-10, 300], stun: 22, kb: 1, stop: 6 })] },
    { id: "m2", name: "킹 훅", anim: "hook", total: 28, cancel: 15, hits: [H(10, [20, 150], 90, "flinch", { z: 80, y: [-10, 300], stun: 24, kb: 1.4, stop: 7 })] },
    { id: "m3", name: "킹 소드 베기", anim: "slashDown", total: 40, hits: [H(16, [20, 190], 150, "stagger", { z: 80, y: [-10, 320], kb: 4, stop: 10, brk: 60 })] },
  ],
  heavy: { id: "mh", name: "킹 소드 올려베기", anim: "slashUp", total: 44, hits: [H(16, [20, 200], 170, "stagger", { z: 80, y: [-10, 340], kb: 3, stop: 10, brk: 80 })] },
  rocket: {
    id: "mr", name: "로켓 펀치", anim: "straight", total: 40, en: 25, cd: 240, shout: "로켓 펀치!", hits: [],
    proj: [{ at: 12, kind: "fist", dx: 90, dy: 140, vx: 9, life: 70, hit: { r: 60, dmg: 200, kind: "stagger", stun: 40, kb: 3, stop: 10, brk: 90, z: 80 } }],
  },
  finish: {
    id: "mf", name: "섬광 일도양단", anim: "slashDown", total: 150, invuln: [0, 150], shout: "필살 — 섬광 일도양단!",
    hits: [H(110, [0, 0], 99999, "spin", { screen: true, stop: 20, brk: 999 })],
  },
};
/** The finisher becomes available once the giant drops to this HP ratio. */
export const MECHA_FINISH_AT = 0.25;

// ---------------------------------------------------------------- enemies

export type EnemyId = "grunt" | "lancer" | "shield" | "bomber" | "drone" | "sniper" | "elite";

export interface EnemyDef {
  id: EnemyId;
  name: string;
  hp: number;
  speed: number;
  /** Preferred distance (x) from the hero while waiting / attacking. */
  range: [number, number];
  moves: MoveDef[];
  score: number;
  /** Front guard (방패병): frontal hits without guardBreak are blocked. */
  frontGuard?: boolean;
  /** Super armor while attacking. */
  armorOnAttack?: boolean;
  breakMax?: number;
  /** Self-destruct (자폭병): explodes when close. */
  fuse?: number;
  color: string;
  blurb: string;
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  grunt: {
    id: "grunt", name: "다크 졸개", hp: 140, speed: 1.6, range: [34, 48], score: 100, color: "#3f3f46",
    blurb: "가장 흔한 전투원. 2연타 펀치. 혼자선 약하지만 둘러싸이면 아프다.",
    moves: [
      { id: "punch", name: "펀치", anim: "jab", total: 30, tell: 20, hits: [H(8, [6, 48], 42, "flinch", { stun: 20 })] },
      { id: "combo", name: "2연타", anim: "hook", total: 40, tell: 22, hits: [H(8, [6, 48], 30, "flinch", { stun: 18 }), H(20, [6, 50], 36, "stagger", { kb: 3 })] },
    ],
  },
  lancer: {
    id: "lancer", name: "다크 창병", hp: 170, speed: 1.4, range: [70, 90], score: 150, color: "#475569",
    blurb: "긴 창으로 멀리서 찌른다. 빨간 ! 가 뜨면 옆 라인으로 비키거나 회피.",
    moves: [{ id: "lunge", name: "돌격 찌르기", anim: "thrust", total: 40, tell: 26, lunge: [[6, 14, 4.5]], hits: [H(10, [10, 96], 58, "stagger", { kb: 4, z: 16 })] }],
  },
  shield: {
    id: "shield", name: "다크 방패병", hp: 240, speed: 1.2, range: [36, 50], score: 200, color: "#52525b", frontGuard: true,
    blurb: "정면 공격을 막는다. 강공격·띄우기·다운 공격으로 방패를 깨거나 등 뒤를 노려라.",
    moves: [{ id: "bash", name: "방패 밀치기", anim: "straight", total: 40, tell: 24, lunge: [[6, 12, 3]], hits: [H(10, [6, 54], 50, "knockdown", { kb: 6, lift: 3 })] }],
  },
  bomber: {
    id: "bomber", name: "다크 폭탄병", hp: 110, speed: 1.5, range: [170, 230], score: 150, color: "#78350f",
    blurb: "멀리서 폭탄을 던진다. 그림자가 떨어질 자리를 알려준다.",
    moves: [{ id: "toss", name: "폭탄 투척", anim: "throw", total: 40, tell: 24, hits: [], proj: [{ at: 10, kind: "bomb", dx: 10, dy: 50, vx: 0, vy: 7.5, life: 140, blast: 54, hit: { r: 12, dmg: 66, kind: "launch", lift: 7.5, stop: 5, brk: 0, z: 30 } }] }],
  },
  drone: {
    id: "drone", name: "자폭 드론병", hp: 70, speed: 3.1, range: [0, 24], score: 120, color: "#b91c1c", fuse: 54,
    blurb: "달려와 터진다. 날려 보내면 다른 적 사이에서 폭발한다(적에게도 피해).",
    moves: [],
  },
  sniper: {
    id: "sniper", name: "다크 저격병", hp: 130, speed: 1.3, range: [260, 330], score: 220, color: "#1e3a8a",
    blurb: "붉은 조준선이 고정된 뒤 쏜다. 라인을 바꾸거나 섬광 회피로 피하자.",
    moves: [{ id: "snipe", name: "저격", anim: "shoot", total: 30, tell: 70, hits: [], proj: [{ at: 4, kind: "laser", dx: 26, dy: 40, vx: 22, life: 40, pierce: true, hit: { r: 14, dmg: 130, kind: "knockdown", kb: 6, lift: 3, stop: 8, brk: 0, z: 14 } }] }],
  },
  elite: {
    id: "elite", name: "근위대장 가르곤", hp: 720, speed: 1.9, range: [40, 56], score: 900, color: "#7e22ce", armorOnAttack: true, breakMax: 180,
    blurb: "공격 중엔 슈퍼아머. 브레이크 게이지를 깨면 다운된다.",
    moves: [
      { id: "triple", name: "3연격", anim: "hook", total: 56, tell: 22, hits: [H(8, [6, 56], 46, "flinch"), H(20, [6, 56], 46, "flinch"), H(34, [6, 64], 76, "knockdown", { kb: 7, lift: 4 })] },
      { id: "dashp", name: "돌진 강타", anim: "dash", total: 44, tell: 30, lunge: [[4, 22, 7.5]], hits: [H(6, [6, 56], 80, "knockdown", { len: 16, kb: 8, lift: 4 })] },
    ],
  },
};

// ---------------------------------------------------------------- bosses

export type BossId = "hornbuster" | "mirage" | "crabton" | "darkshadow" | "nemesis";

export interface BossPattern {
  move: MoveDef;
  /** Phases (1..3) this pattern is used in. */
  phases: number[];
  weight: number;
  /** Only when the hero is within this x distance (melee patterns). */
  near?: number;
  cooldown: number;
}

export interface BossDef {
  id: BossId;
  name: string;
  title: string;
  hp: number;
  breakMax: number;
  speed: number;
  /** Visual scale vs a hero. */
  scale: number;
  color: string;
  accent: string;
  patterns: BossPattern[];
  intro: string;
  /** Giant phase. */
  giantHp: number;
  giantMoves: MoveDef[];
  score: number;
}

const G = (at: number, dmg: number, kind: HitKind, extra: Partial<HitDef> = {}) => H(at, extra.x ?? [20, 200], dmg, kind, { z: 80, y: [-10, 360], ...extra });

const giantSet = (pow: number): MoveDef[] => [
  { id: "gs", name: "거대 할퀴기", anim: "slashH", total: 54, tell: 34, hits: [G(10, 150 * pow, "stagger", { kb: 4 })] },
  { id: "gc", name: "거대 돌진", anim: "charge", total: 70, tell: 44, lunge: [[0, 40, 6]], hits: [G(2, 190 * pow, "knockdown", { len: 40, kb: 8, lift: 4, x: [0, 150] })] },
  { id: "gb", name: "괴광선", anim: "cast", total: 76, tell: 46, hits: [], proj: [{ at: 10, kind: "beam", dx: 120, dy: 200, vx: 0, life: 40, pierce: true, hit: { r: 70, dmg: 46 * pow, kind: "flinch", stun: 30, kb: 1, stop: 3, brk: 0, z: 90 } }] },
  { id: "gp", name: "대지 짓밟기", anim: "slam", total: 64, tell: 40, hits: [G(22, 170 * pow, "knockdown", { x: [-240, 260], kb: 6, lift: 5 })] },
];

export const BOSSES: Record<BossId, BossDef> = {
  hornbuster: {
    id: "hornbuster", name: "혼버스터", title: "돌격괴인", hp: 3200, breakMax: 380, speed: 1.9, scale: 1.45, color: "#92400e", accent: "#fbbf24", score: 8000,
    intro: "뿔로 들이받아 산을 무너뜨린 돌격괴인! 돌진이 벽에 부딪히면 기절한다.",
    giantHp: 2600, giantMoves: giantSet(1),
    patterns: [
      { phases: [1, 2, 3], weight: 3, near: 90, cooldown: 60, move: { id: "swipe", name: "뿔 휘두르기", anim: "hook", total: 46, tell: 24, hits: [H(10, [6, 80], 90, "stagger", { z: 30, kb: 5 })] } },
      { phases: [1, 2, 3], weight: 2, cooldown: 170, move: { id: "charge", name: "맹돌진", anim: "charge", total: 100, tell: 40, special: "charge", hits: [H(0, [-10, 70], 140, "knockdown", { len: 100, z: 26, kb: 9, lift: 5, stop: 9 })] } },
      { phases: [1, 2, 3], weight: 2, cooldown: 200, move: { id: "slam", name: "대지 붕괴", anim: "slam", total: 70, tell: 34, hop: [4, 9], hits: [H(30, [-70, 70], 100, "knockdown", { z: 40, kb: 6, lift: 5, len: 6 })], proj: [{ at: 32, kind: "wave", dx: 40, dy: 0, vx: 6, life: 70, fanZ: [], pierce: true, hit: { r: 18, dmg: 80, kind: "launch", lift: 8, stop: 5, brk: 0, z: 30 } }, { at: 32, kind: "wave", dx: -40, dy: 0, vx: -6, life: 70, pierce: true, hit: { r: 18, dmg: 80, kind: "launch", lift: 8, stop: 5, brk: 0, z: 30 } }] } },
      { phases: [3], weight: 2, cooldown: 300, move: { id: "rocks", name: "낙석 소환", anim: "roar", total: 80, tell: 30, special: "rockRain", hits: [] } },
    ],
  },
  mirage: {
    id: "mirage", name: "미라쥬", title: "환영괴인", hp: 3000, breakMax: 340, speed: 2.2, scale: 1.3, color: "#6d28d9", accent: "#e9d5ff", score: 9000,
    intro: "거울 속에서 나타나는 환영괴인! 그림자가 진한 쪽이 진짜다.",
    giantHp: 2700, giantMoves: giantSet(1.05),
    patterns: [
      { phases: [1, 2, 3], weight: 2, near: 80, cooldown: 70, move: { id: "claw", name: "거울 손톱", anim: "slashH", total: 40, tell: 20, hits: [H(9, [6, 70], 70, "stagger", { z: 26 })] } },
      { phases: [1, 2, 3], weight: 3, cooldown: 110, move: { id: "orbs", name: "환영구", anim: "cast", total: 50, tell: 24, hits: [], proj: [{ at: 14, kind: "orb", dx: 30, dy: 50, vx: 4.2, life: 120, fanZ: [-36, 36], hit: { r: 16, dmg: 62, kind: "knockdown", kb: 5, lift: 3, stop: 5, brk: 0, z: 18 } }] } },
      { phases: [1, 2, 3], weight: 2, cooldown: 150, move: { id: "tele", name: "순간이동", anim: "cast", total: 40, tell: 10, special: "teleport", hits: [H(26, [6, 70], 80, "knockdown", { z: 30, kb: 6, lift: 4 })] } },
      { phases: [2, 3], weight: 2, cooldown: 420, move: { id: "clones", name: "분신술", anim: "roar", total: 50, tell: 20, special: "clones", hits: [] } },
      { phases: [3], weight: 2, cooldown: 260, move: { id: "mbeam", name: "미러 빔", anim: "cast", total: 90, tell: 50, hits: [], proj: [{ at: 4, kind: "beam", dx: 30, dy: 50, vx: 0, life: 50, pierce: true, hit: { r: 22, dmg: 34, kind: "flinch", stun: 26, kb: 1.6, stop: 2, brk: 0, z: 22 } }] } },
    ],
  },
  crabton: {
    id: "crabton", name: "크랩톤", title: "강철괴인", hp: 3800, breakMax: 480, speed: 1.5, scale: 1.55, color: "#9f1239", accent: "#fda4af", score: 10000,
    intro: "강철 집게의 괴인! 가드 자세일 땐 정면이 무적 — 뒤로 돌아가라.",
    giantHp: 3000, giantMoves: giantSet(1.1),
    patterns: [
      { phases: [1, 2, 3], weight: 3, near: 90, cooldown: 70, move: { id: "claws", name: "집게 연타", anim: "hook", total: 54, tell: 22, hits: [H(10, [6, 84], 76, "flinch", { z: 30, stun: 26 }), H(26, [6, 88], 96, "knockdown", { z: 30, kb: 7, lift: 4 })] } },
      { phases: [1, 2, 3], weight: 2, near: 70, cooldown: 220, move: { id: "grab", name: "강철 조이기", anim: "grab", total: 60, tell: 30, hits: [H(10, [6, 70], 30, "grab", { len: 8, z: 24, stun: 100, stop: 6 })] } },
      { phases: [1, 2, 3], weight: 2, cooldown: 360, move: { id: "guard", name: "강철 가드", anim: "guard", total: 140, tell: 10, special: "guard", hits: [] } },
      { phases: [2, 3], weight: 2, cooldown: 160, move: { id: "bubbles", name: "거품 포격", anim: "cast", total: 56, tell: 24, hits: [], proj: [{ at: 12, kind: "bubble", dx: 40, dy: 60, vx: 3.4, life: 140, fanZ: [-40, -16, 16, 40], hit: { r: 16, dmg: 50, kind: "flinch", stun: 30, kb: 2, stop: 3, brk: 0, z: 16 } }] } },
    ],
  },
  darkshadow: {
    id: "darkshadow", name: "다크섀도", title: "흑기사", hp: 3600, breakMax: 420, speed: 2.6, scale: 1.2, color: "#18181b", accent: "#a5b4fc", score: 12000,
    intro: "프리즘파이브의 숙적 흑기사! 푸른 섬광 자세(패리)를 때리면 반격당한다.",
    giantHp: 3000, giantMoves: giantSet(1.15),
    patterns: [
      { phases: [1, 2, 3], weight: 3, near: 90, cooldown: 60, move: { id: "combo", name: "흑검 3연참", anim: "slashH", total: 60, tell: 18, hits: [H(8, [6, 74], 66, "flinch", { z: 28, stun: 24 }), H(22, [6, 74], 66, "flinch", { z: 28, stun: 24 }), H(38, [6, 84], 106, "knockdown", { z: 30, kb: 8, lift: 4 })] } },
      { phases: [1, 2, 3], weight: 2, cooldown: 150, move: { id: "dashcut", name: "섬영참", anim: "dash", total: 50, tell: 26, lunge: [[0, 20, 12]], invuln: [0, 20], hits: [H(0, [-20, 60], 120, "knockdown", { len: 22, z: 26, kb: 7, lift: 5, stop: 8 })] } },
      { phases: [1, 2, 3], weight: 2, cooldown: 300, move: { id: "parry", name: "흑월 패리", anim: "guard", total: 80, tell: 8, special: "parry", hits: [] } },
      { phases: [3], weight: 2, cooldown: 340, move: { id: "shades", name: "그림자 십자참", anim: "roar", total: 90, tell: 30, special: "pillars", hits: [] } },
    ],
  },
  nemesis: {
    id: "nemesis", name: "네메시스", title: "암흑황제", hp: 6200, breakMax: 640, speed: 1.6, scale: 1.7, color: "#3b0764", accent: "#facc15", score: 20000,
    intro: "암흑제국의 황제! 3단계에서 다크 블래스트를 모으면 브레이크로 끊거나 섬광 회피로 버텨라.",
    giantHp: 3800, giantMoves: giantSet(1.25),
    patterns: [
      { phases: [1, 2, 3], weight: 3, near: 100, cooldown: 70, move: { id: "scepter", name: "제왕의 홀", anim: "slashH", total: 50, tell: 22, hits: [H(12, [6, 96], 96, "knockdown", { z: 34, kb: 7, lift: 4 })] } },
      { phases: [1, 2, 3], weight: 3, cooldown: 130, move: { id: "dorbs", name: "암흑구", anim: "cast", total: 56, tell: 24, hits: [], proj: [{ at: 14, kind: "orb", dx: 30, dy: 70, vx: 3.2, life: 170, home: 0.09, fanZ: [-30, 30], hit: { r: 18, dmg: 82, kind: "knockdown", kb: 5, lift: 3, stop: 5, brk: 0, z: 18 } }] } },
      { phases: [1, 2, 3], weight: 2, cooldown: 240, move: { id: "pillars", name: "낙뢰 기둥", anim: "roar", total: 90, tell: 20, special: "pillars", hits: [] } },
      { phases: [2, 3], weight: 1, cooldown: 600, move: { id: "summon", name: "근위대 소환", anim: "roar", total: 60, tell: 20, special: "summon", hits: [] } },
      { phases: [3], weight: 3, cooldown: 700, move: { id: "dblast", name: "다크 블래스트", anim: "charge", total: 200, tell: 10, special: "darkBlast", hits: [] } },
    ],
  },
};

// ---------------------------------------------------------------- stages

export type Theme = "quarry" | "city" | "factory" | "fortress" | "throne";

export interface SpawnGroup {
  enemies: EnemyId[];
  /** Spawn the next group when at most this many foes are left. */
  when?: number;
}

export interface WaveDef {
  /** Hero x that triggers the lock. */
  at: number;
  groups: SpawnGroup[];
  boss?: BossId;
  crates?: number;
}

export interface StageDef {
  id: number;
  name: string;
  sub: string;
  theme: Theme;
  length: number;
  waves: WaveDef[];
  /** Par clear time in seconds (rank + time bonus). */
  par: number;
  /** Stage hazard: periodic steam vents (제철소). */
  vents?: boolean;
}

export const STAGES: StageDef[] = [
  {
    id: 1, name: "STAGE 1 · 채석장", sub: "돌격괴인 혼버스터 출현!", theme: "quarry", length: 2800, par: 210,
    waves: [
      { at: 380, groups: [{ enemies: ["grunt", "grunt", "grunt"] }], crates: 1 },
      { at: 980, groups: [{ enemies: ["grunt", "grunt", "lancer"] }, { enemies: ["grunt", "grunt"], when: 1 }] },
      { at: 1600, groups: [{ enemies: ["grunt", "bomber", "grunt"] }, { enemies: ["lancer", "grunt", "bomber"], when: 1 }], crates: 2 },
      { at: 2420, groups: [{ enemies: [] }], boss: "hornbuster" },
    ],
  },
  {
    id: 2, name: "STAGE 2 · 도심 야경", sub: "환영괴인 미라쥬의 습격", theme: "city", length: 3200, par: 250,
    waves: [
      { at: 380, groups: [{ enemies: ["grunt", "grunt", "shield"] }, { enemies: ["grunt", "drone"], when: 1 }], crates: 1 },
      { at: 1100, groups: [{ enemies: ["shield", "lancer", "grunt"] }, { enemies: ["drone", "drone", "grunt"], when: 1 }] },
      { at: 1850, groups: [{ enemies: ["elite"] }, { enemies: ["grunt", "grunt"], when: 1 }], crates: 2 },
      { at: 2400, groups: [{ enemies: ["bomber", "shield", "grunt", "grunt"] }, { enemies: ["drone", "lancer", "grunt"], when: 2 }] },
      { at: 2820, groups: [{ enemies: [] }], boss: "mirage" },
    ],
  },
  {
    id: 3, name: "STAGE 3 · 제철소", sub: "강철괴인 크랩톤 — 증기 배관 주의", theme: "factory", length: 3400, par: 300, vents: true,
    waves: [
      { at: 400, groups: [{ enemies: ["grunt", "shield", "sniper"] }, { enemies: ["grunt", "grunt", "drone"], when: 1 }], crates: 1 },
      { at: 1150, groups: [{ enemies: ["lancer", "lancer", "bomber"] }, { enemies: ["shield", "sniper", "grunt"], when: 1 }] },
      { at: 1900, groups: [{ enemies: ["elite", "grunt"] }, { enemies: ["drone", "drone", "sniper"], when: 1 }], crates: 2 },
      { at: 2550, groups: [{ enemies: ["shield", "shield", "bomber", "grunt"] }, { enemies: ["elite"], when: 1 }] },
      { at: 3020, groups: [{ enemies: [] }], boss: "crabton" },
    ],
  },
  {
    id: 4, name: "STAGE 4 · 악의 요새", sub: "숙적 흑기사 다크섀도", theme: "fortress", length: 3600, par: 320,
    waves: [
      { at: 400, groups: [{ enemies: ["grunt", "grunt", "lancer", "shield"] }, { enemies: ["sniper", "drone", "grunt"], when: 1 }], crates: 1 },
      { at: 1200, groups: [{ enemies: ["elite", "bomber"] }, { enemies: ["elite"], when: 1 }] },
      { at: 2000, groups: [{ enemies: ["shield", "shield", "sniper", "sniper"] }, { enemies: ["drone", "drone", "drone", "grunt"], when: 1 }], crates: 2 },
      { at: 2700, groups: [{ enemies: ["lancer", "lancer", "grunt", "grunt", "bomber"] }, { enemies: ["elite", "shield"], when: 2 }] },
      { at: 3220, groups: [{ enemies: [] }], boss: "darkshadow" },
    ],
  },
  {
    id: 5, name: "FINAL · 황제의 옥좌", sub: "암흑황제 네메시스와의 결전", theme: "throne", length: 2600, par: 300,
    waves: [
      { at: 400, groups: [{ enemies: ["elite", "grunt", "grunt"] }, { enemies: ["sniper", "bomber", "shield"], when: 1 }], crates: 2 },
      { at: 1200, groups: [{ enemies: ["elite", "elite"] }, { enemies: ["drone", "drone", "lancer", "grunt"], when: 1 }], crates: 1 },
      { at: 2220, groups: [{ enemies: [] }], boss: "nemesis" },
    ],
  },
];

// ---------------------------------------------------------------- difficulty

export type Difficulty = "easy" | "normal" | "hard";

export interface DifficultyDef {
  id: Difficulty;
  name: string;
  /** Damage dealt to the hero. */
  dmg: number;
  /** Enemy/boss HP. */
  hp: number;
  /** Max foes allowed to attack at once (공격 토큰). */
  tokens: number;
  lives: number;
  /** Enemy telegraph length multiplier. */
  tell: number;
  /** Score multiplier. */
  score: number;
  blurb: string;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  easy: { id: "easy", name: "견습", dmg: 0.55, hp: 0.8, tokens: 1, lives: 5, tell: 1.4, score: 0.7, blurb: "적이 약하고 예고가 길다. 처음 하는 분께." },
  normal: { id: "normal", name: "정규", dmg: 1, hp: 1, tokens: 2, lives: 3, tell: 1, score: 1, blurb: "기본 난이도. 섬광 회피와 콤보를 익혀야 한다." },
  hard: { id: "hard", name: "레전드", dmg: 1.45, hp: 1.3, tokens: 3, lives: 2, tell: 0.8, score: 1.6, blurb: "적이 셋까지 동시에 덤빈다. 노데스가 목표." },
};

// ---------------------------------------------------------------- style rank

export const STYLE_RANKS = [
  { id: "D", at: 0, mul: 1, color: "#94a3b8", word: "Dull" },
  { id: "C", at: 60, mul: 1.1, color: "#60a5fa", word: "Cool" },
  { id: "B", at: 140, mul: 1.2, color: "#34d399", word: "Bravo" },
  { id: "A", at: 240, mul: 1.35, color: "#facc15", word: "Awesome" },
  { id: "S", at: 360, mul: 1.5, color: "#fb923c", word: "Sensational" },
  { id: "SS", at: 500, mul: 1.75, color: "#f43f5e", word: "Super Sentai" },
  { id: "SSS", at: 660, mul: 2, color: "#e879f9", word: "Shining Prism" },
] as const;
export const STYLE_MAX = 760;

export function styleRank(pts: number) {
  let r: (typeof STYLE_RANKS)[number] = STYLE_RANKS[0];
  for (const s of STYLE_RANKS) if (pts >= s.at) r = s;
  return r;
}

// ---------------------------------------------------------------- pickups

export type PickupKind = "riceball" | "meat" | "crystal" | "prism" | "star";

export const PICKUPS: Record<PickupKind, { name: string; emoji: string; hp?: number; en?: number; prism?: number; score?: number }> = {
  riceball: { name: "주먹밥", emoji: "🍙", hp: 0.18 },
  meat: { name: "통고기", emoji: "🍖", hp: 0.45 },
  crystal: { name: "에너지 크리스탈", emoji: "🔷", en: 40 },
  prism: { name: "프리즘 결정", emoji: "💎", prism: 35 },
  star: { name: "섬광 별", emoji: "⭐", score: 1000 },
};

/** Stage clear grade from a 0..100 performance score. */
export function stageGrade(p: number): "S" | "A" | "B" | "C" {
  return p >= 90 ? "S" : p >= 72 ? "A" : p >= 50 ? "B" : "C";
}
