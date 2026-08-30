"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import { HAND_CATEGORY_LABEL, SUIT_EMOJI, type RoundResultSnapshot, type Seat, type Suit } from "./engine";

/**
 * Death-game-themed showdown presentation for the rebuilt rulebook — see
 * `engine.ts`'s module doc for the full rules this renders. Purely
 * cosmetic, no game logic: mounts a fixed overlay, self-times via
 * useEffect/setTimeout, and lets the caller's own fixed host timer
 * (`LoveWinsAllGame.tsx`) be the thing that actually advances the reducer —
 * same split as every other `<Game>Effects.tsx` in this project, including
 * reusing `showMeTheCoin/ShowMeTheCoinEffects.tsx`'s double-tap-skip-gesture
 * helper as a dependency-free copy (ARCHITECTURE.md §2's "게임 간 코드 결합 0").
 *
 * Keyframes live in `globals.css` under the pre-existing `lwa-` prefix (see
 * that file's "러브 윈즈 올" section) — the old LOVE/WAR-themed ones
 * (heart-burst/shield-pulse, broken-heart-crack/death-vignette/emblem-slam)
 * are repurposed here rather than deleted: a heart burst now celebrates the
 * rare "러브 윈즈 올" hand (any variant's rank-1 category) landing at
 * showdown, and the death vignette now marks the match's final KO reveal —
 * both are still thematically apt for this rebuild, just retargeted.
 */

const DOUBLE_TAP_SKIP_MS = 350;
function isDoubleTap(lastTapAt: number, now: number): boolean {
  return lastTapAt !== 0 && now - lastTapAt < DOUBLE_TAP_SKIP_MS;
}

const HEART_PARTICLE_COUNT = 14;
const HEART_PARTICLES = Array.from({ length: HEART_PARTICLE_COUNT });

/** Radiating neon-pink heart particles — mounted only when someone's showdown hand is the rank-1 "러브 윈즈 올" category. */
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

function ShieldPulse() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ animation: "lwa-shield-pulse 1s ease-out both" }}>
      <div className="h-40 w-40 rounded-full border-4 border-emerald-300/70 sm:h-52 sm:w-52" />
    </div>
  );
}

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
export function ChipPot({ pot }: { pot: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full text-3xl sm:h-24 sm:w-24 sm:text-4xl"
        style={{
          background: "radial-gradient(circle at 35% 30%, #fef3c7 0%, #f59e0b 35%, #78350f 75%, #1a0510 100%)",
          animation: "lwa-pot-glow-pulse 2.2s ease-in-out infinite",
        }}
        aria-hidden
      >
        🪙
      </div>
      <span className="text-[11px] font-medium tracking-wide text-amber-200/70 uppercase">POT</span>
      <span className="text-2xl font-black text-amber-200 drop-shadow-[0_0_12px_rgba(245,158,11,0.7)] tabular-nums sm:text-3xl">🪙 {pot}</span>
    </div>
  );
}

function DeathVignette({ loserName }: { loserName: string }) {
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
        <p className="text-lg font-black tracking-wide text-rose-200 sm:text-xl">{loserName}님 칩 소진 — 탈락</p>
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
        <div className="h-full rounded-full bg-gradient-to-r from-pink-400 to-rose-500 transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
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

function CardChip({ suit, dim }: { suit: Suit; dim?: boolean }) {
  return (
    <span
      className={`flex h-10 w-8 flex-col items-center justify-center rounded-lg border text-lg sm:h-12 sm:w-10 sm:text-xl ${
        dim ? "border-white/10 bg-white/5 opacity-50" : "border-white/20 bg-black/40"
      }`}
    >
      {SUIT_EMOJI[suit]}
    </span>
  );
}

export interface RevealOverlayProps {
  result: RoundResultSnapshot;
  isGameOver: boolean;
  names: Record<Seat, string>;
  viewerSeat: Seat;
  timeLeft: number;
  secondsTotal: number;
  /** Ends the reveal wait immediately — a no-op once the phase has already moved on, safe from more than one viewer pressing it near-simultaneously. Also used as the "결과 확인" acknowledgement when `isGameOver`. */
  onSkip: () => void;
}

/** The §6 full-reveal showdown (or a §G fold's no-reveal variant) — request's "선택 공개 및 생사 판정 연출 최소 3초 유지 + 직하단 [⏩ 스킵] 버튼". Every viewer sees identical content. */
export default function RevealOverlay({ result, isGameOver, names, viewerSeat, timeLeft, secondsTotal, onSkip }: RevealOverlayProps) {
  const hasSkippedRef = useRef(false);
  const lastTapRef = useRef(0);

  function triggerSkip() {
    if (hasSkippedRef.current) return;
    hasSkippedRef.current = true;
    onSkip();
  }

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

  const isFold = result.outcome === "fold";
  const isTie = result.outcome === "tie";
  const isWin = result.outcome === "win";
  const jackpot = isWin && result.handRanks && Object.values(result.handRanks).some((c) => c === "loveWinsAll");
  // The only way `isGameOver` can coincide with a null `winnerSeat` is the
  // rare simultaneous double-KO (both chip stacks hit 0 at once) — see
  // engine.ts's `applyKoCheck`. Checked first so it never gets mislabeled as
  // an ordinary mid-match tie (which always has a next round to carry into).
  const isDoubleKoDraw = isGameOver && result.winnerSeat === null;

  const loserName = isWin && result.winnerSeat ? names[result.winnerSeat === "p1" ? "p2" : "p1"] : null;

  const headline = isDoubleKoDraw
    ? "💀 둘 다 동시에 칩 소진 — 무승부로 게임 종료"
    : isFold
      ? `🏳️ ${names[result.folderSeat as Seat]}님 폴드 — ${names[result.winnerSeat as Seat]}님이 팟을 가져갑니다`
      : isTie
        ? "🤝 무승부 — 팟이 다음 라운드로 이월됩니다"
        : jackpot
          ? `💗 러브 윈즈 올! ${names[result.winnerSeat as Seat]}님 압도적 승리`
          : `🏆 ${names[result.winnerSeat as Seat]}님 승리`;

  const body = (
    <div
      className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/85 p-4"
      style={{ animation: "lwa-overlay-in 0.35s ease-out both" }}
      onClick={handleBackdropTap}
    >
      {jackpot && (
        <>
          <HeartBurst />
          <ShieldPulse />
        </>
      )}
      {isGameOver && <BrokenHeartCrack />}

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-3 py-6 text-center">
        {isGameOver && loserName && <DeathVignette loserName={loserName} />}

        <h2
          className={`break-keep text-lg font-extrabold sm:text-xl ${
            isWin ? "text-amber-200 drop-shadow-[0_0_16px_rgba(245,158,11,0.7)]" : "text-white/90"
          }`}
        >
          {headline}
        </h2>

        {!isFold && result.hands && (
          <div className="flex items-start justify-center gap-5">
            {(["p1", "p2"] as const).map((seat) => (
              <div key={seat} className="flex flex-col items-center gap-1.5">
                <Avatar size={28} className={seat === result.winnerSeat ? "ring-2 ring-amber-300/80" : undefined} />
                <span className="max-w-[84px] truncate text-xs text-white/70">
                  {names[seat]}
                  {seat === viewerSeat && <span className="text-emerald-300"> (나)</span>}
                </span>
                <div className="flex gap-1">
                  {(result.hands![seat] ?? []).map((suit, i) => (
                    <CardChip key={i} suit={suit} />
                  ))}
                  {result.community && <CardChip suit={result.community} />}
                </div>
                <span className="text-xs font-bold text-white/80">{result.handRanks ? HAND_CATEGORY_LABEL[result.handRanks[seat]] : ""}</span>
                {result.declaredHand[seat] && (
                  <span className="text-[10px] text-white/40">선언: {HAND_CATEGORY_LABEL[result.declaredHand[seat]!]}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {result.potWon > 0 && <p className="text-sm text-amber-100">🪙 팟 {result.potWon} 획득</p>}
        {result.liarPenaltyPaid > 0 && <p className="text-xs text-rose-300">🃏 라이어 카드 패배 페널티 {result.liarPenaltyPaid} 추가 지불</p>}
        {isTie && <p className="text-xs text-white/50">팟이 아무에게도 분배되지 않고 다음 라운드로 넘어갑니다</p>}

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
