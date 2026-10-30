/**
 * The cosmetic skins a player can pick (🎨 내 스킨): one table skin (felt +
 * room colour of every 3D table) and one card-back skin. Both are shown to
 * everyone in the room — the table is the host's, each player's own hand of
 * cards wears that player's back (see `src/lib/skins/useSkins.ts`).
 *
 * Purely visual: a skin never changes what a card is, and shared piles
 * (decks, discards, the market) always keep the game's own back so nobody
 * can tell whose card is whose in a common pile.
 *
 * Patterns differ per skin (not just colours) so two backs stay tellable
 * apart without relying on colour vision.
 */

export type SkinPattern = "diag" | "diamond" | "dots" | "waves" | "grid" | "plain";

export interface CardBackSkin {
  id: string;
  name: string;
  emoji: string;
  /** [base, stripe] colours of the pattern. */
  colors: [string, string];
  /** Border + emblem colour. */
  accent: string;
  pattern: SkinPattern;
  /** Glyph in the middle of the back. */
  emblem: string;
}

export interface TableSkin {
  id: string;
  name: string;
  emoji: string;
  felt: string;
  /** Pattern drawn over the felt (subtle, `feltAccent` on `felt`). */
  pattern: SkinPattern;
  feltAccent: string;
  inlay: string;
  /** Room background + fog colour. */
  background: string;
}

export const DEFAULT_SKIN_ID = "default";

/** `default` = the game's own back. */
export const CARD_BACK_SKINS: readonly CardBackSkin[] = [
  { id: "crimson", name: "로열 크림슨", emoji: "🥀", colors: ["#5b0f1e", "#7a1a2c"], accent: "#f2c14e", pattern: "diamond", emblem: "♛" },
  { id: "midnight", name: "미드나잇 스타", emoji: "🌌", colors: ["#0b1330", "#16224d"], accent: "#a5b4fc", pattern: "dots", emblem: "✦" },
  { id: "sakura", name: "벚꽃", emoji: "🌸", colors: ["#f9a8c4", "#fbcfe0"], accent: "#9d174d", pattern: "waves", emblem: "✿" },
  { id: "gold", name: "황금 문양", emoji: "👑", colors: ["#1c1406", "#3b2a0b"], accent: "#fbbf24", pattern: "grid", emblem: "❖" },
  { id: "emerald", name: "에메랄드", emoji: "💚", colors: ["#053d2e", "#0a5c45"], accent: "#6ee7b7", pattern: "diag", emblem: "♣" },
  { id: "neon", name: "네온 시티", emoji: "🌃", colors: ["#1a0533", "#2e0a59"], accent: "#f0abfc", pattern: "grid", emblem: "⚡" },
  { id: "ocean", name: "딥 오션", emoji: "🌊", colors: ["#063a52", "#0b5675"], accent: "#7dd3fc", pattern: "waves", emblem: "⚓" },
  { id: "mono", name: "모노 체커", emoji: "♟️", colors: ["#111111", "#2a2a2a"], accent: "#f5f5f5", pattern: "diamond", emblem: "♠" },
];

/** `default` = the game's own table. */
export const TABLE_SKINS: readonly TableSkin[] = [
  { id: "casino", name: "카지노 그린", emoji: "🎰", felt: "#0f5132", pattern: "plain", feltAccent: "#14653f", inlay: "#d4af37", background: "#0b1a12" },
  { id: "velvet", name: "로열 벨벳", emoji: "🍷", felt: "#6b1022", pattern: "diamond", feltAccent: "#7d1730", inlay: "#e8c46a", background: "#1a0a0e" },
  { id: "midnight", name: "미드나잇", emoji: "🌙", felt: "#16245a", pattern: "dots", feltAccent: "#1e2f70", inlay: "#c7d2fe", background: "#070b1c" },
  { id: "sakura", name: "벚꽃 정원", emoji: "🌸", felt: "#c9708f", pattern: "waves", feltAccent: "#d7849f", inlay: "#fff1f5", background: "#2a1420" },
  { id: "ocean", name: "딥 오션", emoji: "🌊", felt: "#0b5675", pattern: "waves", feltAccent: "#0f6688", inlay: "#bae6fd", background: "#04141f" },
  { id: "palace", name: "황금 궁전", emoji: "👑", felt: "#2b1d08", pattern: "grid", feltAccent: "#3a280c", inlay: "#fbbf24", background: "#120c03" },
  { id: "neon", name: "네온 시티", emoji: "🌃", felt: "#2a0a4f", pattern: "grid", feltAccent: "#3a0f6b", inlay: "#f0abfc", background: "#0a0216" },
  { id: "slate", name: "모던 슬레이트", emoji: "🪨", felt: "#3f4650", pattern: "diag", feltAccent: "#48505b", inlay: "#e5e7eb", background: "#121417" },
];

export function cardBackSkin(id: string | null | undefined): CardBackSkin | null {
  return CARD_BACK_SKINS.find((s) => s.id === id) ?? null;
}

export function tableSkin(id: string | null | undefined): TableSkin | null {
  return TABLE_SKINS.find((s) => s.id === id) ?? null;
}

export interface SkinChoice {
  table: string;
  back: string;
}

export const DEFAULT_SKIN: SkinChoice = { table: DEFAULT_SKIN_ID, back: DEFAULT_SKIN_ID };

/** Untrusted input (localStorage, account metadata, another player's presence) → known ids only. */
export function sanitizeSkin(raw: unknown): SkinChoice {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    table: typeof r.table === "string" && tableSkin(r.table) ? r.table : DEFAULT_SKIN_ID,
    back: typeof r.back === "string" && cardBackSkin(r.back) ? r.back : DEFAULT_SKIN_ID,
  };
}

/** CSS `background` for a pattern — the 2D card backs and the picker swatches. */
export function patternCss(pattern: SkinPattern, [a, b]: [string, string]): string {
  switch (pattern) {
    case "diag":
      return `repeating-linear-gradient(135deg,${a} 0px,${a} 6px,${b} 6px,${b} 12px)`;
    case "diamond":
      return `repeating-linear-gradient(45deg,${b} 0 2px,transparent 2px 10px),repeating-linear-gradient(-45deg,${b} 0 2px,transparent 2px 10px),${a}`;
    case "dots":
      return `radial-gradient(circle,${b} 1.6px,transparent 2px) 0 0/9px 9px,${a}`;
    case "waves":
      return `radial-gradient(circle at 50% 100%,transparent 5px,${b} 5px,${b} 7px,transparent 7px) 0 0/14px 8px,${a}`;
    case "grid":
      return `linear-gradient(${b} 1.5px,transparent 1.5px) 0 0/10px 10px,linear-gradient(90deg,${b} 1.5px,transparent 1.5px) 0 0/10px 10px,${a}`;
    default:
      return a;
  }
}

/** Draws `pattern` over a `size`×`size` canvas area — the 3D card backs and felt textures. */
export function drawPattern(ctx: CanvasRenderingContext2D, pattern: SkinPattern, [a, b]: [string, string], w: number, h: number, step: number): void {
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = b;
  ctx.fillStyle = b;
  ctx.lineWidth = Math.max(1, step / 5);
  ctx.beginPath();
  if (pattern === "diag") {
    for (let x = -h; x < w; x += step) {
      ctx.moveTo(x, h);
      ctx.lineTo(x + h, 0);
    }
  } else if (pattern === "diamond") {
    for (let x = -h; x < w + h; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
      ctx.moveTo(x, h);
      ctx.lineTo(x + h, 0);
    }
  } else if (pattern === "grid") {
    for (let x = 0; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
  } else if (pattern === "waves") {
    for (let y = step / 2; y < h; y += step) {
      for (let x = 0; x < w; x += step) ctx.arc(x + step / 2, y, step / 2.4, Math.PI, 2 * Math.PI);
      ctx.moveTo(0, y + step);
    }
  } else if (pattern === "dots") {
    for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) {
      ctx.moveTo(x + step / 6, y);
      ctx.arc(x, y, step / 6, 0, 2 * Math.PI);
    }
    ctx.fill();
    return;
  }
  ctx.stroke();
}
