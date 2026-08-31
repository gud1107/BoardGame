"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import type { CoinToken, RoundResultSnapshot, Seat } from "./engine";

/** How close together two backdrop taps must land to count as a double-tap skip gesture — same small pure helper `grid-poker/skipGesture.ts` defines, kept as its own copy here per ARCHITECTURE.md §2's "zero cross-game code coupling" rule rather than importing across game folders. */
const DOUBLE_TAP_SKIP_MS = 350;
function isDoubleTap(lastTapAt: number, now: number): boolean {
  return lastTapAt !== 0 && now - lastTapAt < DOUBLE_TAP_SKIP_MS;
}

/**
 * Death-game-themed full action FX suite — the rebuild request's "인게임 모든
 * 액션 비주얼 & 사운드 풀 이펙트": chip-submission sparks (`ChipClinkBurst`),
 * an ALL-IN slam emblem (`AllInEmblem`), a showdown light-pillar + gold burst
 * (`ShowdownOverlay`/`CoinBurst`), a winner's coin shower (`CoinShower`), and
 * an elimination vignette with shattering coin shards (`DeathVignette`).
 * Purely cosmetic, no game logic — same "portal a fixed overlay, self-time
 * via useEffect/setTimeout, let the caller's own fixed timer be the thing
 * that actually advances the reducer" split as `grid-poker/RoundResultOverlay.tsx`,
 * which the showdown overlay below is modeled on (including reusing its
 * `isDoubleTap`/skip-button gesture helper — cross-game *type-level* reuse of
 * a dependency-free pure helper, not a cross-game *state* coupling, so it
 * doesn't violate ARCHITECTURE.md §2's "게임 간 코드 결합 0" rule).
 *
 * This project had no audio pipeline when this file was first written (no
 * `<audio>`/Web Audio usage anywhere in any existing `<Game>Effects.tsx` —
 * confirmed by grep before writing this file) — every other title's "풀
 * 이펙트" requests had shipped as visual + haptic-feeling CSS choreography
 * only, so the "칩 충돌음" etc. the original request asked for was delivered
 * as a heavier, more percussive *visual* accent (a sharp scale-snap on the
 * chip/coin stack, a "thud" screen micro-shake on ALL-IN) rather than actual
 * sound. **That has since changed project-wide** (Grid Poker, Dalmuti, Las
 * Vegas, Love Wins All, Mine of Oblivion, etc. all now call
 * `@/lib/audio/soundEngine`'s `getSoundEngine()`), so the 2026-08-31
 * betting-UI/FX follow-up request's `BetBadge`/`CoinBlastSlam` below are the
 * first real SFX in this file (`playSmtcCoinBlastSlam`), triggered from
 * `ShowMeTheCoinBoard.tsx` alongside them — every FX added before that
 * follow-up remains visual-only, as documented above.
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

/** Vertical beams of light behind the two avatars on a showdown reveal — the request's "빛의 기둥(Light Pillar)". */
function LightPillars() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex justify-center gap-24 sm:gap-40">
      {[0, 1].map((i) => (
        <span
          key={i}
          className="h-64 w-10 sm:w-14"
          style={{
            background: "linear-gradient(to bottom, rgba(253,230,138,0.85), rgba(251,191,36,0.15) 60%, transparent)",
            animation: `smtc-light-pillar 1.1s ease-out ${(i * 0.1).toFixed(2)}s both`,
            filter: "blur(2px)",
          }}
        />
      ))}
    </div>
  );
}

const SHOWER_COIN_COUNT = 22;
const SHOWER_COINS = Array.from({ length: SHOWER_COIN_COUNT });

/** Dozens of gold coins raining from the pot down into the winner's side — the request's "코인 샤워(Coin Shower)" pot-recovery motion. `alignRight` mirrors the shower toward whichever seat visually sits on the right. */
function CoinShower({ alignRight }: { alignRight: boolean }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 flex h-full overflow-hidden ${alignRight ? "justify-end pr-6 sm:pr-16" : "justify-start pl-6 sm:pl-16"}`}
    >
      <div className="relative h-full w-28 sm:w-40">
        {SHOWER_COINS.map((_, i) => (
          <span
            key={i}
            className="absolute top-0 text-xl sm:text-2xl"
            style={
              {
                left: `${(i * 37) % 100}%`,
                animation: `smtc-coin-shower-fall ${(0.9 + (i % 5) * 0.12).toFixed(2)}s cubic-bezier(0.55,0,0.85,0.35) ${(i * 0.05).toFixed(2)}s both`,
              } as CSSProperties
            }
          >
            🪙
          </span>
        ))}
      </div>
    </div>
  );
}

/** Central pot/vault display — the request's "거대한 황금 코인 볼(Vault) & 누적 팟 카운터". Always visible on the live table, not just during a reveal. `clinkPulse` (a monotonic counter that bumps every time chips land in the pot — ante/bet/raise/call) replays a gold-spark burst each time it changes, the request's "코인을 걸거나 슬롯에 올릴 때 황금빛 스파크". */
export function VaultPot({ pot, clinkPulse }: { pot: number; clinkPulse: number }) {
  return (
    <div className="relative flex flex-col items-center gap-1">
      {clinkPulse > 0 && (
        <div key={clinkPulse} aria-hidden className="pointer-events-none absolute -top-2 flex h-24 w-24 items-center justify-center sm:h-28 sm:w-28">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className="absolute text-sm"
              style={{ "--angle": `${60 * i}deg`, animation: "smtc-chip-clink-spark 0.5s ease-out both" } as CSSProperties}
            >
              ✨
            </span>
          ))}
        </div>
      )}
      <div
        key={`vault-${clinkPulse}`}
        className="flex h-20 w-20 items-center justify-center rounded-full text-3xl sm:h-24 sm:w-24 sm:text-4xl"
        style={{
          background: "radial-gradient(circle at 35% 30%, #fef3c7 0%, #f59e0b 35%, #92400e 75%, #451a03 100%)",
          animation: `smtc-vault-glow-pulse 2.2s ease-in-out infinite${clinkPulse > 0 ? ", smtc-chip-clink-thud 0.35s ease-out" : ""}`,
        }}
        aria-hidden
      >
        🏆
      </div>
      <span className="text-[11px] font-medium tracking-wide text-amber-200/70 uppercase">누적 팟</span>
      <span className="text-2xl font-black text-amber-200 drop-shadow-[0_0_12px_rgba(251,191,36,0.7)] tabular-nums sm:text-3xl">
        🎰 {pot}
      </span>
    </div>
  );
}

/**
 * Bold neon "🎰 {amount}" badge — the betting-UI/FX rebuild request's live
 * opponent-bet-amount display ("굵은 네온 뱃지와 애니메이션으로 즉시 표시"),
 * mounted both on a seat's slot (`ShowMeTheCoinBoard.tsx`'s `PlayerPanel`)
 * and again in the table's center betting zone. `pulseKey` (bumped by the
 * caller every time the amount grows this street) is used as the React
 * `key` so the pop-in animation replays on every increase, not just mount —
 * same technique as `VaultPot`'s `clinkPulse`. Renders nothing at 0 (nothing
 * bet yet this street).
 */
export function BetBadge({ amount, pulseKey, size = "md" }: { amount: number; pulseKey: number; size?: "sm" | "md" }) {
  if (amount <= 0) return null;
  const sizeCls = size === "sm" ? "gap-0.5 px-2 py-0.5 text-xs" : "gap-1 px-2.5 py-1 text-sm";
  return (
    <span
      key={pulseKey}
      className={`inline-flex items-center rounded-full border border-amber-300/80 bg-gradient-to-r from-pink-500 to-amber-400 font-black text-black shadow-[0_0_16px_-2px_rgba(251,191,36,0.9)] tabular-nums ${sizeCls}`}
      style={{ animation: "smtc-bet-badge-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both" }}
    >
      🎰 {amount}
    </span>
  );
}

/**
 * §1 secret-commit status badge — the "상대 베팅 코인 수량이 노출되지 않는다"
 * bug report turned out (after `AskUserQuestion` confirmation) to point at
 * this phase, not the betting street: the player wants the *count* of coins
 * each side placed behind the screen to be visible in real time, while the
 * denominations/value stay secret until showdown ("금액만 비밀이고 개수는
 * 공개"). `count` must therefore only ever be `committed[seat]?.length` —
 * NEVER the coin values themselves — see `ShowMeTheCoinBoard.tsx`'s call
 * site. `pulseKey` bumps once when a seat's status flips from "대기" to
 * "배치완료" (same replay-on-`key` technique as `BetBadge`).
 */
export function CommitStatusBadge({ committed, count, pulseKey }: { committed: boolean; count: number; pulseKey: number }) {
  return (
    <span
      key={pulseKey}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-black tabular-nums shadow-[0_0_10px_-2px_rgba(234,179,8,0.6)] ${
        committed
          ? "border-yellow-500/80 bg-neutral-900/90 text-yellow-300"
          : "border-white/15 bg-neutral-900/70 text-white/50"
      }`}
      style={committed ? { animation: "smtc-bet-badge-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) both" } : undefined}
    >
      🪙 {committed ? `${count}개 배치완료` : "배치 대기"}
    </span>
  );
}

const BLAST_MAX_COINS = 9;

/**
 * Huge coin-bundle trajectory slamming from a seat's slot into the central
 * pot — the request's "Coin Blast Slam". `fromSide` picks the flight
 * direction (`"left"` = the seat rendered on the board's left flying
 * rightward to the vault, `"right"` = the reverse). `intensity` (0~1, this
 * bet's size relative to the bettor's own remaining stack going in) scales
 * the coin count and glow — an all-in reads as the biggest possible slam.
 * Absolutely positioned within the board's own (already `relative`)
 * container, not a portal — stays inside the board card, so it can never
 * visually collide with unrelated fixed UI (e.g. the room-betting FAB).
 * Self-hides via `onDone`, same self-timing pattern as `AllInEmblem`.
 */
export function CoinBlastSlam({
  fromSide,
  amount,
  intensity,
  onDone,
}: {
  fromSide: "left" | "right";
  amount: number;
  intensity: number;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, 750);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only per this instance, same pattern as every other self-timing effect in this file
  }, []);

  const amt = Math.max(0, Math.min(1, intensity));
  const coinCount = 4 + Math.round(amt * (BLAST_MAX_COINS - 4));
  const flyKeyframe = fromSide === "left" ? "smtc-coin-blast-fly-from-left" : "smtc-coin-blast-fly-from-right";

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30 overflow-visible">
      {Array.from({ length: coinCount }).map((_, i) => (
        <span
          key={i}
          className="absolute text-2xl sm:text-3xl"
          style={
            {
              "--jitter": `${(i - coinCount / 2) * 5}px`,
              animation: `${flyKeyframe} ${(0.42 + amt * 0.1).toFixed(2)}s cubic-bezier(0.2,0.85,0.3,1) ${(i * 0.02).toFixed(2)}s both`,
            } as CSSProperties
          }
        >
          🪙
        </span>
      ))}
      <span
        className="absolute top-1/2 left-1/2 whitespace-nowrap text-xl font-black text-amber-200 drop-shadow-[0_0_16px_rgba(251,191,36,0.9)] sm:text-2xl"
        style={{ animation: "smtc-bet-amount-popup 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.15s both" }}
      >
        🎰 +{amount}
      </span>
    </div>
  );
}

/**
 * Full-screen "[ 🔥 ALL-IN ]" scoreboard-slam emblem — the request's "올인
 * 선언 액션" FX. Self-hides after ~1.3s via `onDone`; purely decorative,
 * mounted from `ShowMeTheCoinBoard.tsx` whenever a seat's chip stack is
 * detected to have just hit 0 during the betting phase (a raise-shove or a
 * call-for-everything both count as "declaring all-in").
 */
export function AllInEmblem({ name, onDone }: { name: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only per this emblem instance, same pattern as every other self-timing effect in this project's <Game>Effects.tsx files
  }, []);

  if (typeof document === "undefined") return null;

  const body = (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[92] flex items-center justify-center">
      <div
        className="absolute h-40 w-40 rounded-full sm:h-56 sm:w-56"
        style={{ background: "radial-gradient(circle, rgba(251,146,60,0.55) 0%, rgba(244,63,94,0.25) 45%, transparent 75%)", animation: "smtc-allin-pulse-ring 1.1s ease-out both" }}
      />
      <div className="relative flex flex-col items-center gap-1" style={{ animation: "smtc-death-emblem-slam 0.6s cubic-bezier(0.34,1.56,0.64,1) both, smtc-death-shake 0.45s ease-out 0.5s both" }}>
        <span
          className="rounded-xl border-2 border-amber-300/80 bg-black/80 px-5 py-2 text-2xl font-black tracking-widest text-amber-200 drop-shadow-[0_0_22px_rgba(251,146,60,0.9)] sm:text-4xl"
          style={{ animation: "smtc-allin-flicker 1.1s ease-in-out both" }}
        >
          🔥 ALL-IN
        </span>
        <span className="text-sm font-bold text-white/80 sm:text-base">{name}님의 올인 선언!</span>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

const SHARD_COUNT = 10;
const SHARDS = Array.from({ length: SHARD_COUNT });

/** Full-screen red vignette + slammed death emblem + shattering coin fragments — the request's KO elimination beat ("붉은 비네트 암전 + 깨진 코인 파편 + 데스 엠블럼"). `isDraw` softens the copy for the (rulebook-silent, engine-documented) mutual-bust edge case where both seats are eliminated on the same tied round. */
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
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[96] flex items-center justify-center">
        {SHARDS.map((_, i) => (
          <span
            key={i}
            className="absolute text-xl sm:text-2xl"
            style={
              {
                "--angle": `${(360 / SHARD_COUNT) * i}deg`,
                animation: `smtc-coin-shard-shatter 0.9s cubic-bezier(0.3,0.9,0.4,1) ${(0.1 + i * 0.02).toFixed(2)}s both`,
              } as CSSProperties
            }
          >
            {i % 2 === 0 ? "🪙" : "💥"}
          </span>
        ))}
      </div>
      <div
        className="relative z-10 flex flex-col items-center gap-2"
        style={{ animation: "smtc-death-emblem-slam 0.7s cubic-bezier(0.34,1.56,0.64,1) 0.15s both, smtc-death-shake 0.5s ease-out 0.55s both" }}
      >
        <span className="text-6xl drop-shadow-[0_0_25px_rgba(244,63,94,0.9)] sm:text-7xl">💀</span>
        <p className="text-lg font-black tracking-wide text-rose-200 sm:text-xl">
          {isDraw ? "동시 탈락 — 무승부" : `[ 💀 ELIMINATED ] ${loserName ?? "상대"}님 탈락`}
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

function coinSumOf(coins: CoinToken[]): number {
  return coins.reduce((sum, c) => sum + c.value, 0);
}

/** Groups a revealed hand's coins by denomination (descending) for a compact "3×500 + 1×10" style readout instead of a wall of individual coin glyphs. */
function groupByValue(coins: CoinToken[]): { value: number; count: number }[] {
  const byValue = new Map<number, number>();
  for (const c of coins) byValue.set(c.value, (byValue.get(c.value) ?? 0) + 1);
  return [...byValue.entries()].sort((a, b) => b[0] - a[0]).map(([value, count]) => ({ value, count }));
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
 * plus the light-pillar/coin-shower/death-game elimination beats. Every
 * viewer (winner and loser alike) sees the identical content, same principle
 * as grid-poker's overlay.
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
      ? `${result.roundNumber}라운드 · 무승부 (칩 균등 분배)`
      : `👑 ${names[result.winnerSeat as Seat]}님 승리`;

  const body = (
    <div
      className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/85 p-4"
      style={{ animation: "smtc-overlay-in 0.35s ease-out both" }}
      onClick={handleBackdropTap}
    >
      {!isFold && <LightPillars />}
      {isDecisiveWin && <CoinBurst />}
      {isDecisiveWin && result.winnerSeat && <CoinShower alignRight={result.winnerSeat !== viewerSeat} />}
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
            {(["p1", "p2"] as const).map((seat) => {
              const hand = result.committed![seat];
              return (
                <div key={seat} className="flex flex-col items-center gap-1">
                  <Avatar size={32} className={seat === result.winnerSeat ? "ring-2 ring-amber-300/80" : undefined} />
                  <span className="text-xs text-white/70">
                    {names[seat]}
                    {seat === viewerSeat && <span className="text-emerald-300"> (나)</span>}
                  </span>
                  <span className="text-lg font-bold text-amber-100">🪙 {coinSumOf(hand)}</span>
                  <span className="text-[10px] text-white/40">
                    {groupByValue(hand)
                      .map((g) => `${g.value}×${g.count}`)
                      .join(" + ")}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {isTie ? (
          <p className="text-sm text-amber-100">
            💰 각자 {result.potWon}칩씩 획득{result.carriedOver > 0 && ` · ${result.carriedOver}칩은 다음 라운드로 이월`}
          </p>
        ) : (
          result.potWon > 0 && <p className="text-sm text-amber-100">💰 판돈 {result.potWon}칩 획득</p>
        )}

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
