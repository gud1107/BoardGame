"use client";

import { useEffect, useRef, useState } from "react";
import RulebookModal from "./RulebookModal";
import {
  computeLeaderboard,
  MATCH_DURATION_MS,
  RESPAWN_DELAY_MS,
  type SeatIndex,
  type SnakeInput,
  type WormState,
} from "./engine";

/**
 * Canvas 2D real-time renderer + input capture, the "board" layer for this
 * game (see ARCHITECTURE.md §2's `<Game>Board.tsx` slot) — state comes in as
 * a prop only, intent goes out only via `onInput`/`onGameEnd`, no network
 * awareness here (same controlled-component contract as every other game's
 * board, just driven by a `requestAnimationFrame` loop instead of clicks).
 *
 * Input model (boardGameRule/지렁이/지렁이.md's "크로스 플랫폼 & 반응형" section):
 * mouse position relative to the canvas center steers on desktop, held
 * WASD/arrow keys override it, a touch-drag virtual joystick (rendered only
 * when a touch capability is detected) does the same on mobile, and boosting
 * is spacebar / mouse-down / a touch button. The computed `{angle,
 * boosting}` is read every animation frame but only pushed to `onInput` at a
 * throttled ~14/sec — the caller (`WormGame.tsx`) decides how much of that
 * to actually put on the wire.
 */

const BASE_VIEW_HEIGHT = 820; // world units visible vertically at zoom = 1
const EMIT_INTERVAL_MS = 70;
const JOYSTICK_RADIUS = 46;
const JOYSTICK_DEADZONE = 8;

export interface WormCanvasProps {
  state: WormState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onInput: (input: SnakeInput) => void;
  onGameEnd: () => void;
}

function hsl(hue: number, s = 78, l = 56) {
  return `hsl(${hue} ${s}% ${l}%)`;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function WormCanvas({ state, viewerSeat, names, connectedSeats, onInput, onGameEnd }: WormCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [rulebookOpen, setRulebookOpen] = useState(false);
  // Lazy initializer (runs once on first render, not "in an effect") — this
  // component only ever mounts client-side (dynamic import, `ssr: false`),
  // so `window`/`navigator` are always available here.
  const [touchCapable] = useState(() => "ontouchstart" in window || navigator.maxTouchPoints > 0);

  // Latest-value refs so the RAF loop (mounted once) never reads stale
  // props/state — kept in sync via effects (never mutated during render,
  // same pattern as `gameStateRef` in WormGame.tsx).
  const stateRef = useRef(state);
  const namesRef = useRef(names);
  const onInputRef = useRef(onInput);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);
  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);

  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const mouseBoostRef = useRef(false);
  const keysRef = useRef<Set<string>>(new Set());
  const spaceBoostRef = useRef(false);
  const joystickRef = useRef<{ active: boolean; dx: number; dy: number }>({ active: false, dx: 0, dy: 0 });
  const joystickBoostRef = useRef(false);
  const lastAngleRef = useRef(state.snakes[viewerSeat]?.angle ?? 0);
  const [joystickVisual, setJoystickVisual] = useState<{ dx: number; dy: number } | null>(null);

  const gameEndFiredRef = useRef(false);

  // ---------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) {
        keysRef.current.add(k);
        e.preventDefault();
      }
      if (k === " ") {
        spaceBoostRef.current = true;
        e.preventDefault();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      keysRef.current.delete(k);
      if (k === " ") spaceBoostRef.current = false;
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // ---------------------------------------------------------------------
  // Pointer steering (mouse) + mouse-down boost, on the canvas itself.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function onMove(e: PointerEvent) {
      if (e.pointerType === "touch") return; // touch uses the joystick instead
      const rect = canvas!.getBoundingClientRect();
      pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    function onDown(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      mouseBoostRef.current = true;
    }
    function onUp(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      mouseBoostRef.current = false;
    }
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // ---------------------------------------------------------------------
  // Resize the backing canvas to match its CSS box (device-pixel-ratio aware).
  // ---------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    function resize() {
      const rect = container!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.max(1, Math.round(rect.width * dpr));
      canvas!.height = Math.max(1, Math.round(rect.height * dpr));
      canvas!.style.width = `${rect.width}px`;
      canvas!.style.height = `${rect.height}px`;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ---------------------------------------------------------------------
  // Main render + input-emit loop.
  // ---------------------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    let lastEmit = 0;

    function computeAngle(cssW: number, cssH: number): number {
      const keys = keysRef.current;
      let dx = 0;
      let dy = 0;
      if (keys.has("arrowup") || keys.has("w")) dy -= 1;
      if (keys.has("arrowdown") || keys.has("s")) dy += 1;
      if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
      if (keys.has("arrowright") || keys.has("d")) dx += 1;
      if (dx !== 0 || dy !== 0) return Math.atan2(dy, dx);
      const joy = joystickRef.current;
      if (joy.active && Math.hypot(joy.dx, joy.dy) > JOYSTICK_DEADZONE / JOYSTICK_RADIUS) return Math.atan2(joy.dy, joy.dx);
      const p = pointerRef.current;
      if (p) return Math.atan2(p.y - cssH / 2, p.x - cssW / 2);
      return lastAngleRef.current;
    }

    function frame(now: number) {
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cssW = canvas.width / dpr;
        const cssH = canvas.height / dpr;
        draw(canvas, dpr, cssW, cssH, stateRef.current, viewerSeat, namesRef.current);

        const angle = computeAngle(cssW, cssH);
        lastAngleRef.current = angle;
        const boosting = mouseBoostRef.current || spaceBoostRef.current || joystickBoostRef.current;
        if (now - lastEmit >= EMIT_INTERVAL_MS) {
          lastEmit = now;
          onInputRef.current({ angle, boosting });
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [viewerSeat]);

  // ---------------------------------------------------------------------
  // Game end detection (match timer elapsed).
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (state.phase === "gameOver" && !gameEndFiredRef.current) {
      gameEndFiredRef.current = true;
      onGameEnd();
    }
  }, [state.phase, onGameEnd]);

  // ---------------------------------------------------------------------
  // Touch joystick handlers.
  // ---------------------------------------------------------------------
  const joystickBaseRef = useRef<HTMLDivElement | null>(null);
  function handleJoystickPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    joystickRef.current = { active: true, dx: 0, dy: 0 };
    setJoystickVisual({ dx: 0, dy: 0 });
  }
  function handleJoystickPointerMove(e: React.PointerEvent) {
    if (!joystickRef.current.active || !joystickBaseRef.current) return;
    const rect = joystickBaseRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const mag = Math.hypot(dx, dy);
    if (mag > JOYSTICK_RADIUS) {
      dx = (dx / mag) * JOYSTICK_RADIUS;
      dy = (dy / mag) * JOYSTICK_RADIUS;
    }
    joystickRef.current = { active: true, dx, dy };
    setJoystickVisual({ dx, dy });
  }
  function handleJoystickPointerUp() {
    joystickRef.current = { active: false, dx: 0, dy: 0 };
    setJoystickVisual(null);
  }

  const viewerSnake = state.snakes[viewerSeat];
  const respawnMsLeft = viewerSnake && !viewerSnake.alive && viewerSnake.deadAtMs !== null ? RESPAWN_DELAY_MS - (state.elapsedMs - viewerSnake.deadAtMs) : null;
  const leaderboard = computeLeaderboard(state, 5);
  const timeLeft = MATCH_DURATION_MS - state.elapsedMs;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-[28px] border border-black/60 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)]"
        style={{ height: "min(78vh, 640px)", background: "#050a05", touchAction: "none" }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

        {/* Top-left: my stats + timer */}
        <div className="pointer-events-none absolute top-2 left-2 flex flex-col gap-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-white/80 backdrop-blur-sm">
          <span className="font-bold text-lime-200">
            🪱 {names[viewerSeat] ?? "나"} · 길이 {viewerSnake?.length ?? 0}
          </span>
          <span className="text-white/60">점수 {viewerSnake?.score ?? 0}</span>
          <span className="text-white/60">⏱ 남은 시간 {formatClock(timeLeft)}</span>
        </div>

        {/* Top-right: leaderboard */}
        <div className="pointer-events-none absolute top-2 right-2 flex w-36 flex-col gap-1 rounded-xl border border-white/10 bg-black/40 px-2.5 py-2 text-[11px] text-white/80 backdrop-blur-sm">
          <span className="mb-0.5 font-semibold tracking-wide text-white/50 uppercase">🏆 리더보드</span>
          {leaderboard.map((entry, i) => (
            <span key={entry.seat} className={`flex items-center justify-between gap-1 ${entry.seat === viewerSeat ? "text-lime-300" : entry.alive ? "text-white/80" : "text-white/30"}`}>
              <span className="truncate">
                {i + 1}. {names[entry.seat] ?? `#${entry.seat}`}
                {!entry.alive && " 💀"}
              </span>
              <span className="font-bold">{entry.length}</span>
            </span>
          ))}
        </div>

        {/* Rulebook button */}
        <button
          onClick={() => setRulebookOpen(true)}
          className="absolute bottom-2 left-2 rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] text-white/70 backdrop-blur-sm transition hover:border-white/30 hover:text-white"
        >
          📖 룰북
        </button>

        {/* Respawn overlay */}
        {respawnMsLeft !== null && respawnMsLeft > 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-center">
            <span className="text-3xl">💀</span>
            <span className="text-sm font-semibold text-rose-200">사망! 부활까지 {(respawnMsLeft / 1000).toFixed(1)}초</span>
          </div>
        )}

        {/* Touch controls */}
        {touchCapable && (
          <>
            <div
              ref={joystickBaseRef}
              onPointerDown={handleJoystickPointerDown}
              onPointerMove={handleJoystickPointerMove}
              onPointerUp={handleJoystickPointerUp}
              onPointerCancel={handleJoystickPointerUp}
              className="absolute bottom-4 left-4 h-24 w-24 rounded-full border border-white/20 bg-white/5"
            >
              <div
                className="pointer-events-none absolute top-1/2 left-1/2 h-9 w-9 rounded-full bg-lime-300/70"
                style={{
                  transform: `translate(-50%, -50%) translate(${joystickVisual?.dx ?? 0}px, ${joystickVisual?.dy ?? 0}px)`,
                }}
              />
            </div>
            <button
              onPointerDown={() => {
                joystickBoostRef.current = true;
              }}
              onPointerUp={() => {
                joystickBoostRef.current = false;
              }}
              onPointerCancel={() => {
                joystickBoostRef.current = false;
              }}
              className="absolute right-4 bottom-4 h-16 w-16 rounded-full border border-amber-300/40 bg-amber-500/20 text-xs font-bold text-amber-100 active:bg-amber-400/40"
            >
              🚀 부스트
            </button>
          </>
        )}
      </div>

      <p className="text-center text-[11px] text-white/40">
        {connectedSeats.size}/{state.playerCount}명 접속 중 · 마우스/드래그로 방향, 스페이스바·클릭·부스트 버튼으로 대시
      </p>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Pure canvas drawing — no React, no state mutation, just paints the frame.
// ---------------------------------------------------------------------
function draw(canvas: HTMLCanvasElement, dpr: number, cssW: number, cssH: number, state: WormState, viewerSeat: SeatIndex, names: Record<SeatIndex, string>) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const viewer = state.snakes[viewerSeat];
  const camera = viewer?.alive ? viewer.path[0] : { x: state.arena.width / 2, y: state.arena.height / 2 };
  const zoom = viewer ? Math.max(0.55, 1.15 - viewer.length * 0.004) : 0.9;
  const scale = (cssH / BASE_VIEW_HEIGHT) * zoom;

  function toScreen(x: number, y: number): [number, number] {
    return [(x - camera.x) * scale + cssW / 2, (y - camera.y) * scale + cssH / 2];
  }

  // Background.
  ctx.fillStyle = "#060b06";
  ctx.fillRect(0, 0, cssW, cssH);

  // World grid.
  const gridSize = 120;
  ctx.strokeStyle = "rgba(163,230,53,0.06)";
  ctx.lineWidth = 1;
  const startX = Math.floor((camera.x - cssW / scale / 2) / gridSize) * gridSize;
  const endX = camera.x + cssW / scale / 2;
  const startY = Math.floor((camera.y - cssH / scale / 2) / gridSize) * gridSize;
  const endY = camera.y + cssH / scale / 2;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += gridSize) {
    const [sx1, sy1] = toScreen(x, startY);
    const [sx2, sy2] = toScreen(x, endY);
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
  }
  for (let y = startY; y <= endY; y += gridSize) {
    const [sx1, sy1] = toScreen(startX, y);
    const [sx2, sy2] = toScreen(endX, y);
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
  }
  ctx.stroke();

  // Arena boundary (lethal wall).
  ctx.strokeStyle = "rgba(248,113,113,0.55)";
  ctx.lineWidth = 4;
  const [bx1, by1] = toScreen(0, 0);
  const [bx2, by2] = toScreen(state.arena.width, state.arena.height);
  ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);

  // Food.
  for (const food of state.food) {
    const [sx, sy] = toScreen(food.x, food.y);
    if (sx < -20 || sx > cssW + 20 || sy < -20 || sy > cssH + 20) continue;
    const r = (3 + food.value * 1.6) * scale;
    ctx.beginPath();
    ctx.fillStyle = hsl(food.hue, 85, 62);
    ctx.arc(sx, sy, Math.max(2, r), 0, Math.PI * 2);
    ctx.fill();
  }

  // Snakes (others first, viewer last so it renders on top).
  const seats = Array.from({ length: state.playerCount }, (_, i) => i).sort((a, b) => (a === viewerSeat ? 1 : b === viewerSeat ? -1 : 0));
  for (const seat of seats) {
    const snake = state.snakes[seat];
    if (!snake || !snake.alive || snake.segments.length === 0) continue;
    const color = hsl(snake.hue, 75, seat === viewerSeat ? 60 : 52);

    for (let i = snake.segments.length - 1; i >= 0; i--) {
      const seg = snake.segments[i];
      const [sx, sy] = toScreen(seg.x, seg.y);
      if (sx < -30 || sx > cssW + 30 || sy < -30 || sy > cssH + 30) continue;
      const t = 1 - i / snake.segments.length;
      const r = (6 + t * 6) * scale;
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.globalAlpha = i === 0 ? 1 : 0.92;
      ctx.arc(sx, sy, Math.max(1.5, r), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Eyes on the head, facing travel direction.
    const [hx, hy] = toScreen(snake.path[0].x, snake.path[0].y);
    const eyeOffset = 6 * scale;
    const perp = snake.angle + Math.PI / 2;
    for (const sign of [-1, 1]) {
      const ex = hx + Math.cos(snake.angle) * eyeOffset + Math.cos(perp) * eyeOffset * 0.6 * sign;
      const ey = hy + Math.sin(snake.angle) * eyeOffset + Math.sin(perp) * eyeOffset * 0.6 * sign;
      ctx.beginPath();
      ctx.fillStyle = "#0b1a0b";
      ctx.arc(ex, ey, Math.max(1, 2.4 * scale), 0, Math.PI * 2);
      ctx.fill();
    }

    // Name label above the head.
    const label = names[seat] ?? `#${seat}`;
    ctx.font = `${Math.max(10, 12 * scale)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = seat === viewerSeat ? "#d9f99d" : "rgba(255,255,255,0.7)";
    ctx.fillText(label, hx, hy - 18 * scale - 4);
  }
}
