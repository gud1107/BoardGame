"use client";

import { useEffect, useRef, useState } from "react";
import RulebookModal from "./RulebookModal";
import {
  computeLeaderboard,
  getGrowthStage,
  MATCH_DURATION_MS,
  RESPAWN_DELAY_MS,
  SEGMENT_SPACING,
  type GrowthStage,
  type SeatIndex,
  type SnakeInput,
  type Vec2,
  type WormState,
} from "./engine";
import { detectWormEvents, WormEffectsManager } from "./WormEffects";

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
const MINIMAP_CSS_SIZE = 96; // matches the `h-24 w-24` Tailwind box below

// Kill announcement banner (see the kill-FX session's confirmed answers):
// center screen, 1.8s total (worm-kill-banner keyframe in globals.css owns
// the 0.3s scale-in / 1.0s hold / 0.5s fade split), and a same-killer streak
// within this window gets a "DOUBLE/TRIPLE KILL" callout.
const KILL_BANNER_DURATION_MS = 1800;
const KILL_COMBO_WINDOW_MS = 5000;

interface KillBanner {
  id: number;
  text: string;
  comboLabel: string | null;
}

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
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
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
  // Visual FX layer (particles/shockwaves/flashes/screen-shake) — see
  // WormEffects.ts's module doc for why this has to diff snapshots instead
  // of reacting to actions. `effects` is one long-lived manager instance for
  // the component's whole mount (lazy `useState` initializer, same pattern
  // as `touchCapable` above — a ref can't be read during render under this
  // project's lint rules, and this value's identity never needs to change).
  // `lastDiffedStateRef` tracks which incoming `state` prop it has already
  // diffed so each new network snapshot is only diffed once (the RAF loop
  // below reads `stateRef` many times per snapshot, but must not re-fire the
  // same events each time).
  const [effects] = useState(() => new WormEffectsManager());
  const lastDiffedStateRef = useRef(state);

  // Kill announcement banners — DOM/CSS overlay (screen-space typography,
  // not a fit for the canvas-only WormEffectsManager above). One entry per
  // opponent-elimination death event; `killComboRef` tracks each killer's
  // recent kill timestamps to label a same-killer streak within
  // KILL_COMBO_WINDOW_MS as a "DOUBLE/TRIPLE KILL".
  const [killBanners, setKillBanners] = useState<KillBanner[]>([]);
  const killBannerIdRef = useRef(0);
  const killComboRef = useRef<Map<SeatIndex, { count: number; lastAt: number }>>(new Map());

  useEffect(() => {
    const prevSnapshot = lastDiffedStateRef.current;
    if (prevSnapshot !== state) {
      const events = detectWormEvents(prevSnapshot, state);
      effects.handleEvents(events, viewerSeat);
      for (const ev of events) {
        if (ev.type !== "death" || ev.cause !== "head" || ev.attackerSeat === null) continue;
        // 짧은 쾌감 진동 — 내가 킬러일 때만, Vibration API 미지원 브라우저(iOS
        // Safari 등)에서는 조용히 무시.
        if (ev.attackerSeat === viewerSeat && typeof navigator !== "undefined" && "vibrate" in navigator) {
          try {
            navigator.vibrate(60);
          } catch {
            // 일부 브라우저는 지원 플래그가 있어도 호출 시점에 던질 수 있음 — 코스메틱이므로 무시.
          }
        }
        const now = performance.now();
        const prevCombo = killComboRef.current.get(ev.attackerSeat);
        const comboCount = prevCombo && now - prevCombo.lastAt <= KILL_COMBO_WINDOW_MS ? prevCombo.count + 1 : 1;
        killComboRef.current.set(ev.attackerSeat, { count: comboCount, lastAt: now });
        const victimName = namesRef.current[ev.seat] ?? `#${ev.seat}`;
        const comboLabel = comboCount === 2 ? "DOUBLE KILL!" : comboCount === 3 ? "TRIPLE KILL!" : comboCount >= 4 ? `${comboCount} KILL STREAK!` : null;
        const id = ++killBannerIdRef.current;
        setKillBanners((prev) => [...prev, { id, text: `${victimName} 처치! / ELIMINATED!`, comboLabel }]);
      }
      lastDiffedStateRef.current = state;
    }
  }, [state, viewerSeat, effects]);

  function removeKillBanner(id: number) {
    setKillBanners((prev) => prev.filter((b) => b.id !== id));
  }

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
  // Minimap backing canvas — fixed CSS size (`MINIMAP_CSS_SIZE`, the `h-24
  // w-24` box below), so unlike the main canvas this only needs a one-shot
  // dpr-aware sizing, not a `ResizeObserver`.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const canvas = minimapRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(MINIMAP_CSS_SIZE * dpr);
    canvas.height = Math.round(MINIMAP_CSS_SIZE * dpr);
    canvas.style.width = `${MINIMAP_CSS_SIZE}px`;
    canvas.style.height = `${MINIMAP_CSS_SIZE}px`;
  }, []);

  // ---------------------------------------------------------------------
  // Mobile gesture/overscroll lock — scoped to this component's mount (only
  // rendered while `phase === "playing"`, see `WormGame.tsx`), restored on
  // unmount so leaving the game never leaves the rest of the site
  // non-scrollable. The canvas game area itself already blocks touch
  // gestures via `touchAction: "none"` on its container below; this covers
  // the surrounding page chrome (stat/leaderboard overlays, the footer
  // caption) so a stray touch there can't trigger the browser's pull-to-
  // refresh or rubber-band bounce while dragging the virtual joystick near
  // the game's edges. `touch-action: pan-y` keeps ordinary vertical page
  // scroll working while dropping pinch-zoom and double-tap-zoom (neither is
  // in the "pan-y" allowed-gesture list), and `overscroll-behavior: none`
  // stops the pull-to-refresh/rubber-band bounce and (on Chromium) most of
  // the swipe-back/forward navigation gesture. A genuine OS-level Safari
  // edge-swipe-back gesture is outside what any web-page CSS/JS can block —
  // documented as a known limitation rather than claimed as "완전 차단".
  // ---------------------------------------------------------------------
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverscroll = html.style.overscrollBehavior;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    const prevBodyTouchAction = body.style.touchAction;
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    body.style.touchAction = "pan-y";
    function blockMultiTouch(e: TouchEvent) {
      if (e.touches.length > 1) e.preventDefault(); // pinch-zoom guard beyond what touch-action already drops
    }
    document.addEventListener("touchmove", blockMultiTouch, { passive: false });
    return () => {
      html.style.overscrollBehavior = prevHtmlOverscroll;
      body.style.overscrollBehavior = prevBodyOverscroll;
      body.style.touchAction = prevBodyTouchAction;
      document.removeEventListener("touchmove", blockMultiTouch);
    };
  }, []);

  // ---------------------------------------------------------------------
  // Main render + input-emit loop.
  // ---------------------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    let lastEmit = 0;
    let lastFrameTime = performance.now();

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
      // FX physics/lifecycle run at true render framerate, decoupled from
      // the ~11Hz network snapshot rate that actually feeds `stateRef`
      // (that's what makes particles/shake feel smooth instead of choppy).
      const dt = Math.min(now - lastFrameTime, 100);
      lastFrameTime = now;
      effects.updateLiveBoost(stateRef.current);
      effects.updateHeadTrail(stateRef.current);
      effects.update(dt);

      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cssW = canvas.width / dpr;
        const cssH = canvas.height / dpr;
        draw(canvas, dpr, cssW, cssH, stateRef.current, viewerSeat, namesRef.current, effects);
        drawMinimap(minimapRef.current, dpr, stateRef.current, viewerSeat);

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
  }, [viewerSeat, effects]);

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

        {/* Top-right: leaderboard + minimap radar, stacked */}
        <div className="pointer-events-none absolute top-2 right-2 flex flex-col items-end gap-1.5">
          <div className="flex w-36 flex-col gap-1 rounded-xl border border-white/10 bg-black/40 px-2.5 py-2 text-[11px] text-white/80 backdrop-blur-sm">
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
          {/* Minimap radar — dots scaled to the full arena, viewer in lime, current #1 ringed gold. See `drawMinimap` below. */}
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm">
            <canvas ref={minimapRef} className="block h-24 w-24" />
          </div>
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

        {/* Kill announcement banner(s) — center screen, scale-in → hold →
            fade over KILL_BANNER_DURATION_MS (see this file's module doc). */}
        {killBanners.length > 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
            {killBanners.map((b) => (
              <div
                key={b.id}
                onAnimationEnd={() => removeKillBanner(b.id)}
                className="flex flex-col items-center"
                style={{ animation: `worm-kill-banner ${KILL_BANNER_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1) forwards` }}
              >
                {b.comboLabel && (
                  <span
                    className="mb-1 text-sm font-extrabold tracking-[0.25em] text-amber-300 uppercase sm:text-base"
                    style={{ animation: "worm-kill-combo-pulse 0.5s ease-in-out infinite" }}
                  >
                    {b.comboLabel}
                  </span>
                )}
                <span className="rounded-2xl border border-rose-300/40 bg-black/55 px-6 py-2.5 text-xl font-black tracking-wide text-rose-100 uppercase shadow-[0_0_30px_rgba(248,113,113,0.55)] sm:text-2xl">
                  {b.text}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Touch controls — 2026-09-05 세션: 오른손 엄지 조작성을 위해 조이스틱을
            화면 하단 모서리에서 우측 세로 중앙(top: 50%, right, translateY(-50%))
            으로 재배치(`AskUserQuestion` 확정). 부스트 버튼은 조이스틱과 같은
            우측 축에서 그 바로 아래로 붙여 세로로 스택(역시 확정 답변) — 가로
            폭이 더 큰 조이스틱(h-24=96px) 중심에 맞춰 우측 오프셋을 계산해
            두 컨트롤의 좌우 중심이 정확히 일치하도록 뺐다. 바깥 컨테이너에
            이미 `touchAction: "none"`이 걸려 있지만(위 컨테이너 style 참고),
            각 컨트롤에도 명시적으로 중복 지정해 터치 오작동(스크롤/줌)을 이중
            차단한다. */}
        {touchCapable && (
          <>
            <div
              ref={joystickBaseRef}
              onPointerDown={handleJoystickPointerDown}
              onPointerMove={handleJoystickPointerMove}
              onPointerUp={handleJoystickPointerUp}
              onPointerCancel={handleJoystickPointerUp}
              className="absolute h-24 w-24 rounded-full border border-white/20 bg-white/5"
              style={{ top: "50%", right: 24, transform: "translateY(-50%)", touchAction: "none" }}
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
              className="absolute h-16 w-16 rounded-full border border-amber-300/40 bg-amber-500/20 text-xs font-bold text-amber-100 active:bg-amber-400/40"
              style={{ top: "calc(50% + 64px)", right: 40, touchAction: "none" }}
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
// 2026-09-05 성장 진화 세션: 10/25/50/100 길이 단계(`engine.ts`의
// `GrowthStage`)별 마디 반경 배율/네온 글로우 여부/크리스탈 폴리곤 전환 여부.
// 단계가 오를수록 누적(spiky의 그라데이션·돌기는 그 위 단계에서도 계속 유지).
// ---------------------------------------------------------------------
function stageRadiusMul(stage: GrowthStage): number {
  switch (stage) {
    case "aurora":
      return 1.34;
    case "crystal":
      return 1.26;
    case "scale":
      return 1.16;
    case "spiky":
      return 1.06;
    default:
      return 1;
  }
}

/** 마디 폴리곤(육각 "크리스탈") — crystal/aurora 단계 전용, 머리(i===0)는 항상 원형 유지(눈/표정 배치 단순화). */
function drawCrystalSegment(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rotation: number) {
  const sides = 6;
  ctx.beginPath();
  for (let k = 0; k < sides; k++) {
    const a = rotation + (k / sides) * Math.PI * 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/** 가시/돌기형 세그먼트 — spiky 단계 이상에서 몇 마디 간격으로 몸통 바깥쪽을 향해 작은 삼각 돌기를 덧그린다. 방향은 이웃 마디(world-space) 접선의 수직 벡터로 계산 — 정규화된 방향 비율은 world/screen 균등 스케일에서 그대로 쓸 수 있다. */
function drawSpike(ctx: CanvasRenderingContext2D, sx: number, sy: number, prevSeg: Vec2, nextSeg: Vec2, side: number, r: number, hue: number, light: number) {
  const dx = prevSeg.x - nextSeg.x;
  const dy = prevSeg.y - nextSeg.y;
  const len = Math.hypot(dx, dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;
  const baseX = sx + perpX * side * r * 0.6;
  const baseY = sy + perpY * side * r * 0.6;
  const spikeLen = r * 0.9;
  const tipX = baseX + perpX * side * spikeLen;
  const tipY = baseY + perpY * side * spikeLen;
  ctx.beginPath();
  ctx.fillStyle = hsl(hue, 82, Math.min(88, light + 16));
  ctx.moveTo(baseX - perpY * side * r * 0.28, baseY + perpX * side * r * 0.28);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(baseX + perpY * side * r * 0.28, baseY - perpX * side * r * 0.28);
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------
// Pure canvas drawing — no React, no state mutation, just paints the frame.
// ---------------------------------------------------------------------
function draw(canvas: HTMLCanvasElement, dpr: number, cssW: number, cssH: number, state: WormState, viewerSeat: SeatIndex, names: Record<SeatIndex, string>, effects: WormEffectsManager) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  // Self-destruct screen shake (viewer-local only, see WormEffects.ts) — a
  // small translate applied to the whole frame before anything is drawn, so
  // world, grid, and FX all shift together like a real camera jolt.
  const shake = effects.consumeShakeOffset();
  if (shake.dx !== 0 || shake.dy !== 0) ctx.translate(shake.dx, shake.dy);

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

  // World-space view rect (with a small margin) — used below to skip both
  // food and whole off-screen snakes' rendering work *before* transforming
  // to screen space, cheaper than a per-item toScreen-then-check and, for
  // snakes, avoids the eyes/glow/aura/label work a per-segment-only check
  // wouldn't have skipped. 모바일 렉 최적화 세션 (2026-09-02): 맵이 커지고
  // (`ARENA_SIZE`) 먹이 개수가 늘면서(`FOOD_COUNT_TARGET`) 이 컬링이 실제로
  // 아끼는 작업량도 함께 커졌다.
  const cullMarginWorld = 60 / scale;
  const viewMinX = camera.x - cssW / scale / 2 - cullMarginWorld;
  const viewMaxX = camera.x + cssW / scale / 2 + cullMarginWorld;
  const viewMinY = camera.y - cssH / scale / 2 - cullMarginWorld;
  const viewMaxY = camera.y + cssH / scale / 2 + cullMarginWorld;

  // Food.
  for (const food of state.food) {
    if (food.x < viewMinX || food.x > viewMaxX || food.y < viewMinY || food.y > viewMaxY) continue;
    const [sx, sy] = toScreen(food.x, food.y);
    const r = (3 + food.value * 1.6) * scale;
    ctx.beginPath();
    ctx.fillStyle = hsl(food.hue, 85, 62);
    ctx.arc(sx, sy, Math.max(2, r), 0, Math.PI * 2);
    ctx.fill();
  }

  // Current #1 by length (crown target below) — only an alive snake can
  // wear it, since the crown renders on its actual head position.
  const leaderSeat = computeLeaderboard(state, 1).find((entry) => entry.alive)?.seat ?? null;

  // Snakes (others first, viewer last so it renders on top).
  const seats = Array.from({ length: state.playerCount }, (_, i) => i).sort((a, b) => (a === viewerSeat ? 1 : b === viewerSeat ? -1 : 0));
  for (const seat of seats) {
    const snake = state.snakes[seat];
    if (!snake || !snake.alive || snake.segments.length === 0) continue;

    // Whole-snake broad-phase cull: every segment lies within
    // `snake.length * SEGMENT_SPACING` of the head by construction
    // (`computeSegments`), so a head whose full reach can't touch the view
    // rect means none of its segments/eyes/glow/aura/label can either —
    // skip the entire snake's per-frame draw work, not just individual
    // off-screen segments.
    const head0 = snake.path[0];
    const reach = snake.length * SEGMENT_SPACING + 40;
    if (head0.x + reach < viewMinX || head0.x - reach > viewMaxX || head0.y + reach < viewMinY || head0.y - reach > viewMaxY) continue;

    const stage = getGrowthStage(snake.length);
    // 성장 단계별 외형(10/25/50/100 길이 기준, `AskUserQuestion`으로 2026-09-02의
    // 20/40·3단계 체계를 전면 교체 확정 — engine.ts의 `getGrowthStage` 참고):
    // spiky부터 몸통에 그라데이션(머리→꼬리 밝기 차)과 돌기가 붙고, scale부터
    // 네온 글로우가, crystal부터 마디 자체가 육각 폴리곤("크리스탈")으로 바뀌고
    // 잔상까지 겹쳐 그리며, aurora는 여기에 시간에 따라 색조가 흐르는 오로라
    // 펄스가 더해진다. 머리(i===0)는 항상 원형으로 유지해 눈/표정 배치는 단계와
    // 무관하게 단순하게 둔다.
    const radiusMul = stageRadiusMul(stage);
    const glow = stage === "scale" || stage === "crystal" || stage === "aurora";
    const crystalShape = stage === "crystal" || stage === "aurora";
    const spikes = stage !== "base";
    const baseLight = seat === viewerSeat ? 60 : 52;
    const auroraShift = stage === "aurora" ? (performance.now() / 16) % 360 : 0;

    // Afterimage trail (crystal/aurora 전용) — drawn *before* the body so the
    // solid segments render on top of the fading ghosts, not the other way
    // round.
    if (crystalShape) {
      const trailColor = hsl(snake.hue, 75, baseLight);
      const trail = effects.headTrail(seat);
      for (let ti = 0; ti < trail.length; ti++) {
        const [tx, ty] = toScreen(trail[ti].x, trail[ti].y);
        if (tx < -30 || tx > cssW + 30 || ty < -30 || ty > cssH + 30) continue;
        ctx.beginPath();
        ctx.fillStyle = trailColor;
        ctx.globalAlpha = 0.2 * (1 - ti / trail.length);
        ctx.arc(tx, ty, Math.max(2, 8 * scale), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    for (let i = snake.segments.length - 1; i >= 0; i--) {
      const seg = snake.segments[i];
      const [sx, sy] = toScreen(seg.x, seg.y);
      if (sx < -30 || sx > cssW + 30 || sy < -30 || sy > cssH + 30) continue;
      const segT = i / snake.segments.length; // 0(머리) .. ~1(꼬리) — growthPulseAlpha와 짝
      const t = 1 - segT; // 1(머리) .. 0(꼬리) — 기존 반경 테이퍼링용
      // Head gets a brief scale-pulse on eating a pellet (WormEffects.ts's
      // headScale, eases back to 1 once the pulse expires).
      const headPulse = i === 0 ? effects.headScale(seat) : 1;
      const r = (6 + t * 6) * scale * headPulse * radiusMul;

      // 단계별 색상 진행 — spiky부터 그라데이션, crystal부터 마디 색조 이동,
      // aurora는 시간에 따라 흐르는 색조를 더해 오로라 펄스처럼 보이게 한다.
      let hue = snake.hue;
      let light = baseLight;
      if (stage !== "base") light = Math.min(88, light + t * 10);
      if (crystalShape) hue = (hue + t * 12) % 360;
      if (stage === "aurora") hue = (hue + auroraShift) % 360;
      const color = hsl(hue, 75, light);

      if (glow) {
        ctx.shadowColor = hsl(hue, 92, 72);
        ctx.shadowBlur = (stage === "aurora" ? 10 : stage === "crystal" ? 7 : 4) * scale;
      }
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.globalAlpha = i === 0 ? 1 : 0.92;
      if (crystalShape && i !== 0) {
        drawCrystalSegment(ctx, sx, sy, Math.max(1.5, r), snake.angle);
      } else {
        ctx.arc(sx, sy, Math.max(1.5, r), 0, Math.PI * 2);
        ctx.fill();
      }
      if (glow) ctx.shadowBlur = 0;

      // 가시/돌기형 세그먼트 — spiky 단계 이상, 몇 마디 간격으로 좌우 번갈아
      // 몸통 바깥쪽에 작은 삼각 돌기를 덧그린다(머리 제외).
      if (spikes && i !== 0 && i % 3 === 0) {
        const prevSeg = snake.segments[Math.max(i - 1, 0)];
        const nextSeg = snake.segments[Math.min(i + 1, snake.segments.length - 1)];
        drawSpike(ctx, sx, sy, prevSeg, nextSeg, i % 6 === 0 ? 1 : -1, r, hue, light);
      }
      // 비늘 테두리 패턴 — scale 단계 이상에서 몇 마디 간격으로만 어두운
      // 테두리 링을 겹쳐 그린다(머리 제외). 구 3단계 체계의 "mid/large 테두리"를
      // 이어받되 임계값만 scale(길이 25) 이상으로 갱신.
      if ((stage === "scale" || crystalShape) && i !== 0 && i % 4 === 0) {
        ctx.beginPath();
        ctx.strokeStyle = hsl(hue, 70, seat === viewerSeat ? 32 : 26);
        ctx.lineWidth = Math.max(0.6, 1.1 * scale);
        ctx.arc(sx, sy, Math.max(1.5, r * 0.7), 0, Math.PI * 2);
        ctx.stroke();
      }

      // 성장 순간 파동(Glow Pulse Wave) — 10/25/50/100 임계값을 막 넘었을 때
      // 머리→꼬리로 훑고 지나가는 밝은 오버레이 (WormEffects.ts의
      // growthPulseAlpha, 새 순회 패스 없이 이 루프에 얹는다).
      const pulse = effects.growthPulseAlpha(seat, segT);
      if (pulse > 0) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(255,255,255,${pulse * 0.85})`;
        ctx.arc(sx, sy, Math.max(1.5, r * 1.08), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Eyes on the head, facing travel direction — unless a recent kill (see
    // WormEffects.ts's killExpression) has this seat wearing a 2.5s victory
    // expression instead (2026-09-05 킬 표정 세션, `AskUserQuestion`으로
    // "미소/윙크/선글라스 중 랜덤" 확정).
    const [hx, hy] = toScreen(snake.path[0].x, snake.path[0].y);
    const eyeOffset = 6 * scale;
    const perp = snake.angle + Math.PI / 2;
    const expression = effects.killExpression(seat);
    if (expression === "sunglasses") {
      const lx = hx + Math.cos(snake.angle) * eyeOffset + Math.cos(perp) * eyeOffset * 0.6 * -1;
      const ly = hy + Math.sin(snake.angle) * eyeOffset + Math.sin(perp) * eyeOffset * 0.6 * -1;
      const rx = hx + Math.cos(snake.angle) * eyeOffset + Math.cos(perp) * eyeOffset * 0.6 * 1;
      const ry = hy + Math.sin(snake.angle) * eyeOffset + Math.sin(perp) * eyeOffset * 0.6 * 1;
      ctx.strokeStyle = "#0b1a0b";
      ctx.lineWidth = Math.max(2, 4 * scale);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(rx, ry);
      ctx.stroke();
      for (const [ex, ey] of [[lx, ly], [rx, ry]] as const) {
        ctx.beginPath();
        ctx.fillStyle = "#0b1a0b";
        ctx.arc(ex, ey, Math.max(1.5, 3 * scale), 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      for (const sign of [-1, 1]) {
        const ex = hx + Math.cos(snake.angle) * eyeOffset + Math.cos(perp) * eyeOffset * 0.6 * sign;
        const ey = hy + Math.sin(snake.angle) * eyeOffset + Math.sin(perp) * eyeOffset * 0.6 * sign;
        // 윙크 — 진행 방향 기준 오른쪽 눈(sign===1)만 감은 아치형 선으로,
        // 반대쪽은 평소처럼 원으로 유지.
        if (expression === "wink" && sign === 1) {
          ctx.strokeStyle = "#0b1a0b";
          ctx.lineWidth = Math.max(1, 2 * scale);
          ctx.beginPath();
          ctx.arc(ex, ey, Math.max(1, 2.4 * scale), 0.15 * Math.PI, 0.85 * Math.PI);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.fillStyle = "#0b1a0b";
          ctx.arc(ex, ey, Math.max(1, 2.4 * scale), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // 사악한 미소 — 머리 앞쪽(진행 방향)에 입 모양 호를 추가.
      if (expression === "smile") {
        const mx = hx + Math.cos(snake.angle) * eyeOffset * 1.7;
        const my = hy + Math.sin(snake.angle) * eyeOffset * 1.7;
        ctx.strokeStyle = "#0b1a0b";
        ctx.lineWidth = Math.max(1, 2 * scale);
        ctx.beginPath();
        ctx.arc(mx, my, Math.max(1.5, 3.2 * scale), snake.angle - 0.9, snake.angle + 0.9);
        ctx.stroke();
      }
    }

    // Hit-impact glow: a brief bright ring around an attacker's head right
    // after it lands a tail-cut (WormEffects.ts's headGlowAlpha).
    const glowAlpha = effects.headGlowAlpha(seat);
    if (glowAlpha > 0) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255, 241, 150, ${glowAlpha})`;
      ctx.lineWidth = Math.max(1, 3 * scale);
      ctx.arc(hx, hy, Math.max(2, 13 * scale), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Killer gold aura pulse: a breathing golden ring around whoever just
    // landed a kill (WormEffects.ts's killerAuraAlpha), visible to everyone
    // watching, not just the killer.
    const auraAlpha = effects.killerAuraAlpha(seat);
    if (auraAlpha > 0) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255, 213, 92, ${Math.min(1, auraAlpha)})`;
      ctx.lineWidth = Math.max(1.5, 4 * scale);
      ctx.shadowColor = "rgba(255, 196, 60, 0.9)";
      ctx.shadowBlur = 14 * scale;
      ctx.arc(hx, hy, Math.max(3, 19 * scale), 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Name label above the head.
    const label = names[seat] ?? `#${seat}`;
    ctx.font = `${Math.max(10, 12 * scale)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = seat === viewerSeat ? "#d9f99d" : "rgba(255,255,255,0.7)";
    ctx.fillText(label, hx, hy - 18 * scale - 4);

    // Realtime #1 crown + gold aura — persistent (not fading, unlike the
    // kill-triggered `killerAuraAlpha` ring above), visible to every viewer,
    // re-evaluated every frame from `computeLeaderboard` so it instantly
    // hops to whoever is actually longest right now.
    if (seat === leaderSeat) {
      const pulse = 0.85 + 0.15 * Math.sin(Date.now() / 260);
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255, 213, 92, 0.6)";
      ctx.lineWidth = Math.max(1.5, 3 * scale);
      ctx.shadowColor = "rgba(255, 196, 60, 0.85)";
      ctx.shadowBlur = 10 * scale;
      ctx.arc(hx, hy, Math.max(3, 17 * scale) * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = `${Math.max(13, 17 * scale)}px sans-serif`;
      ctx.fillText("👑", hx, hy - 32 * scale - 8);
    }
  }

  // Particles/floating text/shockwaves/flashes/slash trails — always drawn
  // last so they sit above the snakes/food they're reacting to.
  effects.draw(ctx, toScreen, scale);

  // Full-screen white/neon kill flash (killer's/victim's own screens only —
  // WormEffects.ts's screenFlashAlpha), drawn in screen space last so it
  // washes over everything else. A small overscan covers the shake
  // translate applied at the top of this function so no seam shows at the
  // jittered edges.
  const flashAlpha = effects.screenFlashAlpha();
  if (flashAlpha > 0) {
    ctx.fillStyle = `rgba(255, 250, 235, ${flashAlpha * 0.55})`;
    ctx.fillRect(-20, -20, cssW + 40, cssH + 40);
  }
}

// ---------------------------------------------------------------------
// Minimap radar — the whole arena scaled down into a fixed `MINIMAP_CSS_SIZE`
// square (independent of the main view's camera/zoom), every alive seat as a
// dot, the viewer in lime, the current #1 by length ringed gold. New in the
// 2026-09-02 맵 확장 세션 (there was no minimap before this — see HANDOFF.md).
// ---------------------------------------------------------------------
function drawMinimap(canvas: HTMLCanvasElement | null, dpr: number, state: WormState, viewerSeat: SeatIndex) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, MINIMAP_CSS_SIZE, MINIMAP_CSS_SIZE);
  ctx.fillStyle = "rgba(5, 10, 5, 0.55)";
  ctx.fillRect(0, 0, MINIMAP_CSS_SIZE, MINIMAP_CSS_SIZE);

  const sx = MINIMAP_CSS_SIZE / state.arena.width;
  const sy = MINIMAP_CSS_SIZE / state.arena.height;
  const leaderSeat = computeLeaderboard(state, 1).find((entry) => entry.alive)?.seat ?? null;

  for (let seat = 0; seat < state.playerCount; seat++) {
    const snake = state.snakes[seat];
    if (!snake?.alive || snake.path.length === 0) continue;
    const px = snake.path[0].x * sx;
    const py = snake.path[0].y * sy;
    const isViewer = seat === viewerSeat;
    ctx.beginPath();
    ctx.fillStyle = isViewer ? "#d9f99d" : hsl(snake.hue, 80, 60);
    ctx.arc(px, py, isViewer ? 3 : 2.2, 0, Math.PI * 2);
    ctx.fill();
    if (seat === leaderSeat) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255, 213, 92, 0.9)";
      ctx.lineWidth = 1.2;
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, MINIMAP_CSS_SIZE - 1, MINIMAP_CSS_SIZE - 1);
}
