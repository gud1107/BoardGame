import { BODY_R, CHARGE_MS, FIELD_HL, FIELD_HW, PILES, SNOWMAN_H, WALL_COST, WALL_H, chargeForRange, launchFor, sideSign } from "./data";
import { ammoMax, ballPos, isFrozen, nearPile, press, rnd, setInput, wallSpotOk, type HostRuntime, type MatchState, type PlayerState } from "./sim";

/**
 * 눈싸움 요새전 AI (룰북 §11). 레벨이 높을수록 자주 생각하고, 움직이는 상대를 앞질러 겨누고,
 * 벽이 가로막으면 포물선으로 넘기고, 날아오는 눈덩이를 구르기로 피하고, 벽을 세워 숨는다.
 *
 * 역할: 팀 안 순번이 짝수면 공격(상대 눈사람·사람), 홀수면 수비(우리 진영에서 다가오는 상대).
 * 손떨림(조준각·힘)은 봇 전용 난수로 — 경기 난수와 섞이지 않는다.
 */

interface Lv {
  thinkMs: number;
  aimSd: number;
  powSd: number;
  lead: number;
  dodge: number;
  walls: boolean;
  /** 던지기 전에 힘을 다 모으는 데 쓰는 여유 (사람처럼 살짝 늦게) */
  hesitate: number;
  strafe: boolean;
}

function lvParams(lv: number): Lv {
  const l = Math.max(1, Math.min(10, Math.round(lv)));
  return {
    thinkMs: 380 - l * 28,
    aimSd: [0.24, 0.19, 0.15, 0.12, 0.095, 0.075, 0.058, 0.045, 0.034, 0.025][l - 1],
    powSd: [0.18, 0.15, 0.12, 0.1, 0.085, 0.07, 0.058, 0.047, 0.037, 0.03][l - 1],
    lead: l <= 2 ? 0 : l <= 5 ? 0.6 : 1,
    dodge: l <= 3 ? 0 : (l - 3) / 7,
    walls: l >= 3,
    hesitate: 260 - l * 20,
    strafe: l >= 5,
  };
}

function gauss(r: { rng: number }): number {
  const u = Math.max(1e-9, rnd(r));
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd(r));
}

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/**
 * 가장 약한 힘(=가장 빠른 공) 중에 벽을 다 넘고 목표 거리 `d`에서 높이가 [yMin, yMax] 안인 것.
 * 없으면 null — 각을 바꾸거나 다가가야 한다.
 */
export function solvePow(s: MatchState, p: PlayerState, a: number, d: number, yMin: number, yMax: number): number | null {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  for (let pow = 0; pow <= 1.0001; pow += 0.03) {
    const L = launchFor(pow);
    if (L.range < d - 0.4) continue;
    const yAt = (x: number) => {
      const tt = x / L.vh;
      return 1.45 + L.vy * tt - 7 * tt * tt;
    };
    const y = yAt(d);
    if (y < yMin || y > yMax) continue;
    let ok = true;
    for (const w of s.walls) {
      const along = (w.x - p.x) * c + (w.z - p.z) * sn;
      if (along <= 0.2 || along >= d - 0.3) continue;
      const perp = Math.abs(-(w.x - p.x) * sn + (w.z - p.z) * c);
      if (perp > 1.35) continue;
      if (yAt(along) < WALL_H + 0.22) {
        ok = false;
        break;
      }
    }
    if (ok) return pow;
  }
  return null;
}

function nearestPile(p: PlayerState) {
  let best = PILES[0];
  let bd = 1e9;
  for (const pl of PILES) {
    // 자기 진영 눈더미를 더 좋아한다
    const own = pl.z * sideSign(p.team) > 0 ? 0 : 6;
    const d = dist(p.x, p.z, pl.x, pl.z) + own;
    if (d < bd) {
      bd = d;
      best = pl;
    }
  }
  return best;
}

export function botThink(rt: HostRuntime, seat: number) {
  const s = rt.state;
  const p = s.players[seat];
  const mem = rt.bots[seat];
  if (!p || isFrozen(p, s.t)) return;
  const L = lvParams(p.lv);
  const inp = rt.inputs[seat];

  // 힘 모으는 중이면 다 모았을 때 던진다
  if (p.chargeAt && mem.releaseAt && s.t >= mem.releaseAt) {
    setInput(rt, seat, { ...inp, charge: 0, aim: mem.aim });
    press(rt, seat, "throw", mem.pow);
    mem.releaseAt = 0;
    mem.nextThinkAt = s.t + 120;
    return;
  }
  // 모으는 중엔 생각을 바꾸지 않는다 (다 모으면 위에서 던짐)
  if (mem.releaseAt && p.chargeAt) return;
  if (mem.releaseAt && !p.chargeAt && s.t > mem.releaseAt + 300) mem.releaseAt = 0;
  if (mem.releaseAt) return;
  if (s.t < mem.nextThinkAt) return;
  mem.nextThinkAt = s.t + L.thinkMs * (0.8 + rnd(rt.botRng) * 0.4);

  const sg = sideSign(p.team);
  const enemies = s.players.filter((e) => e.team !== p.team && !isFrozen(e, s.t));
  const foeMan = s.snowmen.find((m) => m.team !== p.team)!;
  const myMan = s.snowmen.find((m) => m.team === p.team)!;

  // 1) 날아오는 눈덩이 피하기
  if (L.dodge > 0 && s.t >= p.dashCdAt) {
    for (const b of s.balls) {
      if (b.team === p.team) continue;
      const now = ballPos(b, s.t);
      const soon = ballPos(b, s.t + 350);
      const dx = soon.x - now.x;
      const dz = soon.z - now.z;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - now.x) * dx + (p.z - now.z) * dz) / l2));
      const cx = now.x + dx * t;
      const cz = now.z + dz * t;
      if (Math.hypot(cx - p.x, cz - p.z) < BODY_R + 0.35 && soon.y < 1.8 && rnd(rt.botRng) < L.dodge) {
        // 공이 오는 방향의 옆으로
        const l = Math.sqrt(l2);
        const side = rnd(rt.botRng) < 0.5 ? 1 : -1;
        setInput(rt, seat, { ...inp, mx: (-dz / l) * side, mz: (dx / l) * side, charge: 0, gather: 0 });
        press(rt, seat, "dash");
        p.stats.dodges += 1;
        mem.releaseAt = 0;
        return;
      }
    }
  }

  // 2) 가까운 아이템
  const item = s.items.find((it) => dist(it.x, it.z, p.x, p.z) < 6.5);

  // 3) 목표 정하기
  const k = s.players.filter((o) => o.team === p.team && o.seat < seat).length;
  // 팀에 수비는 한 명만 (두 번째 사람) — 나머지는 공격
  const role = k === 1 ? "defend" : "attack";
  let target: { x: number; z: number; vx: number; vz: number; man: boolean } | null = null;
  let bestD = 1e9;
  for (const e of enemies) {
    const d = dist(e.x, e.z, p.x, p.z);
    // 수비는 우리 진영에 들어온 상대를 먼저
    const pri = role === "defend" && e.z * sg > 0 ? d - 6 : d;
    if (pri < bestD) {
      bestD = pri;
      target = { x: e.x, z: e.z, vx: e.vx, vz: e.vz, man: false };
    }
  }
  const dTarget = target ? dist(target.x, target.z, p.x, p.z) : 99;
  const dMan = dist(foeMan.x, foeMan.z, p.x, p.z);
  if ((!target || dTarget > 15) && dMan < 17.5) target = { x: foeMan.x, z: foeMan.z, vx: 0, vz: 0, man: true };
  // 공격수: 바로 앞(6m)에 상대가 없으면 눈사람을 노린다 — 멀면 다가가서
  if (role === "attack" && (!target || dTarget > 6.5)) target = { x: foeMan.x, z: foeMan.z, vx: 0, vz: 0, man: true };

  // 4) 눈덩이가 없으면 모으러
  const low = p.ammo === 0 || (p.ammo < 2 && dTarget > 9);
  if (low) {
    if (item) {
      moveTo(rt, seat, item.x, item.z, 0);
      return;
    }
    const pile = nearestPile(p);
    const far = dist(pile.x, pile.z, p.x, p.z);
    // 가까운 눈더미가 멀고 상대가 가까우면 그 자리에서 뭉친다
    if (far > 2 && !(dTarget < 7 && far > 5)) moveTo(rt, seat, pile.x, pile.z, 0);
    else setInput(rt, seat, { ...inp, mx: 0, mz: 0, gather: 1, charge: 0 });
    return;
  }
  if (p.ammo < ammoMax(s) && dTarget > 12 && nearPile(p.x, p.z)) {
    setInput(rt, seat, { ...inp, mx: 0, mz: 0, gather: 1, charge: 0 });
    return;
  }

  // 5) 벽 세우기: 상대가 다가오는데 앞에 우리 벽이 없으면
  if (L.walls && p.ammo >= WALL_COST + 1 && target && !target.man && dTarget < 11 && dTarget > 4 && rnd(rt.botRng) < 0.35) {
    const a = Math.atan2(target.z - p.z, target.x - p.x);
    const wx = p.x + Math.cos(a) * 1.35;
    const wz = p.z + Math.sin(a) * 1.35;
    const cover = s.walls.some((w) => w.team === p.team && dist(w.x, w.z, wx, wz) < 2.2);
    if (!cover && wallSpotOk(s, p.team, wx, wz, a + Math.PI / 2)) {
      setInput(rt, seat, { ...inp, aim: a, mx: 0, mz: 0, charge: 0, gather: 0 });
      press(rt, seat, "wall");
      return;
    }
  }

  if (!target) {
    // 할 일이 없으면 상대 눈사람 쪽으로 (수비는 우리 진영 앞쪽)
    if (role === "defend") moveTo(rt, seat, (rnd(rt.botRng) - 0.5) * 8, sg * 6, 0);
    else moveTo(rt, seat, foeMan.x * 0.5, foeMan.z - sg * 9, 0);
    return;
  }

  // 6) 사정거리 안이면 조준해서 던지기, 아니면 다가가기
  let tx = target.x;
  let tz = target.z;
  if (!target.man && L.lead > 0) {
    // 날아가는 시간만큼 앞질러 (두 번 다듬기)
    for (let i = 0; i < 2; i++) {
      const tt = launchFor(chargeForRange(dist(tx, tz, p.x, p.z))).time;
      tx = target.x + target.vx * tt * L.lead;
      tz = target.z + target.vz * tt * L.lead;
    }
  }
  const d = dist(tx, tz, p.x, p.z);
  // 사람은 12m 안에서만 (멀면 움직이는 상대를 거의 못 맞힌다), 눈사람은 멀리서도
  const reach = target.man ? 13 : 12;
  if (d > reach || (role === "defend" && target.z * sg < -2 && !target.man)) {
    // 다가가기 (수비는 가운데선을 넘지 않음)
    const gx = tx;
    let gz = tz;
    if (role === "defend") gz = Math.max(sg * 1.5 * sg, gz * sg) * sg;
    moveTo(rt, seat, gx, gz, d > reach ? 0 : 0);
    return;
  }
  let a = Math.atan2(tz - p.z, tx - p.x);
  const solved = target.man ? solvePow(s, p, a, d, 0.4, SNOWMAN_H - 0.15) : solvePow(s, p, a, d, 0.25, 1.55);
  if (solved === null) {
    // 벽에 막혀 각이 안 나온다 — 옆으로 돌거나(공격) 벽을 부수러 다가간다
    const side = mem.strafe;
    const step = target.man ? 3.5 : 2.5;
    moveTo(rt, seat, p.x + Math.cos(a + (Math.PI / 2) * side) * step + Math.cos(a) * 1.5, p.z + Math.sin(a + (Math.PI / 2) * side) * step + Math.sin(a) * 1.5, 0);
    if (s.t > mem.strafeUntil || Math.abs(p.x) > FIELD_HW - 1.5) {
      mem.strafe = -mem.strafe;
      mem.strafeUntil = s.t + 1500;
    }
    return;
  }
  let pow = solved;
  a += gauss(rt.botRng) * L.aimSd;
  pow = Math.max(0, Math.min(1, pow + gauss(rt.botRng) * L.powSd));
  mem.aim = a;
  mem.pow = pow;
  mem.releaseAt = s.t + pow * CHARGE_MS + L.hesitate + rnd(rt.botRng) * 120;
  // 모으는 동안 옆걸음 (상위 레벨)
  let mx = 0;
  let mz = 0;
  if (L.strafe) {
    if (s.t > mem.strafeUntil) {
      mem.strafe = rnd(rt.botRng) < 0.5 ? 1 : -1;
      mem.strafeUntil = s.t + 900 + rnd(rt.botRng) * 900;
    }
    mx = Math.cos(a + Math.PI / 2) * mem.strafe;
    mz = Math.sin(a + Math.PI / 2) * mem.strafe;
    // 벽 밖으로 나가지 않게
    if (Math.abs(p.x + mx) > FIELD_HW - 1) mx = -mx;
    if (Math.abs(p.z + mz) > FIELD_HL - 1) mz = -mz;
  }
  setInput(rt, seat, { ...inp, aim: a, charge: 1, gather: 0, mx, mz });
  void myMan;
}

function moveTo(rt: HostRuntime, seat: number, x: number, z: number, _stop: number) {
  void _stop;
  const p = rt.state.players[seat];
  const dx = x - p.x;
  const dz = z - p.z;
  const l = Math.hypot(dx, dz);
  const inp = rt.inputs[seat];
  if (l < 0.4) {
    setInput(rt, seat, { ...inp, mx: 0, mz: 0, charge: 0, gather: 0 });
    return;
  }
  // 앞에 벽이 있으면 옆으로 비켜 간다
  let mx = dx / l;
  let mz = dz / l;
  for (const w of rt.state.walls) {
    const ahead = { x: p.x + mx * 1.1, z: p.z + mz * 1.1 };
    if (Math.hypot(ahead.x - w.x, ahead.z - w.z) < 1.4) {
      const c = Math.cos(w.a);
      const sn = Math.sin(w.a);
      const sgn = mx * c + mz * sn >= 0 ? 1 : -1;
      mx = c * sgn;
      mz = sn * sgn;
      break;
    }
  }
  setInput(rt, seat, { ...inp, mx, mz, aim: Math.atan2(mz, mx), charge: 0, gather: 0 });
}
