"use client";

/**
 * 페루도 핵심 액션 버튼([베팅확정]/[맞아(Calza)]/[페루도(Dudo)]) 연출 고도화
 * (2026-09-20 세션, 사용자의 상세 스펙 요청). 세 조각으로 나뉜다:
 *
 * 1. `detectBetConfirmEvent`/`detectShowdownEvent` — Coyote의
 *    `detectCoyoteCallEvent`, Dalmuti의 `detectPlayImpactEvents`와 동일한
 *    순수 상태-diff 감지 함수. 로컬 클릭이 아니라 실제 락스텝 상태 전이를
 *    비교해서 트리거하므로, 맞아!/페루도! 같은 "모두가 봐야 하는" 선언은
 *    호출한 사람뿐 아니라 모든 클라이언트에서 동일하게 동기 재생된다.
 * 2. `PerudoFxButton` — Dalmuti의 `FxButton`과 동일한 기법(누르는 즉시
 *    scale-95 + 리플 + 방사형 스파크 파티클)을 페루도 전용 팔레트로 복제한
 *    드롭인 버튼 래퍼. 순수 로컬/즉시 피드백이라 사운드는 가벼운
 *    `playUiClickTick()` 하나만 — 크고 개성 있는 액션별 사운드(스탬프/차임/
 *    천둥)는 §1의 상태-diff 트리거에서 재생돼 클릭과 확정 사이 중복 재생을
 *    피한다.
 * 3. `PerudoShowdownOverlay` — [맞아]/[페루도] 선언 시 전체 화면을 덮는
 *    시네마틱 팝업(에메랄드/크림슨 엠블럼 + 충격파 + 스파크). `createPortal`로
 *    `document.body`에 직접 마운트 — Coyote의 `DeathStampOverlay`/
 *    `CoyoteHowlBanner`와 동일 기법.
 *
 * 화면 흔들림([페루도])과 줌인([맞아])은 이 파일이 아니라 `PerudoBoard.tsx`가
 * 자신의 루트 패널에 직접 인라인 `animation` 스타일로 건다(다르무티의
 * `shake` state/스타일 적용 패턴과 동일) — 이 오버레이는 화면 중앙 팝업만
 * 책임진다.
 */

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import type { PerudoState } from "./engine";

export type PerudoShowdownKind = "dudo" | "calza";

/**
 * A bid just landed while still in the "playing" phase — fires for whoever's
 * bid it is, on every connected client (not just the bidder), so the gold
 * stamp reads as "the table's shared bid just changed" rather than a
 * local-only click effect. `prev`/`next` are the same lockstep `PerudoState`
 * snapshots every other detector in this project diffs (see module doc).
 */
export function detectBetConfirmEvent(prev: PerudoState, next: PerudoState): boolean {
  if (prev === next) return false;
  if (next.phase !== "playing" || !next.currentBid) return false;
  if (!prev.currentBid) return true;
  const a = prev.currentBid;
  const b = next.currentBid;
  return a.seat !== b.seat || a.face !== b.face || a.quantity !== b.quantity;
}

/**
 * "페루도!"/"맞아!"가 방금 판정을 마쳐 `reveal` 단계로 넘어간 순간 — 그 판정의
 * 종류(`lastResolution.kind`)를 그대로 돌려준다. `engine.ts`의 `dudo()`/
 * `calza()`가 항상 이 전이 안에서 `lastResolution`을 함께 채우므로 별도 null
 * 체크 없이 바로 읽어도 안전.
 *
 * `next.phase === "gameOver"`도 함께 체크하는 이유(2026-09-20, 실제
 * Playwright 스크린샷으로 발견): `engine.ts`의 `applyResolution`은 그 판정으로
 * 한 명만 남으면 `reveal`을 아예 거치지 않고 `playing`에서 곧장 `gameOver`로
 * 전이시킨다(같은 함수, 같은 `if (alive.length <= 1)` 분기). 이 체크가
 * `"reveal"`만 봤을 때는 경기를 끝내는, 가장 극적이어야 할 바로 그 마지막
 * 페루도!/맞아! 선언에서만 쇼다운 연출이 통째로 빠지는 결과가 나왔다.
 */
export function detectShowdownEvent(prev: PerudoState, next: PerudoState): PerudoShowdownKind | null {
  if (prev === next) return null;
  if (prev.phase === "playing" && (next.phase === "reveal" || next.phase === "gameOver") && next.lastResolution) {
    return next.lastResolution.kind;
  }
  return null;
}

// ---------------------------------------------------------------------------
// PerudoFxButton — 버튼 자체의 누름 피드백(스케일 + 리플 + 스파크)
// ---------------------------------------------------------------------------

export type PerudoFxVariant = "gold" | "emerald" | "crimson";

const FX_VARIANT_STYLE: Record<PerudoFxVariant, { glow: string; spark: string }> = {
  gold: { glow: "rgba(253,224,71,0.55)", spark: "#fde047" },
  emerald: { glow: "rgba(16,185,129,0.55)", spark: "#34d399" },
  crimson: { glow: "rgba(239,68,68,0.55)", spark: "#f87171" },
};

const FX_PARTICLE_COUNT = 8;
const FX_PARTICLES = Array.from({ length: FX_PARTICLE_COUNT });

interface FxRipple {
  id: number;
  x: number;
  y: number;
  size: number;
}

/**
 * Drop-in `<button>` replacement, modeled 1:1 on Dalmuti's `FxButton`
 * (`src/games/dalmuti/DalmutiEffects.tsx`) but re-implemented here rather
 * than imported — per-game zero-coupling convention (see this file's own
 * `useIsMobile.ts`-style precedent elsewhere in this project). Forwards
 * every prop straight through, so the 3 existing buttons' carefully-tuned
 * mobile sizing (`min-h-[36px]`, `flex-1`, `whitespace-nowrap`, etc. from the
 * previous session) survives untouched — this only ADDS the press feedback
 * as an absolutely-positioned overlay sibling plus a conditional
 * `scale-95` class, never touches layout.
 */
export function PerudoFxButton({
  variant,
  className = "",
  onClick,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant: PerudoFxVariant }) {
  const [ripples, setRipples] = useState<FxRipple[]>([]);
  const [pressed, setPressed] = useState(false);
  const nextRippleId = useRef(0);
  const palette = FX_VARIANT_STYLE[variant];

  const firePress = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const id = ++nextRippleId.current;
    const size = Math.max(rect.width, rect.height) * 1.6;
    setRipples((prev) => [...prev, { id, x: e.clientX - rect.left, y: e.clientY - rect.top, size }]);
    setPressed(true);
    getSoundEngine().playUiClickTick();
  };
  const releasePress = () => setPressed(false);
  const removeRipple = (id: number) => setRipples((prev) => prev.filter((r) => r.id !== id));

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={firePress}
      onPointerUp={releasePress}
      onPointerLeave={releasePress}
      onPointerCancel={releasePress}
      className={`relative overflow-hidden transition ${pressed ? "scale-95" : ""} ${className}`}
    >
      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden>
        {ripples.map((r: FxRipple) => (
          <span key={r.id}>
            <span
              className="absolute rounded-full"
              style={{
                left: r.x,
                top: r.y,
                width: r.size,
                height: r.size,
                background: `radial-gradient(circle, rgba(255,255,255,0.55) 0%, ${palette.glow} 42%, transparent 72%)`,
                animation: "perudo-fx-ripple 550ms ease-out forwards",
              }}
              onAnimationEnd={() => removeRipple(r.id)}
            />
            {FX_PARTICLES.map((_, i) => (
              <span
                key={i}
                className="absolute h-1 w-1 rounded-full"
                style={
                  {
                    left: r.x,
                    top: r.y,
                    background: palette.spark,
                    boxShadow: `0 0 5px 1px ${palette.spark}`,
                    "--angle": `${(360 / FX_PARTICLE_COUNT) * i}deg`,
                    animation: "perudo-fx-particle 480ms ease-out forwards",
                  } as CSSProperties
                }
              />
            ))}
          </span>
        ))}
      </span>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PerudoShowdownOverlay — [맞아]/[페루도] 전체 화면 쇼다운 팝업
// ---------------------------------------------------------------------------

const SHOWDOWN_MS = 1400;

const SHOWDOWN_PALETTE: Record<
  PerudoShowdownKind,
  { vignette: string; ring: string; spark: string; textClass: string; glow: string; emblem: string; sub: string }
> = {
  dudo: {
    vignette: "radial-gradient(ellipse at center, transparent 18%, rgba(190,18,18,0.4) 60%, rgba(20,0,0,0.82) 100%)",
    ring: "rgba(239,68,68,0.9)",
    spark: "#f87171",
    textClass: "text-rose-300",
    glow: "drop-shadow(0 0 30px rgba(239,68,68,0.9))",
    emblem: "⚡ PERUDO!",
    sub: "블러핑 고발",
  },
  calza: {
    vignette: "radial-gradient(ellipse at center, transparent 18%, rgba(16,185,129,0.32) 60%, rgba(0,20,14,0.78) 100%)",
    ring: "rgba(16,185,129,0.9)",
    spark: "#34d399",
    textClass: "text-emerald-300",
    glow: "drop-shadow(0 0 30px rgba(16,185,129,0.9))",
    emblem: "🎯 EXACT CALZA!",
    sub: "신의 한 수",
  },
};

const SHOWDOWN_SPARK_COUNT = 14;

export function PerudoShowdownOverlay({
  kind,
  actorName,
  onDone,
}: {
  kind: PerudoShowdownKind;
  actorName: string;
  onDone: () => void;
}) {
  const palette = SHOWDOWN_PALETTE[kind];

  useEffect(() => {
    const engine = getSoundEngine();
    engine.unlock();
    if (kind === "dudo") engine.playPerudoDudoThunder();
    else engine.playPerudoCalzaChime();
    const t = setTimeout(onDone, SHOWDOWN_MS);
    // Deliberately does NOT call `onDone` on cleanup (unlike Dalmuti's
    // `PlayImpactBurst`/`FlyingExchangeCard`, which manage a QUEUE of
    // simultaneous events and need every entry to self-remove by id even on
    // an early unmount). This overlay is a single nullable value, not a
    // queue — calling `onDone` from cleanup too would null it out a SECOND
    // time, which is harmless in production but actively breaks this
    // component under React's dev-only Strict Mode double-invoke (mount →
    // cleanup → remount simulation): the cleanup-triggered `onDone()` fires
    // before the very first paint, nulling `showdownFx` in the parent and
    // hiding the overlay before anyone ever sees it (caught via an actual
    // Playwright screenshot showing nothing, not by inspection).
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, same pattern as Coyote/Dalmuti's self-timed overlays
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[92] flex items-center justify-center overflow-hidden" aria-hidden>
      <div className="absolute inset-0" style={{ background: palette.vignette, animation: "perudo-showdown-vignette-in 0.35s ease-out both" }} />
      <span
        className="absolute h-40 w-40 rounded-full sm:h-56 sm:w-56"
        style={{ boxShadow: `0 0 0 3px ${palette.ring}`, animation: "perudo-showdown-shockwave 0.9s ease-out 0.05s both" }}
      />
      {Array.from({ length: SHOWDOWN_SPARK_COUNT }).map((_, i) => (
        <span
          key={i}
          className="absolute top-1/2 left-1/2 h-2 w-2 rounded-full"
          style={
            {
              background: palette.spark,
              boxShadow: `0 0 8px 2px ${palette.spark}`,
              "--angle": `${(360 / SHOWDOWN_SPARK_COUNT) * i}deg`,
              animation: `perudo-showdown-spark 0.9s ease-out ${(0.1 + i * 0.015).toFixed(2)}s forwards`,
            } as CSSProperties
          }
        />
      ))}
      <div
        className="relative flex flex-col items-center gap-2 px-6 text-center"
        style={{ animation: "perudo-showdown-emblem-slam 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}
      >
        <span className={`text-5xl font-black tracking-wide break-keep sm:text-6xl ${palette.textClass}`} style={{ filter: palette.glow }}>
          {palette.emblem}
        </span>
        <span className="text-sm font-bold break-keep text-white/90 sm:text-base">
          {actorName}님의 {palette.sub}
        </span>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// BetStampBurst — [베팅확정] 배팅판 주변 골드 펄스 링(아주 작은 오버레이,
// 포탈 아님 — 배팅판 박스 안쪽에 그대로 얹힘)
// ---------------------------------------------------------------------------

/** 배팅판 테두리를 한 번 감싸는 샴페인 골드 펄스 링. `token`이 바뀔 때마다 `key`로 remount시켜 재생 — MyTurnOverlay 등 이 프로젝트 전반의 표준 "토큰 리마운트" 관례. */
export function BetGoldPulseRing({ token }: { token: number }) {
  return (
    <span
      key={token}
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[1.25rem]"
      style={{ animation: "perudo-bet-gold-pulse 0.6s ease-out" }}
    />
  );
}
