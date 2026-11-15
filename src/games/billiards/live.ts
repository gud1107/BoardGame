import { CUE_ID, toSim, type Ball } from "./engine";
import { firstContact, R, railDistance, rollDistance, speedForPower } from "./physics";

/**
 * The shooter's live aim (rulebook §4) — direction, power, spin and the
 * hand-placed cue-ball spot. Local while I aim; broadcast at ~11 Hz so the
 * others watch the cue swing. Purely cosmetic: only the final `shoot`
 * action counts.
 */
export interface LiveAim {
  turn: number;
  /** Unit direction (table coords). */
  dx: number;
  dy: number;
  /** 0..1 cue draw-back. */
  power: number;
  /** −1 draw … +1 follow. */
  spin: number;
  /** −1 left … +1 right english. */
  side: number;
  /** Hand-placed cue ball spot (NaN = where it lies). */
  px: number;
  py: number;
  /** performance.now() of the last update. */
  at: number;
  remote?: boolean;
}

export interface Guide {
  /** Cue ball centre. */
  cx: number;
  cy: number;
  /** End of the dashed line (ghost ball spot or the cushion). */
  ex: number;
  ey: number;
  hit: { id: number; x: number; y: number; nx: number; ny: number } | null;
  /** Object ball path (along the contact normal) and the cue's deflection (tangent), lengths in table units. */
  objLen: number;
  cueTx: number;
  cueTy: number;
  cueLen: number;
}

/**
 * Ghost-ball guide (§4): where the cue ball first touches a ball (or the
 * cushion), and — with the long guide — the object ball's line and the cue
 * ball's tangent line after the hit. No bounce prediction beyond that.
 */
export function aimGuide(balls: readonly Ball[], aim: Pick<LiveAim, "dx" | "dy" | "power" | "px" | "py">, long: boolean): Guide | null {
  let list = balls;
  if (!Number.isNaN(aim.px)) list = balls.map((b) => (b.id === CUE_ID ? { ...b, x: aim.px, y: aim.py } : b));
  const cue = list.find((b) => b.id === CUE_ID);
  if (!cue) return null;
  const reach = Math.min(60, rollDistance(speedForPower(Math.max(0.15, aim.power))));
  const hit = firstContact(toSim(list), CUE_ID, aim.dx, aim.dy);
  const toRail = railDistance(cue.x, cue.y, aim.dx, aim.dy);
  let len = Math.min(toRail, reach);
  let h: Guide["hit"] = null;
  if (hit && hit.t <= Math.min(toRail, reach)) {
    len = hit.t;
    const ob = list.find((b) => b.id === hit.id)!;
    h = { id: hit.id, x: ob.x, y: ob.y, nx: hit.nx, ny: hit.ny };
  }
  const ex = cue.x + aim.dx * len;
  const ey = cue.y + aim.dy * len;
  let objLen = 0;
  let cueTx = 0;
  let cueTy = 0;
  let cueLen = 0;
  if (h && long) {
    // cut: object goes along the normal, cue ball along the tangent (stun-shot rule of thumb)
    const cos = aim.dx * h.nx + aim.dy * h.ny;
    objLen = Math.min(railDistance(h.x, h.y, h.nx, h.ny), 2 + 9 * cos * cos);
    cueTx = aim.dx - h.nx * cos;
    cueTy = aim.dy - h.ny * cos;
    const tl = Math.hypot(cueTx, cueTy);
    if (tl > 1e-4) {
      cueTx /= tl;
      cueTy /= tl;
      cueLen = Math.min(railDistance(ex, ey, cueTx, cueTy), 1.5 + 5 * (1 - cos * cos));
    }
  }
  return { cx: cue.x, cy: cue.y, ex, ey, hit: h, objLen, cueTx, cueTy, cueLen };
}

export const GHOST_R = R;
