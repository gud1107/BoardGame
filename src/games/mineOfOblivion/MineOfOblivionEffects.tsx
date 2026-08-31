"use client";

import { useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import type { EventKind, LastEvent, Seat } from "./engine";

/** How close together two backdrop taps must land to count as a double-tap skip gesture — same small helper every other `<Game>Effects.tsx` in this project re-implements locally per ARCHITECTURE.md §2's "zero cross-game code coupling" rule (see grid-poker/skipGesture.ts). */
const DOUBLE_TAP_SKIP_MS = 350;
function isDoubleTap(lastTapAt: number, now: number): boolean {
  return lastTapAt !== 0 && now - lastTapAt < DOUBLE_TAP_SKIP_MS;
}

/**
 * 11×11 지뢰찾기식 도착-판정 연출 — 지뢰 폭발(-5점 + 강제 리스폰, 영구 탈락이
 * 아님) / 보물 순차 획득(+10/+15/+20) / 안전 칸 최초 공개(+N점) 3종. 매 턴
 * 정확히 한 번, `REVEAL_STEP`에 진입할 때마다 뜬다. Keyframes live in
 * `globals.css` under the `moo-` prefix (same per-game-keyframes convention
 * as every other `<Game>Effects.tsx`).
 */

const FIRE_PARTICLE_COUNT = 16;
const FIRE_PARTICLES = Array.from({ length: FIRE_PARTICLE_COUNT });
const SPARKLE_PARTICLE_COUNT = 14;
const SPARKLE_PARTICLES = Array.from({ length: SPARKLE_PARTICLE_COUNT });

function FireBurst() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {FIRE_PARTICLES.map((_, i) => (
        <span
          key={i}
          className="absolute text-xl"
          style={
            {
              "--angle": `${(360 / FIRE_PARTICLE_COUNT) * i}deg`,
              animation: `moo-fire-particle 0.85s ease-out ${(i * 0.02).toFixed(2)}s both`,
            } as CSSProperties
          }
        >
          {i % 3 === 0 ? "🔥" : i % 3 === 1 ? "💥" : "🟥"}
        </span>
      ))}
    </div>
  );
}

function TreasureSparkle() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {SPARKLE_PARTICLES.map((_, i) => (
        <span
          key={i}
          className="absolute text-lg"
          style={
            {
              "--angle": `${(360 / SPARKLE_PARTICLE_COUNT) * i}deg`,
              animation: `moo-treasure-sparkle-particle 1s ease-out ${(i * 0.025).toFixed(2)}s both`,
            } as CSSProperties
          }
        >
          {i % 2 === 0 ? "✨" : "💰"}
        </span>
      ))}
    </div>
  );
}

/** 지뢰 폭발: 붉은 비네트 암전 + 화면 흔들림 + 화염 파티클 + 슬램 엠블럼 + 붉은 "-5" 플로팅 텍스트. 영구 탈락이 아니라 "출발지 인근으로 강제 리스폰"이라는 걸 문구로 분명히 한다. */
function MineBlastVignette({ mover, tile, respawnTile, names }: { mover: Seat; tile: string; respawnTile?: string; names: Record<Seat, string> }) {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[95]"
        style={{
          background: "radial-gradient(ellipse at center, transparent 25%, rgba(190,10,30,0.5) 70%, rgba(0,0,0,0.92) 100%)",
          animation: "moo-red-flash-in 0.5s ease-out both, moo-screen-shake 0.5s ease-out both",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 z-20 -translate-x-1/2 text-5xl font-black text-rose-400 drop-shadow-[0_0_18px_rgba(244,63,94,0.9)] sm:text-6xl"
        style={{ animation: "moo-score-float-up 1.1s ease-out 0.15s both" }}
      >
        −5
      </span>
      <div className="relative z-10 flex flex-col items-center gap-2" style={{ animation: "moo-mine-emblem-slam 0.65s cubic-bezier(0.34,1.56,0.64,1) 0.1s both" }}>
        <span className="text-6xl drop-shadow-[0_0_25px_rgba(244,63,94,0.9)] sm:text-7xl">💀</span>
        <p className="text-lg font-black tracking-wide text-rose-200 sm:text-xl">
          폭사! {names[mover]}님 {tile} 지뢰 명중
        </p>
        <p className="text-xs text-rose-100/70">해당 칸 지뢰 전원 제거 · {respawnTile ?? "출발지 인근"}(으)로 강제 리스폰</p>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{ animation: "moo-respawn-warp 0.9s ease-in 0.35s both" }}
      >
        <span className="text-4xl">🌀</span>
      </div>
    </>
  );
}

/** 안전 칸 최초 공개: 에메랄드 펄스 링 + 골드 "+N" 플로팅 스코어. */
function RevealPulse({ scoreGained }: { scoreGained: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="absolute h-24 w-24 rounded-full border-4 border-emerald-400/70" style={{ animation: "moo-safe-pulse-ring 0.9s ease-out both" }} />
      <span className="absolute h-24 w-24 rounded-full border-4 border-emerald-400/50" style={{ animation: "moo-safe-pulse-ring 0.9s ease-out 0.15s both" }} />
      <span className="relative text-4xl">🟢</span>
      {scoreGained > 0 && (
        <span
          className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 text-3xl font-black text-amber-300 drop-shadow-[0_0_14px_rgba(251,191,36,0.8)] sm:text-4xl"
          style={{ animation: "moo-score-float-up 1s ease-out 0.1s both" }}
        >
          +{scoreGained}
        </span>
      )}
    </div>
  );
}

/** 보물 획득: 거대한 황금 궤짝 오픈 연출 + 순차 점수(+10/+15/+20) 골드 파티클. */
function TreasureChestBurst({ points }: { points: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <TreasureSparkle />
      <span
        className="relative text-7xl drop-shadow-[0_0_30px_rgba(251,191,36,0.9)] sm:text-8xl"
        style={{ animation: "moo-chest-open-slam 0.7s cubic-bezier(0.34,1.56,0.64,1) both" }}
      >
        📦
      </span>
      <span
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 text-4xl font-black text-amber-300 drop-shadow-[0_0_18px_rgba(251,191,36,0.9)] sm:text-5xl"
        style={{ animation: "moo-score-float-up 1.1s ease-out 0.2s both" }}
      >
        +{points}
      </span>
    </div>
  );
}

function SkipButton({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSkip();
      }}
      className="relative z-10 mt-3 flex items-center gap-1.5 rounded-full border border-rose-500/50 bg-black/80 px-6 py-2.5 text-sm font-semibold text-white/90 backdrop-blur-sm transition hover:border-rose-400/70 hover:bg-black active:scale-95"
      style={{ animation: "moo-skip-pulse-glow 1.8s ease-in-out infinite" }}
      aria-label="연출 스킵하고 바로 진행하기"
    >
      ⏩ 스킵
    </button>
  );
}

export interface RevealOverlayProps {
  event: LastEvent;
  names: Record<Seat, string>;
  viewerSeat: Seat;
  isGameOver: boolean;
  winner: Seat | null;
  isDraw: boolean;
  timeLeft: number;
  secondsTotal: number;
  /** Ends the reveal wait immediately — a no-op once the phase has already moved on (mirrors grid-poker/showMeTheCoin's shared skip). */
  onSkip: () => void;
}

const EVENT_HEADLINE: Record<EventKind, (names: Record<Seat, string>, ev: LastEvent) => string> = {
  reveal: (names, ev) => (ev.alreadyVisited ? `${names[ev.actor]}님 · ${ev.tile} 이미 탐사된 칸 · 0점` : `${names[ev.actor]}님 · ${ev.tile} 최초 공개`),
  treasure: (names, ev) => `💎 ${names[ev.actor]}님 ${ev.treasureOrder}번째 보물 획득!`,
  mine: () => "", // rendered entirely by MineBlastVignette instead
};

export default function RevealOverlay({ event, names, viewerSeat, isGameOver, winner, isDraw, timeLeft, secondsTotal, onSkip }: RevealOverlayProps) {
  const hasSkippedRef = useRef(false);
  const lastTapRef = useRef(0);

  function triggerSkip() {
    if (hasSkippedRef.current) return;
    hasSkippedRef.current = true;
    onSkip();
  }

  function handleBackdropTap() {
    const now = Date.now();
    if (isDoubleTap(lastTapRef.current, now)) {
      lastTapRef.current = 0;
      triggerSkip();
    } else {
      lastTapRef.current = now;
    }
  }

  if (typeof document === "undefined") return null;

  const isMine = event.kind === "mine";
  const isTreasure = event.kind === "treasure";
  const pct = Math.max(0, Math.min(100, (timeLeft / secondsTotal) * 100));

  const body = (
    <div
      className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/85 p-4"
      style={{ animation: "moo-overlay-in 0.3s ease-out both" }}
      onClick={handleBackdropTap}
    >
      {isMine && <FireBurst />}

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-3 py-6 text-center">
        {isMine ? (
          <MineBlastVignette mover={event.actor} tile={event.tile} respawnTile={event.respawnTile} names={names} />
        ) : isTreasure ? (
          <>
            <TreasureChestBurst points={event.treasurePoints ?? 0} />
            <h2 className="text-xl font-extrabold text-amber-200 drop-shadow-[0_0_16px_rgba(251,191,36,0.8)] sm:text-2xl">{EVENT_HEADLINE.treasure(names, event)}</h2>
          </>
        ) : (
          <>
            <RevealPulse scoreGained={event.scoreGained ?? 0} />
            <h2
              className={`text-xl font-extrabold sm:text-2xl ${event.alreadyVisited ? "text-white/50" : "text-emerald-200 drop-shadow-[0_0_16px_rgba(52,211,153,0.7)]"}`}
            >
              {EVENT_HEADLINE.reveal(names, event)}
            </h2>
          </>
        )}

        {isGameOver && <p className="text-sm font-semibold text-white/80">{isDraw ? "🤝 무승부" : `🏆 ${names[winner as Seat]}님 최종 승리`}</p>}

        <SkipButton onSkip={triggerSkip} />

        {isGameOver ? (
          <p className="mt-1 text-xs text-white/40">화면을 눌러 결과를 확인하세요{viewerSeat ? "" : ""}</p>
        ) : (
          <div className="relative z-10 flex w-full max-w-xs flex-col items-center gap-1.5">
            <span className="text-[11px] font-medium tracking-wide text-white/50 uppercase">다음 턴 준비</span>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-rose-500 to-fuchsia-500 transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

/** Small always-visible avatar+HUD strip for one seat — score/treasure/mine-hit stats, used by the Board's top/bottom bars. */
export function SeatHud({
  seat,
  name,
  score,
  treasuresClaimed,
  mineHitsTaken,
  isActive,
  connected,
}: {
  seat: Seat;
  name: string;
  score: number;
  treasuresClaimed: number;
  mineHitsTaken: number;
  isActive: boolean;
  connected: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 transition ${isActive ? "border-rose-400/50 bg-rose-500/10" : "border-white/10 bg-white/[0.03]"}`}>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
        <Avatar size={24} />
        {name}
        {!connected && <span className="text-[10px] font-normal text-rose-300">(연결 끊김)</span>}
      </span>
      <span className="flex items-center gap-2 text-xs text-white/60">
        <span title="총점" className={`font-bold ${score < 0 ? "text-rose-300" : "text-amber-200"}`}>
          🏅 {score}
        </span>
        <span title="획득 보물">💎 {treasuresClaimed}</span>
        <span title="지뢰 피격 횟수">💥 {mineHitsTaken}</span>
      </span>
      <span className="sr-only">{seat}</span>
    </div>
  );
}
