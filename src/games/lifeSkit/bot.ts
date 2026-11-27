import { ROLES, SCENE_COUNT, type RoleDef } from "./data";
import { choicesFor, pendingSeats, rawOf, resolveSeat, roleOf, type EngineAction, type GameState, type Seat, type SeatState } from "./engine";

/** 이 상태에서 남은 장면을 살았을 때의 (가장 잘 산 점수, 아무렇게나 산 평균) — 배역당 상태 수가 적어 통째로 기억해 둔다 */
const futureMemo = new Map<string, [number, number]>();
function future(role: RoleDef, scene: number, seat: SeatState): [number, number] {
  if (scene >= SCENE_COUNT) {
    const v = rawOf(role, seat);
    return [v, v];
  }
  const key = `${role.id}|${scene}|${seat.stats.join(",")}|${[...seat.tags].sort().join(",")}`;
  const hit = futureMemo.get(key);
  if (hit) return hit;
  let best = -Infinity;
  let sum = 0;
  const n = role.scenes[scene].choices.length;
  for (let i = 0; i < n; i++) {
    const [mx, mean] = future(role, scene + 1, resolveSeat(role, scene, seat, i, false));
    if (mx > best) best = mx;
    sum += mean;
  }
  const out: [number, number] = [best, sum / n];
  futureMemo.set(key, out);
  return out;
}

/**
 * 인생 상황극 AI. 배역은 아무거나, 장면에서는 레벨이 높을수록 "이 선택이 남은 인생을 어디로
 * 데려가는지"(대가·성격·나비효과·엔딩까지)를 내다보고 고른다 — 낮은 레벨은 사람처럼 눈에 보이는
 * 이득(힌트)과 ⚡ 지름길에 끌린다.
 * `rand`는 0..1 난수(방장 기기에서만 호출되므로 결정적일 필요가 없다. 테스트는 시드를 넣는다).
 */
export function chooseBotAction(state: GameState, seat: Seat, level: number, rand: () => number = Math.random): EngineAction | null {
  const me = state.seats[seat];
  if (!me) return null;
  if (state.phase === "cast") {
    return me.role === null ? { type: "PICK_ROLE", seat, role: ROLES[Math.floor(rand() * ROLES.length)].id } : null;
  }
  if (state.phase === "choose") {
    if (me.pending !== null) return null;
    const options = choicesFor(state, seat);
    const role = roleOf(state, seat)!;
    const insight = Math.max(0, Math.min(1, (level - 1) / 9));
    const looks = options.map((_, i) => {
      const [mx, mean] = future(role, state.scene + 1, resolveSeat(role, state.scene, me, i, false));
      return (mx + mean) / 2;
    });
    const base = looks.reduce((a, b) => a + b, 0) / looks.length;
    let best = 0;
    let bestScore = -Infinity;
    options.forEach((o, i) => {
      const real = (looks[i] - base) / 4;
      const seen = o.hint.length * 1.5 + (o.fast ? 1 : 0);
      const score = real * insight + seen * (1 - insight) + rand() * (3 - insight * 2.5);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return { type: "CHOOSE", seat, scene: state.scene, choice: best };
  }
  if (state.phase === "reveal") {
    if (me.ready) return null;
    if (me.clapTo === null && state.seatCount > 1 && rand() < 0.7) {
      // 수치가 가장 크게 움직인(웃긴) 장면에 박수
      const others = Array.from({ length: state.seatCount }, (_, s) => s).filter((s) => s !== seat);
      const drama = (s: Seat) => (state.seats[s].log[state.scene]?.fx ?? [0]).reduce((a, b) => a + Math.abs(b), 0) + rand() * 2;
      const to = others.reduce((a, b) => (drama(b) > drama(a) ? b : a));
      return { type: "CLAP", seat, scene: state.scene, to };
    }
    return { type: "READY", seat, scene: state.scene };
  }
  return null;
}

/** 지금 움직여야 하는 봇 좌석 */
export function nextBotSeat(state: GameState, bots: ReadonlySet<Seat>): Seat | null {
  return pendingSeats(state).find((s) => bots.has(s)) ?? null;
}
