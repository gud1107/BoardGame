import { WINDMILL_PERIOD } from "./physics";

/**
 * The windmill clock this screen draws the blades with (rulebook §8). It
 * runs with performance.now(); when a stroke replays, the scene aligns it to
 * the clock that stroke was hit at, so the blades on screen are where the
 * physics had them. The shooter's `wm` is read from this same clock at the
 * moment of the hit — what you see is what you hit through.
 */
let offset = 0;

export function windmillNow(): number {
  return performance.now() / 1000 + offset;
}

export function alignWindmill(clock: number) {
  offset = clock - performance.now() / 1000;
}

/** 0..1 through one turn of the blades. */
export function windmillTurn(clock: number): number {
  const p = clock / WINDMILL_PERIOD;
  return p - Math.floor(p);
}
