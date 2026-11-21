import { cornerSpeed } from "./bot";
import { CAR_R, CRASH_MS, RESET_MS, ROCKET_BOOST_MS, ROCKET_EARLY_MS, ROCKET_LATE_MS, ROCKET_STALL_WINDOW_MS, SPIN_MS, STALL_MS, STEP_MS, TOP_MS } from "./data";
import type { Snap, SnapBuffer } from "./net";
import { collidePair, draftUpdate, driftTier, forwardSpeed, giveBoost, inAir, newCar, resetCar, stepCar, type Car, type CarEvent, type CarInput } from "./physics";
import { crashBack, FL, hazardAt, trackOf, type PosReport } from "./sim";
import { pointAt, project, type Track } from "./track";

/**
 * 내 차 (룰북 §10): 내 기기가 physics.ts로 바로 움직인다 — 입력 지연이 없다.
 *
 * - 60Hz 고정 스텝. 시계는 이 기기의 performance.now() (방장 시각은 버퍼로 추정해 위험물·기차·출발 시각에만 쓴다).
 * - 방장이 내려보낸 효과 카운터(fxSpin·fxBoost·fxTop)가 늘면 지금 적용하고, tp가 늘면 방장이 아는 위치로 옮긴다.
 * - 고무 오리·장난감 벽·기차는 여기서 판정하고 `hz`로 알린다. 남의 차와는 내 차만 밀린다.
 * - 🚀 출발 부스트·🔁 제자리로·🧑‍🦽 주행 보조도 여기서.
 */

export interface DriverControls {
  steer: number;
  brake: boolean;
  drift: boolean;
}

export type LocalEvent = CarEvent | { k: "hazard"; what: "duck" | "toy" | "train"; blocked: boolean } | { k: "rocket"; ok: boolean } | { k: "reset" } | { k: "fx"; what: "spin" | "boost" | "top" | "tp" };

export class LocalDriver {
  car: Car | null = null;
  seat: number;
  race = -1;
  tp = -1;
  seed = 0;
  private seenSpin = 0;
  private seenBoost = 0;
  private seenTop = 0;
  private acc = 0;
  private last = 0;
  /** 스스로 부딪혀 이미 처리한 위험물 (오리·벽 id) */
  hitIds = new Set<number>();
  private trainHitAt = -1e9;
  pending: NonNullable<PosReport["hz"]> = [];
  counters = { ni: 0, nt: 0, nr: 0 };
  st = { w: 0, d1: 0, d2: 0, j: 0, pl: 0 };
  /** 출발 부스트: 처음 누른 시각(내 시계) · 결과 */
  private rocketPress = 0;
  rocket = 0;
  private rocketApplied = false;
  /** 방장 시각으로 본 출발 시각 → 내 시계 */
  goLocal = 0;
  controls: DriverControls = { steer: 0, brake: false, drift: false };
  assist = false;
  flags = 0;

  constructor(seat: number) {
    this.seat = seat;
  }

  /** 스냅샷과 맞추기: 새 판·새 레이스·순간이동 보정이면 방장이 아는 위치로 */
  sync(buf: SnapBuffer, now: number) {
    const snap = buf.latest();
    const p = snap?.players[this.seat];
    if (!snap || !p) return;
    const tr = trackOf(snap);
    if (!this.car || this.race !== snap.race || this.seed !== snap.seed || p.tp > this.tp) {
      const fresh = !this.car || this.race !== snap.race || this.seed !== snap.seed;
      const c = newCar(tr, p.x, p.z, p.h, p.lastS, p.seg);
      c.dist = p.dist;
      c.y = p.y;
      if (!fresh && this.car) {
        // 순간이동 보정: 위치만 옮기고 타이머는 그대로
        Object.assign(this.car, { x: p.x, z: p.z, y: p.y, h: p.h, vx: 0, vz: 0, seg: p.seg, lastS: p.lastS, dist: p.dist, drift: 0, driftMs: 0, airUntil: 0, airFrom: 0 });
      } else {
        this.car = c;
        this.hitIds.clear();
        this.rocketPress = 0;
        this.rocket = 0;
        this.rocketApplied = false;
        this.pending = [];
      }
      if (this.seed !== snap.seed) {
        this.counters = { ni: 0, nt: 0, nr: 0 };
        this.st = { w: 0, d1: 0, d2: 0, j: 0, pl: 0 };
        this.seenSpin = p.fxSpin;
        this.seenBoost = p.fxBoost;
        this.seenTop = p.fxTop;
      }
      this.race = snap.race;
      this.seed = snap.seed;
      this.tp = p.tp;
      this.last = now;
      this.acc = 0;
    }
    this.goLocal = now + (snap.goAt - buf.hostNow(now));
  }

  /** 🚀 / ↑ 누름 (카운트다운 중) */
  pressRocket(now: number, phase: string) {
    if (this.rocketPress !== 0 || this.rocket !== 0) return;
    if (phase !== "countdown" && now > this.goLocal + ROCKET_LATE_MS) return;
    const d = now - this.goLocal;
    if (d < -ROCKET_STALL_WINDOW_MS) return;
    this.rocketPress = now;
    this.rocket = d >= -ROCKET_EARLY_MS && d <= ROCKET_LATE_MS ? 1 : -1;
  }

  pressReset(now: number) {
    if (!this.car || now < this.car.resetUntil + 400) return;
    const snap = this.lastSnapTrack;
    if (!snap) return;
    resetCar(this.car, snap, now, RESET_MS);
    this.counters.nr += 1;
    this.events.push({ k: "reset" });
  }

  private lastSnapTrack: Track | null = null;
  events: LocalEvent[] = [];

  /** 매 프레임 (requestAnimationFrame) — 60Hz로 나눠 돈다 */
  frame(buf: SnapBuffer, now: number, others: { seat: number; x: number; z: number; y: number; vx: number; vz: number }[]) {
    this.sync(buf, now);
    const snap = buf.latest();
    const c = this.car;
    const p = snap?.players[this.seat];
    if (!snap || !c || !p) return;
    const tr = trackOf(snap);
    this.lastSnapTrack = tr;
    c.catchup = p.catchup || 1;
    // 방장이 내려보낸 효과
    if (p.fxSpin > this.seenSpin) {
      this.seenSpin = p.fxSpin;
      c.spinUntil = now + (p.fxSpinMs || SPIN_MS);
      c.drift = 0;
      c.driftMs = 0;
      this.events.push({ k: "fx", what: "spin" });
    }
    if (p.fxBoost > this.seenBoost) {
      this.seenBoost = p.fxBoost;
      giveBoost(c, now, p.fxBoostMs, p.fxBoostMult);
      this.events.push({ k: "fx", what: "boost" });
    }
    if (p.fxTop > this.seenTop) {
      this.seenTop = p.fxTop;
      c.topUntil = now + TOP_MS;
      this.events.push({ k: "fx", what: "top" });
    }
    const dtAll = this.last ? Math.min(250, now - this.last) : 0;
    this.last = now;
    this.acc += dtAll;
    const hostT = buf.hostNow(now);
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      const t = now - this.acc;
      this.tick(snap, tr, t, hostT - this.acc, others);
    }
  }

  private tick(snap: Snap, tr: Track, t: number, hostT: number, others: { seat: number; x: number; z: number; y: number; vx: number; vz: number }[]) {
    const c = this.car!;
    const p = snap.players[this.seat];
    const dt = STEP_MS / 1000;
    let inp: CarInput = { ...this.controls };
    if (snap.phase === "countdown") {
      c.stallUntil = Math.max(c.stallUntil, this.goLocal);
      c.vx = 0;
      c.vz = 0;
      this.flags = FL.stall;
      return;
    }
    if (snap.phase === "race" && !p.finishedAt) {
      // 🚀 출발 부스트: 출발 뒤 결과가 정해지면(또는 늦게 누를 수 있는 시간이 지나면) 한 번 적용
      if (!this.rocketApplied && t >= this.goLocal && (this.rocket !== 0 || t >= this.goLocal + ROCKET_LATE_MS)) {
        this.rocketApplied = true;
        c.stallUntil = this.rocket < 0 ? this.goLocal + STALL_MS : 0;
        if (this.rocket > 0) giveBoost(c, t, ROCKET_BOOST_MS);
        if (this.rocket !== 0) this.events.push({ k: "rocket", ok: this.rocket > 0 });
      } else if (!this.rocketApplied && t >= this.goLocal) c.stallUntil = 0;
      if (this.assist) inp = assistInput(c, tr, inp, t);
    } else {
      // 들어왔거나 레이스가 끝남: 천천히 선다
      inp = { steer: inp.steer * 0.5, brake: true, drift: false };
    }
    const ev = stepCar(c, inp, tr, t, dt);
    for (const e of ev) {
      this.events.push(e);
      if (e.k === "wall" || e.k === "obstacle") this.st.w += 1;
      else if (e.k === "driftBoost") {
        if (e.tier === 2) this.st.d2 += 1;
        else this.st.d1 += 1;
      }
      else if (e.k === "jump") this.st.j += 1;
      else if (e.k === "land" && e.perfect) this.st.pl += 1;
    }
    // 남의 차와 부딪힘 (내 차만 밀림)
    if (!inAir(c, t)) {
      for (const o of others) {
        const tmp = { ...o } as unknown as Car;
        collidePair(c, tmp, true, false);
      }
    }
    c.draftMs = draftUpdate(c, others, STEP_MS);
    // 위험물 (오리·장난감 벽·기차)
    if (snap.phase === "race" && !p.finishedAt) {
      const view = { ...snap, ducks: snap.ducks.filter((d) => !this.hitIds.has(d.id)), toys: snap.toys.filter((x) => !this.hitIds.has(x.id)) };
      const h = hazardAt(view, c, this.seat, hostT, t);
      if (h) {
        const shielded = hostT < p.shieldUntil && !this.usedShield;
        const top = t < c.topUntil;
        if (h.k === "train") {
          if (!top && hostT - this.trainHitAt > 3000) {
            this.trainHitAt = hostT;
            crashBack(c, tr, t, CRASH_MS);
            this.pending.push({ k: "train", id: -1 });
            this.events.push({ k: "hazard", what: "train", blocked: false });
          }
        } else {
          this.hitIds.add(h.id);
          if (shielded || top) {
            if (!top) this.usedShield = true;
            this.pending.push({ k: h.k, id: h.id, b: 1 });
            this.events.push({ k: "hazard", what: h.k, blocked: true });
          } else {
            if (h.k === "duck") {
              c.spinUntil = t + SPIN_MS;
              c.drift = 0;
              c.driftMs = 0;
            } else crashBack(c, tr, t, CRASH_MS);
            this.pending.push({ k: h.k, id: h.id });
            this.events.push({ k: "hazard", what: h.k, blocked: false });
          }
        }
      }
      if (hostT >= p.shieldUntil) this.usedShield = false;
    }
    this.flags = flagsOf(c, t, inp);
  }

  private usedShield = false;

  report(race: number): PosReport | null {
    const c = this.car;
    if (!c) return null;
    const r: PosReport = {
      x: round(c.x),
      z: round(c.z),
      y: round(c.y),
      vx: round(c.vx),
      vz: round(c.vz),
      h: Math.round(c.h * 1000) / 1000,
      fl: this.flags,
      ni: this.counters.ni,
      nt: this.counters.nt,
      nr: this.counters.nr,
      rk: this.rocketApplied ? this.rocket : 0,
      tp: this.tp,
      race,
      st: { ...this.st },
    };
    if (this.pending.length) {
      r.hz = this.pending;
      this.pending = [];
    }
    return r;
  }

  /** 화면용 지금 위치 (내 차) */
  pose() {
    const c = this.car;
    return c ? { x: c.x, z: c.z, y: c.y, h: c.h, vx: c.vx, vz: c.vz } : null;
  }

  speed(): number {
    return this.car ? Math.max(0, forwardSpeed(this.car)) : 0;
  }

  tier(): 0 | 1 | 2 {
    return this.car ? driftTier(this.car) : 0;
  }
}

const round = (v: number) => Math.round(v * 100) / 100;

function flagsOf(c: Car, t: number, inp: CarInput): number {
  let f = 0;
  const tier = driftTier(c);
  if (c.drift !== 0) f |= FL.drift;
  if (tier === 1) f |= FL.drift1;
  if (tier === 2) f |= FL.drift2;
  if (t < c.boostUntil) f |= FL.boost;
  if (inp.brake) f |= FL.brake;
  if (t < c.spinUntil) f |= FL.spin;
  if (inAir(c, t)) f |= FL.air;
  if (t < c.topUntil) f |= FL.top;
  if (t < c.resetUntil) f |= FL.reset;
  if (t < c.stallUntil) f |= FL.stall;
  if (c.draftMs >= 600) f |= FL.draft;
  return f;
}

/**
 * 🧑‍🦽 주행 보조 (설정에서 켜기): 핸들을 놓고 있으면 길 가운데 앞쪽을 향해 살살 꺾어 주고,
 * 앞의 급한 굽이에서 너무 빠르면 브레이크를 대신 밟는다. 직접 꺾으면 그 입력이 우선.
 */
export function assistInput(c: Car, tr: Track, inp: CarInput, t: number): CarInput {
  if (t < c.spinUntil) return inp;
  const pr = project(tr, c.x, c.z, c.seg);
  const vf = forwardSpeed(c);
  const out = { ...inp };
  if (Math.abs(inp.steer) < 0.12 && c.drift === 0) {
    const look = 3 + Math.max(0, vf) * 0.4;
    const q = pointAt(tr, pr.s + look, pr.lat * 0.5);
    let d = Math.atan2(q.z - c.z, q.x - c.x) - c.h;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    out.steer = Math.max(-0.8, Math.min(0.8, d * 1.8));
  }
  if (!inp.brake && !inp.drift) {
    let kMax = 0;
    for (let d = 3; d <= 14; d += 2) {
      const i = Math.floor((((pr.s + d) % tr.L) + tr.L) % tr.L / tr.ds) % tr.n;
      if (Math.abs(tr.curv[i]) > Math.abs(kMax)) kMax = tr.curv[i];
    }
    if (vf > cornerSpeed(kMax) * 0.97 + 0.5) out.brake = true;
  }
  return out;
}

export { CAR_R };
