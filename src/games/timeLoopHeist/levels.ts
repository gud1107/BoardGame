/**
 * 시간 루프 도둑단 — 작전(레벨) 데이터.
 *
 * 지도 글자:
 *   `#` 벽 · `.` 바닥 · `S` 출발점(모든 자아가 0틱에 여기서 시작) · `V` 탈출 밴(보석을 들고 밟으면 입금)
 *   `*` 보석 · `$` 동전(보너스) · `P` `Q` `R` 압력 발판 · `L` `M` 레버(한 번 당기면 고정)
 *   `E` EMP 콘솔(사용하면 모든 경비 로봇이 EMP_TICKS 동안 멈추고 눈이 꺼짐)
 *   `1`~`6` 문 — `gates[글자].need`의 장치가 "모두" 켜져 있을 때만 열림(누가 서 있으면 닫히지 않음)
 *
 * 경비 로봇은 `path`를 왕복하고, 바라보는 쪽으로 `VISION`칸(벽·닫힌 문에 막힘)과 자기 칸을 본다.
 *
 * `roles` / 봇: 봇은 "지금 가져올 수 있는 보석"이 있으면 가져오고, 없으면 `roles`를 앞에서부터
 * 보며 아직 지난 루프에서 해결되지 않은 역할(발판 지키기·레버·EMP)을 맡는다. 셀프플레이
 * 테스트(engine.test.ts)가 1~4인 모두 루프 한도 안에 깨는지 확인한다.
 */

export type GateKind = "door" | "laser";

export type RoleStep =
  | { kind: "lever"; trig: string }
  | { kind: "hold"; trig: string; from: number }
  | { kind: "press"; trig: string; at: number };

export interface RoleDef {
  id: string;
  label: string;
  steps: RoleStep[];
}

export interface LevelDef {
  id: string;
  name: string;
  emoji: string;
  /** 작전 브리핑 한두 문장 */
  blurb: string;
  /** 처음 하는 사람용 힌트 */
  hint: string;
  rows: string[];
  gates: Record<string, { need: string[]; kind: GateKind }>;
  guards: { path: [number, number][] }[];
  /** 한 루프의 틱 수 */
  ticks: number;
  /** 인원(1~4)별 필요 보석 수 — 인덱스 = 인원 */
  need: [0, number, number, number, number];
  /** 인원별 최대 루프 수 */
  loops: [0, number, number, number, number];
  /** 인원별 기준 루프(이하면 ⭐ 추가) */
  par: [0, number, number, number, number];
  roles: RoleDef[];
}

export const LEVELS: LevelDef[] = [
  {
    id: "plates",
    name: "1호 전시실 · 발판의 기억",
    emoji: "🟨",
    blurb: "전시실 두 곳은 압력 발판을 누르고 있어야만 문이 열려요. 발판은 문에서 멀어서 혼자서는 누르면서 지나갈 수 없죠. 지난 루프의 내가 발판을 지키게 하세요!",
    hint: "첫 루프: 발판 위로 가서 끝까지 대기(·). 다음 루프: 열린 문으로 들어가 보석을 들고 🚐 밴으로!",
    rows: [
      "############",
      "#....#....$#",
      "#SV..1...*.#",
      "#....#.....#",
      "#....#######",
      "#P...#.....#",
      "#Q...2..*..#",
      "#....#....$#",
      "############",
    ],
    gates: { "1": { need: ["P"], kind: "door" }, "2": { need: ["Q"], kind: "laser" } },
    guards: [],
    ticks: 30,
    need: [0, 1, 2, 2, 2],
    loops: [0, 3, 3, 3, 3],
    par: [0, 2, 2, 2, 2],
    roles: [
      { id: "P", label: "발판 P 지키기", steps: [{ kind: "hold", trig: "P", from: 6 }] },
      { id: "Q", label: "발판 Q 지키기", steps: [{ kind: "hold", trig: "Q", from: 6 }] },
    ],
  },
  {
    id: "two-keys",
    name: "2호 금고 · 두 개의 열쇠",
    emoji: "🗝️",
    blurb: "가운데 금고 문은 서쪽 발판 P와 동쪽 발판 Q가 동시에 눌려야 열려요. 동쪽 방은 복도의 레버 L을 당겨야 들어갈 수 있어요.",
    hint: "같은 루프의 동료는 서로 안 보여요. 이번 루프에 P와 Q를 나눠 지키고, 다음 루프에 금고를 털어요.",
    rows: [
      "#############",
      "#$...#*.*#.$#",
      "#.P..#...#.Q#",
      "#....#...#..#",
      "###.###3###5#",
      "#...........#",
      "#SV...L.....#",
      "#############",
    ],
    gates: { "3": { need: ["P", "Q"], kind: "door" }, "5": { need: ["L"], kind: "laser" } },
    guards: [],
    ticks: 36,
    need: [0, 1, 2, 2, 2],
    loops: [0, 4, 3, 3, 3],
    par: [0, 3, 2, 2, 2],
    roles: [
      { id: "P", label: "발판 P 지키기", steps: [{ kind: "hold", trig: "P", from: 9 }] },
      { id: "Q", label: "레버 L → 발판 Q 지키기", steps: [{ kind: "lever", trig: "L" }, { kind: "hold", trig: "Q", from: 17 }] },
    ],
  },
  {
    id: "patrol",
    name: "3호 회랑 · 경비 로봇",
    emoji: "🤖",
    blurb: "보석 방 문은 회랑 가운데 벽감의 발판 P로 열려요. 회랑에는 경비 로봇이 왕복하며 앞 3칸을 감시해요. 들키면 그 자아는 체포!",
    hint: "로봇은 바라보는 쪽 3칸만 봐요 — 등 뒤를 따라가거나 벽감에 숨어요. 홀의 EMP 콘솔(E)을 쓰면 로봇이 8틱 동안 멈춰요.",
    rows: [
      "###############",
      "#E..#######.*.#",
      "#...#######...#",
      "#..........6.*#",
      "#...###.###...#",
      "#SV.###P###.$.#",
      "###############",
    ],
    gates: { "6": { need: ["P"], kind: "door" } },
    guards: [
      {
        path: [
          [5, 3],
          [6, 3],
          [7, 3],
          [8, 3],
          [9, 3],
          [10, 3],
        ],
      },
    ],
    ticks: 40,
    need: [0, 1, 2, 2, 2],
    loops: [0, 4, 3, 3, 3],
    par: [0, 3, 2, 2, 2],
    roles: [
      { id: "P", label: "벽감 발판 P 지키기", steps: [{ kind: "hold", trig: "P", from: 17 }] },
      {
        id: "E",
        label: "EMP 콘솔 지키기",
        steps: [
          { kind: "press", trig: "E", at: 14 },
          { kind: "press", trig: "E", at: 24 },
        ],
      },
    ],
  },
  {
    id: "grand-vault",
    name: "4호 대금고 · 시간의 사슬",
    emoji: "🏛️",
    blurb: "레버 L이 북쪽 전시관을, 전시관의 발판 P가 대금고를, 대금고의 발판 Q가 남쪽 갤러리를 엽니다. 갤러리엔 경비 로봇이 왕복해요. 세 겹의 사슬을 루프마다 한 겹씩!",
    hint: "보석 A는 레버만 당기면 가져올 수 있어요. B는 P를, C는 Q를 지난 루프의 누군가가 지켜야 해요.",
    rows: [
      "#################",
      "#P.....*.#$...*.#",
      "#........2......#",
      "##1#######....Q.#",
      "#....############",
      "#....############",
      "#....#.$.#..#...#",
      "#.L..3.........*#",
      "#....#...#..#...#",
      "#SV.E############",
      "#################",
    ],
    gates: {
      "1": { need: ["L"], kind: "laser" },
      "2": { need: ["P"], kind: "door" },
      "3": { need: ["Q"], kind: "door" },
    },
    guards: [
      {
        path: [
          [7, 7],
          [8, 7],
          [9, 7],
          [10, 7],
          [11, 7],
          [12, 7],
          [13, 7],
          [14, 7],
        ],
      },
    ],
    ticks: 48,
    need: [0, 2, 3, 3, 3],
    loops: [0, 4, 4, 4, 4],
    par: [0, 3, 3, 3, 3],
    roles: [
      { id: "P", label: "레버 L → 발판 P 지키기", steps: [{ kind: "lever", trig: "L" }, { kind: "hold", trig: "P", from: 12 }] },
      { id: "Q", label: "대금고 발판 Q 지키기", steps: [{ kind: "lever", trig: "L" }, { kind: "hold", trig: "Q", from: 24 }] },
      {
        id: "E",
        label: "EMP 콘솔 지키기",
        steps: [
          { kind: "press", trig: "E", at: 24 },
          { kind: "press", trig: "E", at: 31 },
          { kind: "press", trig: "E", at: 38 },
        ],
      },
    ],
  },
];

export function levelById(id: string): LevelDef {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0];
}

// ---------------------------------------------------------------- parsing

export type Cell = { x: number; y: number };

export interface ParsedLevel {
  def: LevelDef;
  w: number;
  h: number;
  /** y*w+x → true 벽 */
  wall: boolean[];
  spawn: Cell;
  van: Cell;
  loot: { id: number; kind: "gem" | "coin"; x: number; y: number }[];
  /** 장치(발판·레버·EMP) 글자 → 위치 */
  plates: Record<string, Cell>;
  levers: Record<string, Cell>;
  consoles: Record<string, Cell>;
  /** 문 글자 → 위치·조건 */
  gates: Record<string, Cell & { need: string[]; kind: GateKind }>;
  /** y*w+x → 문 글자 */
  gateAt: (string | null)[];
}

const cache = new Map<string, ParsedLevel>();

export function parseLevel(def: LevelDef): ParsedLevel {
  const hit = cache.get(def.id);
  if (hit && hit.def === def) return hit;
  const h = def.rows.length;
  const w = def.rows[0].length;
  const wall: boolean[] = new Array(w * h).fill(false);
  const gateAt: (string | null)[] = new Array(w * h).fill(null);
  const loot: ParsedLevel["loot"] = [];
  const plates: Record<string, Cell> = {};
  const levers: Record<string, Cell> = {};
  const consoles: Record<string, Cell> = {};
  const gates: ParsedLevel["gates"] = {};
  let spawn: Cell = { x: 1, y: 1 };
  let van: Cell = { x: 1, y: 1 };
  for (let y = 0; y < h; y++) {
    const row = def.rows[y];
    if (row.length !== w) throw new Error(`level ${def.id}: row ${y} width ${row.length} != ${w}`);
    for (let x = 0; x < w; x++) {
      const c = row[x];
      const i = y * w + x;
      if (c === "#") wall[i] = true;
      else if (c === "S") spawn = { x, y };
      else if (c === "V") van = { x, y };
      else if (c === "*") loot.push({ id: loot.length, kind: "gem", x, y });
      else if (c === "$") loot.push({ id: loot.length, kind: "coin", x, y });
      else if (c === "P" || c === "Q" || c === "R") plates[c] = { x, y };
      else if (c === "L" || c === "M") levers[c] = { x, y };
      else if (c === "E") consoles[c] = { x, y };
      else if (c >= "1" && c <= "6") {
        const g = def.gates[c];
        if (!g) throw new Error(`level ${def.id}: gate ${c} has no rule`);
        gates[c] = { x, y, need: g.need, kind: g.kind };
        gateAt[i] = c;
      }
    }
  }
  const parsed: ParsedLevel = { def, w, h, wall, spawn, van, loot, plates, levers, consoles, gates, gateAt };
  cache.set(def.id, parsed);
  return parsed;
}
