"use client";

/**
 * Hand-drawn SVG chess pieces (no external art). 45×45 viewBox. White pieces
 * are ivory with a dark outline, black pieces ebony with a light inner line,
 * so they differ by shape and by light/dark contrast — not by hue alone
 * (rulebook §1.2 accessibility note).
 *
 * Gradients come from `<ChessPieceDefs/>`, rendered once by the board.
 */

export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export function ChessPieceDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <defs>
        <linearGradient id="chess-ivory" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#f1ece2" />
          <stop offset="1" stopColor="#cfc6b6" />
        </linearGradient>
        <linearGradient id="chess-ebony" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b5f6b" />
          <stop offset="0.45" stopColor="#2a2d35" />
          <stop offset="1" stopColor="#0d0e12" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const BASE = "M10.5 38.5h24a1.5 1.5 0 0 0 1.5-1.5v-1.6a1.5 1.5 0 0 0-1.5-1.5h-24A1.5 1.5 0 0 0 9 35.4V37a1.5 1.5 0 0 0 1.5 1.5z";

function Shape({ type, line }: { type: PieceType; line: string }) {
  switch (type) {
    case "p":
      return (
        <path d="M22.5 7.5a5 5 0 0 1 3.4 8.7c2.3 1.2 3.6 3.3 3.6 5.8h-3.2c.4 3.6 2.4 6.6 5.6 9 1.4 1 2.1 2.4 2.1 4V38H11v-3c0-1.6.7-3 2.1-4 3.2-2.4 5.2-5.4 5.6-9h-3.2c0-2.5 1.3-4.6 3.6-5.8A5 5 0 0 1 22.5 7.5z" />
      );
    case "r":
      return (
        <>
          <path d={BASE} />
          <path d="M13 34l1.6-3.4h15.8L32 34z" />
          <path d="M15.6 30.6V17.4h13.8v13.2z" />
          <path d="M12.4 8.6h4.2v3h3.1v-3h5.6v3h3.1v-3h4.2v6.5l-2.6 2.3H15l-2.6-2.3z" />
          <path d="M15.6 17.4h13.8M14.6 30.6h15.8" fill="none" stroke={line} strokeWidth="1.1" />
        </>
      );
    case "b":
      return (
        <>
          <path d={BASE} />
          <path d="M14 34c2.5-1.6 5-2.2 8.5-2.2S28.5 32.4 31 34z" />
          <path d="M22.5 9.2c-5.4 4.6-8.2 9.8-7.2 14.4.7 3.2 3.3 4.9 3.3 4.9l-1.3 3.3h10.4l-1.3-3.3s2.6-1.7 3.3-4.9c1-4.6-1.8-9.8-7.2-14.4z" />
          <circle cx="22.5" cy="7.2" r="2.4" />
          <path d="M24.8 14.2l-4.2 6M19.6 22.5h5.8M22.5 19.6v5.8" fill="none" stroke={line} strokeWidth="1.2" strokeLinecap="round" />
          <path d="M17.6 28.5h9.8" fill="none" stroke={line} strokeWidth="1.1" />
        </>
      );
    case "n":
      return (
        <>
          <path d={BASE} />
          <path d="M24 9.6c6.4.6 10.8 5.6 10.3 14.6l-.5 9.4H15.4c-.2-4.6 3.3-6.8 5.8-9.4.9-1 1.1-2.1.6-3-2.2 1.9-4.4 1.6-5.9 3.9-.9 1.3-2.9 1.6-4.2.5-1.2-1-1.3-2.6-.5-4.1 1.4-2.6 3.4-4.6 5-7.1l1.5-3-1.1-3.1 3 1.8 2-3z" />
          <circle cx="18.6" cy="14.6" r="1.15" fill={line} stroke="none" />
          <path d="M25.6 12.4c3.6 2.2 5.6 6.4 5.4 12.6M13 22.6l1.2.4" fill="none" stroke={line} strokeWidth="1.1" strokeLinecap="round" />
        </>
      );
    case "q":
      return (
        <>
          <path d={BASE} />
          <path d="M11.8 30.5L9.2 13.6l5.6 8.2 1.1-11.2 4.2 9.8 2.4-11.6 2.4 11.6 4.2-9.8 1.1 11.2 5.6-8.2-2.6 16.9z" />
          <circle cx="9.2" cy="12.4" r="2" />
          <circle cx="15.9" cy="9.6" r="2" />
          <circle cx="22.5" cy="7.6" r="2.1" />
          <circle cx="29.1" cy="9.6" r="2" />
          <circle cx="35.8" cy="12.4" r="2" />
          <path d="M11.8 30.5c6.6-2.4 14.8-2.4 21.4 0l-.6 3.4c-6.4-2-13.8-2-20.2 0z" />
          <path d="M12.6 27c6.2-2 13.6-2 19.8 0" fill="none" stroke={line} strokeWidth="1.1" />
        </>
      );
    case "k":
      return (
        <>
          <path d={BASE} />
          <path d="M21.3 4h2.4v3h3v2.4h-3v3.4h-2.4V9.4h-3V7h3z" />
          <path d="M22.5 13.4c1.6 0 2.8 1.4 2.8 3.4 0 1.8-1.2 3.8-2.8 6.2-1.6-2.4-2.8-4.4-2.8-6.2 0-2 1.2-3.4 2.8-3.4z" />
          <path d="M12 30.6c-3.4-5-2.6-11.4 2.4-12.9 3.4-1 6.6 1 8.1 5.2 1.5-4.2 4.7-6.2 8.1-5.2 5 1.5 5.8 7.9 2.4 12.9z" />
          <path d="M12 30.6c6.6-2.4 14.4-2.4 21 0l-.6 3.3c-6.4-2-13.4-2-19.8 0z" />
          <path d="M13.2 27c6-2.2 12.6-2.2 18.6 0M22.5 23v6" fill="none" stroke={line} strokeWidth="1.1" />
        </>
      );
  }
}

export default function ChessPiece({ type, white, className, style }: { type: PieceType; white: boolean; className?: string; style?: React.CSSProperties }) {
  const fill = white ? "url(#chess-ivory)" : "url(#chess-ebony)";
  const stroke = white ? "#2b2620" : "#07080a";
  const line = white ? "#5c5246" : "#c9ced8";
  return (
    <svg viewBox="0 0 45 45" className={className} style={style} aria-hidden>
      <g fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
        <Shape type={type} line={line} />
      </g>
    </svg>
  );
}

/** Piece char ("P", "n", …) → props. */
export function pieceProps(ch: string): { type: PieceType; white: boolean } {
  return { type: ch.toLowerCase() as PieceType, white: ch === ch.toUpperCase() };
}

export const PIECE_NAME_KO: Record<PieceType, string> = { p: "폰", n: "나이트", b: "비숍", r: "룩", q: "퀸", k: "킹" };
