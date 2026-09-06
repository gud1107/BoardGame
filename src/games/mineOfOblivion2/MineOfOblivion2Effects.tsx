"use client";

import { useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import type { BombEvent, EventKind, LastEvent, Seat } from "./engine";

/** How close together two backdrop taps must land to count as a double-tap skip gesture — duplicated per-game per ARCHITECTURE.md §2 (see 1편's `grid-poker/skipGesture.ts` precedent). */
const DOUBLE_TAP_SKIP_MS = 350;
function isDoubleTap(lastTapAt: number, now: number): boolean {
  return lastTapAt !== 0 && now - lastTapAt < DOUBLE_TAP_SKIP_MS;
}

/**
 * 도착-판정 + 시한폭탄 폭발 연출. 1편의 지뢰 폭발(-5 + 강제 리스폰) / 보물
 * 순차 획득(+10/+15/+20) / 안전 칸 최초 공개(+N점) 3종은 그대로 유지하고,
 * 여기에 신규 시한폭탄 3×3 대폭발(화면 흔들림 + 9칸 화염 충격파 + 묵직한
 * 폭발음 + 반경 내 전원 -5, 아무도 없으면 설치자 +2) 연출을 추가한다. 한
 * 턴에 도착 판정과 시한폭탄 폭발이 동시에 일어날 수 있어(내 이동으로 다른
 * 곳의 시한폭탄이 카운트다운 만료), `RevealOverlay`는 `bombEvents` 배열을
 * 별도로 받아 도착 판정 패널 아래에 이어서 렌더링한다. Keyframes live in
 * `globals.css` under the `moo2-` prefix (per-game-keyframes convention).
 */

const FIRE_PARTICLE_COUNT = 16;
const FIRE_PARTICLES = Array.from({ length: FIRE_PARTICLE_COUNT });
const SPARKLE_PARTICLE_COUNT = 14;
const SPARKLE_PARTICLES = Array.from({ length: SPARKLE_PARTICLE_COUNT });
/** More particles than a regular mine's `FireBurst` — a 3×3 explosion reads as strictly bigger than a 1-tile mine hit. */
const MEGA_FIRE_PARTICLE_COUNT = 28;
const MEGA_FIRE_PARTICLES = Array.from({ length: MEGA_FIRE_PARTICLE_COUNT });

function FireBurst() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {FIRE_PARTICLES.map((_, i) => (
        <span
          key={i}
          className="absolute text-xl"
          style={{ "--angle": `${(360 / FIRE_PARTICLE_COUNT) * i}deg`, animation: `moo2-fire-particle 0.85s ease-out ${(i * 0.02).toFixed(2)}s both` } as CSSProperties}
        >
          {i % 3 === 0 ? "🔥" : i % 3 === 1 ? "💥" : "🟥"}
        </span>
      ))}
    </div>
  );
}

/** 시한폭탄 3×3 대폭발 전용 — 더 크고 더 오래, 더 많은 파티클로 화면 전체를 뒤덮는다. */
function MegaFireBurst() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {MEGA_FIRE_PARTICLES.map((_, i) => (
        <span
          key={i}
          className="absolute text-2xl sm:text-3xl"
          style={{ "--angle": `${(360 / MEGA_FIRE_PARTICLE_COUNT) * i}deg`, animation: `moo2-mega-fire-particle 1.15s ease-out ${(i * 0.018).toFixed(2)}s both` } as CSSProperties}
        >
          {i % 4 === 0 ? "🔥" : i % 4 === 1 ? "💥" : i % 4 === 2 ? "🧨" : "🟧"}
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
          style={{ "--angle": `${(360 / SPARKLE_PARTICLE_COUNT) * i}deg`, animation: `moo2-treasure-sparkle-particle 1s ease-out ${(i * 0.025).toFixed(2)}s both` } as CSSProperties}
        >
          {i % 2 === 0 ? "✨" : "💰"}
        </span>
      ))}
    </div>
  );
}

/** 지뢰 폭발(1편과 동일 연출). */
function MineBlastVignette({ mover, tile, respawnTile, names }: { mover: Seat; tile: string; respawnTile?: string; names: Record<Seat, string> }) {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[95]"
        style={{
          background: "radial-gradient(ellipse at center, transparent 25%, rgba(190,10,30,0.5) 70%, rgba(0,0,0,0.92) 100%)",
          animation: "moo2-red-flash-in 0.5s ease-out both, moo2-screen-shake 0.5s ease-out both",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 z-20 -translate-x-1/2 text-5xl font-black text-rose-400 drop-shadow-[0_0_18px_rgba(244,63,94,0.9)] sm:text-6xl"
        style={{ animation: "moo2-score-float-up 1.1s ease-out 0.15s both" }}
      >
        −5
      </span>
      <div className="relative z-10 flex flex-col items-center gap-2" style={{ animation: "moo2-mine-emblem-slam 0.65s cubic-bezier(0.34,1.56,0.64,1) 0.1s both" }}>
        <span className="text-6xl drop-shadow-[0_0_25px_rgba(244,63,94,0.9)] sm:text-7xl">💀</span>
        <p className="text-lg font-black tracking-wide text-rose-200 break-keep sm:text-xl">
          폭사! {names[mover]}님 {tile} 지뢰 명중
        </p>
        <p className="text-xs text-rose-100/70 break-keep">해당 칸 지뢰 전원 제거 · {respawnTile ?? "출발지 인근"}(으)로 강제 리스폰</p>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ animation: "moo2-respawn-warp 0.9s ease-in 0.35s both" }}>
        <span className="text-4xl">🌀</span>
      </div>
    </>
  );
}

/** 시한폭탄 3×3 대폭발 — 지뢰 폭발보다 강한 화면 흔들림(`moo2-mega-shake`) + 훨씬 넓은 화염 충격파. 반경 내에 아무도 없으면(안전 회피) 설치자 +2 보너스를, 있으면 걸린 전원 -5를 표시한다. */
function BombBlastVignette({ event, names }: { event: BombEvent; names: Record<Seat, string> }) {
  const safelyAvoided = event.hitSeats.length === 0;
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[95]"
        style={{
          background: "radial-gradient(ellipse at center, transparent 15%, rgba(251,146,60,0.55) 55%, rgba(0,0,0,0.94) 100%)",
          animation: "moo2-orange-flash-in 0.55s ease-out both, moo2-mega-shake 0.65s ease-out both",
        }}
      />
      <MegaFireBurst />
      <div className="relative z-10 flex flex-col items-center gap-2" style={{ animation: "moo2-bomb-emblem-slam 0.7s cubic-bezier(0.34,1.56,0.64,1) 0.1s both" }}>
        <span className="text-7xl drop-shadow-[0_0_30px_rgba(251,146,60,0.95)] sm:text-8xl">🧨</span>
        <p className="text-lg font-black tracking-wide text-amber-100 break-keep sm:text-xl">
          💥 {names[event.owner]}님의 시한폭탄 폭발! ({event.tile} 중심 3×3)
        </p>
        {safelyAvoided ? (
          <p className="text-sm font-bold text-emerald-300 break-keep">아무도 반경에 없었음 · {names[event.owner]}님 +{event.ownerBonus}점</p>
        ) : (
          <p className="text-sm font-bold text-rose-300 break-keep">{event.hitSeats.map((s) => names[s]).join(", ")}님 반경 피격 · 각 −5점 + 강제 리스폰</p>
        )}
      </div>
      {event.hitSeats.length > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[28%] z-20 -translate-x-1/2 text-5xl font-black text-rose-400 drop-shadow-[0_0_18px_rgba(244,63,94,0.9)] sm:text-6xl"
          style={{ animation: "moo2-score-float-up 1.1s ease-out 0.2s both" }}
        >
          −5
        </span>
      )}
    </>
  );
}

function RevealPulse({ scoreGained }: { scoreGained: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="absolute h-24 w-24 rounded-full border-4 border-emerald-400/70" style={{ animation: "moo2-safe-pulse-ring 0.9s ease-out both" }} />
      <span className="absolute h-24 w-24 rounded-full border-4 border-emerald-400/50" style={{ animation: "moo2-safe-pulse-ring 0.9s ease-out 0.15s both" }} />
      <span className="relative text-4xl">🟢</span>
      {scoreGained > 0 && (
        <span
          className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 text-3xl font-black text-amber-300 drop-shadow-[0_0_14px_rgba(251,191,36,0.8)] sm:text-4xl"
          style={{ animation: "moo2-score-float-up 1s ease-out 0.1s both" }}
        >
          +{scoreGained}
        </span>
      )}
    </div>
  );
}

function TreasureChestBurst({ points }: { points: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <TreasureSparkle />
      <span className="relative text-7xl drop-shadow-[0_0_30px_rgba(251,191,36,0.9)] sm:text-8xl" style={{ animation: "moo2-chest-open-slam 0.7s cubic-bezier(0.34,1.56,0.64,1) both" }}>
        📦
      </span>
      <span
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 text-4xl font-black text-amber-300 drop-shadow-[0_0_18px_rgba(251,191,36,0.9)] sm:text-5xl"
        style={{ animation: "moo2-score-float-up 1.1s ease-out 0.2s both" }}
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
      className="relative z-10 mt-3 flex items-center gap-1.5 rounded-full border border-orange-500/50 bg-black/80 px-6 py-2.5 text-sm font-semibold text-white/90 backdrop-blur-sm transition hover:border-orange-400/70 hover:bg-black active:scale-95"
      style={{ animation: "moo2-skip-pulse-glow 1.8s ease-in-out infinite" }}
      aria-label="연출 스킵하고 바로 진행하기"
    >
      ⏩ 스킵
    </button>
  );
}

export interface RevealOverlayProps {
  event: LastEvent;
  bombEvents: BombEvent[];
  names: Record<Seat, string>;
  viewerSeat: Seat;
  isGameOver: boolean;
  winner: Seat | null;
  isDraw: boolean;
  timeLeft: number;
  secondsTotal: number;
  onSkip: () => void;
}

const EVENT_HEADLINE: Record<EventKind, (names: Record<Seat, string>, ev: LastEvent) => string> = {
  reveal: (names, ev) => (ev.alreadyVisited ? `${names[ev.actor]}님 · ${ev.tile} 이미 탐사된 칸 · 0점` : `${names[ev.actor]}님 · ${ev.tile} 최초 공개`),
  treasure: (names, ev) => `💎 ${names[ev.actor]}님 ${ev.treasureOrder}번째 보물 획득!`,
  mine: () => "",
};

export default function RevealOverlay({ event, bombEvents, names, viewerSeat, isGameOver, winner, isDraw, timeLeft, secondsTotal, onSkip }: RevealOverlayProps) {
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
  const hasBombs = bombEvents.length > 0;
  const pct = Math.max(0, Math.min(100, (timeLeft / secondsTotal) * 100));

  const body = (
    <div
      className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/85 p-4"
      style={{ animation: "moo2-overlay-in 0.3s ease-out both" }}
      onClick={handleBackdropTap}
    >
      {isMine && !hasBombs && <FireBurst />}

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-3 py-6 text-center">
        {isMine && (
          <MineBlastVignette mover={event.actor} tile={event.tile} respawnTile={event.respawnTile} names={names} />
        )}
        {!isMine && isTreasure && (
          <>
            <TreasureChestBurst points={event.treasurePoints ?? 0} />
            <h2 className="text-xl font-extrabold text-amber-200 drop-shadow-[0_0_16px_rgba(251,191,36,0.8)] break-keep sm:text-2xl">{EVENT_HEADLINE.treasure(names, event)}</h2>
          </>
        )}
        {!isMine && !isTreasure && (
          <>
            <RevealPulse scoreGained={event.scoreGained ?? 0} />
            <h2 className={`text-xl font-extrabold break-keep sm:text-2xl ${event.alreadyVisited ? "text-white/50" : "text-emerald-200 drop-shadow-[0_0_16px_rgba(52,211,153,0.7)]"}`}>
              {EVENT_HEADLINE.reveal(names, event)}
            </h2>
          </>
        )}

        {bombEvents.map((be) => (
          <div key={be.bombId} className="relative flex w-full flex-col items-center">
            <BombBlastVignette event={be} names={names} />
          </div>
        ))}

        {isGameOver && <p className="text-sm font-semibold text-white/80 break-keep">{isDraw ? "🤝 무승부" : `🏆 ${names[winner as Seat]}님 최종 승리`}</p>}

        <SkipButton onSkip={triggerSkip} />

        {isGameOver ? (
          <p className="mt-1 text-xs text-white/40">화면을 눌러 결과를 확인하세요{viewerSeat ? "" : ""}</p>
        ) : (
          <div className="relative z-10 flex w-full max-w-xs flex-col items-center gap-1.5">
            <span className="text-[11px] font-medium tracking-wide text-white/50 uppercase">다음 턴 준비</span>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-rose-500 transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

/** Small always-visible avatar+HUD strip for one seat — score/treasure/mine-hit/bomb stats. */
export function SeatHud({
  seat,
  name,
  score,
  treasuresClaimed,
  mineHitsTaken,
  bombHitsTaken,
  bombsSafelyDetonated,
  isActive,
  connected,
}: {
  seat: Seat;
  name: string;
  score: number;
  treasuresClaimed: number;
  mineHitsTaken: number;
  bombHitsTaken: number;
  bombsSafelyDetonated: number;
  isActive: boolean;
  connected: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 transition ${isActive ? "border-orange-400/50 bg-orange-500/10" : "border-white/10 bg-white/[0.03]"}`}>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-white break-keep">
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
        <span title="시한폭탄 피격 횟수">🧨 {bombHitsTaken}</span>
        <span title="안전하게 터진 내 시한폭탄">🛡️ {bombsSafelyDetonated}</span>
      </span>
      <span className="sr-only">{seat}</span>
    </div>
  );
}

/** 본인이 설치한 시한폭탄 전용 째깍이는 카운트다운 배지 — 남은 턴이 1 이하면 붉게 경고, 그 외엔 호박색. */
export function BombTickBadge({ remaining, size = 15 }: { remaining: number; size?: number }) {
  const urgent = remaining <= 1;
  return (
    <span
      className={`absolute inset-0 flex items-center justify-center rounded-full border font-black moo2-bomb-tick ${
        urgent ? "border-rose-400/80 bg-rose-500/30 text-rose-100" : "border-amber-400/70 bg-amber-500/25 text-amber-100"
      }`}
      style={{ fontSize: size * 0.62 }}
      title={`남은 턴: ${remaining}`}
    >
      {remaining}
    </span>
  );
}
