import { parseLevel, type LevelDef, type ParsedLevel } from "./levels";

/**
 * 시간 루프 도둑단 — 한 루프(틱 0..T)를 결정론적으로 시뮬레이션한다. 엔진·화면·봇이 모두
 * 이 함수 하나를 쓴다(녹화 중 미리보기, 합쳐진 재생, 봇 계획 검증).
 *
 * 자아(self) = 한 루프에서 한 플레이어가 녹화한 행동열. 지난 루프의 자아는 "유령"이 되어 같은
 * 행동을 매 루프 다시 한다. 자아끼리는 서로 통과한다(막지 않음).
 *
 * 행동 글자: `N` `S` `E` `W` 이동 · `.` 대기 · `U` 사용(레버·EMP 콘솔 / 들고 있으면 내려놓기)
 *
 * 한 틱의 순서
 *  1) 문 상태 계산 — 조건 장치가 모두 켜졌거나 그 칸에 누가 서 있으면 열림
 *  2) 자아 행동(루프 오름차순, 같은 루프는 좌석 오름차순)
 *     - 이동하려는 칸이 벽/닫힌 문이면 ⚠️ 시간 역설: 그 자아는 사라진다(들고 있던 건 그 자리에)
 *       녹화할 때는 막힌 칸으로 못 움직이게 하므로, 역설은 "세상이 녹화 때와 달라졌다"는 뜻이다.
 *     - 행동 뒤 그 칸에 보석이 있고 빈손이면 줍고, 동전은 주머니에 넣는다. 밴에 서면 입금.
 *  3) 경비 로봇 이동(EMP 중이면 정지)
 *  4) 시야 판정(EMP 중이면 없음) — 로봇 칸 + 바라보는 쪽 VISION칸 안의 자아는 🚨 체포
 *  5) EMP 시간 감소
 */

export const VISION = 3;
export const EMP_TICKS = 8;

export type Act = "N" | "S" | "E" | "W" | "." | "U";
export const ACTS: readonly Act[] = ["N", "S", "E", "W", ".", "U"];
export const DIRS: Record<"N" | "S" | "E" | "W", [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

export interface SelfTrack {
  seat: number;
  /** 1부터 */
  loop: number;
  moves: string;
}

export type SelfStatus = "ok" | "paradox" | "caught";

export interface SelfFrame {
  x: number;
  y: number;
  status: SelfStatus;
  /** 들고 있는 보석 loot id */
  carry: number | null;
  /** 주머니 동전 수(아직 입금 전) */
  coins: number;
  /** 바라보는 방향(연출용) */
  face: "N" | "S" | "E" | "W";
}

export interface GuardFrame {
  x: number;
  y: number;
  face: "N" | "S" | "E" | "W";
}

export type LootState = "floor" | "carried" | "banked";

export interface Frame {
  t: number;
  selves: SelfFrame[];
  guards: GuardFrame[];
  /** 문 글자 → 열림 (이 틱을 시작할 때) */
  open: Record<string, boolean>;
  /** 장치 글자 → 켜짐 (이 틱을 시작할 때) */
  active: Record<string, boolean>;
  levers: Record<string, boolean>;
  emp: number;
  loot: { x: number; y: number; state: LootState }[];
  gems: number;
  coins: number;
  /** 이 프레임 시점에 경비가 보고 있는 칸 (y*w+x) */
  seen: number[];
}

export type SimEventKind = "paradox" | "caught" | "pick" | "drop" | "bank" | "coin" | "lever" | "emp";
export interface SimEvent {
  /** 이 사건이 일어난 틱 (프레임 t → t+1 사이) */
  t: number;
  kind: SimEventKind;
  self: number;
  x: number;
  y: number;
  /** bank 이면 보석/동전 */
  loot?: number;
}

export interface SimResult {
  frames: Frame[];
  events: SimEvent[];
  /** 입금된 보석 수가 need에 처음 닿은 틱(프레임 번호), 없으면 null */
  clearedAt: number | null;
  final: Frame;
}

function guardFace(a: [number, number], b: [number, number], prev: "N" | "S" | "E" | "W"): "N" | "S" | "E" | "W" {
  if (b[0] > a[0]) return "E";
  if (b[0] < a[0]) return "W";
  if (b[1] > a[1]) return "S";
  if (b[1] < a[1]) return "N";
  return prev;
}

/** 경비 로봇의 t틱 시점 경로 인덱스(왕복). EMP로 멈춘 시간은 따로 센다. */
function patrolIndex(len: number, step: number): number {
  if (len <= 1) return 0;
  const period = 2 * (len - 1);
  const m = ((step % period) + period) % period;
  return m < len ? m : period - m;
}

export function sortTracks(tracks: readonly SelfTrack[]): SelfTrack[] {
  return [...tracks].sort((a, b) => a.loop - b.loop || a.seat - b.seat);
}

export function computeOpen(lv: ParsedLevel, active: Record<string, boolean>, occupied: Set<number>): Record<string, boolean> {
  const open: Record<string, boolean> = {};
  for (const [id, g] of Object.entries(lv.gates)) {
    open[id] = g.need.every((n) => active[n]) || occupied.has(g.y * lv.w + g.x);
  }
  return open;
}

function visionTiles(lv: ParsedLevel, guards: GuardFrame[], open: Record<string, boolean>): number[] {
  const out = new Set<number>();
  for (const g of guards) {
    out.add(g.y * lv.w + g.x);
    const [dx, dy] = DIRS[g.face];
    let x = g.x;
    let y = g.y;
    for (let i = 0; i < VISION; i++) {
      x += dx;
      y += dy;
      if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) break;
      const idx = y * lv.w + x;
      if (lv.wall[idx]) break;
      const gate = lv.gateAt[idx];
      if (gate && !open[gate]) break;
      out.add(idx);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function passable(lv: ParsedLevel, x: number, y: number, open: Record<string, boolean>): boolean {
  if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) return false;
  const idx = y * lv.w + x;
  if (lv.wall[idx]) return false;
  const gate = lv.gateAt[idx];
  if (gate && !open[gate]) return false;
  return true;
}

function cloneFrame(f: Frame): Frame {
  return {
    t: f.t,
    selves: f.selves.map((s) => ({ ...s })),
    guards: f.guards.map((g) => ({ ...g })),
    open: { ...f.open },
    active: { ...f.active },
    levers: { ...f.levers },
    emp: f.emp,
    loot: f.loot.map((l) => ({ ...l })),
    gems: f.gems,
    coins: f.coins,
    seen: f.seen,
  };
}

/**
 * `tracks`를 정렬된 순서로 합쳐 한 루프를 돌린다. `need`가 주어지면 clearedAt을 채운다.
 * 행동열이 T보다 짧으면 나머지는 대기, 모르는 글자도 대기로 본다.
 */
export function simulate(def: LevelDef, tracksIn: readonly SelfTrack[], need = Infinity): SimResult {
  const lv = parseLevel(def);
  const T = def.ticks;
  const tracks = sortTracks(tracksIn);
  const w = lv.w;

  const leverIds = Object.keys(lv.levers);
  const plateIds = Object.keys(lv.plates);
  const guardPaths = def.guards.map((g) => g.path);
  const guardSteps = guardPaths.map(() => 0);

  const selves: SelfFrame[] = tracks.map(() => ({ x: lv.spawn.x, y: lv.spawn.y, status: "ok", carry: null, coins: 0, face: "E" }));
  const guards: GuardFrame[] = guardPaths.map((p) => ({ x: p[0][0], y: p[0][1], face: p.length > 1 ? guardFace(p[0], p[1], "E") : "S" }));
  const levers: Record<string, boolean> = Object.fromEntries(leverIds.map((id) => [id, false]));
  const loot = lv.loot.map((l) => ({ x: l.x, y: l.y, state: "floor" as LootState }));
  let emp = 0;
  let gems = 0;
  let coins = 0;
  let clearedAt: number | null = null;
  const events: SimEvent[] = [];
  const frames: Frame[] = [];

  const activeNow = (): Record<string, boolean> => {
    const a: Record<string, boolean> = {};
    for (const id of plateIds) {
      const p = lv.plates[id];
      a[id] = selves.some((s) => s.status === "ok" && s.x === p.x && s.y === p.y);
    }
    for (const id of leverIds) a[id] = levers[id];
    for (const id of Object.keys(lv.consoles)) a[id] = emp > 0;
    return a;
  };
  const occupiedNow = () => new Set(selves.filter((s) => s.status === "ok").map((s) => s.y * w + s.x));

  /** loot id → 들고 있는 자아(동전 추적용) */
  const carriedBy: number[] = lv.loot.map(() => -1);

  const dropAll = (i: number) => {
    const s = selves[i];
    if (s.carry !== null) {
      loot[s.carry] = { x: s.x, y: s.y, state: "floor" };
      events.push({ t: -1, kind: "drop", self: i, x: s.x, y: s.y, loot: s.carry });
      s.carry = null;
    }
    // 주머니 동전은 그 자리에 흩어진다 — 합쳐 하나로 떨어뜨린다(주울 수 있는 동전 칸으로)
    if (s.coins > 0) {
      let left = s.coins;
      for (let k = 0; k < loot.length && left > 0; k++) {
        if (lv.loot[k].kind === "coin" && loot[k].state === "carried" && carriedBy[k] === i) {
          loot[k] = { x: s.x, y: s.y, state: "floor" };
          carriedBy[k] = -1;
          left--;
        }
      }
      s.coins = 0;
    }
  };

  const snapshot = (t: number, open: Record<string, boolean>, active: Record<string, boolean>, seen: number[]): Frame => ({
    t,
    selves: selves.map((s) => ({ ...s })),
    guards: guards.map((g) => ({ ...g })),
    open: { ...open },
    active: { ...active },
    levers: { ...levers },
    emp,
    loot: loot.map((l) => ({ ...l })),
    gems,
    coins,
    seen,
  });

  let active = activeNow();
  let open = computeOpen(lv, active, occupiedNow());
  let seen = visionTiles(lv, guards, open);
  frames.push(snapshot(0, open, active, seen));

  for (let t = 0; t < T; t++) {
    active = activeNow();
    open = computeOpen(lv, active, occupiedNow());
    // 프레임 t의 열림 상태는 "이 틱을 시작할 때" 값으로 맞춘다
    frames[t].open = { ...open };
    frames[t].active = { ...active };

    for (let i = 0; i < tracks.length; i++) {
      const s = selves[i];
      if (s.status !== "ok") continue;
      const ch = (tracks[i].moves[t] ?? ".") as Act;
      if (ch === "N" || ch === "S" || ch === "E" || ch === "W") {
        const [dx, dy] = DIRS[ch];
        s.face = ch;
        const nx = s.x + dx;
        const ny = s.y + dy;
        if (!passable(lv, nx, ny, open)) {
          s.status = "paradox";
          events.push({ t, kind: "paradox", self: i, x: s.x, y: s.y });
          dropAll(i);
          continue;
        }
        s.x = nx;
        s.y = ny;
      } else if (ch === "U") {
        const here = { x: s.x, y: s.y };
        const lever = leverIds.find((id) => lv.levers[id].x === here.x && lv.levers[id].y === here.y);
        const console = Object.keys(lv.consoles).find((id) => lv.consoles[id].x === here.x && lv.consoles[id].y === here.y);
        if (lever) {
          if (!levers[lever]) {
            levers[lever] = true;
            events.push({ t, kind: "lever", self: i, x: s.x, y: s.y });
          }
        } else if (console) {
          emp = EMP_TICKS + 1; // 5) 감소 뒤 EMP_TICKS틱 동안 유지
          events.push({ t, kind: "emp", self: i, x: s.x, y: s.y });
        } else if (s.carry !== null) {
          const onLoot = loot.some((l, k) => l.state === "floor" && lv.loot[k].kind === "gem" && l.x === s.x && l.y === s.y);
          if (!onLoot && !(s.x === lv.van.x && s.y === lv.van.y)) {
            loot[s.carry] = { x: s.x, y: s.y, state: "floor" };
            events.push({ t, kind: "drop", self: i, x: s.x, y: s.y, loot: s.carry });
            s.carry = null;
            // 방금 내려놓은 걸 아래 자동 줍기가 다시 줍지 않게 한다
            continue;
          }
        }
      }
      // 자동 줍기 / 입금
      for (let k = 0; k < loot.length; k++) {
        const l = loot[k];
        if (l.state !== "floor" || l.x !== s.x || l.y !== s.y) continue;
        if (lv.loot[k].kind === "coin") {
          loot[k] = { ...l, state: "carried" };
          carriedBy[k] = i;
          s.coins++;
          events.push({ t, kind: "coin", self: i, x: s.x, y: s.y, loot: k });
        } else if (s.carry === null) {
          loot[k] = { ...l, state: "carried" };
          s.carry = k;
          events.push({ t, kind: "pick", self: i, x: s.x, y: s.y, loot: k });
        }
      }
      if (s.x === lv.van.x && s.y === lv.van.y) {
        if (s.carry !== null) {
          loot[s.carry] = { x: lv.van.x, y: lv.van.y, state: "banked" };
          events.push({ t, kind: "bank", self: i, x: s.x, y: s.y, loot: s.carry });
          s.carry = null;
          gems++;
        }
        if (s.coins > 0) {
          for (let k = 0; k < loot.length; k++) {
            if (carriedBy[k] === i && loot[k].state === "carried") {
              loot[k] = { x: lv.van.x, y: lv.van.y, state: "banked" };
              carriedBy[k] = -1;
              events.push({ t, kind: "bank", self: i, x: s.x, y: s.y, loot: k });
            }
          }
          coins += s.coins;
          s.coins = 0;
        }
      }
    }

    // 3) 경비 이동
    if (emp === 0) {
      for (let g = 0; g < guards.length; g++) {
        const path = guardPaths[g];
        if (path.length <= 1) continue;
        const a = path[patrolIndex(path.length, guardSteps[g])];
        guardSteps[g]++;
        const b = path[patrolIndex(path.length, guardSteps[g])];
        guards[g].x = b[0];
        guards[g].y = b[1];
        guards[g].face = guardFace(a, b, guards[g].face);
        // 끝에 닿으면 바로 돌아본다(되돌아갈 쪽)
        const c = path[patrolIndex(path.length, guardSteps[g] + 1)];
        guards[g].face = guardFace(b, c, guards[g].face);
      }
    }

    // 4) 시야
    const afterActive = activeNow();
    const afterOpen = computeOpen(lv, afterActive, occupiedNow());
    seen = emp > 0 ? [] : visionTiles(lv, guards, afterOpen);
    if (seen.length > 0) {
      const seenSet = new Set(seen);
      for (let i = 0; i < selves.length; i++) {
        const s = selves[i];
        if (s.status !== "ok" || !seenSet.has(s.y * w + s.x)) continue;
        s.status = "caught";
        events.push({ t, kind: "caught", self: i, x: s.x, y: s.y });
        dropAll(i);
      }
    }

    // 5) EMP
    if (emp > 0) emp--;

    for (const e of events) if (e.t === -1) e.t = t;
    if (clearedAt === null && gems >= need) clearedAt = t + 1;

    const a2 = activeNow();
    const o2 = computeOpen(lv, a2, occupiedNow());
    frames.push(snapshot(t + 1, o2, a2, seen));
  }

  return { frames, events, clearedAt, final: frames[frames.length - 1] };
}

export { cloneFrame };

/** 녹화 중 입력이 가능한가 — 막힌 칸으로는 못 간다(그래야 역설 = 세상이 바뀐 것) */
export function canAct(def: LevelDef, frame: Frame, selfIdx: number, act: Act): boolean {
  const lv = parseLevel(def);
  const s = frame.selves[selfIdx];
  if (!s || s.status !== "ok") return false;
  if (act === "." || act === "U") return true;
  const [dx, dy] = DIRS[act];
  return passable(lv, s.x + dx, s.y + dy, frame.open);
}

/** 이 칸에서 U가 무슨 일을 하는가 (버튼 라벨용) */
export function actLabel(def: LevelDef, frame: Frame, selfIdx: number): string | null {
  const lv = parseLevel(def);
  const s = frame.selves[selfIdx];
  if (!s || s.status !== "ok") return null;
  const lever = Object.keys(lv.levers).find((id) => lv.levers[id].x === s.x && lv.levers[id].y === s.y);
  if (lever) return frame.levers[lever] ? null : `레버 ${lever} 당기기`;
  const console = Object.keys(lv.consoles).find((id) => lv.consoles[id].x === s.x && lv.consoles[id].y === s.y);
  if (console) return "EMP 발동";
  if (s.carry !== null && !(s.x === lv.van.x && s.y === lv.van.y)) return "보석 내려놓기";
  return null;
}
