/**
 * 🁢 도미노 설계 — puzzle book on top of 도미노 연쇄's topple rules
 * (dominoChain/engine.ts `topple`, unchanged): straight falls, 🔀 splits
 * onto both forward diagonals, bells ring and let the fall pass through,
 * 💣 bombs knock all 8 neighbours, rocks and walls stop it.
 *
 * Puzzle rule (rulebook §4): you may stand a piece on ANY empty cell facing
 * any of the 8 directions (no frontier rule — there is only one chain).
 * Ring every bell with as few pieces as possible.
 */

import { fallDirs, stepCell, topple, type Cell, type FeatureKind, type Piece, type PieceKind, type RoundResult } from "@/games/dominoChain/engine";

export interface Placed {
  cell: number;
  kind: "domino" | "split";
  dir: number;
}

export interface DominoStage {
  id: string;
  title: string;
  goal: string;
  hint: string;
  size: number;
  /** Rows of the board, one char per cell:
   *  `.` empty · `1`–`3` bell · `*` bomb · `#` rock · `W` wall ·
   *  `P` pusher (facing `pusherDir`) · arrows `>` `v` `<` `^` fixed dominoes. */
  rows: string[];
  pusherDir: number;
  /** Pieces in hand. */
  dominoes: number;
  splits: number;
  /** Solver minimum of pieces for ringing every bell (⭐⭐⭐). */
  par: number;
  /** Rings every bell with `par` pieces (tests prove it). */
  solution: Placed[];
  /** Bombs must not go off for ⭐⭐⭐ ("조용히" stages). */
  noBomb?: boolean;
}

const ARROW: Record<string, number> = { ">": 0, v: 2, "<": 4, "^": 6 };

export function baseCells(stage: DominoStage): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < stage.size; r++) {
    for (let c = 0; c < stage.size; c++) {
      const ch = stage.rows[r]?.[c] ?? ".";
      let piece: Piece | null = null;
      let feature: Cell["feature"] = null;
      if (ch >= "1" && ch <= "3") feature = { kind: "bell", value: Number(ch) };
      else if (ch === "*") feature = { kind: "bomb", value: 0 };
      else if (ch === "#") feature = { kind: "rock", value: 0 };
      else if (ch === "W") piece = { kind: "wall", owner: 0, dir: 0 };
      else if (ch === "P") piece = { kind: "pusher", owner: 0, dir: stage.pusherDir };
      else if (ch in ARROW) piece = { kind: "domino", owner: 0, dir: ARROW[ch] };
      cells.push({ piece, feature });
    }
  }
  return cells;
}

export function withPlaced(base: readonly Cell[], placed: readonly Placed[]): Cell[] {
  const cells = base.slice();
  for (const p of placed) cells[p.cell] = { ...cells[p.cell], piece: { kind: p.kind as PieceKind, owner: 0, dir: p.dir } };
  return cells;
}

export const canPlace = (cells: readonly Cell[], i: number) => !cells[i].piece && !cells[i].feature;

export function bellCells(base: readonly Cell[]): number[] {
  const out: number[] = [];
  base.forEach((c, i) => c.feature?.kind === "bell" && out.push(i));
  return out;
}

export interface DominoOutcome {
  result: RoundResult;
  rung: number;
  bells: number;
  bombs: number;
  used: number;
  stars: number;
  tiers: { label: string; ok: boolean }[][];
}

export function runDomino(stage: DominoStage, placed: readonly Placed[]): DominoOutcome {
  const base = baseCells(stage);
  const cells = withPlaced(base, placed);
  const result = topple(cells, stage.size, 1, 0, 0);
  const rungSet = new Set(result.events.filter((e) => e.kind === "ring").map((e) => e.cell));
  const bells = bellCells(base);
  const rung = bells.filter((b) => rungSet.has(b)).length;
  const bombs = result.events.filter((e) => e.kind === "boom").length;
  const used = placed.length;
  const all = rung === bells.length;
  const tiers = [
    [{ label: `종 ${bells.length}개 모두 울리기`, ok: all }],
    [{ label: `조각 ${stage.par + 2}개 이하로`, ok: used <= stage.par + 2 }],
    [{ label: `조각 ${stage.par}개 이하로 (최소)`, ok: used <= stage.par }, ...(stage.noBomb ? [{ label: "폭탄은 터뜨리지 않기", ok: bombs === 0 }] : [])],
  ];
  let stars = 0;
  for (const t of tiers) {
    if (t.every((c) => c.ok)) stars++;
    else break;
  }
  return { result, rung, bells: bells.length, bombs, used, stars, tiers };
}

export interface Reach {
  fallen: Uint8Array;
  rung: Uint8Array;
  booms: number;
  /** Empty cells the chain lands on → arrival directions. */
  landings: Map<number, number[]>;
}

/**
 * Where one chain reaches, without the clock: with a single chain the
 * topple is order-independent (every piece falls once, along its own
 * facing), so a plain flood fill gives the same fallen / rung / boomed sets
 * as `topple` (tests cross-check). Used for the board's landing highlights
 * and by the solver, where `topple` would be far too slow.
 */
export function reach(size: number, cells: readonly Cell[]): Reach {
  const fallen = new Uint8Array(cells.length);
  const rung = new Uint8Array(cells.length);
  const boomed = new Uint8Array(cells.length);
  const seen = new Uint8Array(cells.length * 8);
  const landings = new Map<number, number[]>();
  const stack: number[] = [];
  let booms = 0;
  const push = (from: number, d: number) => {
    const j = stepCell(size, from, d);
    if (j >= 0 && !seen[j * 8 + d]) {
      seen[j * 8 + d] = 1;
      stack.push(j * 8 + d);
    }
  };
  cells.forEach((c, i) => {
    if (c.piece?.kind === "pusher") {
      fallen[i] = 1;
      for (const d of fallDirs(c.piece)) push(i, d);
    }
  });
  while (stack.length) {
    const v = stack.pop()!;
    const j = v >> 3;
    const d = v & 7;
    const c = cells[j];
    const p = c.piece;
    if (p) {
      if ((p.kind === "domino" || p.kind === "split") && !fallen[j]) {
        fallen[j] = 1;
        for (const d2 of fallDirs(p)) push(j, d2);
      }
    } else if (c.feature?.kind === "bell") {
      rung[j] = 1;
      push(j, d);
    } else if (c.feature?.kind === "bomb") {
      if (!boomed[j]) {
        boomed[j] = 1;
        booms++;
        for (let k = 0; k < 8; k++) push(j, k);
      }
    } else if (!c.feature) {
      const arr = landings.get(j) ?? [];
      if (!arr.includes(d)) arr.push(d);
      landings.set(j, arr);
    }
  }
  return { fallen, rung, booms, landings };
}

/** Empty cells the current chain would land on (highlighted on the board). */
export function landings(stage: DominoStage, cells: readonly Cell[]): Map<number, number[]> {
  return reach(stage.size, cells).landings;
}

function useful(cells: readonly Cell[], fallen: Uint8Array, j: number): boolean {
  if (j < 0) return false;
  const c = cells[j];
  if (c.feature?.kind === "rock") return false;
  if (c.piece?.kind === "wall") return false;
  return !fallen[j];
}

/**
 * Fewest pieces that ring every bell (iterative deepening over landing
 * cells; order of placement never matters in a one-chain topple). Returns
 * the first solution found at the minimum depth, or null within `maxDepth`.
 */
export function solveDomino(stage: DominoStage, maxDepth: number, opts: { noBomb?: boolean; minDepth?: number } = {}): Placed[] | null {
  const base = baseCells(stage);
  const bells = bellCells(base);
  const kinds: ("domino" | "split")[] = stage.splits > 0 ? ["domino", "split"] : ["domino"];
  const done = (r: Reach) => bells.every((b) => r.rung[b]) && (!opts.noBomb || r.booms === 0);
  for (let depth = opts.minDepth ?? 0; depth <= maxDepth; depth++) {
    const seen = new Set<string>();
    const dfs = (placed: Placed[], splitsUsed: number): Placed[] | null => {
      const cells = withPlaced(base, placed);
      const r = reach(stage.size, cells);
      if (placed.length === depth) return done(r) ? placed : null;
      if (opts.noBomb && r.booms > 0) return null;
      for (const [cell] of r.landings) {
        for (const kind of kinds) {
          if (kind === "split" && splitsUsed >= stage.splits) continue;
          if (kind === "domino" && placed.length - splitsUsed >= stage.dominoes) continue;
          for (let dir = 0; dir < 8; dir++) {
            // a piece that can only fall off the board, onto a rock/wall or onto something already down adds nothing
            const targets = kind === "split" ? [(dir + 7) % 8, (dir + 1) % 8] : [dir];
            if (!targets.some((d) => useful(cells, r.fallen, stepCell(stage.size, cell, d)))) continue;
            const next = [...placed, { cell, kind, dir }];
            const key = next
              .map((p) => p.cell * 16 + (p.kind === "split" ? 8 : 0) + p.dir)
              .sort((a, b) => a - b)
              .join(",");
            if (seen.has(key)) continue;
            seen.add(key);
            const res = dfs(next, splitsUsed + (kind === "split" ? 1 : 0));
            if (res) return res;
          }
        }
      }
      return null;
    };
    const res = dfs([], 0);
    if (res) return res;
  }
  return null;
}

export type { FeatureKind };
