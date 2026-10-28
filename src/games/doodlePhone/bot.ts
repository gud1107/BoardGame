/**
 * AI players for 그림 전화기 (ARCHITECTURE.md §7).
 *
 * Free-form text and drawings cannot be enumerated the way card moves can, so
 * `getValidMoves` returns the bot's own shortlist of candidates and
 * `chooseBotAction` picks among them with the shared level curve.
 *
 * - Drawing: a library of hand-tuned doodle templates, looked up by keywords
 *   in the prompt ("모자를 쓴 고양이" → cat + hat). Matching is word-aware: a
 *   one-letter keyword only counts as a whole word (particles aside), so
 *   "번개장터" is lightning + a market stall, not a 개 (dog). Unknown prompts
 *   get a random template — the bot "misread" it, which is on theme.
 * - Guessing: information-fair (§7.1) — the bot only looks at the drawing it
 *   was handed, never at the album history. It rasterizes the picture
 *   (raster.ts), splits it into a left/right object when there's a clear gap,
 *   and compares shape + color layout with its own templates; when nothing
 *   looks familiar it falls back to guessing from which colors carry the most
 *   ink.
 *
 * - Mode-specific drawing turns (see modes.ts `DrawingReference`): copy /
 *   memory → redraw the previous picture by hand (wobblier at low levels);
 *   onion → `nextAnimationFrame`: the subject walks/hops
 *   on from where the last frame left it and one piece of background is added per frame;
 *   base → keep the picture and add a small doodle of its own.
 * - Opening prompts: usually invented on the spot (promptGen.ts — "케이크를
 *   훔친 원숭이"), sometimes a stock line; the nouns are always drawable.
 * - Icebreaker: a canned answer per question.
 * - Theme packs: on turn 1 the bot picks one of the album's offered keywords
 *   (and doodles it, if it knows a template for any word in it).
 *
 * Lower levels wobble more and more often fall back to the random
 * candidate (`pickByLevel`).
 */

import { botTier, pickByLevel, type BotLevel } from "@/games/shared/bot/botDifficulty";
import { CANVAS_H, CANVAS_W, EMPTY_DRAWING, MAX_DRAWING_CHARS, clampToCanvas, decodePoints, encodePoints, isBlankDrawing, isShapeOp, nearestPaletteIndex, opAlpha, serializedLength, shapeOp, strokeOp, type DrawOp, type Drawing, type Point } from "./drawing";
import {
  TEXT_MAX_CHARS,
  albumFor,
  currentTurn,
  hasSubmitted,
  isValidText,
  promptFor,
  shownPageAt,
  turnKind,
  type DoodlePhoneState,
  type EngineAction,
  type SeatIndex,
} from "./engine";
import { translateOp, unionBounds, type Bounds } from "./editing";
import { ICEBREAKER_QUESTIONS, drawingReferenceFor, icebreakerQuestion, inspirationWord, openingChoices } from "./modes";
import { generatePrompt, josa } from "./promptGen";
import { BOT_OPENING_PROMPTS, FALLBACK_PROMPTS } from "./prompts";
import { RASTER_W, rasterize, type Raster } from "./raster";

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
    const mapped = points.map((p) => this.map(p));
    // A closed outline must stay closed after the wobble, or the fill that follows leaks onto the whole sheet.
    const [first, last] = [points[0], points[points.length - 1]];
    if (points.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) mapped[mapped.length - 1] = mapped[0];
    this.ops.push(strokeOp(color, sizeIndex, mapped));
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
    keywords: ["고양이", "냥", "야옹", "사자", "호랑이", "표범", "여우", "치타"],
    draw: (p) => {
      p.circle(50, 58, 28, C.black, 2).fill(50, 62, C.orange);
      p.line(pts(27, 42, 30, 14, 45, 32), C.black, 2).line(pts(55, 32, 70, 14, 73, 42), C.black, 2);
      p.dot(40, 54, C.black, 3).dot(60, 54, C.black, 3).dot(50, 64, C.pink, 3);
      p.line(pts(20, 62, 40, 66), C.black, 1).line(pts(20, 70, 40, 68), C.black, 1).line(pts(60, 66, 80, 62), C.black, 1).line(pts(60, 68, 80, 70), C.black, 1);
    },
  },
  {
    name: "강아지",
    keywords: ["강아지", "개", "멍멍", "댕댕", "늑대", "강쥐", "멍뭉이", "퍼피"],
    draw: (p) => {
      p.circle(50, 55, 27, C.black, 2).fill(50, 60, C.tan);
      p.ellipse(22, 55, 8, 20, C.black, 2).fill(19, 55, C.brown).ellipse(78, 55, 8, 20, C.black, 2).fill(81, 55, C.brown); // fill the part of the ear outside the head
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
      // Dark-rimmed apples: plain red on green vanishes for red-green color-blind players.
      for (const [x, y] of [[40, 32], [60, 40], [48, 50]]) p.circle(x, y, 6, C.darkRed, 2).fill(x, y, C.red);
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
      // One closed outline (outer arc out, inner arc back) so the fill can't leak onto the paper.
      const arc = (cx: number, r: number, from: number, to: number) => Array.from({ length: 21 }, (_, i) => ({ x: cx + Math.cos(from + ((to - from) * i) / 20) * r, y: 50 + Math.sin(from + ((to - from) * i) / 20) * r }));
      p.line([...arc(50, 32, Math.PI * 0.4, Math.PI * 1.6), ...arc(70, 32, Math.PI * 1.398, Math.PI * 0.602)], C.amber, 2);
      p.fill(28, 50, C.cream);
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
    keywords: ["물고기", "생선", "바다", "고래", "상어", "붕어", "연어", "참치", "니모"],
    draw: (p) => {
      p.ellipse(44, 50, 30, 18, C.navy, 2).fill(44, 50, C.blue);
      p.line(pts(72, 50, 92, 34, 92, 66, 72, 50), C.navy, 2).fill(86, 50, C.cyan);
      p.dot(28, 46, C.black, 4);
      p.line(pts(5, 88, 20, 82, 35, 88, 50, 82, 65, 88, 80, 82, 95, 88), C.cyan, 2);
    },
  },
  {
    name: "사람",
    keywords: ["사람", "친구", "남자", "여자", "아이", "선생님", "우주비행사", "가족", "아빠", "엄마", "춤", "댄스", "표정", "미소", "고음", "세레머니", "액션", "팔뚝", "탐정", "선수", "가수", "배우", "의사", "경찰", "요리사", "할머니", "할아버지"],
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
  {
    name: "번개",
    keywords: ["번개", "천둥", "벼락", "전기", "볼트", "충전"],
    draw: (p) => {
      p.line(pts(60, 4, 24, 54, 48, 54, 36, 96, 80, 42, 55, 42, 72, 4, 60, 4), C.orange, 2).fill(52, 48, C.amber);
    },
  },
  {
    name: "가게",
    keywords: ["가게", "시장", "장터", "마트", "상점", "편의점", "쇼핑", "장사", "중고", "거래", "판매", "장보기", "노점", "포장마차"],
    draw: (p) => {
      p.line(pts(30, 12, 70, 12, 70, 28, 30, 28, 30, 12), C.brown, 2).fill(50, 20, C.amber);
      p.line(pts(40, 28, 40, 34), C.brown, 2).line(pts(60, 28, 60, 34), C.brown, 2);
      p.line(pts(8, 34, 92, 34, 96, 48, 4, 48, 8, 34), C.darkRed, 2).fill(50, 41, C.red);
      p.line(pts(29, 35, 27, 47), C.cream, 4).line(pts(50, 35, 50, 47), C.cream, 4).line(pts(71, 35, 73, 47), C.cream, 4);
      p.line(pts(12, 48, 12, 92), C.brown, 3).line(pts(88, 48, 88, 92), C.brown, 3);
      p.line(pts(8, 68, 92, 68, 92, 92, 8, 92, 8, 68), C.brown, 2).fill(50, 80, C.tan);
      p.circle(26, 61, 6, C.darkRed, 2).fill(26, 61, C.red).circle(42, 61, 6, C.orange, 2).fill(42, 61, C.amber);
      p.line(pts(58, 54, 76, 54, 76, 67, 58, 67, 58, 54), C.navy, 2).fill(67, 60, C.blue);
    },
  },
  {
    name: "비행기",
    keywords: ["비행기", "비행", "공항", "항공", "여객기"],
    draw: (p) => {
      p.ellipse(50, 50, 42, 10, C.navy, 2).fill(50, 50, C.lightGray);
      p.line(pts(44, 46, 32, 18, 42, 18, 60, 46), C.navy, 2).fill(46, 34, C.blue);
      p.line(pts(44, 54, 32, 82, 42, 82, 60, 54), C.navy, 2).fill(46, 66, C.blue);
      p.line(pts(14, 46, 6, 26, 16, 26, 26, 42), C.navy, 2).fill(14, 36, C.red);
      p.dot(62, 48, C.cyan, 3).dot(70, 48, C.cyan, 3).dot(78, 48, C.cyan, 3);
    },
  },
  {
    name: "새",
    keywords: ["새", "참새", "비둘기", "까치", "독수리", "앵무새", "병아리", "닭", "오리", "백조", "갈매기", "부엉이", "올빼미", "치킨"],
    draw: (p) => {
      p.ellipse(46, 60, 28, 20, C.black, 2).fill(42, 64, C.amber);
      p.circle(70, 36, 14, C.black, 2).fill(70, 34, C.amber);
      p.line(pts(83, 32, 96, 37, 83, 42, 83, 32), C.black, 1).fill(87, 37, C.orange);
      p.dot(73, 32, C.black, 3).ellipse(40, 60, 13, 8, C.orange, 2);
      p.line(pts(40, 79, 38, 94), C.orange, 2).line(pts(54, 79, 56, 94), C.orange, 2);
    },
  },
  {
    name: "토끼",
    keywords: ["토끼", "바니"],
    draw: (p) => {
      p.ellipse(38, 24, 7, 20, C.black, 2).fill(38, 24, C.lightPink).ellipse(62, 24, 7, 20, C.black, 2).fill(62, 24, C.lightPink);
      p.circle(50, 64, 25, C.black, 2).fill(50, 70, C.lightGray);
      p.dot(41, 60, C.black, 3).dot(59, 60, C.black, 3).dot(50, 68, C.pink, 4);
      p.line(pts(50, 70, 50, 76), C.black, 1).line(pts(26, 70, 42, 72), C.black, 1).line(pts(58, 72, 74, 70), C.black, 1);
    },
  },
  {
    name: "곰",
    keywords: ["곰", "곰돌이", "판다", "테디", "너구리"],
    draw: (p) => {
      p.circle(26, 30, 11, C.black, 2).fill(26, 30, C.brown).circle(74, 30, 11, C.black, 2).fill(74, 30, C.brown);
      p.circle(50, 56, 29, C.black, 2).fill(50, 46, C.brown);
      p.ellipse(50, 68, 12, 9, C.black, 2).fill(50, 70, C.tan);
      p.dot(40, 50, C.black, 4).dot(60, 50, C.black, 4).dot(50, 64, C.black, 5);
    },
  },
  {
    name: "돼지",
    keywords: ["돼지", "꿀꿀", "삼겹살"],
    draw: (p) => {
      p.line(pts(24, 42, 18, 8, 48, 26, 24, 42), C.darkRed, 2).fill(30, 25, C.pink).line(pts(76, 42, 82, 8, 52, 26, 76, 42), C.darkRed, 2).fill(70, 25, C.pink);
      p.circle(50, 56, 30, C.darkRed, 2).fill(50, 44, C.lightPink);
      p.ellipse(50, 64, 13, 9, C.darkRed, 2).fill(50, 64, C.pink).dot(45, 64, C.darkRed, 3).dot(55, 64, C.darkRed, 3);
      p.dot(39, 48, C.black, 3).dot(61, 48, C.black, 3);
    },
  },
  {
    name: "원숭이",
    keywords: ["원숭이", "고릴라", "침팬지"],
    draw: (p) => {
      p.circle(22, 50, 9, C.black, 2).fill(22, 50, C.tan).circle(78, 50, 9, C.black, 2).fill(78, 50, C.tan);
      p.circle(50, 50, 27, C.black, 2).fill(50, 30, C.brown);
      p.ellipse(50, 60, 17, 14, C.black, 2).fill(50, 62, C.tan);
      p.dot(42, 44, C.black, 4).dot(58, 44, C.black, 4).ellipse(50, 64, 7, 4, C.black, 1, 0.2, Math.PI - 0.2);
    },
  },
  {
    name: "공룡",
    keywords: ["공룡", "용", "드래곤", "티라노", "도마뱀", "괴물"],
    draw: (p) => {
      p.line(pts(6, 80, 20, 60, 40, 52, 58, 52, 66, 30, 78, 20, 94, 24, 94, 34, 80, 36, 74, 54, 76, 84, 66, 84, 64, 68, 44, 68, 42, 84, 32, 84, 32, 70, 6, 80), C.forest, 2).fill(52, 60, C.green);
      p.line(pts(30, 56, 34, 46, 40, 53), C.amber, 3).line(pts(44, 52, 49, 42, 54, 52), C.amber, 3);
      p.dot(84, 27, C.black, 4);
    },
  },
  {
    name: "배",
    keywords: ["배", "보트", "요트", "해적선", "타이타닉", "뱃머리", "항해", "선박", "유람선", "뗏목"],
    draw: (p) => {
      p.line(pts(50, 60, 50, 10), C.black, 3).line(pts(52, 12, 84, 54, 52, 54, 52, 12), C.black, 1).fill(60, 42, C.cream);
      p.line(pts(50, 10, 34, 16, 50, 22), C.red, 2).fill(44, 16, C.red);
      p.line(pts(8, 60, 92, 60, 76, 82, 24, 82, 8, 60), C.black, 2).fill(50, 70, C.brown);
      p.line(pts(2, 92, 18, 86, 34, 92, 50, 86, 66, 92, 82, 86, 98, 92), C.blue, 2);
    },
  },
  {
    name: "책",
    keywords: ["책", "공부", "도서관", "독서", "소설", "숙제", "시험", "일기"],
    draw: (p) => {
      p.line(pts(50, 28, 10, 20, 10, 80, 50, 88, 50, 28), C.navy, 2).fill(30, 50, C.cream);
      p.line(pts(50, 28, 90, 20, 90, 80, 50, 88), C.navy, 2).fill(70, 50, C.cream);
      for (const y of [36, 48, 60]) p.line(pts(18, y, 42, y + 5), C.gray, 1).line(pts(58, y + 5, 82, y), C.gray, 1);
    },
  },
  {
    name: "공",
    keywords: ["공", "축구", "농구", "야구", "배구", "공놀이", "월드컵", "축구공"],
    draw: (p) => {
      p.circle(50, 50, 38, C.black, 2);
      const pent: Point[] = [];
      for (let i = 0; i <= 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        pent.push({ x: 50 + Math.cos(a) * 13, y: 50 + Math.sin(a) * 13 });
      }
      p.line(pent, C.black, 2).fill(50, 50, C.black);
      for (let i = 0; i < 5; i++) p.line([pent[i], { x: 50 + (pent[i].x - 50) * 2.9, y: 50 + (pent[i].y - 50) * 2.9 }], C.black, 2);
    },
  },
  {
    name: "기차",
    keywords: ["기차", "지하철", "열차", "승강장", "전철", "철도"],
    draw: (p) => {
      p.line(pts(12, 22, 22, 22, 22, 40, 12, 40, 12, 22), C.black, 2).fill(17, 31, C.gray);
      p.line(pts(6, 40, 46, 40, 46, 78, 6, 78, 6, 40), C.black, 2).fill(26, 66, C.red);
      p.line(pts(26, 46, 40, 46, 40, 58, 26, 58, 26, 46), C.black, 1).fill(33, 52, C.cyan);
      p.line(pts(52, 46, 94, 46, 94, 78, 52, 78, 52, 46), C.black, 2).fill(73, 62, C.blue).line(pts(46, 70, 52, 70), C.black, 3);
      for (const x of [16, 36, 62, 84]) p.circle(x, 82, 7, C.black, 2).fill(x, 82, C.gray);
      p.line(pts(2, 93, 98, 93), C.brown, 3);
    },
  },
  {
    name: "커피",
    keywords: ["커피", "컵", "카페", "우유", "음료", "주스", "라떼", "머그"],
    draw: (p) => {
      p.line(pts(22, 34, 70, 34, 66, 90, 26, 90, 22, 34), C.black, 2).fill(46, 66, C.lightGray);
      p.ellipse(46, 34, 24, 6, C.black, 2).fill(46, 34, C.brown);
      p.ellipse(72, 60, 13, 15, C.black, 4, -Math.PI / 2, Math.PI / 2);
      p.line(pts(36, 24, 32, 16, 38, 8, 34, 0), C.gray, 2).line(pts(54, 24, 50, 16, 56, 8, 52, 0), C.gray, 2);
    },
  },
  {
    name: "휴대폰",
    keywords: ["휴대폰", "핸드폰", "스마트폰", "전화", "폰", "앱", "문자", "카톡", "게임"],
    draw: (p) => {
      p.line(pts(28, 4, 72, 4, 72, 96, 28, 96, 28, 4), C.black, 2).fill(30, 92, C.gray);
      p.line(pts(32, 12, 68, 12, 68, 82, 32, 82, 32, 12), C.black, 1).fill(50, 70, C.cyan);
      p.dot(40, 22, C.red, 6).dot(50, 22, C.amber, 6).dot(60, 22, C.green, 6).dot(40, 34, C.violet, 6).dot(50, 34, C.blue, 6);
      p.circle(50, 89, 3, C.black, 1);
    },
  },
  {
    name: "아이스크림",
    keywords: ["아이스크림", "빙수", "콘", "디저트", "젤라또"],
    draw: (p) => {
      p.line(pts(32, 50, 68, 50, 50, 96, 32, 50), C.brown, 2).fill(50, 64, C.tan);
      p.line(pts(40, 58, 56, 74), C.brown, 1).line(pts(60, 58, 44, 74), C.brown, 1);
      p.circle(50, 40, 18, C.pink, 2).fill(50, 44, C.lightPink);
      p.circle(50, 18, 12, C.amber, 2).fill(50, 18, C.cream).dot(50, 5, C.red, 6);
    },
  },
  {
    name: "수박",
    keywords: ["수박", "과일"],
    draw: (p) => {
      p.ellipse(50, 30, 44, 44, C.forest, 4, 0, Math.PI).line(pts(6, 30, 94, 30), C.forest, 2);
      // A pale band between rind and flesh — red and green alone look the same to red-green color-blind players.
      p.ellipse(50, 30, 36, 36, C.cream, 4, 0, Math.PI).fill(50, 70, C.green).fill(50, 46, C.red);
      for (const [x, y] of [[34, 40], [50, 44], [66, 40], [42, 54], [58, 54]]) p.dot(x, y, C.black, 3);
    },
  },
  {
    name: "펭귄",
    keywords: ["펭귄", "남극"],
    draw: (p) => {
      p.ellipse(50, 54, 25, 38, C.black, 2).fill(50, 24, C.navy);
      p.ellipse(50, 62, 16, 26, C.black, 1).fill(50, 64, C.cream);
      p.dot(43, 28, C.cream, 4).dot(57, 28, C.cream, 4).dot(43, 28, C.black, 2).dot(57, 28, C.black, 2);
      p.line(pts(45, 35, 55, 35, 50, 42, 45, 35), C.orange, 2).fill(50, 37, C.orange);
      p.ellipse(40, 93, 8, 3, C.orange, 3).ellipse(60, 93, 8, 3, C.orange, 3);
    },
  },
  {
    name: "개구리",
    keywords: ["개구리", "올챙이", "우물"],
    draw: (p) => {
      p.circle(32, 34, 11, C.forest, 2).fill(32, 34, C.lime).circle(68, 34, 11, C.forest, 2).fill(68, 34, C.lime);
      p.ellipse(50, 62, 36, 24, C.forest, 2).fill(50, 66, C.green);
      p.dot(32, 33, C.black, 5).dot(68, 33, C.black, 5);
      p.ellipse(50, 64, 18, 8, C.forest, 2, 0.2, Math.PI - 0.2);
    },
  },
  {
    name: "쥐",
    keywords: ["쥐", "생쥐", "햄스터", "다람쥐"],
    draw: (p) => {
      p.ellipse(46, 62, 30, 20, C.black, 2).fill(40, 66, C.gray);
      p.circle(66, 40, 10, C.black, 2).fill(66, 40, C.lightPink);
      p.dot(70, 56, C.black, 3).dot(76, 64, C.pink, 4);
      p.line(pts(16, 64, 6, 52, 12, 40, 4, 30), C.pink, 2);
    },
  },
  {
    name: "성",
    keywords: ["성", "궁전", "왕국", "공주", "왕자", "왕"],
    draw: (p) => {
      p.line(pts(10, 92, 10, 26, 18, 26, 18, 34, 26, 34, 26, 26, 34, 26, 34, 44, 66, 44, 66, 26, 74, 26, 74, 34, 82, 34, 82, 26, 90, 26, 90, 92, 10, 92), C.gray, 2).fill(50, 60, C.lightGray);
      p.line(pts(42, 92, 42, 74, 50, 66, 58, 74, 58, 92), C.black, 2).fill(50, 82, C.brown);
      p.line(pts(22, 26, 22, 8), C.black, 2).line(pts(22, 8, 36, 12, 22, 16), C.red, 2).fill(27, 12, C.red);
      p.line(pts(78, 26, 78, 8), C.black, 2).line(pts(78, 8, 92, 12, 78, 16), C.red, 2).fill(83, 12, C.red);
    },
  },
  {
    name: "무지개",
    keywords: ["무지개", "희망"],
    draw: (p) => {
      [C.red, C.orange, C.amber, C.green, C.blue, C.violet].forEach((color, i) => p.ellipse(50, 74, 44 - i * 5, 44 - i * 5, color, 4, Math.PI, Math.PI * 2));
      p.ellipse(10, 80, 12, 8, C.gray, 2).ellipse(90, 80, 12, 8, C.gray, 2);
    },
  },
  {
    name: "로켓",
    keywords: ["로켓", "우주선", "발사", "외계인"],
    draw: (p) => {
      p.line(pts(50, 4, 66, 28, 66, 72, 34, 72, 34, 28, 50, 4), C.black, 2).fill(50, 56, C.lightGray);
      p.circle(50, 38, 8, C.black, 2).fill(50, 38, C.cyan);
      p.line(pts(34, 54, 20, 80, 34, 72), C.black, 2).fill(30, 70, C.red).line(pts(66, 54, 80, 80, 66, 72), C.black, 2).fill(70, 70, C.red);
      p.line(pts(40, 72, 50, 96, 60, 72), C.red, 2).fill(50, 78, C.orange);
    },
  },
  {
    name: "소",
    keywords: ["소", "젖소", "황소", "외양간", "목장", "코뿔소", "하마"],
    draw: (p) => {
      p.line(pts(30, 26, 22, 10), C.tan, 4).line(pts(70, 26, 78, 10), C.tan, 4);
      p.ellipse(50, 50, 26, 30, C.black, 2).fill(50, 40, C.lightGray);
      p.ellipse(40, 34, 8, 6, C.black, 2).fill(40, 34, C.black).ellipse(62, 46, 7, 9, C.black, 2).fill(62, 46, C.black);
      p.ellipse(50, 72, 18, 11, C.black, 2).fill(50, 74, C.lightPink).dot(43, 72, C.black, 3).dot(57, 72, C.black, 3);
      p.dot(40, 50, C.black, 3);
    },
  },
];

/** Endings that can ride on a noun inside one word ("개가", "집에서", "개들이"). */
const PARTICLES = ["에서", "에게", "한테", "하고", "이랑", "처럼", "까지", "부터", "이", "가", "을", "를", "은", "는", "의", "와", "과", "랑", "에", "도", "만", "들"];

/**
 * Prefixes people glue onto a one-letter noun without a space ("흰개",
 * "아기새", "검정개"). "번개" must stay a 번개, so a prefix counts only if
 * it's listed here or is an adjective form of 2+ syllables ending in ㄴ
 * ("착한개", "커다란배" — but not the one-syllable 번/안 of 번개/안개).
 */
const MODIFIERS = ["흰", "큰", "들", "아기", "새끼", "꼬마", "애완", "검정", "하양", "노랑", "빨강", "파랑", "초록", "분홍", "보라", "회색", "갈색", "주황", "황금", "금색", "은색", "대왕", "미니", "거대", "왕"];

function isAdjectivePrefix(prefix: string): boolean {
  if (MODIFIERS.includes(prefix)) return true;
  const code = prefix.charCodeAt(prefix.length - 1) - 0xac00;
  return prefix.length >= 2 && code >= 0 && code <= 11171 && code % 28 === 4; // final ㄴ
}

/** The word plus what's left after peeling particles off its end ("개들이" → 개들이, 개들, 개). */
function stemsOf(word: string): string[] {
  const stems = [word];
  let rest = word;
  for (let i = 0; i < 3; i++) {
    const particle = PARTICLES.find((p) => rest.length > p.length && rest.endsWith(p));
    if (!particle) break;
    rest = rest.slice(0, -particle.length);
    stems.push(rest);
  }
  return stems;
}

/**
 * Templates named in `text`, in the order they appear (at most two — the
 * last two, where the subject is).
 * A one-letter keyword ("개", "차", "해") must be the whole word give or take
 * particles, or follow an adjective (MODIFIERS, "흰개") — otherwise "번개장터"
 * reads as 개 and the bot draws a dog. Longer
 * keywords may sit inside a compound ("생일케이크"), but one inside a longer
 * match doesn't count ("눈사람" isn't also a 사람).
 */
/** Names of every doodle the bot knows, for tests. */
export const TEMPLATE_NAMES: readonly string[] = TEMPLATES.map((t) => t.name);

function templatesIn(text: string): Template[] {
  const hits: { t: Template; at: number; end: number }[] = [];
  for (const m of text.matchAll(/[^\s.,!?~"'()[\]·]+/g)) {
    const word = m[0];
    const start = m.index ?? 0;
    const stems = stemsOf(word);
    for (const t of TEMPLATES) {
      for (const k of t.keywords) {
        if (k.length === 1) {
          const stem = stems.find((st) => st === k || (st.length > 1 && st.endsWith(k) && isAdjectivePrefix(st.slice(0, -1))));
          if (stem) hits.push({ t, at: start + stem.length - 1, end: start + stem.length });
          continue;
        }
        for (let i = word.indexOf(k); i >= 0; i = word.indexOf(k, i + 1)) hits.push({ t, at: start + i, end: start + i + k.length });
      }
    }
  }
  const kept = hits.filter((h) => !hits.some((o) => o.at <= h.at && o.end >= h.end && o.end - o.at > h.end - h.at));
  const found: Template[] = [];
  for (const h of kept.sort((a, b) => a.at - b.at)) if (!found.includes(h.t)) found.push(h.t);
  // Korean puts the subject last ("우주에서 피자 배달하는 펭귄") — with three or more, keep the last two.
  return found.length > 2 ? found.slice(-2) : found;
}

/** Which doodles a prompt asks for, by template name — exported for tests. */
export function templateNamesIn(text: string): string[] {
  return templatesIn(text).map((t) => t.name);
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
    if (isShapeOp(op)) {
      // Shapes store absolute corners, not deltas — jitter and shift each corner.
      const [x1, y1, x2, y2] = op.p;
      const moved = shapeOp(op.k, op.c, op.w, { x: x1 + dx + j(), y: y1 + dy + j() }, { x: x2 + dx + j(), y: y2 + dy + j() }, { opacity: opAlpha(op) * 100, filled: op.f === 1 });
      return moved;
    }
    return strokeOp(op.c, op.w, decodePoints(op.p).map((pt) => ({ x: pt.x + dx + j(), y: pt.y + dy + j() })), opAlpha(op) * 100);
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

// ---------------------------------------------------------------------------
// Animation mode — the next frame
// ---------------------------------------------------------------------------

/**
 * Opacity of the scenery added to animation frames (by bots and the 🌄
 * button). Faint on purpose, so the hand-drawn subject stays the star of the
 * flipbook instead of the auto background. The value also tells the next bot
 * "this is the background — leave it where it is", and it's off the opacity
 * slider's 5% grid, so a person's own strokes can't be mistaken for it.
 */
export const SCENERY_ALPHA = 47;

export function isSceneryOp(op: DrawOp): boolean {
  return "a" in op && op.a === SCENERY_ALPHA;
}

/** Horizontal step per frame and hop height, logical px. */
const FRAME_STEP_X = 26;
const FRAME_HOP_Y = 16;
const FRAME_MARGIN = 6;
/** Free run the subject needs to walk at all; a wider subject is shrunk once to get this much room. */
const MIN_WALK_ROOM = 3 * FRAME_STEP_X;
const SHRINK_TO_ROOM = 120;

type ScenePiece = (rng: () => number, wobble: number) => DrawOp[];

const wavyLine = (y: number, color: number, sizeIndex: number, rng: () => number, wobble: number): DrawOp =>
  strokeOp(color, sizeIndex, Array.from({ length: 13 }, (_, i) => ({ x: i * (CANVAS_W / 12), y: y + Math.sin(i * 1.3) * 3 + (rng() - 0.5) * wobble })));

const disc = (cx: number, cy: number, r: number, color: number): DrawOp => shapeOp("e", color, 0, { x: cx - r, y: cy - r }, { x: cx + r, y: cy + r }, { filled: true });

const starPoints = (cx: number, cy: number, r: number): Point[] =>
  Array.from({ length: 11 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr };
  });

/**
 * Background pieces in two stages, one added per frame: stage 1 sets the
 * scene (ground first), stage 2 dresses it up (rainbow, rain, stars…) so long
 * albums (10+ players) keep growing to the last frame. Fixed spots around the
 * edges so they rarely sit under the subject — and they're drawn behind it.
 */
const SCENE_STAGES: readonly (readonly ScenePiece[])[] = [
  [
    // ground
    (rng, w) => [wavyLine(344, C.green, 2, rng, w)],
    // sun
    (rng, w) => {
      const pen = new Pen({ x: 400, y: 8, size: 70 }, rng, w);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pen.line(pts(50 + Math.cos(a) * 30, 50 + Math.sin(a) * 30, 50 + Math.cos(a) * 46, 50 + Math.sin(a) * 46), C.orange, 2);
      }
      return [disc(435, 43, 16, C.amber), ...pen.ops];
    },
    // cloud
    (rng, w) => new Pen({ x: 20, y: 14, size: 80 }, rng, w).ellipse(30, 40, 18, 14, C.blue, 2).ellipse(52, 32, 22, 18, C.blue, 2).ellipse(74, 42, 18, 13, C.blue, 2).ops,
    // bird
    (rng, w) => new Pen({ x: 190, y: 16, size: 40 }, rng, w).line(pts(10, 50, 30, 36, 50, 52, 70, 36, 90, 50), C.black, 2).ops,
    // flower
    (rng, w) => {
      const pen = new Pen({ x: 14, y: 270, size: 70 }, rng, w).line(pts(50, 40, 50, 100), C.forest, 2);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        pen.circle(50 + Math.cos(a) * 12, 30 + Math.sin(a) * 12, 8, C.pink, 2);
      }
      return [...pen.ops, disc(49, 291, 5, C.amber)];
    },
    // grass tufts on the ground line
    (rng, w) =>
      [70, 190, 300, 420].flatMap((x) => new Pen({ x: x - 14, y: 318, size: 28 }, rng, w).line(pts(50, 92, 20, 30), C.green, 2).line(pts(50, 92, 50, 10), C.green, 2).line(pts(50, 92, 80, 30), C.green, 2).ops),
    // second cloud
    (rng, w) => new Pen({ x: 270, y: 30, size: 60 }, rng, w).ellipse(32, 40, 18, 13, C.cyan, 2).ellipse(58, 36, 22, 16, C.cyan, 2).ops,
    // second bird
    (rng, w) => new Pen({ x: 330, y: 4, size: 30 }, rng, w).line(pts(10, 50, 30, 36, 50, 52, 70, 36, 90, 50), C.black, 2).ops,
  ],
  [
    // rainbow
    (rng, w) => {
      const pen = new Pen({ x: 130, y: -10, size: 180 }, rng, w);
      [C.red, C.orange, C.amber, C.green, C.blue, C.violet].forEach((color, i) => pen.ellipse(50, 50, 44 - i * 3, 30 - i * 3, color, 2, Math.PI, Math.PI * 2));
      return pen.ops;
    },
    // rain under the first cloud
    (rng, w) => {
      const pen = new Pen({ x: 20, y: 60, size: 90 }, rng, w);
      for (const [x, y] of [[20, 20], [40, 34], [60, 18], [80, 32], [30, 56], [70, 54]]) pen.line(pts(x, y, x - 3, y + 12), C.blue, 1);
      return pen.ops;
    },
    // stars
    () => [strokeOp(C.amber, 1, starPoints(130, 76, 9)), strokeOp(C.amber, 1, starPoints(262, 64, 7)), strokeOp(C.amber, 1, starPoints(372, 104, 8))],
    // butterfly by the flower
    (rng, w) => new Pen({ x: 96, y: 262, size: 36 }, rng, w).ellipse(32, 40, 18, 22, C.violet, 2).ellipse(68, 40, 18, 22, C.violet, 2).line(pts(50, 22, 50, 66), C.black, 2).ops,
    // bush on the right
    (rng, w) => new Pen({ x: 404, y: 290, size: 70 }, rng, w).ellipse(30, 66, 22, 18, C.forest, 2).ellipse(56, 58, 24, 22, C.forest, 2).ellipse(80, 68, 18, 14, C.forest, 2).ops,
    // pebbles on the ground
    (rng, w) => new Pen({ x: 220, y: 320, size: 60 }, rng, w).ellipse(30, 40, 10, 6, C.gray, 2).ellipse(52, 42, 7, 5, C.gray, 2).ellipse(70, 38, 9, 6, C.gray, 2).ops,
  ],
];

/** Small deterministic hash so every bot continuing the same album tells the same story. */
function albumHash(seed: number, album: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(album + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return (h ^ (h >>> 12)) >>> 0;
}

function shuffled<T>(items: readonly T[], seedHash: number): T[] {
  const out = [...items];
  let h = seedHash;
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Names for the 🌄 picker, in SCENE_STAGES order. */
const SCENE_LABELS: readonly (readonly string[])[] = [
  ["🟩 땅", "☀️ 해", "☁️ 구름", "🐦 새", "🌸 꽃", "🌱 풀", "☁️ 구름 하나 더", "🐦 새 한 마리 더"],
  ["🌈 무지개", "🌧️ 비", "⭐ 별", "🦋 나비", "🌳 덤불", "🪨 조약돌"],
];

interface NamedPiece {
  readonly draw: ScenePiece;
  readonly label: string;
}

const NAMED_STAGES: readonly (readonly NamedPiece[])[] = SCENE_STAGES.map((stage, s) => stage.map((draw, i) => ({ draw, label: SCENE_LABELS[s][i] })));

/** Scenery order for an album: the ground first, the rest of stage 1 shuffled, then stage 2 shuffled. */
function sceneOrder(seed: number, album: number): NamedPiece[] {
  const [first, second] = NAMED_STAGES;
  const h = albumHash(seed, album);
  return [first[0], ...shuffled(first.slice(1), h), ...shuffled(second, (h ^ 0x51ed27) >>> 0)];
}

/** Scenery pieces an album can collect (one per frame from frame 2) — enough for a 14-player album. */
export const SCENE_PIECE_COUNT = SCENE_STAGES.reduce((n, stage) => n + stage.length, 0);

/** Gap kept between scenery and the subject's walking band (covers the hop). */
const SCENERY_GAP = FRAME_HOP_Y + 4;

/**
 * How far to slide `b` vertically to keep it out of `avoid` (the band the
 * subject walks in): 0 if already clear, else up into the sky or down toward
 * the ground (ground-level pieces only go down) — null if neither fits.
 */
function clearanceShift(b: Bounds, avoid: Bounds | null): number | null {
  if (!avoid) return 0;
  const top = avoid.minY - SCENERY_GAP;
  const bottom = avoid.maxY + SCENERY_GAP;
  if (b.maxY < top || b.minY > bottom) return 0;
  const up = top - b.maxY;
  // Ground-level pieces (ground line, grass, flowers…) never float up into the sky.
  if (b.minY < CANVAS_H / 2 && b.minY + up >= 0) return up;
  const down = bottom - b.minY;
  if (b.maxY + down <= CANVAS_H) return down;
  return null;
}

/**
 * This frame's background piece, tagged as scenery — empty once they're all
 * out. Scenery is drawn first, so a line through the subject would split its
 * flood fills (a rainbow through a car left the body half-painted): a piece
 * that would cross `avoid` (where the subject walks) slides up into the sky or
 * down toward the ground, and one with no room either way drops out of the
 * running order. Frame 2 gets the first remaining piece, frame 3 the next…
 * Shared by the bot and the human "🌄 배경 한 조각" button, so both add the
 * same piece to the same frame.
 */
export function scenePieceFor(seed: number, album: number, frame: number, rng: () => number, level: BotLevel = 7, avoid: Bounds | null = null): DrawOp[] {
  return sceneChoicesFor(seed, album, frame, rng, level, avoid, 1)[0]?.ops ?? [];
}

/**
 * The 🌄 picker: this frame's piece (what a bot would add) plus the next
 * ones in the album's order, so a person chooses their own background
 * instead of always getting the bot's. Same placement rules as above.
 */
export function sceneChoicesFor(seed: number, album: number, frame: number, rng: () => number, level: BotLevel = 7, avoid: Bounds | null = null, count = 3): { label: string; ops: DrawOp[] }[] {
  const steady = () => 0.5; // no wobble — just to measure where a piece lands
  const placeable = sceneOrder(seed, album).flatMap((piece) => {
    const b = unionBounds(piece.draw(steady, 0));
    const dy = b ? clearanceShift(b, avoid) : 0;
    return dy === null ? [] : [{ piece, dy }];
  });
  return placeable.slice(frame - 2, frame - 2 + count).map(({ piece, dy }) => ({
    label: piece.label,
    ops: piece.draw(rng, wobbleFor(level)).map((op) => ({ ...translateOp(op, 0, dy), a: SCENERY_ALPHA }) as DrawOp),
  }));
}

/** The ops still visible (after the last clear-all). */
function visibleOps(drawing: Drawing): DrawOp[] {
  const lastClear = drawing.ops.map((op) => op.k).lastIndexOf("x");
  return drawing.ops.slice(lastClear + 1);
}

function subjectBounds(drawing: Drawing | null): Bounds | null {
  return drawing ? unionBounds(visibleOps(drawing).filter((op) => !isSceneryOp(op))) : null;
}

/** Scales ops by `k` around `pivot`. Absolute points are rounded (not deltas), so closed outlines stay closed and fills don't leak. */
function scaleOps(ops: readonly DrawOp[], k: number, pivot: Point): DrawOp[] {
  const at = (p: Point): Point => ({ x: pivot.x + (p.x - pivot.x) * k, y: pivot.y + (p.y - pivot.y) * k });
  return ops.map((op): DrawOp => {
    if (op.k === "x") return op;
    if (op.k === "f") {
      const p = at(op);
      return { ...op, x: clampX(p.x), y: clampY(p.y) };
    }
    if (isShapeOp(op)) {
      const [x1, y1, x2, y2] = op.p;
      const a = clampToCanvas(at({ x: x1, y: y1 }));
      const b = clampToCanvas(at({ x: x2, y: y2 }));
      return { ...op, p: [a.x, a.y, b.x, b.y] };
    }
    return { ...op, p: encodePoints(decodePoints(op.p).map(at)) };
  });
}

/**
 * Whether rising `raised` px between two frames looks like a hop worth landing
 * from. A bigger lift is someone moving the subject on purpose (flying it up,
 * putting it on a roof…) — the next frame carries on from there instead of
 * yanking it back down.
 */
function isHop(raised: number): boolean {
  return raised >= FRAME_HOP_Y / 2 && raised <= FRAME_HOP_Y * 1.5;
}

/**
 * Where the subject goes next, from where it was in the last two frames — a
 * human who dragged it somewhere new is continued from there, not snapped
 * back to a precomputed path. It keeps the last frame's walking direction
 * (bouncing off the edges; the album's default before it has moved), hops up
 * on even frames and lands back on odd ones.
 */
function nextPosition(prev: Bounds, prev2: Bounds | null, size: { w: number; h: number }, frame: number, defaultDir: number): Point {
  const moved = prev2 ? prev.minX - prev2.minX : 0;
  const dir = Math.abs(moved) >= 2 ? Math.sign(moved) : defaultDir;
  const lo = FRAME_MARGIN;
  const hi = Math.max(lo, CANVAS_W - FRAME_MARGIN - size.w);
  let x = prev.minX + dir * FRAME_STEP_X;
  if (x > hi) x = 2 * hi - x;
  if (x < lo) x = 2 * lo - x;
  x = Math.min(hi, Math.max(lo, x));

  let bottom = prev.maxY;
  if (frame % 2 === 0) bottom -= FRAME_HOP_Y;
  else if (prev2 && isHop(prev2.maxY - prev.maxY)) bottom = prev2.maxY; // land from last frame's hop
  const y = Math.min(CANVAS_H - FRAME_MARGIN - size.h, Math.max(FRAME_MARGIN, bottom - size.h));
  return { x, y };
}

/**
 * Animation mode: frame `frame` of an album. `current` is what gets moved —
 * the previous frame for a bot, or the canvas so far for the human "🏃 한
 * 걸음" button — while `prev`/`prev2` (frames frame-1 and frame-2) decide
 * where it goes, so pressing the button twice doesn't walk twice.
 *
 * The subject (everything but the scenery) slides without hand wobble:
 * re-jittering every frame random-walks the outlines until a gap opens and
 * the next flood fill leaks (a car turned its window's color by frame 5). A
 * subject too big to walk or hop is shrunk once around its bottom-centre.
 * With `addScenery`, this frame's background piece is drawn behind it.
 */
export function nextAnimationFrame(
  current: Drawing,
  opts: { seed: number; album: number; frame: number; prev: Drawing | null; prev2: Drawing | null; addScenery: boolean },
  rng: () => number,
  level: BotLevel,
): Drawing {
  const ops = visibleOps(current);
  const scenery = ops.filter(isSceneryOp);
  let subject: readonly DrawOp[] = ops.filter((op) => !isSceneryOp(op));
  let now = unionBounds(subject);

  if (now) {
    const maxW = CANVAS_W - 2 * FRAME_MARGIN - MIN_WALK_ROOM;
    const maxH = CANVAS_H - 2 * FRAME_MARGIN - FRAME_HOP_Y;
    const w = now.maxX - now.minX;
    const h = now.maxY - now.minY;
    if (w > maxW || h > maxH) {
      const k = Math.min((CANVAS_W - 2 * FRAME_MARGIN - SHRINK_TO_ROOM) / w, (maxH - FRAME_HOP_Y) / h, 1);
      subject = scaleOps(subject, k, { x: (now.minX + now.maxX) / 2, y: now.maxY });
      now = unionBounds(subject) ?? now;
    }
    const prev = subjectBounds(opts.prev) ?? now;
    const size = { w: now.maxX - now.minX, h: now.maxY - now.minY };
    const target = nextPosition(prev, subjectBounds(opts.prev2), size, opts.frame, albumHash(opts.seed, opts.album) % 2 === 0 ? 1 : -1);
    const dx = Math.round(target.x - now.minX);
    const dy = Math.round(target.y - now.minY);
    // dx/dy keep the whole subject on the sheet, so translateOp's per-op clamp never squashes anything.
    subject = subject.map((op) => (op.k === "f" ? { ...op, x: clampX(op.x + dx), y: clampY(op.y + dy) } : translateOp(op, dx, dy)));
  }

  const added = opts.addScenery ? scenePieceFor(opts.seed, opts.album, opts.frame, rng, level, unionBounds(subject)) : [];
  const withScene: Drawing = { v: 1, ops: [...scenery, ...added, ...subject] };
  if (serializedLength(withScene) <= MAX_DRAWING_CHARS) return withScene;
  const plain: Drawing = { v: 1, ops: [...scenery, ...subject] };
  return serializedLength(plain) <= MAX_DRAWING_CHARS ? plain : current;
}

const clampX = (x: number) => Math.round(Math.min(CANVAS_W, Math.max(0, x)));
const clampY = (y: number) => Math.round(Math.min(CANVAS_H, Math.max(0, y)));

function templateNamed(word: string, rng: () => number): Template[] {
  const found = templatesIn(word);
  return found.length > 0 ? found : [TEMPLATES[Math.floor(rng() * TEMPLATES.length)]];
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
    } else if (isShapeOp(op)) {
      const [x1, y1, x2, y2] = op.p;
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      // Filled shapes count their area (scaled like a fill), outlines their perimeter like a stroke.
      amount = op.k === "l" ? Math.hypot(w, h) * (op.w + 1) : op.f === 1 ? (w * h) / 40 : 2 * (w + h) * (op.w + 1);
    }
    const key = nearestPaletteIndex(op.c); // free picker colors count as their closest palette color
    ink.set(key, (ink.get(key) ?? 0) + amount * opAlpha(op));
  }
  ink.delete(0);
  return ink;
}

function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}

function joinWords(words: readonly string[]): string {
  const guess = words.length === 1 ? words[0] : `${words[0]}${hasBatchim(words[0]) ? "과" : "와"} ${words[1]}`;
  return Array.from(guess).slice(0, TEXT_MAX_CHARS).join("");
}

/** Last resort when nothing in the picture looks familiar: name the colors with the most ink. */
function guessFromInk(drawing: Drawing, rng: () => number): string {
  const ranked = [...inkByColor(drawing).entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color);
  const words: string[] = [];
  for (const color of ranked) {
    const pool = (COLOR_WORDS[color] ?? []).filter((w) => !words.includes(w));
    if (pool.length > 0) words.push(pool[Math.floor(rng() * pool.length)]);
    if (words.length === 2) break;
  }
  if (words.length === 0) return BLANK_GUESSES[0];
  return joinWords(words);
}

// ---------------------------------------------------------------------------
// Guessing by looking — shape + color layout against the templates
// ---------------------------------------------------------------------------

/** Palette index → color family, so red vs dark red isn't a different picture. 0 = paper. */
const FAMILY = [0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9];
const FAMILIES = 10;
/** Grid sizes of the normalized silhouette and of the coarser color-layout map. */
const SHAPE_N = 10;
const PATCH_N = 5;
/** Below this similarity the bot doesn't trust its eyes and falls back to the ink colors. Tuned on wobbly bot drawings (see the tests). */
const RECOGNIZE_MIN = 0.62;
/**
 * Pictures with less colored ink than this (black/gray pen only) are matched
 * by shape alone against outline versions of the templates — compared by
 * color, every black line drawing looked like the mostly-black soccer ball.
 */
const LINE_ART_MAX_COLOR = 0.2;
const RECOGNIZE_LINE_MIN = 0.7;
/** Line art must also beat the runner-up by this much — outlines of round faces (dog/monkey/bear) look alike, and a wrong guess said confidently is worse than none. */
const LINE_ART_MARGIN = 0.04;
/** Line art the bot isn't sure about still gets a hedged guess ("강아지…인가?") above this similarity, instead of naming ink colors. */
const HUNCH_MIN = 0.55;
/** An empty column run at least this wide (in raster cells) can separate two objects. */
const MIN_GAP_CELLS = 3;

interface Look {
  readonly shape: Float64Array;
  readonly patches: Float64Array;
  readonly colors: Float64Array;
  readonly aspect: number;
  /** Share of the ink in real colors (not black/gray). */
  readonly colorful: number;
  /** Inked cells of a finer MASK_N×MASK_N normalized grid, and each cell's distance to the nearest ink — for chamfer matching of line art. */
  readonly inked: readonly number[];
  readonly dist: Float64Array;
}

const MASK_N = 24;

/** Two-pass chamfer distance transform (in cells) to the nearest inked cell. */
function distanceField(mask: Uint8Array): Float64Array {
  const d = new Float64Array(MASK_N * MASK_N).map((_, i) => (mask[i] ? 0 : Infinity));
  const relax = (i: number, j: number, cost: number) => {
    if (d[j] + cost < d[i]) d[i] = d[j] + cost;
  };
  for (let y = 0; y < MASK_N; y++) {
    for (let x = 0; x < MASK_N; x++) {
      const i = y * MASK_N + x;
      if (x > 0) relax(i, i - 1, 1);
      if (y > 0) relax(i, i - MASK_N, 1);
      if (x > 0 && y > 0) relax(i, i - MASK_N - 1, Math.SQRT2);
      if (x < MASK_N - 1 && y > 0) relax(i, i - MASK_N + 1, Math.SQRT2);
    }
  }
  for (let y = MASK_N - 1; y >= 0; y--) {
    for (let x = MASK_N - 1; x >= 0; x--) {
      const i = y * MASK_N + x;
      if (x < MASK_N - 1) relax(i, i + 1, 1);
      if (y < MASK_N - 1) relax(i, i + MASK_N, 1);
      if (x < MASK_N - 1 && y < MASK_N - 1) relax(i, i + MASK_N + 1, Math.SQRT2);
      if (x > 0 && y < MASK_N - 1) relax(i, i + MASK_N - 1, Math.SQRT2);
    }
  }
  return d;
}

/** Features of the ink in columns [x0, x1): silhouette and color layout in its own bounding square, plus overall colors. */
function lookAt(raster: Raster, x0: number, x1: number): Look | null {
  const H = raster.length / RASTER_W;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < H; y++) {
    for (let x = x0; x < x1; x++) {
      if (raster[y * RASTER_W + x] === 0) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const side = Math.max(w, h);
  const offX = (side - w) / 2;
  const offY = (side - h) / 2;
  const raw = new Float64Array(SHAPE_N * SHAPE_N);
  const patches = new Float64Array(PATCH_N * PATCH_N * FAMILIES);
  const colors = new Float64Array(FAMILIES);
  let colorful = 0;
  let ink = 0;
  const mask = new Uint8Array(MASK_N * MASK_N);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const fam = FAMILY[raster[y * RASTER_W + x]] ?? 1;
      if (fam === 0) continue;
      const u = (x - minX + offX + 0.5) / side;
      const v = (y - minY + offY + 0.5) / side;
      raw[Math.floor(v * SHAPE_N) * SHAPE_N + Math.floor(u * SHAPE_N)] += 1;
      patches[(Math.floor(v * PATCH_N) * PATCH_N + Math.floor(u * PATCH_N)) * FAMILIES + fam] += 1;
      colors[fam] += fam === 1 ? 0.4 : 1; // black outlines are in almost every drawing — they say little
      if (fam > 2) colorful++;
      mask[Math.min(MASK_N - 1, Math.floor(v * MASK_N)) * MASK_N + Math.min(MASK_N - 1, Math.floor(u * MASK_N))] = 1;
      ink++;
    }
  }
  // A light blur so a stroke one cell off still lines up.
  const shape = new Float64Array(SHAPE_N * SHAPE_N);
  for (let y = 0; y < SHAPE_N; y++) {
    for (let x = 0; x < SHAPE_N; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < SHAPE_N && xx >= 0 && xx < SHAPE_N) sum += raw[yy * SHAPE_N + xx] * (dx === 0 && dy === 0 ? 2 : 1);
      }
      shape[y * SHAPE_N + x] = sum;
    }
  }
  const inked = [...mask.keys()].filter((i) => mask[i] === 1);
  return { shape, patches, colors, aspect: w / h, colorful: colorful / ink, inked, dist: distanceField(mask) };
}

function cosine(a: Float64Array, b: Float64Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Mean distance (cells) from `a`'s ink to the nearest ink of `b`. */
function chamfer(a: Look, b: Look): number {
  let sum = 0;
  for (const i of a.inked) sum += b.dist[i];
  return a.inked.length === 0 ? Infinity : sum / a.inked.length;
}

/**
 * Shape-only similarity for line art: do my lines sit on the template's lines
 * (chamfer, forgiving a cell or two of hand wobble), and is most of the
 * template there (weighted less — people leave details out).
 */
function lineSimilarity(a: Look, b: Look): number {
  const near = 1 - (0.65 * chamfer(a, b) + 0.35 * chamfer(b, a)) / 4;
  return 0.5 * near + 0.5 * cosine(a.shape, b.shape) - 0.15 * Math.abs(Math.log(a.aspect / b.aspect));
}

function similarity(a: Look, b: Look): number {
  return 0.35 * cosine(a.shape, b.shape) + 0.35 * cosine(a.patches, b.patches) + 0.3 * cosine(a.colors, b.colors) - 0.15 * Math.abs(Math.log(a.aspect / b.aspect));
}

interface Reference {
  readonly name: string;
  /** Drawn cleanly, as the bot draws it. */
  readonly look: Look;
  /** The same doodle as a person might sketch it: black outlines, no fills. */
  readonly line: Look;
}

let referenceLooks: Reference[] | null = null;

function asLineArt(drawing: Drawing): Drawing {
  return { v: 1, ops: drawing.ops.filter((op) => op.k !== "f").map((op) => (op.k === "x" ? op : ({ ...op, c: C.black, ...(isShapeOp(op) ? { f: undefined } : {}) } as DrawOp))) };
}

/** How each template looks drawn cleanly (and as bare outlines) — computed once. */
function references(): Reference[] {
  referenceLooks ??= TEMPLATES.flatMap((t) => {
    const clean = drawTemplates([t], () => 0.5, 10, [{ x: 130, y: 50, size: 220 }]);
    const look = lookAt(rasterize(clean), 0, RASTER_W);
    const line = lookAt(rasterize(asLineArt(clean)), 0, RASTER_W);
    return look && line ? [{ name: t.name, look, line }] : [];
  });
  return referenceLooks;
}

/**
 * The closest template and how sure the bot is: `confidence` ≥ 0 means sure
 * enough to say it. Colored pictures are compared by shape and color; black
 * or gray pictures by shape only (against the outline and the clean version —
 * a gray robot is filled, a pen sketch isn't), and only when one template
 * clearly stands out.
 */
interface Match {
  readonly name: string;
  readonly confidence: number;
  readonly lineArt: boolean;
  readonly score: number;
  readonly runnerUp: { readonly name: string; readonly score: number } | null;
}

function bestMatch(look: Look | null): Match {
  if (!look) return { name: "", confidence: -Infinity, lineArt: false, score: -Infinity, runnerUp: null };
  const lineArt = look.colorful < LINE_ART_MAX_COLOR;
  const scored = references()
    .map((ref) => ({ name: ref.name, score: lineArt ? Math.max(lineSimilarity(look, ref.line), lineSimilarity(look, ref.look)) : similarity(look, ref.look) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  const base = { name: best.name, lineArt, score: best.score, runnerUp: second ?? null };
  if (!lineArt) return { ...base, confidence: best.score - RECOGNIZE_MIN };
  return { ...base, confidence: Math.min(best.score - RECOGNIZE_LINE_MIN, best.score - (second?.score ?? -Infinity) - LINE_ART_MARGIN) };
}

/** Column to cut the picture at when it holds two objects side by side (a clear empty band with real ink on both sides), else null. */
function splitColumn(raster: Raster): number | null {
  const H = raster.length / RASTER_W;
  const cols = Array.from({ length: RASTER_W }, (_, x) => {
    let n = 0;
    for (let y = 0; y < H; y++) if (raster[y * RASTER_W + x] !== 0) n++;
    return n;
  });
  const total = cols.reduce((a, b) => a + b, 0);
  let best: { cut: number; width: number } | null = null;
  let left = 0;
  for (let x = 0; x < RASTER_W; x++) {
    if (cols[x] !== 0) {
      left += cols[x];
      continue;
    }
    let end = x;
    while (end < RASTER_W && cols[end] === 0) end++;
    const width = end - x;
    if (left >= total * 0.15 && total - left >= total * 0.15 && width >= MIN_GAP_CELLS && (!best || width > best.width)) best = { cut: x + Math.floor(width / 2), width };
    x = end - 1;
  }
  return best?.cut ?? null;
}


interface Reading {
  readonly whole: Match;
  /** Left and right halves, when the picture splits into two objects. */
  readonly sides: readonly [Match, Match] | null;
}

function readDrawing(drawing: Drawing): Reading {
  const raster = rasterize(drawing, isSceneryOp);
  const cut = splitColumn(raster);
  return {
    whole: bestMatch(lookAt(raster, 0, RASTER_W)),
    sides: cut === null ? null : [bestMatch(lookAt(raster, 0, cut)), bestMatch(lookAt(raster, cut, RASTER_W))],
  };
}

/**
 * What the bot thinks it's looking at: one or two template names (left to
 * right), or null when nothing is a confident match. A picture that splits
 * into two objects is read side by side — the whole of it only counts when
 * it's a much better match (one doodle with detached bits): otherwise two
 * sketches side by side looked like one wide watermelon.
 */
export function recognizeDrawing(drawing: Drawing): string[] | null {
  return namesFrom(readDrawing(drawing));
}

function namesFrom({ whole, sides }: Reading): string[] | null {
  if (!sides) return whole.confidence >= 0 ? [whole.name] : null;
  const [left, right] = sides;
  if (whole.confidence >= 0 && whole.confidence > Math.max(left.confidence, right.confidence) + 0.05) return [whole.name];
  if (left.confidence >= 0 && right.confidence >= 0) return left.name === right.name ? [left.name] : [left.name, right.name];
  const sure = sides.filter((m) => m.confidence >= 0);
  return sure.length === 1 ? [sure[0].name] : null;
}

/** Runner-up this close counts as a genuine toss-up between two things. */
const TOSS_UP_MARGIN = 0.015;

/**
 * How a bot sounds when it isn't sure — one per seat, so three bots in a room
 * don't all mumble "…인가?". Each line takes the best guess `a` (and, for a
 * toss-up, the runner-up `b`); the nouns stay in, so the next artist can
 * still draw them.
 */
const VOICES: readonly { readonly hunch: readonly ((a: string) => string)[]; readonly tossUp: (a: string, b: string) => string }[] = [
  // bold
  { hunch: [(a) => `${a}!`, (a) => `누가 봐도 ${a}`, (a) => `${a} 확정`], tossUp: (a, b) => `${josa(a, "과", "와")} ${b} 합체` },
  // playful
  { hunch: [(a) => `${a} 맞죠?`, (a) => `혹시 ${a}?`, (a) => `${a}인 척하는 무언가`], tossUp: (a, b) => `${a} 같은 ${b}` },
  // careful
  { hunch: [(a) => `${a}…인가?`, (a) => `아마도 ${a}`, (a) => `${a} (아마)`], tossUp: (a, b) => `${a}? 아니 ${b}?` },
];

/**
 * A pen sketch the bot can't call for sure: it says what it half-sees, like a
 * person would, in its seat's voice — "강아지 같은 원숭이" for a toss-up,
 * "누가 봐도 강아지" / "강아지…인가?" otherwise. Null when it doesn't even
 * half-see anything, or the picture is colored (the ink colors are a better
 * hint then).
 */
function hunchFor(reading: Reading, rng: () => number, voice: number): string | null {
  // For a two-part picture, the half the bot half-recognises best.
  const m = reading.sides ? [...reading.sides].sort((a, b) => b.confidence - a.confidence)[0] : reading.whole;
  if (!m.lineArt || m.score < HUNCH_MIN) return null;
  const v = VOICES[((voice % VOICES.length) + VOICES.length) % VOICES.length];
  if (m.runnerUp && m.score - m.runnerUp.score < TOSS_UP_MARGIN) return v.tossUp(m.name, m.runnerUp.name);
  return v.hunch[Math.floor(rng() * v.hunch.length)](m.name);
}

/** What the bot answered and why: `sure` it recognised `names`, a `hunch` (hedged), a guess from the `ink` colors, or a `blank` page. */
export interface GuessExplained {
  readonly text: string;
  readonly kind: "sure" | "hunch" | "ink" | "blank";
  readonly names: readonly string[];
}

/** `voice` picks how the bot hedges (its seat, so each bot sounds like itself). */
export function explainGuess(drawing: Drawing, rng: () => number, voice = 0): GuessExplained {
  if (isBlankDrawing(drawing)) return { text: BLANK_GUESSES[Math.floor(rng() * BLANK_GUESSES.length)], kind: "blank", names: [] };
  const reading = readDrawing(drawing);
  const seen = namesFrom(reading);
  if (seen) return { text: joinWords(seen), kind: "sure", names: seen };
  const hunch = hunchFor(reading, rng, voice);
  if (hunch) return { text: hunch, kind: "hunch", names: templateNamesIn(hunch) };
  return { text: guessFromInk(drawing, rng), kind: "ink", names: [] };
}

export function guessFromDrawing(drawing: Drawing, rng: () => number, voice = 0): string {
  return explainGuess(drawing, rng, voice).text;
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

/** How often a bot invents its own opening (promptGen.ts) instead of a stock one — sharper bots are more inventive. */
const INVENT_CHANCE = { novice: 0.4, core: 0.7, expert: 0.9 } as const;

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
      const themed = openingChoices(state.options, state.seed, album);
      const opening =
        state.options.mode === "ICEBREAKER"
          ? icebreakerAnswer(icebreakerQuestion(state.seed, album), rng)
          : themed.length > 0
            ? themed[Math.floor(rng() * themed.length)]
            : rng() < INVENT_CHANCE[botTier(level)]
              ? generatePrompt(rng)
              : BOT_OPENING_PROMPTS[Math.floor(rng() * BOT_OPENING_PROMPTS.length)];
      return [random, text(opening, 1)];
    }
    const guess = prompt.kind === "drawing" ? guessFromDrawing(prompt.drawing, rng, seat) : prompt.text;
    return [random, text(isValidText(guess) ? guess : randomPhrase(rng), 1)];
  }

  const drawing = (d: Drawing, score: number): Candidate => ({ action: { type: "SUBMIT_DRAWING", seat, turn, drawing: d }, score });
  const scribble = drawing(drawTemplates([TEMPLATES[Math.floor(rng() * TEMPLATES.length)]], rng, level), 0);
  const reference = drawingReferenceFor(state.options.mode, prompt?.kind ?? null);
  switch (reference) {
    case "free": {
      const ideas = openingChoices(state.options, state.seed, album);
      const idea = ideas.length > 0 ? ideas[Math.floor(rng() * ideas.length)] : inspirationWord(state.seed, album);
      return [scribble, drawing(drawTemplates(templateNamed(idea, rng), rng, level), 1)];
    }
    case "prompt": {
      const { understood, misread } = botDrawingFor(prompt?.kind === "text" ? prompt.text : "", rng, level);
      return [drawing(misread, 0), drawing(understood, 1)];
    }
    case "copy":
    case "memory":
      return [scribble, drawing(redrawDrawing(prompt?.kind === "drawing" ? prompt.drawing : EMPTY_DRAWING, rng, level), 1)];
    case "onion": {
      // Even the "mistake" keeps the animation going — it just forgets to add to the background.
      const previous = prompt?.kind === "drawing" ? prompt.drawing : EMPTY_DRAWING;
      if (isBlankDrawing(previous)) return [scribble, drawing(drawTemplates([TEMPLATES[Math.floor(rng() * TEMPLATES.length)]], rng, level), 1)];
      const before = turn > 2 ? shownPageAt(state, album, turn - 2) : null;
      const frameOpts = { seed: state.seed, album, frame: turn, prev: previous, prev2: before?.kind === "drawing" ? before.drawing : null };
      return [drawing(nextAnimationFrame(previous, { ...frameOpts, addScenery: false }, rng, level), 0), drawing(nextAnimationFrame(previous, { ...frameOpts, addScenery: true }, rng, level), 1)];
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



