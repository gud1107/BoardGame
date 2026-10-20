"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import dynamic from "next/dynamic";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import ChessPiece, { ChessPieceDefs, PIECE_NAME_KO, pieceProps, type PieceType } from "./ChessPieces";
import {
  canOffer,
  checkersOf,
  kingSquare,
  legalMoveInfos,
  materialSummary,
  otherSeat,
  positionsAfterEach,
  PIECE_VALUE,
  RESULT_LABEL,
  resultScore,
  sqName,
  timeControlById,
  toPgn,
  type ChessState,
  type Color,
  type CorePosition,
  type EngineAction,
  type LegalMoveInfo,
  type MoveRecord,
  type Seat,
} from "./engine";
import { chessCues, getChessSound } from "./chessSound";
import { webglAvailable } from "./three/webgl";

// three.js는 무거워서 3D 판이 처음 필요할 때만 받는다
const Chess3D = dynamic(() => import("./three/Chess3D"), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center text-xs text-amber-200/60">♟️ 3D 체스판 준비 중…</div>,
});

type View = "3d" | "2d";
const VIEW_KEY = "chess-view";

/** 3D by default (§16); 2D when WebGL is missing or the viewer picked it. */
function initialView(): View {
  if (!webglAvailable()) return "2d";
  try {
    return window.localStorage.getItem(VIEW_KEY) === "2d" ? "2d" : "3d";
  } catch {
    return "3d";
  }
}

function initialQuality(): "high" | "low" {
  if (typeof window === "undefined") return "low";
  return window.innerWidth >= 768 && (navigator.hardwareConcurrency ?? 4) >= 4 ? "high" : "low";
}

/**
 * 체스 board (rulebook §16, §17) — controlled component: state in, actions
 * out. Pieces are absolutely positioned on an 8×8 grid; the newest move's
 * pieces remount with CSS keyframes (slide / knight hop / castle pair) and
 * one-shot FX layers (trail, dust ring, capture shatter, en passant vortex,
 * promotion pillar, check line, mate shockwave + confetti) keyed by ply, so
 * every client — including the one that just moved — sees the same show.
 */

interface Props {
  state: ChessState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  opponentConnected: boolean;
  opponentIsBot: boolean;
  /** Local time this client saw the current turn begin (clock display). */
  turnStartedAt: number;
  onAction: (action: EngineAction) => void;
  onLeave: () => void;
  onRematch: () => void;
  onOpenRulebook: () => void;
}

const SLIDE_S = 0.26;
const HOP_S = 0.42;

type ThemeId = "wood" | "green" | "ice";
const THEMES: Record<ThemeId, { label: string; light: string; dark: string; frame: string }> = {
  wood: { label: "나무", light: "#efd9b4", dark: "#b27c4e", frame: "linear-gradient(135deg,#5a3a1f,#2d1b0e)" },
  green: { label: "토너먼트", light: "#eeeed2", dark: "#769656", frame: "linear-gradient(135deg,#3b4a2a,#1d2615)" },
  ice: { label: "얼음", light: "#dee6ef", dark: "#7c95b3", frame: "linear-gradient(135deg,#2c3e57,#141c29)" },
};

const CSS = `
@keyframes cz-slide{from{transform:translate(calc(var(--dx)*100%),calc(var(--dy)*100%))}to{transform:translate(0,0)}}
@keyframes cz-hop{0%{transform:translate(calc(var(--dx)*100%),calc(var(--dy)*100%)) scale(1)}50%{transform:translate(calc(var(--dx)*50%),calc(var(--dy)*50% - 42%)) scale(1.32);filter:drop-shadow(0 18px 9px rgba(0,0,0,.45))}100%{transform:translate(0,0) scale(1)}}
@keyframes cz-trail{from{transform:translate(calc(var(--dx)*100%),calc(var(--dy)*100%));opacity:var(--o)}to{transform:translate(0,0);opacity:0}}
@keyframes cz-ring{0%{opacity:0;transform:scale(.35)}12%{opacity:.85}100%{opacity:0;transform:scale(1.75)}}
@keyframes cz-flash{0%{opacity:0;transform:scale(.2)}15%{opacity:1}100%{opacity:0;transform:scale(2.6)}}
@keyframes cz-captured{0%{opacity:1;transform:scale(1)}30%{opacity:1;transform:scale(1.12);filter:brightness(1.8)}100%{opacity:0;transform:scale(.3) rotate(28deg)}}
@keyframes cz-shard{0%{opacity:1;transform:translate(0,0) rotate(0) scale(1)}100%{opacity:0;transform:translate(var(--sx),var(--sy)) rotate(var(--sr)) scale(.35)}}
@keyframes cz-shake-a{0%,100%{transform:translate(0,0)}20%{transform:translate(calc(var(--amp)*-1px),calc(var(--amp)*.6px))}40%{transform:translate(calc(var(--amp)*1px),calc(var(--amp)*-.8px))}60%{transform:translate(calc(var(--amp)*-.7px),calc(var(--amp)*.4px))}80%{transform:translate(calc(var(--amp)*.4px),0)}}
@keyframes cz-shake-b{0%,100%{transform:translate(0,0)}20%{transform:translate(calc(var(--amp)*-1px),calc(var(--amp)*.6px))}40%{transform:translate(calc(var(--amp)*1px),calc(var(--amp)*-.8px))}60%{transform:translate(calc(var(--amp)*-.7px),calc(var(--amp)*.4px))}80%{transform:translate(calc(var(--amp)*.4px),0)}}
@keyframes cz-pulse{0%,100%{opacity:.55;transform:scale(.9)}50%{opacity:1;transform:scale(1.04)}}
@keyframes cz-line{0%{stroke-dashoffset:var(--len);opacity:1}55%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
@keyframes cz-label{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}14%{opacity:1;transform:translate(-50%,-50%) scale(1.14)}24%{transform:translate(-50%,-50%) scale(1)}78%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-75%) scale(1)}}
@keyframes cz-vortex{0%{opacity:0;transform:scale(1.5) rotate(0)}20%{opacity:1}100%{opacity:0;transform:scale(.1) rotate(600deg)}}
@keyframes cz-suck{0%{opacity:1;transform:scale(1) rotate(0)}25%{opacity:1;transform:scale(1.05) rotate(-40deg)}100%{opacity:0;transform:scale(0) rotate(-560deg)}}
@keyframes cz-pillar{0%{opacity:0;transform:scaleX(.15)}20%{opacity:1;transform:scaleX(1)}100%{opacity:0;transform:scaleX(1.8)}}
@keyframes cz-morph{0%{filter:brightness(3.2) drop-shadow(0 0 14px #fde68a);transform:scale(1.4)}100%{filter:none;transform:scale(1)}}
@keyframes cz-spark{0%{opacity:0;transform:translate(0,0) scale(.4)}15%{opacity:1}100%{opacity:0;transform:translate(var(--sx),var(--sy)) scale(1)}}
@keyframes cz-topple{to{transform:rotate(var(--tip)) translate(-4%,14%);filter:grayscale(.7) brightness(.75)}}
@keyframes cz-shock{0%{opacity:.95;transform:translate(-50%,-50%) scale(.2)}100%{opacity:0;transform:translate(-50%,-50%) scale(10)}}
@keyframes cz-fall{0%{top:-6%;opacity:0;transform:translateX(0) rotate(0)}8%{opacity:1}100%{top:106%;opacity:.9;transform:translateX(var(--sx)) rotate(var(--sr))}}
@keyframes cz-arc{0%{stroke-dashoffset:var(--len);opacity:1}65%{stroke-dashoffset:0;opacity:1}100%{opacity:0;stroke-dashoffset:0}}
@keyframes cz-nope{0%,100%{transform:translateX(0)}20%{transform:translateX(-10%)}40%{transform:translateX(9%)}60%{transform:translateX(-6%)}80%{transform:translateX(4%)}}
@keyframes cz-pop{0%{transform:scale(0);opacity:0}60%{transform:scale(1.45);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes cz-clock{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}50%{box-shadow:0 0 0 4px rgba(239,68,68,.5)}}
@keyframes cz-dots{0%,20%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
@keyframes cz-fade{from{opacity:0}to{opacity:1}}
@keyframes cz-rise{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.cz-fx{display:none!important}.cz-move{animation:cz-fade .2s both!important}.cz-shake{animation:none!important}}
`;

/** Deterministic 0..1 noise for FX particles. */
const noise = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function formatClock(ms: number): string {
  if (ms < 10_000) return (Math.max(0, ms) / 1000).toFixed(1);
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] light:border-slate-200 light:bg-white";
const BTN =
  "rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition hover:border-white/25 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35 light:border-slate-200 light:bg-slate-50 light:text-slate-700 light:hover:bg-slate-100";

export default function ChessBoard({ state, viewerSeat, names, opponentConnected, opponentIsBot, turnStartedAt, onAction, onLeave, onRematch, onOpenRulebook }: Props) {
  const myColor = state.colors[viewerSeat];
  const oppSeat = otherSeat(viewerSeat);
  const oppColor = state.colors[oppSeat];

  /* ── View options ── */
  const [userFlip, setUserFlip] = useState(false);
  const flipped = (myColor === "b") !== userFlip;
  const [theme, setTheme] = useState<ThemeId>(() => {
    try {
      const v = typeof window !== "undefined" ? window.localStorage.getItem("chess-theme") : null;
      return v === "green" || v === "ice" || v === "wood" ? v : "wood";
    } catch {
      return "wood";
    }
  });
  function cycleTheme() {
    const order: ThemeId[] = ["wood", "green", "ice"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
    try {
      window.localStorage.setItem("chess-theme", next);
    } catch {
      /* private mode */
    }
  }
  const colors = THEMES[theme];
  const [canWebgl] = useState(webglAvailable);
  const [view, setView] = useState<View>(initialView);
  const [quality] = useState(initialQuality);
  function toggleView() {
    const next: View = view === "3d" ? "2d" : "3d";
    setView(next);
    setDrag(null);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* private mode */
    }
  }

  /* ── History browsing (§14) ── */
  const [viewPly, setViewPly] = useState<number | null>(null);
  const positions = useMemo(() => positionsAfterEach(state), [state]);
  const shownPly = viewPly === null ? state.moves.length : Math.min(viewPly, state.moves.length);
  const browsing = viewPly !== null && viewPly < state.moves.length;
  const shownPos: CorePosition = browsing ? positions[shownPly] ?? state.pos : state.pos;
  const shownLast: MoveRecord | null = shownPly > 0 ? state.moves[shownPly - 1] : null;

  /* ── Newest-move animation bookkeeping (compare-during-render) ── */
  const [seenPly, setSeenPly] = useState(state.moves.length);
  const [animPly, setAnimPly] = useState<number | null>(null);
  if (state.moves.length !== seenPly) {
    setAnimPly(state.moves.length > seenPly ? state.moves.length : null);
    setSeenPly(state.moves.length);
    if (viewPly !== null) setViewPly(null);
  }
  const anim: MoveRecord | null = !browsing && animPly !== null && animPly === state.moves.length ? state.moves[animPly - 1] : null;

  /* ── Selection / drag ── */
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; x: number; y: number; active: boolean; sx: number; sy: number; hover: number | null } | null>(null);
  const [nope, setNope] = useState<{ sq: number; n: number } | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const playing = state.phase === "playing";
  const myTurn = playing && state.pos.turn === myColor && !browsing;
  const legalNow = useMemo(() => legalMoveInfos(state.pos), [state.pos]);
  // Off-turn preview (§16.2): my moves as if it were my turn.
  const previewMoves = useMemo(() => (state.pos.turn === myColor ? legalNow : legalMoveInfos({ ...state.pos, turn: myColor, ep: -1 })), [state.pos, myColor, legalNow]);
  const selectedMoves: LegalMoveInfo[] = selected === null || browsing ? [] : previewMoves.filter((m) => m.from === selected);

  const isMine = (ch: string) => ch !== "." && (ch === ch.toUpperCase() ? "w" : "b") === myColor;

  const dispOf = (sq: number) => {
    const f = sq & 7;
    const r = sq >> 3;
    return { col: flipped ? 7 - f : f, row: flipped ? r : 7 - r };
  };
  const sqAt = (col: number, row: number) => (flipped ? (row * 8 + (7 - col)) : ((7 - row) * 8 + col));
  const cellStyle = (sq: number): CSSProperties => {
    const { col, row } = dispOf(sq);
    return { left: `${col * 12.5}%`, top: `${row * 12.5}%`, width: "12.5%", height: "12.5%" };
  };

  function bump(sq: number) {
    setNope((n) => ({ sq, n: (n?.n ?? 0) + 1 }));
    getChessSound().play("nope");
  }

  function tryMove(from: number, to: number) {
    if (!myTurn) {
      bump(from);
      return;
    }
    let cands = legalNow.filter((m) => m.from === from && m.to === to);
    // §6 [앱 규칙]: king dropped on its own rook = castle.
    const fromCh = state.pos.board[from];
    const toCh = state.pos.board[to];
    if (cands.length === 0 && fromCh.toLowerCase() === "k" && toCh !== "." && toCh.toLowerCase() === "r" && isMine(toCh)) {
      cands = legalNow.filter((m) => m.from === from && (to > from ? m.kind === "castleK" : m.kind === "castleQ"));
    }
    if (cands.length === 0) {
      bump(from);
      return;
    }
    if (cands.some((m) => m.promo)) {
      setPromo({ from, to: cands[0].to });
      setSelected(null);
      return;
    }
    setSelected(null);
    onAction({ type: "move", seat: viewerSeat, uci: cands[0].uci });
  }

  function clickSquare(sq: number) {
    if (browsing) {
      setViewPly(null);
      return;
    }
    if (promo) return;
    const ch = state.pos.board[sq];
    if (selected !== null && selected !== sq) {
      const target = selectedMoves.some((m) => m.to === sq) || (state.pos.board[selected].toLowerCase() === "k" && ch.toLowerCase() === "r" && isMine(ch));
      if (target) {
        tryMove(selected, sq);
        return;
      }
    }
    if (isMine(ch)) {
      if (selected === sq) setSelected(null);
      else {
        setSelected(sq);
        getChessSound().play("select");
      }
      return;
    }
    if (selected !== null) bump(selected);
    setSelected(null);
  }

  function pointToSq(clientX: number, clientY: number): number | null {
    const el = boardRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const col = Math.floor(((clientX - r.left) / r.width) * 8);
    const row = Math.floor(((clientY - r.top) / r.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return sqAt(col, row);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    getChessSound().unlock();
    if (e.button !== 0 || promo) return;
    const sq = pointToSq(e.clientX, e.clientY);
    if (sq === null) return;
    const r = boardRef.current!.getBoundingClientRect();
    if (!browsing && isMine(state.pos.board[sq])) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ from: sq, x: e.clientX - r.left, y: e.clientY - r.top, sx: e.clientX, sy: e.clientY, active: false, hover: sq });
    } else {
      setDrag({ from: -1, x: 0, y: 0, sx: e.clientX, sy: e.clientY, active: false, hover: null });
    }
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag || drag.from < 0) return;
    const r = boardRef.current!.getBoundingClientRect();
    const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6;
    if (moved || drag.active) {
      if (!drag.active && selected !== drag.from) setSelected(drag.from);
      setDrag({ ...drag, x: e.clientX - r.left, y: e.clientY - r.top, active: true, hover: pointToSq(e.clientX, e.clientY) });
    }
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag;
    setDrag(null);
    if (!d) return;
    const sq = pointToSq(e.clientX, e.clientY);
    if (d.active) {
      if (sq === null) bump(d.from);
      else if (sq !== d.from) tryMove(d.from, sq);
      return;
    }
    if (sq !== null) clickSquare(sq);
  }

  /* ── Clock (§12) ── */
  const [now, setNow] = useState(turnStartedAt);
  const running = state.clock !== null && playing && state.moves.length >= 2;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running]);
  const clockOf = (c: Color) => {
    if (!state.clock) return null;
    if (running && c === state.pos.turn) return Math.max(0, state.remainingMs[c] - Math.max(0, now - turnStartedAt));
    return state.remainingMs[c];
  };
  const myClock = clockOf(myColor);
  const lowTime = myClock !== null && running && state.pos.turn === myColor && myClock < 10_000;
  const tickSecRef = useRef(-1);
  useEffect(() => {
    if (!lowTime || myClock === null) return;
    const sec = Math.ceil(myClock / 1000);
    if (sec !== tickSecRef.current) {
      tickSecRef.current = sec;
      getChessSound().play("tick");
    }
  }, [lowTime, myClock]);

  /* ── Sound ── */
  const cues = useMemo(() => chessCues(myColor), [myColor]);
  useSoundCues(state, getChessSound, cues);
  const pieceCount = state.pos.board.replace(/[.pP]/g, "").length;
  useSuiteBgm(getChessSound, playing, pieceCount <= 8 || (myClock !== null && running && myClock < 30_000) ? 1 : 0);

  /* ── Derived display ── */
  const material = useMemo(() => materialSummary(state), [state]);
  const checkers = useMemo(() => checkersOf(shownPos), [shownPos]);
  const checkedKing = checkers.length > 0 ? kingSquare(shownPos, shownPos.turn) : -1;
  const mated = state.result?.reason === "checkmate" && !browsing ? kingSquare(state.pos, state.pos.turn) : -1;
  const isDraw = state.phase === "gameOver" && state.result?.winner === null && !browsing;

  const [resultOpen, setResultOpen] = useState(true);
  const [seenPhase, setSeenPhase] = useState(state.phase);
  if (seenPhase !== state.phase) {
    setSeenPhase(state.phase);
    if (state.phase === "gameOver") setResultOpen(true);
  }

  const [resignArmed, setResignArmed] = useState(false);
  useEffect(() => {
    if (!resignArmed) return;
    const id = window.setTimeout(() => setResignArmed(false), 3000);
    return () => window.clearTimeout(id);
  }, [resignArmed]);

  const [copied, setCopied] = useState(false);
  function copyPgn() {
    void navigator.clipboard?.writeText(toPgn(state, names)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  /* ── Animation descriptors for the newest move ── */
  const animInfo = useMemo(() => {
    if (!anim) return null;
    const from = dispOf(anim.from);
    const to = dispOf(anim.to);
    const knight = anim.piece.toLowerCase() === "n";
    const castle = anim.kind === "castleK" || anim.kind === "castleQ";
    let rook: { from: number; to: number } | null = null;
    if (castle) rook = anim.kind === "castleK" ? { from: anim.to + 1, to: anim.to - 1 } : { from: anim.to - 2, to: anim.to + 1 };
    const dur = knight ? HOP_S : SLIDE_S;
    return { from, to, dx: from.col - to.col, dy: from.row - to.row, knight, castle, rook, dur, impact: dur * 0.82 };
    // dispOf depends only on `flipped`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim, flipped]);

  const label: { text: string; tone: string } | null = useMemo(() => {
    if (!anim) return null;
    if (anim.mate) return { text: "체크메이트!", tone: "from-amber-300 to-rose-400 text-black" };
    if (anim.promo) return { text: `승진! ${anim.promo.toLowerCase() === "q" ? "♛" : PIECE_NAME_KO[anim.promo.toLowerCase() as PieceType]}`, tone: "from-yellow-200 to-amber-400 text-black" };
    if (anim.kind === "ep") return { text: "앙파상!", tone: "from-violet-300 to-fuchsia-400 text-black" };
    if (anim.kind === "castleK" || anim.kind === "castleQ") return { text: anim.kind === "castleK" ? "캐슬링! O-O" : "캐슬링! O-O-O", tone: "from-amber-200 to-yellow-500 text-black" };
    if (anim.check) return { text: "체크!", tone: "from-rose-400 to-red-600 text-white" };
    if (anim.captured && /[qQ]/.test(anim.captured)) return { text: "퀸 획득!", tone: "from-orange-300 to-red-500 text-black" };
    if (anim.captured && /[rR]/.test(anim.captured)) return { text: "룩 획득!", tone: "from-orange-200 to-orange-500 text-black" };
    return null;
  }, [anim]);

  const shakeAmp = anim?.captured ? (/[qr]/i.test(anim.captured) ? 7 : 3.5) : anim?.mate ? 9 : 0;

  /* ── Pieces ── */
  const pieces: ReactNode[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const ch = shownPos.board[sq];
    if (ch === ".") continue;
    const { type, white } = pieceProps(ch);
    const moving = animInfo && sq === anim!.to;
    const rookMoving = animInfo?.rook && sq === animInfo.rook.to;
    let innerStyle: CSSProperties = {};
    let innerClass = "h-full w-full";
    if (moving) {
      innerStyle = {
        ["--dx" as string]: animInfo.dx,
        ["--dy" as string]: animInfo.dy,
        animation: `${animInfo.knight ? "cz-hop" : "cz-slide"} ${animInfo.dur}s cubic-bezier(.2,.75,.25,1) both${anim!.promo ? `, cz-morph .5s ease-out ${animInfo.dur}s both` : ""}`,
      };
      innerClass += " cz-move";
    } else if (rookMoving) {
      const rf = dispOf(animInfo.rook!.from);
      const rt = dispOf(animInfo.rook!.to);
      innerStyle = { ["--dx" as string]: rf.col - rt.col, ["--dy" as string]: rf.row - rt.row, animation: `cz-slide ${SLIDE_S + 0.08}s cubic-bezier(.2,.75,.25,1) .06s both` };
      innerClass += " cz-move";
    } else if (nope && nope.sq === sq) {
      innerStyle = { animation: "cz-nope .32s ease-out" };
    }
    if (sq === mated) innerStyle = { ...innerStyle, ["--tip" as string]: white ? "-78deg" : "78deg", animation: `cz-topple .7s cubic-bezier(.5,0,.75,0) .35s forwards`, transformOrigin: "50% 92%" };
    const isDragged = drag?.active && drag.from === sq;
    const lifted = selected === sq && !drag?.active;
    pieces.push(
      <div
        key={`${sq}:${ch}:${moving || rookMoving ? `m${animPly}` : nope?.sq === sq ? `n${nope.n}` : ""}`}
        className="pointer-events-none absolute"
        style={{ ...cellStyle(sq), zIndex: moving ? 6 : 4, opacity: isDragged ? 0.28 : 1 }}
      >
        <div className={innerClass} style={innerStyle}>
          <div className="h-full w-full transition-transform duration-150" style={lifted ? { transform: "translateY(-6%) scale(1.08)", filter: "drop-shadow(0 6px 5px rgba(0,0,0,.4))" } : { filter: "drop-shadow(0 2px 1.5px rgba(0,0,0,.35))" }}>
            <ChessPiece type={type} white={white} className="h-full w-full" />
          </div>
        </div>
      </div>,
    );
  }

  /* ── FX layers for the newest move ── */
  const fx: ReactNode[] = [];
  if (anim && animInfo) {
    const k = `fx${animPly}`;
    const toCell = cellStyle(anim.to);
    // Motion trail (slides only).
    if (!animInfo.knight) {
      const { type, white } = pieceProps(anim.promo ?? anim.piece);
      [0.05, 0.1, 0.15].forEach((delay, i) =>
        fx.push(
          <div key={`${k}-trail${i}`} className="cz-fx pointer-events-none absolute" style={{ ...toCell, zIndex: 5 }}>
            <div className="h-full w-full" style={{ ["--dx" as string]: animInfo.dx, ["--dy" as string]: animInfo.dy, ["--o" as string]: 0.32 - i * 0.09, animation: `cz-trail ${SLIDE_S}s cubic-bezier(.2,.75,.25,1) ${delay}s both`, filter: "blur(1.5px)" }}>
              <ChessPiece type={type} white={white} className="h-full w-full" />
            </div>
          </div>,
        ),
      );
    }
    // Landing dust ring (+ knight shockwave).
    fx.push(
      <div key={`${k}-ring`} className="cz-fx pointer-events-none absolute flex items-center justify-center" style={{ ...toCell, zIndex: 3 }}>
        <div className="h-[80%] w-[80%] rounded-full border-2 border-white/70" style={{ animation: `cz-ring .55s ease-out ${animInfo.impact}s both` }} />
        {animInfo.knight && <div className="absolute h-[70%] w-[70%] rounded-full border-[3px] border-amber-200/80" style={{ animation: `cz-ring .7s ease-out ${animInfo.impact + 0.04}s both` }} />}
      </div>,
    );
    // Capture: flash + the captured piece breaking apart.
    if (anim.captured && anim.capSq !== null) {
      const capCell = cellStyle(anim.capSq);
      const cp = pieceProps(anim.captured);
      const ep = anim.kind === "ep";
      fx.push(
        <div key={`${k}-cap`} className="pointer-events-none absolute" style={{ ...capCell, zIndex: ep ? 5 : 7 }}>
          <div className="h-full w-full" style={{ animation: ep ? `cz-suck .7s ease-in ${animInfo.impact * 0.6}s both` : `cz-captured .42s ease-in ${animInfo.impact}s both` }}>
            <ChessPiece type={cp.type} white={cp.white} className="h-full w-full" />
          </div>
        </div>,
      );
      if (ep) {
        fx.push(
          <div key={`${k}-vortex`} className="cz-fx pointer-events-none absolute flex items-center justify-center" style={{ ...capCell, zIndex: 4 }}>
            <div className="h-[95%] w-[95%] rounded-full" style={{ background: "conic-gradient(from 0deg, transparent, rgba(196,181,253,.9), transparent 40%, rgba(232,121,249,.85), transparent 75%, rgba(196,181,253,.9))", maskImage: "radial-gradient(circle, transparent 18%, #000 22%, #000 62%, transparent 70%)", WebkitMaskImage: "radial-gradient(circle, transparent 18%, #000 22%, #000 62%, transparent 70%)", animation: `cz-vortex .85s ease-in ${animInfo.impact * 0.4}s both` }} />
          </div>,
        );
      } else {
        const big = /[qr]/i.test(anim.captured);
        fx.push(
          <div key={`${k}-flash`} className="cz-fx pointer-events-none absolute flex items-center justify-center" style={{ ...toCell, zIndex: 8 }}>
            <div className="h-full w-full rounded-full" style={{ background: big ? "radial-gradient(circle, rgba(255,255,255,.95), rgba(251,146,60,.7) 35%, transparent 70%)" : "radial-gradient(circle, rgba(255,255,255,.9), rgba(253,224,71,.55) 35%, transparent 70%)", animation: `cz-flash ${big ? 0.6 : 0.45}s ease-out ${animInfo.impact}s both` }} />
            {Array.from({ length: big ? 14 : 10 }, (_, i) => {
              const ang = (i / (big ? 14 : 10)) * Math.PI * 2 + noise(i, animPly ?? 0) * 0.6;
              const dist = 70 + noise(i, 3) * (big ? 120 : 70);
              const size = 10 + noise(i, 5) * 12;
              return (
                <span
                  key={i}
                  className="absolute left-1/2 top-1/2"
                  style={{
                    width: `${size}%`,
                    height: `${size * 0.8}%`,
                    marginLeft: `-${size / 2}%`,
                    marginTop: `-${size / 2}%`,
                    background: cp.white ? "linear-gradient(135deg,#fff,#cfc6b6)" : "linear-gradient(135deg,#5b5f6b,#0d0e12)",
                    border: cp.white ? "1px solid #2b2620" : "1px solid #c9ced8",
                    clipPath: i % 2 ? "polygon(50% 0,100% 100%,0 80%)" : "polygon(0 0,100% 30%,40% 100%)",
                    ["--sx" as string]: `${Math.cos(ang) * dist}%`,
                    ["--sy" as string]: `${Math.sin(ang) * dist + 25}%`,
                    ["--sr" as string]: `${(noise(i, 9) - 0.5) * 720}deg`,
                    animation: `cz-shard ${0.55 + noise(i, 7) * 0.3}s cubic-bezier(.15,.6,.4,1) ${animInfo.impact}s both`,
                  }}
                />
              );
            })}
          </div>,
        );
      }
    }
    // Castling: golden arcs for king and rook.
    if (animInfo.castle && animInfo.rook) {
      const kf = animInfo.from;
      const kt = animInfo.to;
      const rf = dispOf(animInfo.rook.from);
      const rt = dispOf(animInfo.rook.to);
      const arc = (a: { col: number; row: number }, b: { col: number; row: number }, lift: number) =>
        `M${a.col + 0.5} ${a.row + 0.5} Q${(a.col + b.col) / 2 + 0.5} ${a.row + 0.5 + lift} ${b.col + 0.5} ${b.row + 0.5}`;
      fx.push(
        <svg key={`${k}-castle`} viewBox="0 0 8 8" className="cz-fx pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 9 }}>
          <path d={arc(kf, kt, -1.1)} fill="none" stroke="#fcd34d" strokeWidth="0.09" strokeLinecap="round" strokeDasharray="4" style={{ ["--len" as string]: 4, animation: "cz-arc .9s ease-out both", filter: "drop-shadow(0 0 .08px #fde68a)" }} />
          <path d={arc(rf, rt, 1.1)} fill="none" stroke="#fbbf24" strokeWidth="0.07" strokeLinecap="round" strokeDasharray="4" style={{ ["--len" as string]: 4, animation: "cz-arc .9s ease-out .06s both" }} />
        </svg>,
      );
    }
    // Promotion: a light pillar down the file + sparkles.
    if (anim.promo) {
      const { col } = dispOf(anim.to);
      fx.push(
        <div key={`${k}-pillar`} className="cz-fx pointer-events-none absolute top-0 h-full" style={{ left: `${col * 12.5}%`, width: "12.5%", zIndex: 2, background: "linear-gradient(to bottom, rgba(254,240,138,.0), rgba(254,240,138,.75) 30%, rgba(255,255,255,.9) 50%, rgba(254,240,138,.75) 70%, rgba(254,240,138,0))", animation: `cz-pillar 1s ease-out ${animInfo.dur}s both` }} />,
      );
      fx.push(
        <div key={`${k}-spark`} className="cz-fx pointer-events-none absolute" style={{ ...toCell, zIndex: 9 }}>
          {Array.from({ length: 12 }, (_, i) => {
            const ang = (i / 12) * Math.PI * 2;
            return (
              <span
                key={i}
                className="absolute left-1/2 top-1/2 h-[12%] w-[12%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-200"
                style={{ boxShadow: "0 0 6px 2px rgba(253,224,71,.8)", ["--sx" as string]: `${Math.cos(ang) * 420}%`, ["--sy" as string]: `${Math.sin(ang) * 420}%`, animation: `cz-spark .8s ease-out ${animInfo.dur + 0.05 + (i % 3) * 0.04}s both` }}
              />
            );
          })}
        </div>,
      );
    }
    // Check line(s): attacker → king.
    if (anim.check && anim.checkers.length > 0) {
      const ks = kingSquare(state.pos, state.pos.turn);
      const kd = dispOf(ks);
      fx.push(
        <svg key={`${k}-checkline`} viewBox="0 0 8 8" className="cz-fx pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 9 }}>
          {anim.checkers.map((c) => {
            const cd = dispOf(c);
            const len = Math.hypot(cd.col - kd.col, cd.row - kd.row) + 0.1;
            return (
              <line key={c} x1={cd.col + 0.5} y1={cd.row + 0.5} x2={kd.col + 0.5} y2={kd.row + 0.5} stroke="#f43f5e" strokeWidth="0.1" strokeLinecap="round" strokeDasharray={len} style={{ ["--len" as string]: len, animation: `cz-line 1.5s ease-out ${animInfo.dur}s both`, filter: "drop-shadow(0 0 .1px #fb7185)" }} />
            );
          })}
        </svg>,
      );
    }
    // Checkmate: shockwave + confetti in the winner's colours.
    if (anim.mate) {
      const ks = dispOf(kingSquare(state.pos, state.pos.turn));
      fx.push(
        <div key={`${k}-shock`} className="cz-fx pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 10 }}>
          {[0, 0.18, 0.36].map((d) => (
            <div key={d} className="absolute rounded-full border-4 border-amber-300/80" style={{ left: `${(ks.col + 0.5) * 12.5}%`, top: `${(ks.row + 0.5) * 12.5}%`, width: "14%", height: "14%", animation: `cz-shock 1.3s ease-out ${animInfo.dur + d}s both` }} />
          ))}
          {Array.from({ length: 40 }, (_, i) => {
            const winnerWhite = anim.color === "w";
            const palette = winnerWhite ? ["#ffffff", "#fde68a", "#fbbf24", "#e5e7eb"] : ["#111827", "#a78bfa", "#fbbf24", "#6b7280"];
            return (
              <span
                key={i}
                className="absolute h-[2.4%] w-[1.4%] rounded-[1px]"
                style={{ left: `${noise(i, 1) * 100}%`, background: palette[i % palette.length], ["--sx" as string]: `${(noise(i, 2) - 0.5) * 160}px`, ["--sr" as string]: `${(noise(i, 4) - 0.5) * 1080}deg`, animation: `cz-fall ${1.8 + noise(i, 6) * 1.4}s ease-in ${animInfo.dur + 0.2 + noise(i, 8) * 0.6}s both` }}
              />
            );
          })}
        </div>,
      );
    }
  }

  /* ── Squares ── */
  const hintTargets = new Map(selectedMoves.map((m) => [m.to, m] as const));
  const hoverSq = drag?.active ? drag.hover : null;
  const squares: ReactNode[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = sqAt(col, row);
      const light = ((sq & 7) + (sq >> 3)) % 2 === 1;
      const isLast = shownLast && (sq === shownLast.from || sq === shownLast.to);
      const isSel = selected === sq && !browsing;
      const hint = hintTargets.get(sq);
      const coordColor = light ? colors.dark : colors.light;
      squares.push(
        <div key={sq} className="relative" style={{ background: light ? colors.light : colors.dark }}>
          {isLast && <div className="absolute inset-0" style={{ background: "rgba(250,204,21,.42)" }} />}
          {isSel && <div className="absolute inset-0" style={{ background: "rgba(250,204,21,.6)", boxShadow: "inset 0 0 0 3px rgba(161,98,7,.7)" }} />}
          {hoverSq === sq && <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 0 4px rgba(255,255,255,.75)" }} />}
          {hint && !hint.capture && <div className="absolute left-1/2 top-1/2 h-[28%] w-[28%] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: myTurn ? "rgba(20,20,20,.26)" : "rgba(20,20,20,.13)" }} />}
          {hint && hint.capture && <div className="absolute inset-0 rounded-full" style={{ background: `radial-gradient(circle, transparent 0 62%, ${myTurn ? "rgba(20,20,20,.28)" : "rgba(20,20,20,.14)"} 64%)` }} />}
          {col === 0 && <span className="absolute left-[4%] top-[2%] text-[clamp(7px,1.6vw,12px)] font-bold" style={{ color: coordColor }}>{(sq >> 3) + 1}</span>}
          {row === 7 && <span className="absolute bottom-[1%] right-[5%] text-[clamp(7px,1.6vw,12px)] font-bold" style={{ color: coordColor }}>{"abcdefgh"[sq & 7]}</span>}
        </div>,
      );
    }
  }

  /* ── Player bars ── */
  const playerBar = (seat: Seat, color: Color) => {
    const active = playing && state.pos.turn === color;
    const caps = [...material.capturedBy[color]].sort((a, b) => (PIECE_VALUE[b.toLowerCase()] ?? 0) - (PIECE_VALUE[a.toLowerCase()] ?? 0));
    const lead = color === "w" ? material.whiteLead : -material.whiteLead;
    const clock = clockOf(color);
    const low = clock !== null && running && active && clock < 10_000;
    const newestCap = anim?.captured && anim.color === color ? caps.indexOf(anim.captured) : -1;
    const isOpp = seat !== viewerSeat;
    return (
      <div className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition ${active ? "bg-amber-400/10 ring-1 ring-amber-400/60 light:bg-amber-50" : "bg-white/[0.03] light:bg-slate-50"}`}>
        <div className="h-8 w-8 shrink-0 rounded-lg bg-black/20 p-0.5 light:bg-slate-200">
          <ChessPiece type="k" white={color === "w"} className="h-full w-full" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-white light:text-slate-900">
            <span className="truncate">{names[seat]}</span>
            {seat === viewerSeat && <span className="rounded bg-sky-500/20 px-1 text-[10px] text-sky-200 light:text-sky-700">나</span>}
            {isOpp && !opponentConnected && <span className="rounded bg-rose-500/20 px-1 text-[10px] text-rose-200 light:text-rose-700">연결 끊김</span>}
            {isOpp && opponentIsBot && active && (
              <span className="text-[11px] font-normal text-amber-200 light:text-amber-700">
                생각 중
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{ animation: `cz-dots 1.2s ${i * 0.2}s infinite` }}>.</span>
                ))}
              </span>
            )}
          </p>
          <div className="flex h-4 items-center gap-0">
            {caps.map((c, i) => {
              const p = pieceProps(c);
              return (
                <span key={`${c}${i}`} className="-mr-1 inline-block h-4 w-4" style={i === newestCap ? { animation: `cz-pop .45s ease-out ${(animInfo?.impact ?? 0) + 0.15}s both` } : undefined}>
                  <ChessPiece type={p.type} white={p.white} className="h-full w-full" />
                </span>
              );
            })}
            {lead > 0 && <span className="ml-2 text-[11px] font-bold text-emerald-300 light:text-emerald-700">+{lead}</span>}
          </div>
        </div>
        {clock !== null && (
          <div
            className={`shrink-0 rounded-lg px-2.5 py-1 font-mono text-lg font-bold tabular-nums ${active ? (low ? "bg-rose-600 text-white" : "bg-white text-slate-900") : "bg-black/30 text-white/60 light:bg-slate-200 light:text-slate-500"}`}
            style={low ? { animation: "cz-clock 1s infinite" } : undefined}
          >
            {formatClock(clock)}
          </div>
        )}
      </div>
    );
  };

  /* ── Move list ── */
  const rows: { n: number; w?: MoveRecord; b?: MoveRecord; wi: number; bi: number }[] = [];
  state.moves.forEach((m, i) => {
    const n = state.start.full + Math.floor(i / 2);
    if (i % 2 === 0) rows.push({ n, w: m, wi: i + 1, bi: i + 2 });
    else rows[rows.length - 1].b = m;
  });
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el && viewPly === null) el.scrollTop = el.scrollHeight;
  }, [state.moves.length, viewPly]);
  const moveCell = (m: MoveRecord | undefined, ply: number) =>
    m ? (
      <button
        onClick={() => setViewPly(ply === state.moves.length ? null : ply)}
        className={`rounded px-1.5 py-0.5 text-left font-mono text-[13px] transition ${shownPly === ply ? "bg-amber-400/25 text-amber-100 light:bg-amber-100 light:text-amber-900" : "text-white/80 hover:bg-white/10 light:text-slate-700 light:hover:bg-slate-100"}`}
      >
        {m.san}
      </button>
    ) : (
      <span />
    );

  const offer = state.offer;
  const offerToMe = offer && offer.from !== viewerSeat && playing;
  const offerFromMe = offer && offer.from === viewerSeat && playing;
  const tc = timeControlById(state.timeControlId);

  const lastDesc = (() => {
    const m = shownLast;
    if (!m) return "백부터 시작합니다";
    const side = m.color === "w" ? "백" : "흑";
    if (m.kind === "castleK") return `${side} 킹사이드 캐슬링`;
    if (m.kind === "castleQ") return `${side} 퀸사이드 캐슬링`;
    const nm = PIECE_NAME_KO[m.piece.toLowerCase() as PieceType];
    let s = `${side} ${nm} ${sqName(m.from)} → ${sqName(m.to)}`;
    if (m.captured) s += ` · ${PIECE_NAME_KO[m.captured.toLowerCase() as PieceType]} 잡음${m.kind === "ep" ? "(앙파상)" : ""}`;
    if (m.promo) s += ` · ${PIECE_NAME_KO[m.promo.toLowerCase() as PieceType]}로 승진`;
    if (m.mate) s += " · 체크메이트";
    else if (m.check) s += " · 체크";
    return s;
  })();

  const status = (() => {
    if (browsing) return { text: `🔎 ${shownPly}반수째 보는 중 — 판을 누르면 현재로`, tone: "text-sky-200 light:text-sky-700" };
    if (!playing) return { text: "게임 종료", tone: "text-white/60 light:text-slate-500" };
    if (myTurn) return checkers.length > 0 ? { text: "⚠️ 체크! 킹을 지키세요", tone: "text-rose-300 light:text-rose-600 font-bold" } : { text: "내 차례", tone: "text-amber-200 light:text-amber-700 font-bold" };
    return { text: opponentIsBot ? "🤖 AI 차례" : "상대 차례", tone: "text-white/60 light:text-slate-500" };
  })();

  const resultTitle = (() => {
    const r = state.result;
    if (!r) return "";
    if (r.winner === null) return "무승부";
    return r.winner === myColor ? "승리!" : "패배";
  })();

  const promoColorWhite = myColor === "w";

  const overlays = (
    <>
      {label && (
        <div key={`label${animPly}`} className={`pointer-events-none absolute left-1/2 top-1/2 whitespace-nowrap rounded-2xl bg-gradient-to-r px-5 py-2 text-[clamp(18px,5vw,34px)] font-black tracking-tight shadow-2xl ${label.tone}`} style={{ zIndex: 30, animation: `cz-label 1.5s ease-out ${(animInfo?.dur ?? 0) * 0.7}s both` }}>
          {label.text}
        </div>
      )}
      {isDraw && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ zIndex: 25 }}>
          <span className="rounded-2xl bg-black/60 px-5 py-2 text-3xl font-black text-white" style={{ animation: "cz-rise .6s ease-out .3s both" }}>
            ½-½
          </span>
        </div>
      )}
      {promo && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55" style={{ zIndex: 40 }} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-slate-900/95 p-3 shadow-2xl" style={{ animation: "cz-rise .25s ease-out" }}>
            <p className="text-sm font-bold text-amber-200">승진할 기물을 고르세요</p>
            <div className="flex gap-2">
              {(["q", "r", "b", "n"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    const p = promo;
                    setPromo(null);
                    onAction({ type: "move", seat: viewerSeat, uci: `${sqName(p.from)}${sqName(p.to)}${t}` });
                  }}
                  className="flex h-16 w-16 flex-col items-center justify-center rounded-xl bg-white/10 transition hover:scale-105 hover:bg-amber-400/30 sm:h-20 sm:w-20"
                  aria-label={PIECE_NAME_KO[t]}
                >
                  <ChessPiece type={t} white={promoColorWhite} className="h-12 w-12 sm:h-16 sm:w-16" />
                  <span className="text-[10px] text-white/70">{PIECE_NAME_KO[t]}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setPromo(null)} className="text-xs text-white/50 hover:text-white/80">
              취소
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div onPointerDownCapture={() => getChessSound().unlock()} className="flex flex-col gap-3">
      <style>{CSS}</style>
      <ChessPieceDefs />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">♟️</span>
          <div>
            <h2 className="text-base font-bold text-white light:text-slate-900">체스</h2>
            <p className="text-[11px] text-white/50 light:text-slate-500">
              {tc.label} · {tc.kind} · 나는 {myColor === "w" ? "백 ♔" : "흑 ♚"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <SuiteSoundHud suite={getChessSound} icon="🎻" label="Grandmaster's Study" preview="castle" />
          {canWebgl && (
            <button onClick={toggleView} className={BTN} title={view === "3d" ? "평면 2D 판으로 보기" : "입체 3D 판으로 보기"}>
              {view === "3d" ? "🖼️ 2D로" : "🧊 3D로"}
            </button>
          )}
          <button onClick={onOpenRulebook} className={BTN}>
            📖 룰북
          </button>
        </div>
      </div>

      {offerToMe && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-sm text-sky-100 light:text-sky-800" style={{ animation: "cz-rise .3s ease-out" }}>
          <span>{offer!.kind === "draw" ? "🤝 상대가 무승부를 제안했어요" : "↩️ 상대가 무르기를 요청했어요"}</span>
          <span className="flex gap-1.5">
            <button onClick={() => onAction({ type: "respond", seat: viewerSeat, accept: true })} className="rounded-lg bg-sky-500 px-3 py-1 text-xs font-bold text-white hover:bg-sky-400">
              수락
            </button>
            <button onClick={() => onAction({ type: "respond", seat: viewerSeat, accept: false })} className="rounded-lg border border-white/20 px-3 py-1 text-xs text-white/80 hover:border-white/40 light:border-slate-300 light:text-slate-700">
              거절
            </button>
          </span>
        </div>
      )}
      {offerFromMe && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60 light:border-slate-200 light:bg-slate-50 light:text-slate-500">
          {offer!.kind === "draw" ? "🤝 무승부 제안을 보냈어요 — 상대의 응답을 기다리는 중" : "↩️ 무르기 요청을 보냈어요 — 상대의 응답을 기다리는 중"}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="mx-auto flex w-full max-w-[min(100%,calc(100dvh-15rem))] min-w-0 flex-col gap-2 lg:max-w-[min(100%,calc(100dvh-19rem))]">
          {playerBar(oppSeat, oppColor)}
          {view === "3d" ? (
            <div
              className="relative aspect-square w-full select-none overflow-hidden rounded-xl transition-[filter] duration-700"
              style={{ background: "#140e09", boxShadow: "0 18px 40px -18px rgba(0,0,0,.7)", filter: isDraw ? "grayscale(.85) brightness(.85)" : undefined }}
              role="grid"
              aria-label="3D 체스판 — 칸을 눌러 기물을 고르고 옮겨요, 끌면 시점 회전"
            >
              <Chess3D
                board={shownPos.board}
                flipped={flipped}
                light={colors.light}
                dark={colors.dark}
                selected={browsing ? null : selected}
                hints={selectedMoves.map((m) => ({ to: m.to, capture: m.capture }))}
                myTurn={myTurn}
                last={shownLast ? { from: shownLast.from, to: shownLast.to } : null}
                checkedKing={checkedKing}
                mated={mated}
                checkKing={anim?.check ? kingSquare(state.pos, state.pos.turn) : -1}
                anim={anim}
                animPly={animPly}
                slideS={SLIDE_S}
                hopS={HOP_S}
                nope={nope}
                quality={quality}
                onSquare={clickSquare}
              />
              {overlays}
            </div>
          ) : (
            <div className="rounded-xl p-[1.6%]" style={{ background: colors.frame, boxShadow: "0 18px 40px -18px rgba(0,0,0,.7)" }}>
              <div
                className={`cz-shake relative select-none overflow-hidden rounded-[3px] transition-[filter] duration-700`}
                style={{ ["--amp" as string]: shakeAmp, animation: shakeAmp ? `cz-shake-${(animPly ?? 0) % 2 ? "a" : "b"} .38s ease-out ${(animInfo?.impact ?? 0)}s` : undefined, filter: isDraw ? "grayscale(.85) brightness(.85)" : undefined }}
              >
                <div
                  ref={boardRef}
                  className="relative aspect-square w-full touch-none"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => setDrag(null)}
                  role="grid"
                  aria-label="체스판"
                >
                  <div className="absolute inset-0 grid grid-cols-8 grid-rows-8">{squares}</div>
                  {checkedKing >= 0 && (
                    <div className="pointer-events-none absolute flex items-center justify-center" style={{ ...cellStyle(checkedKing), zIndex: 3 }}>
                      <div className="h-full w-full rounded-full" style={{ background: "radial-gradient(circle, rgba(239,68,68,.95) 0%, rgba(239,68,68,.55) 40%, transparent 72%)", animation: "cz-pulse 1s ease-in-out infinite" }} />
                    </div>
                  )}
                  {pieces}
                  {fx}
                  {drag?.active && state.pos.board[drag.from] !== "." && (
                    <div className="pointer-events-none absolute" style={{ left: drag.x, top: drag.y, width: "12.5%", height: "12.5%", transform: "translate(-50%,-58%) scale(1.18)", zIndex: 20, filter: "drop-shadow(0 10px 8px rgba(0,0,0,.45))" }}>
                      <ChessPiece {...pieceProps(state.pos.board[drag.from])} className="h-full w-full" />
                    </div>
                  )}
                  {overlays}
                </div>
              </div>
            </div>
          )}
          {playerBar(viewerSeat, myColor)}
          <div className="flex flex-wrap items-center justify-between gap-1 px-1 text-xs">
            <span className={status.tone}>{status.text}</span>
            <span className="truncate text-white/45 light:text-slate-500">{lastDesc}</span>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className={`${PANEL} flex flex-col gap-2 p-3`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide text-white/50 light:text-slate-500">기보 ({state.moves.length}반수)</h3>
              <div className="flex gap-1">
                {[
                  { t: "⏮", go: 0 },
                  { t: "◀", go: Math.max(0, shownPly - 1) },
                  { t: "▶", go: Math.min(state.moves.length, shownPly + 1) },
                  { t: "⏭", go: state.moves.length },
                ].map((b) => (
                  <button key={b.t} onClick={() => setViewPly(b.go >= state.moves.length ? null : b.go)} className="rounded-md px-1.5 py-0.5 text-xs text-white/60 hover:bg-white/10 light:text-slate-500 light:hover:bg-slate-100" aria-label={b.t}>
                    {b.t}
                  </button>
                ))}
              </div>
            </div>
            <div ref={listRef} className="max-h-40 overflow-y-auto lg:max-h-[min(22rem,calc(100dvh-26rem))]">
              {rows.length === 0 ? (
                <p className="py-3 text-center text-xs text-white/35 light:text-slate-400">아직 둔 수가 없어요</p>
              ) : (
                <div className="grid grid-cols-[2.2rem_1fr_1fr] gap-x-1 gap-y-0.5">
                  {rows.map((r) => (
                    <div key={r.n} className="contents">
                      <span className="py-0.5 text-right font-mono text-[12px] text-white/35 light:text-slate-400">{r.n}.</span>
                      {moveCell(r.w, r.wi)}
                      {moveCell(r.b, r.bi)}
                    </div>
                  ))}
                </div>
              )}
              {state.result && <p className="mt-1 text-center font-mono text-sm font-bold text-amber-200 light:text-amber-700">{resultScore(state.result).replace("1/2-1/2", "½-½")}</p>}
            </div>
          </div>

          <div className={`${PANEL} grid grid-cols-2 gap-1.5 p-3`}>
            <button className={BTN} disabled={!canOffer(state, viewerSeat, "draw")} onClick={() => onAction({ type: "offer", seat: viewerSeat, kind: "draw" })}>
              🤝 무승부 제안
            </button>
            <button className={BTN} disabled={!canOffer(state, viewerSeat, "takeback")} onClick={() => onAction({ type: "offer", seat: viewerSeat, kind: "takeback" })}>
              ↩️ 무르기 ({3 - state.offersUsed[viewerSeat].takeback})
            </button>
            <button
              className={`${BTN} ${resignArmed ? "!border-rose-400 !bg-rose-500/30 !text-rose-100" : ""}`}
              disabled={!playing}
              onClick={() => {
                if (resignArmed) {
                  setResignArmed(false);
                  onAction({ type: "resign", seat: viewerSeat });
                } else setResignArmed(true);
              }}
            >
              {resignArmed ? "정말 기권? 한 번 더" : "🏳️ 기권"}
            </button>
            <button className={BTN} onClick={() => setUserFlip((f) => !f)}>
              🔄 판 돌리기
            </button>
            <button className={BTN} onClick={copyPgn}>
              {copied ? "✅ 복사됨" : "📋 PGN 복사"}
            </button>
            <button className={BTN} onClick={cycleTheme}>
              🎨 판: {colors.label}
            </button>
            {!playing && (
              <button className={`${BTN} col-span-2 !bg-amber-500 !text-white hover:!bg-amber-400`} onClick={onRematch}>
                🔁 다시 하기 (색 바꿈)
              </button>
            )}
            <button className={`${BTN} col-span-2`} onClick={onLeave}>
              🚪 나가기
            </button>
          </div>
        </div>
      </div>

      {state.phase === "gameOver" && state.result && resultOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onClick={() => setResultOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl border border-white/10 bg-gradient-to-b from-slate-800 to-slate-950 p-6 text-center shadow-2xl light:border-slate-200 light:from-white light:to-slate-50" style={{ animation: `cz-rise .45s ease-out ${state.result.reason === "checkmate" ? 1.1 : 0.3}s both` }}>
            <div className="h-20 w-20">
              <ChessPiece type="k" white={state.result.winner === null ? myColor === "w" : state.result.winner === "w"} className="h-full w-full" style={state.result.winner !== null && state.result.winner !== myColor ? { transform: "rotate(-70deg) translateY(10%)" } : undefined} />
            </div>
            <h3 className={`text-3xl font-black ${resultTitle === "승리!" ? "text-amber-300 light:text-amber-600" : resultTitle === "패배" ? "text-slate-300 light:text-slate-600" : "text-sky-200 light:text-sky-700"}`}>{resultTitle}</h3>
            <p className="text-sm text-white/70 light:text-slate-600">
              {RESULT_LABEL[state.result.reason]} · <span className="font-mono font-bold">{resultScore(state.result).replace("1/2-1/2", "½-½")}</span> · {state.moves.length}반수
            </p>
            <div className="mt-1 grid w-full grid-cols-2 gap-2">
              <button onClick={onRematch} className="col-span-2 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-white hover:bg-amber-400">
                🔁 다시 하기 (색 바꿈)
              </button>
              <button onClick={() => setResultOpen(false)} className={BTN}>
                🔎 기보 보기
              </button>
              <button onClick={copyPgn} className={BTN}>
                {copied ? "✅ 복사됨" : "📋 PGN 복사"}
              </button>
              <button onClick={onLeave} className={`${BTN} col-span-2`}>
                🚪 나가기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
