import { MAX_WINDOW, TICKS, VAULT, canStep, neighbors } from "./data";
import { caseLog, contradictionsOf, type GameState, type LogEntry, type Seat } from "./engine";

/**
 * 추리 (규칙서 §8·§10) — 봇과 결과 화면의 "수사 요약"이 함께 쓴다. 언제나 한 좌석의 보기만 받는다.
 *
 * 범인이 x라는 가설 하나 = (조작 구간 from~to, 그 구간의 실제 동선). 영상은 모두에게 공개돼 있으므로
 * x의 영상에서 가능한 가설을 전부 늘어놓고, 지금까지 드러난 사실과 안 맞는 가설을 지운다.
 *   - 센서 대조: 그 칸의 실제 인원 = 영상 인원 − (x가 영상에만 있음) + (x가 실제로만 있음)
 *   - 내 기억: 내가 실제로 본 사람과 가설의 x 위치가 맞아야 한다 (손님만)
 *   - 증언 A→B: 손님은 사실만 증언할 수 있으므로 범인은 A(거짓말) 아니면 B(증언 내용이 사실)
 * 남은 가설의 무게를 더한 것이 그 좌석의 의심도.
 */

export interface DeduceOptions {
  /** 금고실에 다녀올 틈(가설)이 있는 사람만 용의자로 본다 */
  opportunity: boolean;
  /** 센서 대조 결과를 쓴다 */
  checks: boolean;
  /** 증언이 나오면 범인은 증언자·지목된 사람 둘 중 하나 */
  pair: boolean;
  /** 내가 실제로 본 사람으로 가설을 지운다 */
  sight: boolean;
  /** 증언 내용이 지목된 사람의 가설과 맞는지 본다 */
  claims: boolean;
}

export const FULL_DEDUCE: DeduceOptions = { opportunity: true, checks: true, pair: true, sight: true, claims: true };

export interface Knowledge {
  /** 좌석별 의심도 (0 = 범인일 수 없다) */
  weight: number[];
  /** 합이 1인 확률 (모두 0이면 전부 0) */
  prob: number[];
  /** 확실한 범인 (내 기억과 영상이 어긋났거나, 남은 용의자가 하나) */
  certain: Seat | null;
  /** [좌석] → 칸(t*10+room) → 그 좌석이 범인일 때 센서가 영상과 어긋날 확률. 가설을 안 쓰면 null */
  mismatch: (Map<number, number> | null)[];
  /** 좌석별로 남은 가설이 덮는 시각 (화면 요약용) */
  windows: number[][];
}

interface Hyp {
  from: number;
  /** 조작 구간의 실제 동선 */
  truth: number[];
  w: number;
}

/** 조작 구간 길이별 사전 확률 — 짧을수록 들킬 칸이 적어 범인이 고르기 쉽다 */
const LEN_PRIOR = [0, 0.5, 0.3, 0.2];

export const cellKey = (t: number, room: number) => t * 10 + room;

/** 이 영상의 주인이 범인이라면 가능한 (구간, 실제 동선) 전부 */
export function hypothesesOf(footage: number[]): Hyp[] {
  const out: Hyp[] = [];
  if (!footage || footage.length !== TICKS + 1) return out;
  for (let len = 1; len <= MAX_WINDOW; len++) {
    for (let from = 1; from + len - 1 <= TICKS; from++) {
      const to = from + len - 1;
      const found: number[][] = [];
      const seq: number[] = [];
      const walk = (prev: number) => {
        if (seq.length === len) {
          if (to < TICKS && !canStep(prev, footage[to + 1])) return;
          if (!seq.includes(VAULT)) return;
          // 구간 양 끝이 영상과 같으면 더 짧은 구간의 가설과 같다
          if (seq[0] === footage[from] || seq[len - 1] === footage[to]) return;
          found.push([...seq]);
          return;
        }
        for (const r of [prev, ...neighbors(prev)]) {
          seq.push(r);
          walk(r);
          seq.pop();
        }
      };
      walk(footage[from - 1]);
      for (const truth of found) out.push({ from, truth, w: LEN_PRIOR[len] / found.length });
    }
  }
  return out;
}

/** 가설에서 x가 시각 t에 실제로 있던 방 */
function truthAt(footage: number[], h: Hyp, t: number): number {
  const i = t - h.from;
  return i >= 0 && i < h.truth.length ? h.truth[i] : footage[t];
}

type Check = Extract<LogEntry, { kind: "check" }>;
type Claim = Extract<LogEntry, { kind: "testify" }>;

/**
 * `viewer`의 눈으로 본 추리. viewer = -1이면 "모두가 아는 것"만 쓴다(범인 봇이 남들 생각을 짐작할 때).
 * view는 그 좌석의 보기(또는 전체 상태)여야 한다 — 남의 실제 동선은 읽지 않는다.
 */
export function deduce(view: GameState, viewer: Seat, opts: DeduceOptions = FULL_DEDUCE): Knowledge {
  const n = view.seatCount;
  const log = caseLog(view);
  const checks = opts.checks ? (log.filter((e) => e.kind === "check") as Check[]) : [];
  const claims = opts.pair ? (log.filter((e) => e.kind === "testify") as Claim[]) : [];
  const guest = viewer >= 0 && viewer < n && view.culprit !== viewer && (view.truth[viewer]?.length ?? 0) > 0;
  const mine = guest ? view.truth[viewer] : null;
  const sight = guest ? view.sight[viewer] : null;

  const weight = Array(n).fill(0);
  const mismatch: (Map<number, number> | null)[] = Array(n).fill(null);
  const windows: number[][] = Array.from({ length: n }, () => []);

  const seen = guest ? contradictionsOf(view, viewer) : [];
  if (seen.length > 0) {
    // 내 기억과 영상이 어긋났다 — 영상이 가짜인 사람은 범인뿐
    weight[seen[0].target] = 1;
  } else {
    for (let x = 0; x < n; x++) {
      if (guest && x === viewer) continue;
      // 증언: 범인은 증언자 아니면 지목된 사람
      if (claims.some((c) => c.seat !== x && c.target !== x)) continue;
      const f = view.footage[x];
      if (!opts.opportunity) {
        // 가설 없이: 영상 인원이 더 많은 칸이 나왔으면 범인은 그 칸에 찍힌 사람 중 하나
        const cleared = checks.some((c) => c.footage > c.truth && f?.[c.t] !== c.room);
        weight[x] = cleared ? 0 : 1;
        continue;
      }
      const mm = new Map<number, number>();
      const covered = new Set<number>();
      let total = 0;
      for (const h of hypothesesOf(f)) {
        let ok = true;
        for (const c of checks) {
          const predicted = c.footage - (f[c.t] === c.room ? 1 : 0) + (truthAt(f, h, c.t) === c.room ? 1 : 0);
          if (predicted !== c.truth) {
            ok = false;
            break;
          }
        }
        if (ok && opts.sight && mine && sight) {
          for (let t = 1; t <= TICKS; t++) {
            if ((truthAt(f, h, t) === mine[t]) !== sight[t].includes(x)) {
              ok = false;
              break;
            }
          }
        }
        if (ok && opts.claims) {
          for (const c of claims) {
            if (c.target !== x) continue;
            const here = truthAt(f, h, c.t) === c.room;
            if (c.claim === "absent" ? here : !here) {
              ok = false;
              break;
            }
          }
        }
        if (!ok) continue;
        total += h.w;
        for (let i = 0; i < h.truth.length; i++) {
          const t = h.from + i;
          covered.add(t);
          const tr = h.truth[i];
          if (tr === f[t]) continue;
          mm.set(cellKey(t, f[t]), (mm.get(cellKey(t, f[t])) ?? 0) + h.w);
          if (tr !== VAULT) mm.set(cellKey(t, tr), (mm.get(cellKey(t, tr)) ?? 0) + h.w);
        }
      }
      weight[x] = total;
      if (total > 0) for (const [k, v] of mm) mm.set(k, v / total);
      mismatch[x] = mm;
      windows[x] = [...covered].sort((a, b) => a - b);
    }
  }

  const sum = weight.reduce((a: number, b: number) => a + b, 0);
  const prob = weight.map((w: number) => (sum > 0 ? w / sum : 0));
  const alive = weight.map((w: number, s: number) => (w > 0 ? s : -1)).filter((s: number) => s >= 0);
  return { weight, prob, certain: alive.length === 1 ? alive[0] : null, mismatch, windows };
}

/** 이 칸을 대조했을 때 영상과 어긋날 확률 (지금 아는 것 기준) */
export function mismatchChance(k: Knowledge, t: number, room: number): number {
  let p = 0;
  const key = cellKey(t, room);
  for (let x = 0; x < k.prob.length; x++) if (k.prob[x] > 0) p += k.prob[x] * (k.mismatch[x]?.get(key) ?? 0);
  return p;
}

/** 좌석 x가 범인이라는 가설 중 "시각 t에 방 room에 있었다/없었다"와 맞는 것이 있나 (영상만으로) */
export function claimPossible(view: GameState, x: Seat, t: number, room: number, there: boolean): boolean {
  const f = view.footage[x];
  if (!f || f.length !== TICKS + 1) return false;
  return hypothesesOf(f).some((h) => (truthAt(f, h, t) === room) === there && t >= h.from && t < h.from + h.truth.length);
}

/** 금고실에 다녀올 틈이 영상에 있는 좌석들 (아무 수사도 하기 전의 용의선상) */
export function opportunitySeats(view: GameState): Seat[] {
  const out: Seat[] = [];
  for (let s = 0; s < view.seatCount; s++) if (hypothesesOf(view.footage[s]).length > 0) out.push(s);
  return out;
}

