"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import type { MatchOutcome, RoundResultSnapshot, Seat } from "./engine";

/** How close together two backdrop taps must land to count as a double-tap skip gesture — same small pure helper `grid-poker/skipGesture.ts`/`showMeTheCoin/ShowMeTheCoinEffects.tsx` define, kept as its own copy here per ARCHITECTURE.md §2's "zero cross-game code coupling" rule rather than importing across game folders. */
const DOUBLE_TAP_SKIP_MS = 350;
function isDoubleTap(lastTapAt: number, now: number): boolean {
  return lastTapAt !== 0 && now - lastTapAt < DOUBLE_TAP_SKIP_MS;
}

/**
 * Death-game-themed reveal presentation — the request's "상호 신뢰(Love) 성공
 * 시: 눈부신 네온 하트 폭발 파티클 + 에메랄드 쉴드 연출" and "배신(Betrayal) 및
 * 처치 시: 깨진 하트(Broken Heart) 크랙 + 붉은 비네트 암전 + 데스 엠블럼 슬램".
 * Purely cosmetic, no game logic — same "portal a fixed overlay, self-time
 * via useEffect/setTimeout, let the caller's own fixed timer be the thing
 * that actually advances the reducer" split as
 * `showMeTheCoin/ShowMeTheCoinEffects.tsx`, which this is modeled on
 * (including reusing its `isDoubleTap`/skip-button gesture helper —
 * cross-game *type-level* reuse of a dependency-free pure helper, not a
 * cross-game *state* coupling, so it doesn't violate ARCHITECTURE.md §2's
 * "게임 간 코드 결합 0" rule).
 *
 * Keyframes live in `globals.css` under the `lwa-` prefix (see that file's
 * "러브 윈즈 올" section) — same per-game-keyframes convention as every other
 * `<Game>Effects.tsx` in this project.
 */

const HEART_PARTICLE_COUNT = 14;
const HEART_PARTICLES = Array.from({ length: HEART_PARTICLE_COUNT });

/** Radiating neon-pink heart particles — mounted behind a mutual-LOVE reveal (either an ordinary tie or the final mutual-victory ending). */
function HeartBurst() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {HEART_PARTICLES.map((_, i) => (
        <span
          key={i}
          className="absolute text-lg"
          style={
            {
              "--angle": `${(360 / HEART_PARTICLE_COUNT) * i}deg`,
              animation: `lwa-heart-burst-particle 0.9s ease-out ${(i * 0.03).toFixed(2)}s both`,
            } as CSSProperties
          }
        >
          💗
        </span>
      ))}
    </div>
  );
}

/** Emerald trust-shield ring accompanying the heart burst — the request's "에메랄드 쉴드 연출". */
function ShieldPulse() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      style={{ animation: "lwa-shield-pulse 1s ease-out both" }}
    >
      <div className="h-40 w-40 rounded-full border-4 border-emerald-300/70 sm:h-52 sm:w-52" />
    </div>
  );
}

/** Cracking broken-heart icon — the request's "깨진 하트(Broken Heart) 크랙" beat, shown behind a betrayal/mutual-WAR reveal. */
function BrokenHeartCrack() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="text-7xl sm:text-8xl" style={{ animation: "lwa-crack-in 0.6s ease-out both" }}>
        💔
      </span>
    </div>
  );
}

/** Central pot display — always visible on the live table, not just during a reveal. */
export function TensionPot({ pot }: { pot: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full text-3xl sm:h-24 sm:w-24 sm:text-4xl"
        style={{
          background: "radial-gradient(circle at 35% 30%, #fbcfe8 0%, #ec4899 35%, #831843 75%, #1a0510 100%)",
          animation: "lwa-pot-glow-pulse 2.2s ease-in-out infinite",
        }}
        aria-hidden
      >
        💗
      </div>
      <span className="text-[11px] font-medium tracking-wide text-pink-200/70 uppercase">긴장 지수</span>
      <span className="text-2xl font-black text-pink-200 drop-shadow-[0_0_12px_rgba(236,72,153,0.7)] tabular-nums sm:text-3xl">
        💗 {pot}
      </span>
    </div>
  );
}

/** Full-screen red vignette + slammed death emblem — the request's KO/mutual-destruction beat. */
function DeathVignette({ loserNames }: { loserNames: string[] }) {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[95]"
        style={{
          background: "radial-gradient(ellipse at center, transparent 30%, rgba(120,0,20,0.55) 75%, rgba(0,0,0,0.9) 100%)",
          animation: "lwa-death-vignette-in 0.6s ease-out both",
        }}
      />
      <div
        className="relative z-10 flex flex-col items-center gap-2"
        style={{ animation: "lwa-death-emblem-slam 0.7s cubic-bezier(0.34,1.56,0.64,1) 0.15s both, lwa-death-shake 0.5s ease-out 0.55s both" }}
      >
        <span className="text-6xl drop-shadow-[0_0_25px_rgba(244,63,94,0.9)] sm:text-7xl">💀</span>
        <p className="text-lg font-black tracking-wide text-rose-200 sm:text-xl">
          {loserNames.length > 1 ? "동시 탈락 — 공동 파멸" : `${loserNames[0] ?? "상대"}님 탈락`}
        </p>
      </div>
    </>
  );
}

function NextRoundCountdown({ timeLeft, secondsTotal }: { timeLeft: number; secondsTotal: number }) {
  const pct = Math.max(0, Math.min(100, (timeLeft / secondsTotal) * 100));
  return (
    <div className="relative z-10 flex w-full max-w-xs flex-col items-center gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-white/50 uppercase">재경기 준비</span>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-pink-400 to-rose-500 transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
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
      className="relative z-10 mt-3 flex items-center gap-1.5 rounded-full border border-pink-500/50 bg-black/80 px-6 py-2.5 text-sm font-semibold text-white/90 backdrop-blur-sm transition hover:border-pink-400/70 hover:bg-black active:scale-95"
      style={{ animation: "lwa-skip-pulse-glow 1.8s ease-in-out infinite" }}
      aria-label="연출 스킵하고 바로 진행하기"
    >
      ⏩ 스킵
    </button>
  );
}

export interface RevealOverlayProps {
  result: RoundResultSnapshot;
  isGameOver: boolean;
  /** `null` while the match isn't over yet (an ordinary mutual-LOVE tie awaiting replay). */
  matchOutcome: MatchOutcome | null;
  names: Record<Seat, string>;
  viewerSeat: Seat;
  timeLeft: number;
  secondsTotal: number;
  /** Ends the reveal wait immediately — a no-op once the phase has already moved on, safe from more than one viewer pressing it near-simultaneously (mirrors showMeTheCoin's overlay). Also used as the "결과 확인" acknowledgement when `isGameOver`. */
  onSkip: () => void;
}

/**
 * The reveal — request's "선택 공개 및 생사 판정 연출 최소 3초 유지 + 직하단
 * [⏩ 스킵] 버튼" plus the death-game elimination beat. Every viewer (winner
 * and loser alike) sees the identical content, same principle as
 * showMeTheCoin's overlay.
 */
export default function RevealOverlay({ result, isGameOver, matchOutcome, names, viewerSeat, timeLeft, secondsTotal, onSkip }: RevealOverlayProps) {
  const hasSkippedRef = useRef(false);
  const lastTapRef = useRef(0);

  function triggerSkip() {
    if (hasSkippedRef.current) return;
    hasSkippedRef.current = true;
    onSkip();
  }

  // The final reveal has no next round for a host timer to drive forward
  // (unlike an ordinary tie, where `LoveWinsAllGame.tsx`'s host-only effect
  // dispatches `"continue"` after `secondsTotal`) — `onSkip` here is purely
  // local (see `LoveWinsAllBoard.tsx`'s `onGameEnd`), so each viewer's own
  // client can safely auto-confirm it after the same hold instead of
  // requiring an explicit tap, while the skip button/backdrop double-tap can
  // still end the wait sooner.
  useEffect(() => {
    if (!isGameOver) return;
    const t = setTimeout(triggerSkip, secondsTotal * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only per this reveal instance, same pattern as every other self-timing effect in this project's <Game>Effects.tsx files
  }, []);

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

  const isMutualLove = result.outcome === "mutualLove";
  const isBetrayal = result.outcome === "betrayal";
  const isMutualWar = result.outcome === "mutualWar";

  const loserNames = isBetrayal
    ? [names[result.winnerSeat === "p1" ? "p2" : "p1"]]
    : isMutualWar
      ? [names.p1, names.p2]
      : [];

  const headline = isBetrayal
    ? `💔 ${names[result.winnerSeat as Seat]}님의 배신 성공 — 단독 승리`
    : isMutualWar
      ? "💀 상호 파멸 — 둘 다 탈락"
      : matchOutcome === "mutualVictory"
        ? "💚 공동 승리! 서로의 신뢰를 끝까지 증명했습니다"
        : `💚 ${result.roundNumber}판 · 아름다운 신뢰 — 무승부, 재경기`;

  const body = (
    <div
      className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/85 p-4"
      style={{ animation: "lwa-overlay-in 0.35s ease-out both" }}
      onClick={handleBackdropTap}
    >
      {isMutualLove && (
        <>
          <HeartBurst />
          <ShieldPulse />
        </>
      )}
      {(isBetrayal || isMutualWar) && <BrokenHeartCrack />}

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-3 py-6 text-center">
        {(isBetrayal || isMutualWar) && loserNames.length > 0 && <DeathVignette loserNames={loserNames} />}

        <h2
          className={`text-xl font-extrabold sm:text-2xl ${
            isMutualLove ? "text-emerald-200 drop-shadow-[0_0_16px_rgba(52,211,153,0.7)]" : "text-rose-200 drop-shadow-[0_0_16px_rgba(244,63,94,0.7)]"
          }`}
        >
          {headline}
        </h2>

        <div className="flex items-center gap-4">
          {(["p1", "p2"] as const).map((seat) => (
            <div key={seat} className="flex flex-col items-center gap-1">
              <Avatar size={32} className={seat === result.winnerSeat ? "ring-2 ring-pink-300/80" : undefined} />
              <span className="text-xs text-white/70">
                {names[seat]}
                {seat === viewerSeat && <span className="text-emerald-300"> (나)</span>}
              </span>
              <span className="text-lg font-bold">{result.choices[seat] === "LOVE" ? "💚 LOVE" : "⚔️ WAR"}</span>
            </div>
          ))}
        </div>

        {result.potWon > 0 && <p className="text-sm text-pink-100">💗 판돈 {result.potWon}점 획득</p>}
        {isMutualLove && matchOutcome === null && <p className="text-xs text-white/50">판돈이 다음 판으로 이월되어 재경기합니다</p>}
        {isMutualWar && <p className="text-xs text-white/50">판돈은 아무에게도 돌아가지 않습니다</p>}

        <SkipButton onSkip={triggerSkip} />

        {isGameOver ? (
          <p className="mt-1 text-xs text-white/40">화면을 눌러 결과를 확인하세요</p>
        ) : (
          <NextRoundCountdown timeLeft={timeLeft} secondsTotal={secondsTotal} />
        )}
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
