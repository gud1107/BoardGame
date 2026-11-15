import { cellIndex, grippable } from "./course";
import { GRAB_MIN, LEDGE, OVERHANG, ROPE_LEN, ROPE_MIN, WALL_W } from "./data";
import { distOf, pressGrab, rnd, type HostRuntime, type PlayerState } from "./sim";

/**
 * 등반 봇 Lv.1~10 (룰북 §9).
 *
 * 기본은 "정상까지 거리장"을 따라 한 칸씩 오르기. 그 위에:
 * - 옆 사람이 공중에 있으면 멈춰서 줄을 당긴다(끌어올리기). 줄이 다 감겼는데도 못 잡으면 위로 끌고 간다.
 * - 줄이 거의 팽팽한데 옆 사람이 아래에서 올라오는 중이면 기다린다.
 * - 체력이 모자라면 가까운 턱에서 쉬고, 턱에선 거의 찰 때까지 쉰다.
 * - 낙석 경고가 머리 위면 옆으로 피한다 (레벨이 높을수록 잘 피함).
 * - Lv.5+ : 오버행 틈 앞에서 위쪽 동료가 띠를 넘었으면 손을 놓고 끌려 올라간다(체력 아끼기).
 * - 낮은 레벨: 느리고, 늦게 쉬고, 가끔 손이 미끄러진다.
 */

export interface BotParams {
  thinkMs: number;
  /** 이동 입력 크기 0~1 */
  speed: number;
  /** 낙석을 피할 확률 */
  dodge: number;
  /** 줄을 영리하게 쓰나 (틈 앞에서 매달려 끌려가기) */
  smart: boolean;
  /** 이 체력 아래면 쉴 곳을 찾는다 */
  restAt: number;
  /** 초당 손이 미끄러질 확률 */
  slip: number;
}

export const BOT_PARAMS: Record<number, BotParams> = {
  1: { thinkMs: 420, speed: 0.6, dodge: 0, smart: false, restAt: 10, slip: 0.05 },
  2: { thinkMs: 380, speed: 0.66, dodge: 0.1, smart: false, restAt: 14, slip: 0.035 },
  3: { thinkMs: 330, speed: 0.72, dodge: 0.25, smart: false, restAt: 20, slip: 0.022 },
  4: { thinkMs: 280, speed: 0.78, dodge: 0.4, smart: false, restAt: 26, slip: 0.012 },
  5: { thinkMs: 240, speed: 0.84, dodge: 0.55, smart: true, restAt: 34, slip: 0.006 },
  6: { thinkMs: 200, speed: 0.88, dodge: 0.68, smart: true, restAt: 40, slip: 0.003 },
  7: { thinkMs: 170, speed: 0.92, dodge: 0.8, smart: true, restAt: 46, slip: 0.001 },
  8: { thinkMs: 140, speed: 0.95, dodge: 0.9, smart: true, restAt: 52, slip: 0 },
  9: { thinkMs: 110, speed: 0.98, dodge: 0.96, smart: true, restAt: 56, slip: 0 },
  10: { thinkMs: 90, speed: 1, dodge: 1, smart: true, restAt: 60, slip: 0 },
};

export function paramsFor(lv: number): BotParams {
  return BOT_PARAMS[Math.max(1, Math.min(10, Math.round(lv) || 5))];
}

const cx = (c: number) => c + 0.5 - WALL_W / 2;

export function botThink(rt: HostRuntime, seat: number) {
  const s = rt.state;
  const p = s.players[seat];
  const mem = rt.bots[seat];
  if (s.t < mem.nextThinkAt) return;
  const prm = paramsFor(p.lv);
  mem.nextThinkAt = s.t + prm.thinkMs;
  const inp = rt.inputs[seat];
  inp.mx = 0;
  inp.my = 0;
  inp.haul = false;
  if (s.t < p.stunUntil) return;
  const neighbors: PlayerState[] = [];
  if (seat > 0) neighbors.push(s.players[seat - 1]);
  if (seat < s.seatCount - 1) neighbors.push(s.players[seat + 1]);
  const cells = rt.cells;
  const cellV = (x: number, y: number) => {
    const i = cellIndex(rt.course, x, y);
    return i < 0 ? undefined : cells[i];
  };

  if (p.mode === "air") {
    const here = cellV(p.x, p.y);
    const canGrab = grippable(here) && (!p.tired || p.stam >= GRAB_MIN + 4);
    const anchorAbove = neighbors.some((n) => n.mode === "grip" && n.y > p.y + 0.4);
    if (mem.waitAbove >= 0 && (!p.hang || !anchorAbove)) mem.waitAbove = -1;
    if (canGrab) {
      const waiting = mem.waitAbove >= 0 && p.y < mem.waitAbove;
      // 줄에 매달려 쉬는 중이면 체력이 좀 찰 때까지 그대로
      const resting = p.hang && p.tired && p.stam < 45 && anchorAbove;
      if (!waiting && !resting) {
        mem.waitAbove = -1;
        pressGrab(rt, seat);
      }
    } else {
      // 잡을 수 있는 가장 가까운 열 쪽으로 몸을 흔든다
      const c0 = Math.floor(p.x + WALL_W / 2);
      for (let d = 1; d <= 3; d++) {
        const l = grippable(cellV(cx(c0 - d), p.y));
        const r = grippable(cellV(cx(c0 + d), p.y));
        if (l || r) {
          inp.mx = l && r ? (rnd(rt.botRng) < 0.5 ? -1 : 1) : l ? -1 : 1;
          break;
        }
      }
    }
    return;
  }

  // ── 잡고 있음 ──
  const here = cellV(p.x, p.y);
  const onLedge = here === LEDGE;
  const dist = distOf(rt);
  // 줄이 거의 팽팽한 옆 사람 — 이 사람에게서 더 멀어지는 칸으로는 못 간다
  const tight = neighbors.filter((n) => n.mode === "grip" && Math.hypot(n.x - p.x, n.y - p.y) > ROPE_LEN - 0.9);
  const climbStep = () => {
    const i = cellIndex(rt.course, p.x, p.y);
    if (i < 0) return;
    const r = Math.floor(i / WALL_W);
    const c = i % WALL_W;
    let best = dist[i];
    let br = r;
    let bc = c;
    // 길이 서로 갈려 줄에 막혔을 때 쓸 차선: 팽팽한 옆 사람에게 가장 가까워지는 칸
    let nearD = Infinity;
    let nr = r;
    let nc = c;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr > rt.course.height || cc < 0 || cc >= WALL_W) continue;
        const j = rr * WALL_W + cc;
        if (!grippable(cells[j])) continue;
        if (dr && dc && !grippable(cells[r * WALL_W + cc]) && !grippable(cells[rr * WALL_W + c])) continue;
        if (tight.length) {
          const far = tight.some((n) => Math.hypot(n.x - cx(cc), n.y - (rr + 0.5)) > Math.hypot(n.x - p.x, n.y - p.y) + 0.05);
          const d0 = Math.hypot(tight[0].x - cx(cc), tight[0].y - (rr + 0.5));
          if (!far && d0 < nearD) {
            nearD = d0;
            nr = rr;
            nc = cc;
          }
          if (far) continue;
        }
        if (dist[j] < best) {
          best = dist[j];
          br = rr;
          bc = cc;
        }
      }
    if (br === r && bc === c) {
      if (!tight.length || (nr === r && nc === c)) return;
      br = nr;
      bc = nc;
    }
    const dx = cx(bc) - p.x;
    const dy = br + 0.5 - p.y;
    const l = Math.hypot(dx, dy) || 1;
    inp.mx = (dx / l) * prm.speed;
    inp.my = (dy / l) * prm.speed;
    return { row: br, col: bc };
  };

  // 1) 매달린 옆 사람 끌어올리기
  let hanging = false;
  let stuck = false;
  for (const n of neighbors) {
    if (n.mode !== "air") continue;
    hanging = true;
    inp.haul = true;
    const seg = Math.min(seat, n.seat);
    if (s.ropes[seg] <= ROPE_MIN + 0.05 && n.y < p.y) stuck = true;
  }
  if (hanging) {
    // 줄을 다 감았는데도 못 잡고 있으면 위로 끌고 올라간다
    if (stuck && p.stam > 12 && !p.summit) climbStep();
    return;
  }
  if (p.summit) return;

  // 2) 낙석 피하기
  if (s.t >= mem.dodgeUntil) {
    for (const r of s.rocks) {
      if (Math.abs(r.x - p.x) > 1.05 || r.y < p.y - 0.4 || r.y - p.y > 14) continue;
      if (rnd(rt.botRng) < prm.dodge) {
        const want = p.x >= r.x ? 1 : -1;
        mem.dodgeDir = grippable(cellV(p.x + want * 0.9, p.y)) ? want : -want;
        mem.dodgeUntil = s.t + 750;
      } else {
        // 이번 돌은 못 봄
        mem.dodgeDir = 0;
        mem.dodgeUntil = s.t + 900;
      }
      break;
    }
  }
  if (s.t < mem.dodgeUntil && mem.dodgeDir !== 0) {
    if (grippable(cellV(p.x + mem.dodgeDir * 0.6, p.y))) inp.mx = mem.dodgeDir;
    return;
  }

  // 3) 쉬기
  if (onLedge && p.stam < 88) return;
  if (!onLedge && p.stam < prm.restAt) {
    const c0 = Math.floor(p.x + WALL_W / 2);
    const r0 = Math.floor(p.y);
    let best = Infinity;
    let tx = 0;
    let ty = 0;
    for (let dr = -3; dr <= 2; dr++)
      for (let dc = -4; dc <= 4; dc++) {
        const rr = r0 + dr;
        const cc = c0 + dc;
        if (rr < 0 || cc < 0 || cc >= WALL_W || rr > rt.course.height) continue;
        if (cells[rr * WALL_W + cc] !== LEDGE) continue;
        const d = Math.abs(dr) + Math.abs(dc);
        if (d < best) {
          best = d;
          tx = cx(cc);
          ty = rr + 0.3;
        }
      }
    if (best < Infinity) {
      const dx = tx - p.x;
      const dy = ty - p.y;
      const l = Math.hypot(dx, dy) || 1;
      inp.mx = (dx / l) * prm.speed;
      inp.my = (dy / l) * prm.speed;
      return;
    }
    // 턱이 없으면: 영리한 봇은 체력 넉넉한 동료 줄에 매달려 쉰다
    if (prm.smart && p.stam < 10 && neighbors.some((n) => n.mode === "grip" && n.stam > 50 && n.y > p.y + 0.6)) {
      p.tired = true;
      pressGrab(rt, seat);
      return;
    }
  }

  // 4) 줄이 팽팽해지면 아래 동료를 기다린다
  for (const n of neighbors) {
    if (n.mode !== "grip") continue;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d > ROPE_LEN - 0.7 && n.y < p.y - 0.4) {
      // 기다리는 동안 그 사람 머리 위쪽으로 옆걸음 — 줄이 옆으로 벌어져 가운데 사람이 끼이지 않게
      const dx = n.x - p.x;
      if (Math.abs(dx) > 1 && grippable(cellV(p.x + Math.sign(dx) * 0.9, p.y))) inp.mx = Math.sign(dx) * prm.speed;
      return;
    }
  }

  // 5) 오르기
  const next = climbStep();
  if (!next) return;
  // 5-1) 오버행 틈 앞: 위쪽 동료가 띠를 넘어 버티고 있으면 손을 놓고 끌려 올라간다
  if (prm.smart && cells[next.row * WALL_W + next.col] === OVERHANG && here !== OVERHANG) {
    const band = rt.course.bands.find((b) => next.row >= b.r0 && next.row <= b.r1);
    const anchor = band ? neighbors.find((n) => n.mode === "grip" && n.y >= band.r1 + 1 && n.stam > 35 && Math.hypot(n.x - p.x, n.y - p.y) <= ROPE_LEN) : undefined;
    if (band && anchor) {
      inp.mx = 0;
      inp.my = 0;
      mem.waitAbove = band.r1 + 1.1;
      pressGrab(rt, seat);
      return;
    }
  }
  // 5-2) 낮은 레벨은 가끔 손이 미끄러진다
  if (prm.slip > 0 && !onLedge && rnd(rt.botRng) < (prm.slip * prm.thinkMs) / 1000) {
    inp.mx = 0;
    inp.my = 0;
    pressGrab(rt, seat);
  }
}
