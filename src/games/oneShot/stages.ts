import type { Motion, SegmentDef, Shot, StageDef, TargetDef, Vec } from "./sim";

/**
 * 한 발의 묘수 stage book. Every `solution` / `myosuSolution` was found by the
 * grid solver (scripts in the session scratchpad, re-checked by
 * `OneShot.test.ts`), which also measures how wide each answer's timing
 * window is — that width is the real difficulty knob.
 */

const P = (x: number, y: number): Vec => ({ x, y });
const at = (x: number, y: number): Motion => ({ k: "static", p: P(x, y) });
const line = (ax: number, ay: number, bx: number, by: number, period: number, phase = 0): Motion => ({ k: "line", a: P(ax, ay), b: P(bx, by), period, phase });
const orbit = (cx: number, cy: number, r: number, period: number, phase = 0): Motion => ({ k: "orbit", c: P(cx, cy), r, period, phase });
const pend = (px: number, py: number, len: number, amp: number, period: number, phase = 0): Motion => ({ k: "pendulum", pivot: P(px, py), len, amp, period, phase });

const tg = (id: string, m: Motion, r = 26): TargetDef => ({ id, kind: "target", m, r });
const hs = (id: string, m: Motion, r = 26): TargetDef => ({ id, kind: "hostage", m, r });

function seg(id: string, kind: "wall" | "mirror", x1: number, y1: number, x2: number, y2: number, extra: Partial<SegmentDef> = {}): SegmentDef {
  return { id, kind, c: P((x1 + x2) / 2, (y1 + y2) / 2), len: Math.hypot(x2 - x1, y2 - y1), angle: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI, ...extra };
}
const wall = (id: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<SegmentDef> = {}) => seg(id, "wall", x1, y1, x2, y2, extra);
const mirror = (id: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<SegmentDef> = {}) => seg(id, "mirror", x1, y1, x2, y2, extra);

/** Rotating shield: `count` plates orbiting a point, each spanning `arc` degrees. */
function shield(id: string, cx: number, cy: number, radius: number, count: number, arc: number, period: number, phase = 0): SegmentDef[] {
  return Array.from({ length: count }, (_, i) => {
    const off = phase + i / count;
    return {
      id: `${id}${i}`,
      kind: "wall" as const,
      c: P(cx, cy),
      move: orbit(cx, cy, radius, period, off),
      len: 2 * radius * Math.sin(((arc / 2) * Math.PI) / 180),
      angle: off * 360 + 90,
      spin: 360 / period,
    };
  });
}

const s = (tick: number, angle: number): Shot => ({ tick, angle });

type Draft = Omit<StageDef, "id" | "chapter" | "index" | "segments" | "barrels" | "weights"> & Partial<Pick<StageDef, "segments" | "barrels" | "weights">>;

function chapter(n: number, list: Draft[]): StageDef[] {
  return list.map((d, i) => ({ segments: [], barrels: [], weights: [], ...d, id: `${n}-${i + 1}`, chapter: n, index: i + 1 }));
}

export const CHAPTERS = [
  { n: 1, title: "사격장 입문", emoji: "🎯", desc: "총알은 날아가는 데 시간이 걸리고, 표적을 뚫고 지나가요." },
  { n: 2, title: "철판 도탄", emoji: "🪞", desc: "철판에 맞은 총알은 튕겨 나가요. 돌아가는 철판은 타이밍이 곧 각도." },
  { n: 3, title: "방패와 인질", emoji: "🛡️", desc: "인질을 맞히면 즉시 실패. 방패 틈은 잠깐만 열려요." },
  { n: 4, title: "샹들리에", emoji: "🪢", desc: "밧줄을 끊으면 떨어지는 무게추가 표적을 덮쳐요." },
  { n: 5, title: "화약통", emoji: "🛢️", desc: "화약통은 주변을 날려 버리고, 옆 화약통도 터뜨려요." },
] as const;

export const STAGES: StageDef[] = [
  ...chapter(1, [
    {
      title: "첫 발",
      brief: "조준하고 쏘세요. 관찰 모드에서 시간을 멈춰 볼 수도 있어요.",
      hint: "표적은 움직이지 않아요. 똑바로 겨누면 끝!",
      duration: 8,
      ammo: 3,
      par: 1,
      targets: [tg("a", at(720, 300), 30)],
      solution: [s(240, -22.5)],
    },
    {
      title: "움직이는 과녁",
      brief: "총알이 날아가는 동안 표적도 움직여요.",
      hint: "표적이 지나갈 자리를 미리 겨누세요 (리드샷).",
      duration: 8,
      ammo: 3,
      par: 1,
      targets: [tg("a", line(760, 110, 760, 470, 3.2))],
      solution: [s(668, -30)],
    },
    {
      title: "겹치는 순간",
      brief: "총알 한 발에 둘 다. 총알은 표적을 뚫고 지나가요.",
      hint: "두 표적과 총구가 한 줄로 서는 순간이 있어요.",
      duration: 10,
      ammo: 2,
      par: 1,
      targets: [tg("a", line(460, 140, 460, 460, 4)), tg("b", line(860, 120, 860, 470, 4, 0.5))],
      solution: [s(608, -25)],
    },
    {
      title: "회전목마",
      brief: "빙글빙글 도는 표적과 오가는 표적.",
      hint: "두 발이면 쉬워요. 하지만 한 줄로 서는 순간도 있을지 몰라요.",
      duration: 10,
      ammo: 3,
      par: 2,
      myosu: 1,
      targets: [tg("a", orbit(560, 260, 110, 5)), tg("b", line(840, 120, 840, 460, 3.4, 0.25)), tg("c", at(320, 420), 24)],
      solution: [s(104, -16.5), s(286, -22.5)],
      myosuSolution: [s(578, -22)],
    },
  ]),
  ...chapter(2, [
    {
      title: "벽 너머",
      brief: "벽 뒤의 표적. 천장의 철판을 이용하세요.",
      hint: "철판에 맞은 총알은 들어온 각도 그대로 튕겨요.",
      duration: 8,
      ammo: 3,
      par: 1,
      targets: [tg("a", at(820, 480))],
      segments: [wall("w", 560, 210, 560, 572), mirror("m", 380, 60, 820, 60)],
      solution: [s(240, -51)],
    },
    {
      title: "돌아가는 철판",
      brief: "철판이 돌아요. 언제 맞히느냐가 곧 반사 각도.",
      hint: "철판이 비스듬히 아래를 향하는 순간을 노리세요.",
      duration: 10,
      ammo: 3,
      par: 1,
      targets: [tg("a", at(850, 470), 34)],
      segments: [wall("w", 680, 240, 680, 572), mirror("m", 420, 110, 640, 110, { spin: 16 })],
      solution: [s(14, -37)],
    },
    {
      title: "두 번 튕기기",
      brief: "철판 두 장을 거쳐야 닿는 구석.",
      hint: "위 철판 → 오른쪽 철판 순서로.",
      duration: 10,
      ammo: 3,
      par: 1,
      targets: [tg("a", line(700, 520, 900, 520, 4))],
      segments: [wall("w1", 600, 380, 900, 380), wall("w2", 600, 380, 600, 572), mirror("m1", 380, 40, 640, 40), mirror("m2", 975, 120, 975, 572)],
      solution: [s(1130, -44)],
    },
    {
      title: "흔들리는 철판",
      brief: "흔들리는 철판과 움직이는 표적 둘.",
      hint: "한 발에 하나씩. 철판이 어느 쪽으로 기울었을 때 각 표적에 닿는지 보세요.",
      duration: 12,
      ammo: 3,
      par: 2,
      targets: [tg("a", line(720, 470, 920, 470, 3)), tg("b", line(860, 180, 860, 420, 4, 0.3))],
      segments: [wall("w", 620, 260, 620, 572), mirror("m", 380, 80, 560, 80, { swing: { amp: 18, period: 3.5 } })],
      solution: [s(214, -47), s(1382, -44.5)],
    },
  ]),
  ...chapter(3, [
    {
      title: "인질 사이로",
      brief: "표적 앞을 인질이 오가요. 인질을 맞히면 즉시 실패!",
      hint: "인질이 지나간 직후가 기회.",
      duration: 10,
      ammo: 2,
      par: 1,
      targets: [tg("a", at(820, 300)), hs("h", line(560, 140, 560, 500, 3.6)), hs("h2", line(680, 480, 680, 120, 2.8))],
      solution: [s(834, -16)],
    },
    {
      title: "회전 방패",
      brief: "방패가 표적 둘레를 돌아요. 틈은 잠깐만 열려요.",
      hint: "틈이 총구 쪽으로 열리기 직전에 쏘세요. 총알이 도착할 때 열려 있으면 돼요.",
      duration: 12,
      ammo: 3,
      par: 1,
      targets: [tg("a", at(760, 300), 24)],
      segments: shield("s", 760, 300, 62, 3, 92, 4),
      solution: [s(74, -20)],
    },
    {
      title: "사격장 행렬",
      brief: "표적과 인질이 한 줄로 지나가요.",
      hint: "총알은 뚫고 지나가요. 뒤에 인질이 없는 순간만!",
      duration: 12,
      ammo: 3,
      par: 2,
      myosu: 1,
      targets: [tg("a", line(380, 200, 880, 200, 6, 0)), hs("h1", line(380, 200, 880, 200, 6, 0.12)), tg("b", line(380, 200, 880, 200, 6, 0.24)), hs("h2", line(380, 360, 880, 360, 5, 0.6))],
      solution: [s(524, -32.5), s(1076, -32)],
      myosuSolution: [s(582, -38)],
    },
    {
      title: "인질 뒤의 철판",
      brief: "인질이 표적 앞을 막고 서 있어요.",
      hint: "정면은 막혔어요. 천장 철판으로 돌아서 내리꽂기.",
      duration: 10,
      ammo: 2,
      par: 1,
      targets: [tg("a", line(800, 330, 920, 330, 2.4)), hs("h", line(760, 130, 960, 130, 3))],
      segments: [mirror("m", 480, 50, 780, 50), wall("w", 740, 200, 740, 440), wall("w2", 740, 440, 980, 440)],
      solution: [s(608, -43)],
    },
  ]),
  ...chapter(4, [
    {
      title: "밧줄 끊기",
      brief: "벽 뒤를 오가는 표적. 위에 매달린 무게추가 보이나요?",
      hint: "밧줄을 쏘면 무게추가 떨어져요. 떨어지는 데 0.7초쯤.",
      duration: 12,
      ammo: 3,
      par: 1,
      targets: [tg("a", line(640, 540, 940, 540, 5))],
      segments: [wall("w", 580, 360, 580, 572), wall("roof", 580, 360, 640, 360)],
      weights: [{ id: "c", m: at(790, 230), anchor: P(790, 0), r: 30 }],
      solution: [s(250, -35.5)],
    },
    {
      title: "흔들리는 샹들리에",
      brief: "샹들리에가 흔들려요. 끊는 순간의 속도로 날아가요.",
      hint: "오른쪽 끝으로 올라가기 직전에 끊으면 멀리 날아가요.",
      duration: 12,
      ammo: 3,
      par: 1,
      targets: [tg("a", at(965, 548), 22)],
      segments: [wall("w", 640, 300, 640, 572)],
      weights: [{ id: "c", m: pend(720, 0, 260, 30, 3), r: 30 }],
      solution: [s(1414, -34)],
    },
    {
      title: "두 개의 샹들리에",
      brief: "표적 둘, 샹들리에 둘.",
      hint: "한 발에 하나씩이면 쉬워요. 밧줄 두 개를 한 줄로 꿰면…?",
      duration: 14,
      ammo: 3,
      par: 2,
      myosu: 1,
      targets: [tg("a", line(610, 548, 820, 548, 2.4), 22), tg("b", line(830, 548, 985, 548, 3, 0.5), 22)],
      segments: [wall("w", 590, 380, 590, 572), wall("beam", 840, 150, 985, 150)],
      weights: [
        { id: "c1", m: at(720, 300), anchor: P(720, 0), r: 24 },
        { id: "c2", m: at(900, 230), anchor: P(900, 150), r: 24 },
      ],
      solution: [s(96, -33.5), s(466, -23)],
      myosuSolution: [s(58, -23.5)],
    },
    {
      title: "거울과 밧줄",
      brief: "밧줄은 벽 뒤에 숨어 있어요.",
      hint: "철판으로 튕겨서 밧줄을 끊으세요.",
      duration: 12,
      ammo: 3,
      par: 1,
      targets: [tg("a", line(700, 540, 940, 540, 4))],
      segments: [wall("w", 600, 120, 600, 572), mirror("m", 380, 30, 700, 30)],
      weights: [{ id: "c", m: pend(820, 0, 200, 20, 2.6), r: 28 }],
      solution: [s(500, -39.5)],
    },
  ]),
  ...chapter(5, [
    {
      title: "펑!",
      brief: "화약통 주변의 표적 셋.",
      hint: "화약통을 쏘면 주변이 통째로 날아가요.",
      duration: 8,
      ammo: 2,
      par: 1,
      targets: [tg("a", at(780, 380)), tg("b", at(860, 470)), tg("c", at(720, 500))],
      barrels: [{ id: "x", m: at(800, 470), r: 26 }],
      segments: [wall("w", 640, 300, 980, 300)],
      solution: [s(240, -7.5)],
    },
    {
      title: "지나갈 때",
      brief: "표적과 인질이 화약통 옆을 지나가요.",
      hint: "폭발 범위에 표적 둘만 들어온 순간!",
      duration: 12,
      ammo: 2,
      par: 1,
      targets: [tg("a", line(790, 400, 985, 400, 3)), tg("b", line(790, 520, 985, 520, 4, 0.5)), hs("h", line(790, 460, 985, 460, 5, 0.3))],
      barrels: [{ id: "x", m: at(735, 480), r: 26 }],
      segments: [wall("w", 770, 280, 770, 572)],
      solution: [s(620, -3.5)],
    },
    {
      title: "연쇄 폭발",
      brief: "벽 뒤의 표적 둘. 화약통 네 개가 줄지어 있어요.",
      hint: "화약통은 옆 화약통을 터뜨려요. 마지막 통 옆에 표적이 올 때를 노리세요.",
      duration: 14,
      ammo: 2,
      par: 1,
      targets: [tg("a", orbit(895, 430, 95, 2.2)), tg("b", at(885, 320))],
      barrels: [
        { id: "x1", m: at(520, 470), r: 26 },
        { id: "x2", m: at(620, 400), r: 26 },
        { id: "x3", m: at(710, 320), r: 26 },
        { id: "x4", m: at(800, 250), r: 26 },
      ],
      segments: [wall("w", 580, 140, 980, 140), wall("w2", 845, 140, 845, 572)],
      solution: [s(90, -15.5)],
    },
    {
      title: "세 개를 한 발로",
      brief: "표적 셋, 총알 두 발. 정말 두 발이 필요할까요?",
      hint: "샹들리에가 화약통에 떨어지면… 그리고 밧줄을 끊은 총알은 계속 날아가요.",
      duration: 14,
      ammo: 3,
      par: 2,
      myosu: 1,
      targets: [tg("a", line(700, 540, 940, 540, 4)), tg("b", line(700, 440, 940, 440, 5, 0.5)), tg("c", at(960, 120), 24)],
      barrels: [{ id: "x", m: at(820, 520), r: 26 }],
      segments: [wall("w", 640, 300, 640, 572), wall("roof", 640, 300, 700, 300)],
      weights: [{ id: "c", m: pend(820, 0, 220, 16, 2.8), r: 28 }],
      solution: [s(844, -33), s(1264, -25.5)],
      myosuSolution: [s(1008, -25.5)],
    },
  ]),
];

export function stageById(id: string): StageDef | undefined {
  return STAGES.find((x) => x.id === id);
}

