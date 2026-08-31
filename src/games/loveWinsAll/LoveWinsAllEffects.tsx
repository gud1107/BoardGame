"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import { getSoundEngine } from "@/lib/audio/soundEngine";
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
 * are repurposed here rather than deleted: a heart burst + shield now
 * celebrates every decisive round win (`isWin`), and the death vignette
 * still marks the match's final KO reveal — both are still thematically apt
 * for this rebuild, just retargeted.
 *
 * 2026-08-31 세션 — 실시간 족보 표시 + 액션 이펙트 강화 (요청의 "게임 전반
 * 액션 비주얼/사운드 이펙트" 항목, 이 게임엔 이전까지 SFX가 전혀 없었다):
 * added `ClashPulse` (쇼다운 카드 공개 순간의 스파크 충돌, 폴드가 아니면
 * 항상) and `RoundLossImpact` (매 라운드 패배마다 패자 클라이언트에서만
 * 재생되는 가벼운 크랙+화면 흔들림+붉은 플래시 — 최종 KO의 무거운
 * `DeathVignette`와는 별개), plus a mount-only SFX effect wiring both to
 * `soundEngine.ts`'s new `playLwa*` methods. See `CombinationBadge.tsx` for
 * the companion "실시간 족보 뱃지" (family lives in this same folder but
 * renders inline on the board, not inside this reveal overlay).
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

const CLASH_SPARK_COUNT = 10;
const CLASH_SPARKS = Array.from({ length: CLASH_SPARK_COUNT });

/** Request's "페어링/쇼다운 대결 스파크 충돌(Clash Pulse)" — a bright center flash plus radiating spark glyphs, mounted the instant both hands are revealed (any non-fold outcome, win or tie alike — a fold never reveals cards, so there's nothing to "clash"). */
function ClashPulse() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span
        className="absolute h-24 w-24 rounded-full sm:h-32 sm:w-32"
        style={{
          background: "radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(236,72,153,0.55) 45%, transparent 72%)",
          animation: "lwa-clash-flash 0.4s ease-out both",
        }}
      />
      {CLASH_SPARKS.map((_, i) => (
        <span
          key={i}
          className="absolute text-base sm:text-lg"
          style={
            {
              "--angle": `${(360 / CLASH_SPARK_COUNT) * i}deg`,
              animation: `lwa-clash-spark-particle 0.5s ease-out ${(i * 0.01).toFixed(2)}s both`,
            } as CSSProperties
          }
        >
          ⚡
        </span>
      ))}
    </div>
  );
}

/** Request's "배신/처치/실패(Betray/Death)" reaction — but repurposed for this rebuild's actual mechanic (see module doc): a lighter, per-round-loss flash+shake+crack for whichever client just lost *this round's* showdown, distinct from `DeathVignette`'s heavier one-time final-KO treatment below. Only ever mounted on the losing viewer's own client (see `RevealOverlay`'s `iLostThisRound`), never the winner's. */
function RoundLossImpact() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[92]"
        style={{
          background: "radial-gradient(ellipse at center, transparent 35%, rgba(190,18,60,0.4) 100%)",
          animation: "lwa-round-loss-vignette-flash 0.6s ease-out both",
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="text-6xl sm:text-7xl" style={{ animation: "lwa-crack-in 0.5s ease-out both" }}>
          💔
        </span>
      </div>
    </>
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
  const isFold = result.outcome === "fold";
  const isTie = result.outcome === "tie";
  const isWin = result.outcome === "win";
  const jackpot = isWin && result.handRanks && Object.values(result.handRanks).some((c) => c === "loveWinsAll");
  // The only way `isGameOver` can coincide with a null `winnerSeat` is the
  // rare simultaneous double-KO (both chip stacks hit 0 at once) — see
  // engine.ts's `applyKoCheck`. Checked first so it never gets mislabeled as
  // an ordinary mid-match tie (which always has a next round to carry into).
  const isDoubleKoDraw = isGameOver && result.winnerSeat === null;
  /** This *specific* viewer's round-loss reaction (see `RoundLossImpact`'s doc) — only true on the losing client, never the winner's or a tie/fold. */
  const iLostThisRound = isWin && !isDoubleKoDraw && result.winnerSeat !== viewerSeat;

  const loserName = isWin && result.winnerSeat ? names[result.winnerSeat === "p1" ? "p2" : "p1"] : null;

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

  // Request's "카드 제출 및 충돌 연출" SFX — a `ClashPulse` spark the instant
  // both hands are shown (any non-fold outcome), then ~350ms later (letting
  // the clash read first) an outcome-specific stinger: this viewer's own
  // win fanfare, this viewer's own round-loss impact, or — once — the
  // heavier final-KO boom. Every branch reads props already fixed for this
  // reveal instance, so mount-only (`[]`) is correct: this component only
  // ever (re)mounts when `LoveWinsAllBoard.tsx` starts a *new* reveal (its
  // phase-gated conditional render), never mid-reveal for the same result.
  useEffect(() => {
    const engine = getSoundEngine();
    engine.unlock();
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!isFold) {
      engine.playLwaClashSpark();
      timers.push(
        setTimeout(() => {
          if (isTie || isDoubleKoDraw) return;
          if (result.winnerSeat === viewerSeat) engine.playLwaVictoryFanfare(Boolean(jackpot));
          else engine.playLwaRoundLossImpact();
        }, 350),
      );
    }
    if (isGameOver) timers.push(setTimeout(() => engine.playLwaFinalKoImpact(), 550));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only per this reveal instance, same rationale as the skip-timer effect above
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
      {!isFold && <ClashPulse />}
      {/* Request's "상호 성공(Love/Win)" flourish — every decisive round win, not just the rare loveWinsAll jackpot (which additionally gets the bigger fanfare chord above and its own headline). */}
      {isWin && (
        <>
          <HeartBurst />
          <ShieldPulse />
        </>
      )}
      {iLostThisRound && <RoundLossImpact />}
      {isGameOver && <BrokenHeartCrack />}

      <div
        className="relative z-10 flex w-full max-w-sm flex-col items-center gap-3 py-6 text-center"
        style={iLostThisRound ? { animation: "lwa-death-shake 0.5s ease-out both" } : undefined}
      >
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
