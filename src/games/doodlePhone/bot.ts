/**
 * AI players for 그림 전화기 (ARCHITECTURE.md §7).
 *
 * Free-form text and drawings cannot be enumerated the way card moves can, so
 * `getValidMoves` returns the bot's own shortlist of candidates and
 * `chooseBotAction` picks among them with the shared level curve.
 *
 * - Drawing: a small library of hand-tuned doodle templates, looked up by
 *   keywords in the prompt ("모자를 쓴 고양이" → cat + hat). Unknown prompts
 *   get a random template — the bot "misread" it, which is on theme.
 * - Guessing: information-fair (§7.1) — the bot only looks at the drawing it
 *   was handed, never at the album history, and guesses from which colors
 *   carry the most ink.
 *
 * - Mode-specific drawing turns (see modes.ts `DrawingReference`): copy /
 *   memory → redraw the previous picture by hand (wobblier at low levels);
 *   onion → redraw it nudged sideways so the flipbook moves; base → keep the
 *   picture and add a small doodle of its own.
 * - Icebreaker: a canned answer per question.
 *
 * Lower levels wobble more and more often fall back to the random
 * candidate (`pickByLevel`).
 */

import { botTier, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { CANVAS_H, CANVAS_W, EMPTY_DRAWING, MAX_DRAWING_CHARS, decodePoints, isBlankDrawing, serializedLength, strokeOp, type DrawOp, type Drawing, type Point } from "./drawing";
import {
  TEXT_MAX_CHARS,
  albumFor,
  currentTurn,
  hasSubmitted,
  isValidText,
  promptFor,
  turnKind,
  type DoodlePhoneState,
  type EngineAction,
  type SeatIndex,
} from "./engine";
import { ICEBREAKER_QUESTIONS, drawingReferenceFor, icebreakerQuestion, inspirationWord } from "./modes";
import { BOT_OPENING_PROMPTS, FALLBACK_PROMPTS } from "./prompts";

// ---------------------------------------------------------------------------
// Doodle templates — authored in a 100×100 box
// ---------------------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  size: number;
}

class Pen {
  readonly ops: DrawOp[] = [];
  constructor(
    private readonly box: Box,
    private readonly rng: () => number,
    private readonly wobble: number,
  ) {}

  private map(p: Point): Point {
    const j = () => (this.rng() - 0.5) * 2 * this.wobble;
    return { x: this.box.x + (p.x / 100) * this.box.size + j(), y: this.box.y + (p.y / 100) * this.box.size + j() };
  }

  /** `weight` is a template-friendly 1 (hairline) … 6 (marker), mapped onto BRUSH_SIZES indices. */
  line(points: Point[], color: number, weight = 2): this {
    const sizeIndex = weight <= 1 ? 0 : weight <= 2 ? 1 : weight <= 4 ? 2 : 3;
    this.ops.push(strokeOp(color, sizeIndex, points.map((p) => this.map(p))));
    return this;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: number, weight = 2, from = 0, to = Math.PI * 2): this {
    const steps = 24;
    const pts: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
    return this.line(pts, color, weight);
  }

  circle(cx: number, cy: number, r: number, color: number, weight = 2): this {
    return this.ellipse(cx, cy, r, r, color, weight);
  }

  dot(x: number, y: number, color: number, weight = 3): this {
    return this.line([{ x, y }], color, weight);
  }

  fill(x: number, y: number, color: number): this {
    const p = this.map({ x, y });
    this.ops.push({ k: "f", c: color, x: Math.round(Math.min(CANVAS_W, Math.max(0, p.x))), y: Math.round(Math.min(CANVAS_H, Math.max(0, p.y))) });
    return this;
  }
}

// Palette indices (drawing.ts PALETTE) used by the templates.
const C = {
  black: 1, gray: 2, lightGray: 3, darkRed: 4, red: 5, orange: 6, amber: 7, cream: 8,
  lime: 9, green: 10, forest: 11, cyan: 12, blue: 13, navy: 14, violet: 15, pink: 16, lightPink: 17, brown: 18, tan: 19,
} as const;

interface Template {
  readonly name: string;
  readonly keywords: readonly string[];
  readonly draw: (pen: Pen) => void;
}

const pts = (...xy: number[]): Point[] => Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[i * 2], y: xy[i * 2 + 1] }));

const TEMPLATES: readonly Template[] = [
  {
    name: "고양이",
    keywords: ["고양이", "냥", "야옹"],
    draw: (p) => {
      p.circle(50, 58, 28, C.black, 2).fill(50, 62, C.orange);
      p.line(pts(27, 42, 30, 14, 45, 32), C.black, 2).line(pts(55, 32, 70, 14, 73, 42), C.black, 2);
      p.dot(40, 54, C.black, 3).dot(60, 54, C.black, 3).dot(50, 64, C.pink, 3);
      p.line(pts(20, 62, 40, 66), C.black, 1).line(pts(20, 70, 40, 68), C.black, 1).line(pts(60, 66, 80, 62), C.black, 1).line(pts(60, 68, 80, 70), C.black, 1);
    },
  },
  {
    name: "강아지",
    keywords: ["강아지", "개", "멍멍", "댕댕"],
    draw: (p) => {
      p.circle(50, 55, 27, C.black, 2).fill(50, 60, C.tan);
      p.ellipse(22, 55, 8, 20, C.black, 2).fill(22, 55, C.brown).ellipse(78, 55, 8, 20, C.black, 2).fill(78, 55, C.brown);
      p.dot(41, 50, C.black, 3).dot(59, 50, C.black, 3).ellipse(50, 64, 6, 4, C.black, 2).fill(50, 64, C.black);
      p.line(pts(44, 72, 50, 76, 56, 72), C.black, 1);
    },
  },
  {
    name: "집",
    keywords: ["집", "건물", "학교", "마을"],
    draw: (p) => {
      p.line(pts(22, 48, 78, 48, 78, 90, 22, 90, 22, 48), C.black, 2).fill(50, 70, C.cream);
      p.line(pts(16, 50, 50, 16, 84, 50, 16, 50), C.black, 2).fill(50, 38, C.red);
      p.line(pts(44, 90, 44, 68, 58, 68, 58, 90), C.black, 2).fill(51, 80, C.brown);
      p.line(pts(28, 56, 38, 56, 38, 64, 28, 64, 28, 56), C.black, 1).fill(33, 60, C.cyan);
    },
  },
  {
    name: "나무",
    keywords: ["나무", "숲", "사과", "공원"],
    draw: (p) => {
      p.line(pts(44, 92, 44, 58, 56, 58, 56, 92, 44, 92), C.black, 2).fill(50, 80, C.brown);
      p.circle(50, 38, 28, C.black, 2).fill(50, 38, C.green);
      p.dot(40, 32, C.red, 5).dot(60, 40, C.red, 5).dot(48, 50, C.red, 5);
    },
  },
  {
    name: "해",
    keywords: ["해", "태양", "햇빛", "여름", "낮"],
    draw: (p) => {
      p.circle(50, 50, 20, C.orange, 2).fill(50, 50, C.amber);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        p.line(pts(50 + Math.cos(a) * 27, 50 + Math.sin(a) * 27, 50 + Math.cos(a) * 40, 50 + Math.sin(a) * 40), C.orange, 2);
      }
      p.dot(43, 46, C.black, 2).dot(57, 46, C.black, 2).ellipse(50, 54, 7, 5, C.black, 1, 0.2, Math.PI - 0.2);
    },
  },
  {
    name: "달",
    keywords: ["달", "밤", "새벽"],
    draw: (p) => {
      p.ellipse(50, 50, 32, 32, C.amber, 2, Math.PI * 0.35, Math.PI * 1.65);
      p.ellipse(62, 50, 26, 26, C.amber, 2, Math.PI * 0.62, Math.PI * 1.38);
      p.fill(26, 50, C.cream);
      p.dot(80, 20, C.amber, 3).dot(86, 70, C.amber, 3);
    },
  },
  {
    name: "별",
    keywords: ["별", "우주", "밤하늘"],
    draw: (p) => {
      const star: Point[] = [];
      for (let i = 0; i <= 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 40 : 17;
        star.push({ x: 50 + Math.cos(a) * r, y: 54 + Math.sin(a) * r });
      }
      p.line(star, C.orange, 2).fill(50, 56, C.amber);
    },
  },
  {
    name: "하트",
    keywords: ["하트", "사랑", "마음", "좋아"],
    draw: (p) => {
      const heart: Point[] = [];
      for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * Math.PI * 2;
        heart.push({ x: 50 + 2.3 * 16 * Math.sin(t) ** 3, y: 50 - 2.3 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) });
      }
      p.line(heart, C.darkRed, 2).fill(50, 52, C.red);
    },
  },
  {
    name: "꽃",
    keywords: ["꽃", "봄", "장미"],
    draw: (p) => {
      p.line(pts(50, 50, 50, 95), C.green, 3).ellipse(40, 80, 8, 4, C.green, 2).fill(40, 80, C.green);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        p.circle(50 + Math.cos(a) * 15, 38 + Math.sin(a) * 15, 11, C.pink, 2).fill(50 + Math.cos(a) * 19, 38 + Math.sin(a) * 19, C.lightPink);
      }
      p.circle(50, 38, 8, C.orange, 2).fill(50, 38, C.amber);
    },
  },
  {
    name: "자동차",
    keywords: ["자동차", "차", "버스", "택시", "드라이브"],
    draw: (p) => {
      p.line(pts(10, 62, 10, 46, 30, 46, 40, 30, 68, 30, 78, 46, 90, 46, 90, 62, 10, 62), C.black, 2).fill(50, 52, C.red);
      p.line(pts(44, 34, 64, 34, 70, 44, 42, 44, 44, 34), C.black, 1).fill(55, 39, C.cyan);
      p.circle(28, 64, 9, C.black, 2).fill(28, 64, C.gray).circle(72, 64, 9, C.black, 2).fill(72, 64, C.gray);
    },
  },
  {
    name: "물고기",
    keywords: ["물고기", "생선", "바다", "고래", "상어"],
    draw: (p) => {
      p.ellipse(44, 50, 30, 18, C.navy, 2).fill(44, 50, C.blue);
      p.line(pts(72, 50, 92, 34, 92, 66, 72, 50), C.navy, 2).fill(86, 50, C.cyan);
      p.dot(28, 46, C.black, 4);
      p.line(pts(5, 88, 20, 82, 35, 88, 50, 82, 65, 88, 80, 82, 95, 88), C.cyan, 2);
    },
  },
  {
    name: "사람",
    keywords: ["사람", "친구", "남자", "여자", "아이", "나", "선생님", "우주비행사", "가족", "아빠", "엄마"],
    draw: (p) => {
      p.circle(50, 24, 13, C.black, 2).fill(50, 24, C.cream);
      p.dot(45, 22, C.black, 2).dot(55, 22, C.black, 2).ellipse(50, 27, 5, 3, C.black, 1, 0.2, Math.PI - 0.2);
      p.line(pts(50, 37, 50, 68), C.black, 3).line(pts(28, 48, 50, 44, 72, 48), C.black, 3);
      p.line(pts(34, 94, 50, 68, 66, 94), C.black, 3);
    },
  },
  {
    name: "피자",
    keywords: ["피자", "치즈", "간식"],
    draw: (p) => {
      p.line(pts(20, 20, 80, 20, 50, 92, 20, 20), C.brown, 3).fill(50, 40, C.amber);
      p.line(pts(18, 20, 82, 20), C.brown, 5);
      p.circle(40, 34, 6, C.darkRed, 2).fill(40, 34, C.red).circle(58, 42, 6, C.darkRed, 2).fill(58, 42, C.red).circle(50, 62, 5, C.darkRed, 2).fill(50, 62, C.red);
    },
  },
  {
    name: "구름",
    keywords: ["구름", "비", "날씨", "장마"],
    draw: (p) => {
      p.ellipse(50, 36, 34, 16, C.gray, 2).fill(50, 36, C.lightGray);
      p.circle(36, 28, 12, C.gray, 2).circle(58, 24, 14, C.gray, 2);
      for (let i = 0; i < 6; i++) p.line(pts(26 + i * 10, 60, 22 + i * 10, 76), C.blue, 2);
    },
  },
  {
    name: "산",
    keywords: ["산", "등산", "캠핑", "여행"],
    draw: (p) => {
      p.line(pts(2, 90, 36, 30, 70, 90, 2, 90), C.forest, 2).fill(36, 75, C.green);
      p.line(pts(40, 90, 68, 40, 98, 90, 40, 90), C.forest, 2).fill(68, 78, C.lime);
      p.line(pts(28, 44, 36, 30, 44, 44, 36, 48, 28, 44), C.gray, 2);
    },
  },
  {
    name: "로봇",
    keywords: ["로봇", "기계", "컴퓨터", "인공지능"],
    draw: (p) => {
      p.line(pts(30, 20, 70, 20, 70, 48, 30, 48, 30, 20), C.black, 2).fill(50, 34, C.lightGray);
      p.dot(40, 32, C.cyan, 6).dot(60, 32, C.cyan, 6).line(pts(42, 42, 58, 42), C.black, 2);
      p.line(pts(50, 20, 50, 8), C.black, 2).dot(50, 7, C.red, 6);
      p.line(pts(26, 52, 74, 52, 74, 90, 26, 90, 26, 52), C.black, 2).fill(50, 70, C.gray);
      p.line(pts(26, 60, 12, 74), C.black, 3).line(pts(74, 60, 88, 74), C.black, 3);
    },
  },
  {
    name: "눈사람",
    keywords: ["눈사람", "겨울", "눈", "크리스마스"],
    draw: (p) => {
      p.circle(50, 70, 22, C.navy, 2).circle(50, 34, 15, C.navy, 2);
      p.dot(45, 31, C.black, 3).dot(55, 31, C.black, 3).line(pts(50, 36, 62, 38, 50, 39), C.orange, 2);
      p.dot(50, 62, C.black, 3).dot(50, 72, C.black, 3);
      p.line(pts(30, 60, 12, 48), C.brown, 2).line(pts(70, 60, 88, 48), C.brown, 2);
    },
  },
  {
    name: "케이크",
    keywords: ["케이크", "생일", "파티", "축하"],
    draw: (p) => {
      p.line(pts(20, 50, 80, 50, 80, 88, 20, 88, 20, 50), C.brown, 2).fill(50, 70, C.lightPink);
      p.line(pts(20, 62, 30, 58, 40, 64, 50, 58, 60, 64, 70, 58, 80, 62), C.pink, 3);
      p.line(pts(50, 50, 50, 30), C.blue, 4).ellipse(50, 24, 4, 7, C.orange, 2).fill(50, 24, C.amber);
    },
  },
  {
    name: "우산",
    keywords: ["우산", "양산"],
    draw: (p) => {
      p.ellipse(50, 50, 38, 30, C.navy, 2, Math.PI, Math.PI * 2).line(pts(12, 50, 88, 50), C.navy, 2).fill(50, 36, C.violet);
      p.line(pts(50, 50, 50, 84, 44, 90, 38, 84), C.black, 3);
    },
  },
  {
    name: "문어",
    keywords: ["문어", "오징어", "해파리"],
    draw: (p) => {
      p.circle(50, 36, 24, C.darkRed, 2).fill(50, 36, C.pink);
      p.dot(42, 34, C.black, 4).dot(58, 34, C.black, 4);
      for (const x of [32, 44, 56, 68]) p.line(pts(x, 56, x - 5, 68, x + 3, 80, x - 4, 92), C.pink, 5);
    },
  },
  {
    name: "모자",
    keywords: ["모자", "왕관", "마법사"],
    draw: (p) => {
      p.line(pts(10, 70, 90, 70), C.black, 5).line(pts(30, 70, 34, 30, 66, 30, 70, 70), C.black, 2).fill(50, 50, C.navy);
      p.line(pts(32, 58, 68, 58), C.red, 4);
    },
  },
];

function templatesIn(text: string): Template[] {
  const found = TEMPLATES.map((t) => ({ t, at: Math.min(...t.keywords.map((k) => (text.includes(k) ? text.indexOf(k) : Infinity))) }))
    .filter((f) => Number.isFinite(f.at))
    .sort((a, b) => a.at - b.at)
    .map((f) => f.t);
  return found.slice(0, 2);
}

function defaultBoxes(count: number): Box[] {
  return count === 1
    ? [{ x: 120, y: 40, size: 240 }]
    : [
        { x: 30, y: 80, size: 200 },
        { x: 250, y: 80, size: 200 },
      ];
}

function wobbleFor(level: BotLevel): number {
  const tier = botTier(level);
  return tier === "expert" ? 0.6 : tier === "core" ? 1.6 : 3.2;
}

/** Composes one or two templates onto the canvas. Deterministic for a given rng. */
export function drawTemplates(templates: readonly Template[], rng: () => number, level: BotLevel, boxes: readonly Box[] = defaultBoxes(templates.length)): Drawing {
  const ops: DrawOp[] = [];
  templates.forEach((t, i) => {
    const pen = new Pen(boxes[i], rng, wobbleFor(level));
    t.draw(pen);
    ops.push(...pen.ops);
  });
  const drawing: Drawing = { v: 1, ops };
  return serializedLength(drawing) <= MAX_DRAWING_CHARS ? drawing : EMPTY_DRAWING;
}

export function botDrawingFor(prompt: string, rng: () => number, level: BotLevel): { understood: Drawing; misread: Drawing } {
  const matched = templatesIn(prompt);
  const random = TEMPLATES[Math.floor(rng() * TEMPLATES.length)];
  return {
    understood: drawTemplates(matched.length > 0 ? matched : [random], rng, level),
    misread: drawTemplates([random], rng, level),
  };
}

/**
 * Redraws `source` by hand: every point jittered by the level's wobble and
 * shifted by (dx, dy). Used to copy (knock-off/sandwich) and, with a small
 * shift, to draw the next animation frame.
 */
export function redrawDrawing(source: Drawing, rng: () => number, level: BotLevel, dx = 0, dy = 0): Drawing {
  const wobble = wobbleFor(level) * 1.5;
  const j = () => (rng() - 0.5) * 2 * wobble;
  const ops = source.ops.map((op): DrawOp => {
    if (op.k === "x") return op;
    if (op.k === "f") return { ...op, x: Math.round(Math.min(CANVAS_W, Math.max(0, op.x + dx))), y: Math.round(Math.min(CANVAS_H, Math.max(0, op.y + dy))) };
    return strokeOp(op.c, op.w, decodePoints(op.p).map((pt) => ({ x: pt.x + dx + j(), y: pt.y + dy + j() })));
  });
  const drawing: Drawing = { v: 1, ops };
  return serializedLength(drawing) <= MAX_DRAWING_CHARS ? drawing : source;
}

/** Complement mode: keep every existing op and add one small doodle somewhere on the sheet. */
export function addToDrawing(base: Drawing, rng: () => number, level: BotLevel): Drawing {
  const size = 90 + rng() * 50;
  const box: Box = { x: rng() * (CANVAS_W - size), y: rng() * (CANVAS_H - size), size };
  const extra = drawTemplates([TEMPLATES[Math.floor(rng() * TEMPLATES.length)]], rng, level, [box]);
  const drawing: Drawing = { v: 1, ops: [...base.ops, ...extra.ops] };
  return serializedLength(drawing) <= MAX_DRAWING_CHARS ? drawing : base;
}

function templateNamed(word: string): Template[] {
  const found = templatesIn(word);
  return found.length > 0 ? found : [TEMPLATES[0]];
}

// ---------------------------------------------------------------------------
// Guessing from ink colors
// ---------------------------------------------------------------------------

const COLOR_WORDS: Record<number, readonly string[]> = {
  [C.red]: ["사과", "하트", "딸기", "빨간 자동차"],
  [C.darkRed]: ["사과", "하트", "문어"],
  [C.orange]: ["고양이", "귤", "호박"],
  [C.amber]: ["해", "별", "피자", "바나나"],
  [C.cream]: ["달", "치즈", "달걀"],
  [C.lime]: ["산", "풀밭", "개구리"],
  [C.green]: ["나무", "숲", "개구리"],
  [C.forest]: ["산", "숲", "선인장"],
  [C.cyan]: ["바다", "하늘", "창문"],
  [C.blue]: ["물고기", "바다", "비"],
  [C.navy]: ["밤하늘", "모자", "고래"],
  [C.violet]: ["우산", "포도", "마법사"],
  [C.pink]: ["꽃", "문어", "돼지"],
  [C.lightPink]: ["케이크", "꽃", "솜사탕"],
  [C.brown]: ["강아지", "곰", "초콜릿"],
  [C.tan]: ["강아지", "빵", "쿠키"],
  [C.black]: ["사람", "로봇", "자동차"],
  [C.gray]: ["로봇", "구름", "자동차"],
  [C.lightGray]: ["구름", "로봇", "눈사람"],
};

const BLANK_GUESSES = ["하얀 종이", "투명 인간", "눈보라 속 북극곰", "아무것도 없음"];

/** Ink per palette color: stroke length × brush size, plus a flat amount per fill. */
export function inkByColor(drawing: Drawing): Map<number, number> {
  const ink = new Map<number, number>();
  for (const op of drawing.ops) {
    if (op.k === "x") continue;
    let amount = 400;
    if (op.k === "s") {
      const points = decodePoints(op.p);
      let len = 1;
      for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      amount = len * (op.w + 1);
    }
    ink.set(op.c, (ink.get(op.c) ?? 0) + amount);
  }
  ink.delete(0);
  return ink;
}

function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}

export function guessFromDrawing(drawing: Drawing, rng: () => number): string {
  if (isBlankDrawing(drawing)) return BLANK_GUESSES[Math.floor(rng() * BLANK_GUESSES.length)];
  const ranked = [...inkByColor(drawing).entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color);
  const words: string[] = [];
  for (const color of ranked) {
    const pool = (COLOR_WORDS[color] ?? []).filter((w) => !words.includes(w));
    if (pool.length > 0) words.push(pool[Math.floor(rng() * pool.length)]);
    if (words.length === 2) break;
  }
  if (words.length === 0) return BLANK_GUESSES[0];
  const guess = words.length === 1 ? words[0] : `${words[0]}${hasBatchim(words[0]) ? "과" : "와"} ${words[1]}`;
  return Array.from(guess).slice(0, TEXT_MAX_CHARS).join("");
}

/** One canned answer list per ICEBREAKER_QUESTIONS entry (same order). */
const ICEBREAKER_ANSWERS: readonly (readonly string[])[] = [
  ["치킨", "떡볶이", "라면"],
  ["바다가 보이는 집", "빨간 자동차", "우주 여행"],
  ["제주도 바다", "비 오는 캠핑장", "눈 덮인 산"],
  ["순간이동", "하늘을 나는 능력", "투명인간"],
  ["고양이", "강아지", "문어"],
  ["피자", "우산", "로봇 친구"],
  ["우주비행사", "요리사", "선생님"],
  ["피자", "케이크", "라면"],
  ["케이크 몰래 먹기", "여행 가기", "잠자기"],
  ["거미", "구름 낀 밤", "상어"],
];

function icebreakerAnswer(question: string, rng: () => number): string {
  const pool = ICEBREAKER_ANSWERS[ICEBREAKER_QUESTIONS.indexOf(question)] ?? BOT_OPENING_PROMPTS;
  return pool[Math.floor(rng() * pool.length)];
}

function randomPhrase(rng: () => number): string {
  const pool = [...FALLBACK_PROMPTS, ...BOT_OPENING_PROMPTS];
  return pool[Math.floor(rng() * pool.length)];
}

// ---------------------------------------------------------------------------
// Bot contract
// ---------------------------------------------------------------------------

interface Candidate {
  action: EngineAction;
  score: number;
}

/**
 * The "random" candidate is always listed first: `pickByLevel`'s mistake path
 * indexes by rng, so with a stubbed rng of 0 a novice deterministically plays
 * the random entry while an expert plays the scored one (see the tests).
 */
function candidates(state: DoodlePhoneState, seat: SeatIndex, level: BotLevel, rng: () => number): Candidate[] {
  const turn = currentTurn(state);
  if (turn > state.playerCount || hasSubmitted(state, seat, turn)) return [];
  const prompt = promptFor(state, seat, turn);
  if (prompt === undefined) return []; // previous page still in flight — wait for it
  const album = albumFor(state.playerCount, seat, turn);

  if (turnKind(state, turn) === "text") {
    const text = (t: string, score: number): Candidate => ({ action: { type: "SUBMIT_TEXT", seat, turn, text: t }, score });
    const random = text(randomPhrase(rng), 0);
    if (prompt === null) {
      const opening =
        state.options.mode === "ICEBREAKER" ? icebreakerAnswer(icebreakerQuestion(state.seed, album), rng) : BOT_OPENING_PROMPTS[Math.floor(rng() * BOT_OPENING_PROMPTS.length)];
      return [random, text(opening, 1)];
    }
    const guess = prompt.kind === "drawing" ? guessFromDrawing(prompt.drawing, rng) : prompt.text;
    return [random, text(isValidText(guess) ? guess : randomPhrase(rng), 1)];
  }

  const drawing = (d: Drawing, score: number): Candidate => ({ action: { type: "SUBMIT_DRAWING", seat, turn, drawing: d }, score });
  const scribble = drawing(drawTemplates([TEMPLATES[Math.floor(rng() * TEMPLATES.length)]], rng, level), 0);
  const reference = drawingReferenceFor(state.options.mode, prompt?.kind ?? null);
  switch (reference) {
    case "free":
      return [scribble, drawing(drawTemplates(templateNamed(inspirationWord(state.seed, album)), rng, level), 1)];
    case "prompt": {
      const { understood, misread } = botDrawingFor(prompt?.kind === "text" ? prompt.text : "", rng, level);
      return [drawing(misread, 0), drawing(understood, 1)];
    }
    case "copy":
    case "memory":
      return [scribble, drawing(redrawDrawing(prompt?.kind === "drawing" ? prompt.drawing : EMPTY_DRAWING, rng, level), 1)];
    case "onion": {
      const dx = 10 + rng() * 14;
      return [scribble, drawing(redrawDrawing(prompt?.kind === "drawing" ? prompt.drawing : EMPTY_DRAWING, rng, level, dx, (rng() - 0.5) * 8), 1)];
    }
    case "base":
      return [scribble, drawing(addToDrawing(prompt?.kind === "drawing" ? prompt.drawing : EMPTY_DRAWING, rng, level), 1)];
  }
}

/**
 * The bot's shortlist for `seat` right now (empty when it has nothing to do).
 * Every entry is accepted by `applyAction`.
 */
export function getValidMoves(state: DoodlePhoneState, seat: SeatIndex, level: BotLevel = 5, rng: () => number = Math.random): EngineAction[] {
  return candidates(state, seat, level, rng).map((c) => c.action);
}

export function chooseBotAction(state: DoodlePhoneState, seat: SeatIndex, level: BotLevel, rng: () => number = Math.random): EngineAction | null {
  const list = candidates(state, seat, level, rng);
  if (list.length === 0) return null;
  return pickByLevel(
    list.map((c) => ({ move: c.action, score: c.score })),
    level,
    rng,
  );
}

/** The first of `botSeats` that still owes a page this turn — drives `useBotAutoplay` one bot at a time. */
export function nextBotActor(state: DoodlePhoneState, botSeats: ReadonlySet<SeatIndex>): SeatIndex | null {
  const turn = currentTurn(state);
  if (turn > state.playerCount) return null;
  for (const seat of [...botSeats].sort((a, b) => a - b)) {
    if (seat < state.playerCount && !hasSubmitted(state, seat, turn) && promptFor(state, seat, turn) !== undefined) return seat;
  }
  return null;
}
