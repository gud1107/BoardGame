"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import type { RoundResultSnapshot, Seat } from "./engine";

/** How close together two backdrop taps must land to count as a double-tap skip gesture — same small pure helper `grid-poker/skipGesture.ts` defines, kept as its own copy here per ARCHITECTURE.md §2's "zero cross-game code coupling" rule rather than importing across game folders. */
const DOUBLE_TAP_SKIP_MS = 350;
function isDoubleTap(lastTapAt: number, now: number): boolean {
  return lastTapAt !== 0 && now - lastTapAt < DOUBLE_TAP_SKIP_MS;
}

/**
 * Death-game-themed showdown/elimination presentation — the request's "코인
 * 오픈 시 화려한 황금 코인 분출 파티클" (§3 이하) and "탈락자 발생 시 화면 붉은
 * 비네트 암전 + 데스 엠블럼 슬램" (§4 KO). Purely cosmetic, no game logic —
 * same "portal a fixed overlay, self-time via useEffect/setTimeout, let the
 * caller's own fixed timer be the thing that actually advances the reducer"
 * split as `grid-poker/RoundResultOverlay.tsx`, which this is modeled on
 * (including reusing its `isDoubleTap`/skip-button gesture helper —
 * cross-game *type-level* reuse of a dependency-free pure helper, not a
 * cross-game *state* coupling, so it doesn't violate ARCHITECTURE.md §2's
 * "게임 간 코드 결합 0" rule).
 *
 * Keyframes live in `globals.css` under the `smtc-` prefix (see that file's
 * "쇼미더코인" section) — same per-game-keyframes convention as every other
 * `<Game>Effects.tsx` in this project.
 */

const GOLD_PARTICLE_COUNT = 14;
const GOLD_PARTICLES = Array.from({ length: GOLD_PARTICLE_COUNT });

/** Radiating gold coin particles — mounted only behind a decisive (non-tie, non-fold) win reveal. */
function CoinBurst() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {GOLD_PARTICLES.map((_, i) => (
        <span
          key={i}
          className="absolute text-lg"
          style={
            {
              "--angle": `${(360 / GOLD_PARTICLE_COUNT) * i}deg`,
              animation: `smtc-coin-burst-particle 0.9s ease-out ${(i * 0.03).toFixed(2)}s both`,
            } as CSSProperties
          }
        >
          🪙
        </span>
      ))}
    </div>
  );
}

/** Central pot/vault display — the request's "거대한 황금 코인 볼(Vault) & 누적 팟 카운터". Always visible on the live table, not just during a reveal. */
export function VaultPot({ pot }: { pot: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full text-3xl sm:h-24 sm:w-24 sm:text-4xl"
        style={{
          background: "radial-gradient(circle at 35% 30%, #fef3c7 0%, #f59e0b 35%, #92400e 75%, #451a03 100%)",
          animation: "smtc-vault-glow-pulse 2.2s ease-in-out infinite",
        }}
        aria-hidden
      >
        🏆
      </div>
      <span className="text-[11px] font-medium tracking-wide text-amber-200/70 uppercase">누적 팟</span>
      <span className="text-2xl font-black text-amber-200 drop-shadow-[0_0_12px_rgba(251,191,36,0.7)] tabular-nums sm:text-3xl">
        🪙 {pot}
      </span>
    </div>
  );
}

/** Full-screen red vignette + slammed death emblem — the request's KO elimination beat. `isDraw` softens the copy for the (rulebook-silent, engine-documented) mutual-bust edge case where both seats hit 0 on a tied round. */
function DeathVignette({ isDraw, loserName }: { isDraw: boolean; loserName: string | null }) {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[95]"
        style={{
          background: "radial-gradient(ellipse at center, transparent 30%, rgba(120,0,20,0.55) 75%, rgba(0,0,0,0.9) 100%)",
          animation: "smtc-death-vignette-in 0.6s ease-out both",
        }}
      />
      <div
        className="relative z-10 flex flex-col items-center gap-2"
        style={{ animation: "smtc-death-emblem-slam 0.7s cubic-bezier(0.34,1.56,0.64,1) 0.15s both, smtc-death-shake 0.5s ease-out 0.55s both" }}
      >
        <span className="text-6xl drop-shadow-[0_0_25px_rgba(244,63,94,0.9)] sm:text-7xl">💀</span>
        <p className="text-lg font-black tracking-wide text-rose-200 sm:text-xl">
          {isDraw ? "동시 탈락 — 무승부" : `${loserName ?? "상대"}님 탈락`}
        </p>
      </div>
    </>
  );
}

function NextRoundCountdown({ timeLeft, secondsTotal }: { timeLeft: number; secondsTotal: number }) {
  const pct = Math.max(0, Math.min(100, (timeLeft / secondsTotal) * 100));
  return (
    <div className="relative z-10 flex w-full max-w-xs flex-col items-center gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-white/50 uppercase">다음 라운드 준비</span>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-500 transition-[width] duration-1000 ease-linear"
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
      className="relative z-10 mt-3 flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-black/80 px-6 py-2.5 text-sm font-semibold text-white/90 backdrop-blur-sm transition hover:border-amber-400/70 hover:bg-black active:scale-95"
      style={{ animation: "smtc-skip-pulse-glow 1.8s ease-in-out infinite" }}
      aria-label="연출 스킵하고 바로 진행하기"
    >
      ⏩ 스킵
    </button>
  );
}

export interface ShowdownOverlayProps {
  result: RoundResultSnapshot;
  /** Whether this same reveal is also the match's final KO — swaps the "다음 라운드" countdown for the death vignette + a confirm button. */
  isGameOver: boolean;
  /** Only meaningful when `isGameOver` — `null` for the confirmed-draw edge case (module doc / engine.ts's `applyKoCheck`). */
  gameLoserSeat: Seat | null;
  names: Record<Seat, string>;
  viewerSeat: Seat;
  timeLeft: number;
  secondsTotal: number;
  /** Ends the showdown wait immediately — a no-op once the phase has already moved on, safe from more than one viewer pressing it near-simultaneously (mirrors grid-poker's `RoundResultOverlay`). Also used as the "결과 확인" acknowledgement when `isGameOver`. */
  onSkip: () => void;
}

/**
 * The showdown reveal — request's "결과/연출 3초 유지 + 직하단 [⏩ 스킵] 버튼"
 * plus the death-game elimination beat. Every viewer (winner and loser alike)
 * sees the identical content, same principle as grid-poker's overlay.
 */
export default function ShowdownOverlay({
  result,
  isGameOver,
  gameLoserSeat,
  names,
  viewerSeat,
  timeLeft,
  secondsTotal,
  onSkip,
}: ShowdownOverlayProps) {
  const hasSkippedRef = useRef(false);
  const lastTapRef = useRef(0);

  function triggerSkip() {
    if (hasSkippedRef.current) return;
    hasSkippedRef.current = true;
    onSkip();
  }

  // The final KO reveal has no next round for a host timer to drive forward
  // (unlike an ordinary showdown, where `ShowMeTheCoinGame.tsx`'s host-only
  // effect dispatches `"continue"` after `secondsTotal`) — `onSkip` here is
  // purely local (see `ShowMeTheCoinBoard.tsx`'s `onGameEnd`), so each
  // viewer's own client can safely auto-confirm it after the same ~3s hold
  // instead of requiring an explicit tap, while the skip button/backdrop
  // double-tap can still end the wait sooner.
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

  const isDecisiveWin = result.outcome === "win" && result.winnerSeat !== null;
  const isFold = result.outcome === "fold";
  const isTie = result.outcome === "tie";

  const headline = isFold
    ? `${names[result.folderSeat as Seat]}님이 폴드했습니다`
    : isTie
      ? `${result.roundNumber}라운드 · 무승부`
      : `👑 ${names[result.winnerSeat as Seat]}님 승리`;

  const body = (
    <div
      className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/85 p-4"
      style={{ animation: "smtc-overlay-in 0.35s ease-out both" }}
      onClick={handleBackdropTap}
    >
      {isDecisiveWin && <CoinBurst />}
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-3 py-6 text-center">
        {isGameOver ? (
          <DeathVignette isDraw={gameLoserSeat === null} loserName={gameLoserSeat ? names[gameLoserSeat] : null} />
        ) : null}

        <h2
          className={`text-xl font-extrabold sm:text-2xl ${
            isFold ? "text-white/70" : isTie ? "text-white/70" : "text-amber-200 drop-shadow-[0_0_16px_rgba(251,191,36,0.8)]"
          }`}
        >
          {headline}
        </h2>

        {!isFold && result.committed && (
          <div className="flex items-center gap-4">
            {(["p1", "p2"] as const).map((seat) => (
              <div key={seat} className="flex flex-col items-center gap-1">
                <Avatar size={32} className={seat === result.winnerSeat ? "ring-2 ring-amber-300/80" : undefined} />
                <span className="text-xs text-white/70">
                  {names[seat]}
                  {seat === viewerSeat && <span className="text-emerald-300"> (나)</span>}
                </span>
                <span className="text-lg font-bold text-amber-100">🪙 {result.committed?.[seat]}</span>
              </div>
            ))}
          </div>
        )}

        {result.potWon > 0 && <p className="text-sm text-amber-100">💰 판돈 {result.potWon}코인 획득</p>}
        {isTie && <p className="text-xs text-white/50">판돈이 다음 라운드로 이월됩니다</p>}

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
