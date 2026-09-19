"use client";

/**
 * 페루도 핵심 액션 버튼([베팅확정]/[맞아(Calza)]/[페루도(Dudo)]) 연출 고도화
 * (2026-09-20 세션 → 같은 날 두 차례 후속 세션, 매번 사용자의 상세 스펙
 * 요청). 세 조각으로 나뉜다:
 *
 * 1. `detectBetConfirmEvent`/`detectShowdownEvent` — Coyote의
 *    `detectCoyoteCallEvent`, Dalmuti의 `detectPlayImpactEvents`와 동일한
 *    순수 상태-diff 감지 함수. 로컬 클릭이 아니라 실제 락스텝 상태 전이를
 *    비교해서 트리거하므로, 맞아!/페루도! 같은 "모두가 봐야 하는" 선언은
 *    호출한 사람뿐 아니라 모든 클라이언트에서 동일하게 동기 재생된다.
 *    `detectShowdownEvent`는 2번째 후속 세션에서 "선언했다"는 사실 하나가
 *    아니라 그 선언의 실제 성패까지 판정해 4가지 결과
 *    (`PerudoShowdownOutcome`) 중 하나로 분류하도록 확장됨 — 판정식은 그
 *    함수 자신의 doc 주석 참고.
 * 2. `PerudoFxButton` — Dalmuti의 `FxButton`과 동일한 기법(누르는 즉시
 *    scale-95 + 리플 + 방사형 스파크 파티클)을 페루도 전용 팔레트로 복제한
 *    드롭인 버튼 래퍼. 순수 로컬/즉시 피드백이라 사운드는 가벼운
 *    `playUiClickTick()` 하나만 — 크고 개성 있는 액션별 사운드(스탬프/차임/
 *    천둥/공/버저/팡파르/스크레이프)는 §1의 상태-diff 트리거에서 재생돼
 *    클릭과 확정 사이 중복 재생을 피한다. [베팅확정](`variant === "gold"`)만
 *    공용 8입자 리플 대신 `makeGoldSparkParticles`가 만드는 35개 샴페인
 *    골드/백금 중력 스파크 버스트 + `makeGoldRays`의 12줄기 방사형 광선을
 *    쓴다 — 자세한 물리 근사치는 각 함수 자신의 doc 주석 참고.
 * 3. `PerudoShowdownOverlay` — [맞아]/[페루도]가 실제로 어떻게 판정났는지에
 *    따라 4가지 완전히 다른 전체 화면 시네마틱 팝업(엠블럼 + 충격파 + 스파크
 *    + 결과별 전용 레이어: 유리 파편/조준 레티클, 화면 균열, 팽창 링, 연기/
 *    쇠사슬)을 재생. `createPortal`로 `document.body`에 직접 마운트 —
 *    Coyote의 `DeathStampOverlay`/`CoyoteHowlBanner`와 동일 기법.
 *
 * 화면 흔들림([페루도 실패/역풍]만), 줌인([맞아 성공]만), 채도 저하([맞아
 * 실패]만)는 이 파일이 아니라 `PerudoBoard.tsx`가 자신의 루트 패널에 직접
 * 인라인 `animation` 스타일로 건다(다르무티의 `shake` state/스타일 적용
 * 패턴과 동일) — 이 오버레이는 화면 중앙 팝업만 책임진다. `filter`는 자기
 * 자신의 렌더링만 바꾸고 배경엔 영향이 없어서, 보드 자체를 desaturate하려면
 * 보드 쪽에서 걸어야 한다는 걸 실제로 한 번 잘못 만들었다가 고쳤다 — 아래
 * 채도 저하 레이어의 doc 주석 참고.
 */

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import type { PerudoState } from "./engine";

/**
 * 2026-09-20 후속 세션(사용자 상세 스펙): "페루도!"/"맞아!"를 선언했다는
 * 사실 하나가 아니라, 그 선언이 실제로 어떻게 판정났는지에 따라 4가지
 * 완전히 다른 쇼다운을 재생한다 — `engine.ts`의 `dudo()`/`calza()`가
 * 남기는 `RoundResolution`에서 성패를 그대로 읽어 분류(아래
 * `detectShowdownEvent` 참고).
 */
export type PerudoShowdownOutcome = "dudoSuccess" | "dudoFail" | "calzaSuccess" | "calzaFail";

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
 *
 * 2026-09-20 후속 세션: 이제 `kind`만이 아니라 실제 성패까지 함께 판정해
 * 4가지 결과 중 하나로 분류한다 — `PerudoBoard.tsx`의 reveal 분기가 이미
 * 쓰고 있던 것과 동일한 판정식을 그대로 재사용:
 * - `kind === "dudo"`: `affectedSeat !== actorSeat`면 고발이 적중해
 *   **선언자(bid.seat)** 가 다이를 잃은 것 → `dudoSuccess`(블러핑 적발
 *   성공). 반대로 `affectedSeat === actorSeat`면 고발한 본인이 다이를 잃은
 *   것 → `dudoFail`(역풍/고발 실패).
 * - `kind === "calza"`: `diceDelta > 0`(다이를 되찾음)이면 정확히 맞힌 것 →
 *   `calzaSuccess`. 그 외(항상 손실)엔 `calzaFail`.
 */
export function detectShowdownEvent(prev: PerudoState, next: PerudoState): PerudoShowdownOutcome | null {
  if (prev === next) return null;
  if (prev.phase === "playing" && (next.phase === "reveal" || next.phase === "gameOver") && next.lastResolution) {
    const res = next.lastResolution;
    if (res.kind === "dudo") return res.affectedSeat !== res.actorSeat ? "dudoSuccess" : "dudoFail";
    return res.diceDelta > 0 ? "calzaSuccess" : "calzaFail";
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

/**
 * [베팅확정] 전용 "샴페인 골드 & 백금 스파크" 중력 버스트 (2026-09-20 세션
 * → 같은 날 후속 세션에서 22→35개로 확대, 사용자 상세 스펙: 35개 입자, 크기
 * 1.5~3.0px, 소멸 속도 0.03~0.045). 다른 두 버튼의 공용 `FX_PARTICLES`(고정
 * 각도 8개, 순수 방사형 직선)보다 훨씬 화려하고 물리적인 느낌을 내기 위해 이
 * 버튼만 별도 경로로 렌더링: 매 클릭마다 35개를 새로 무작위 생성(각도/발사
 * 거리/중력 낙하량/크기/지속 시간 전부 랜덤)하고, 3단 키프레임
 * (`perudo-gold-spark-burst`)에 CSS 커스텀 프로퍼티(`--dx-mid`/`--dy-mid`/
 * `--dx-end`/`--dy-end`)로 각 입자의 궤적을 개별 주입 — 발사 직후(35%)엔
 * 각도를 따라 대체로 퍼지다가, 종료 시점(100%)엔 모든 입자의 y값에 추가
 * 낙하량을 더해 "중력을 받아 아래로 흩어짐"을 만든다.
 *
 * 같은 후속 세션에서 `GoldLightRays`(12줄기 방사형 광선)도 이 버튼에만
 * 추가됐다 — 클릭 지점에서 30°씩 회전 배치된 얇은 그라디언트 막대 12개가
 * 짧게 확장하며 소멸. 버튼 자신의 `overflow-hidden`을 gold variant에서만
 * 끄지 않으면(아래 `PerudoFxButton`) 광선/스파크 둘 다 버튼 테두리에 잘려
 * 안 보이므로 반드시 함께 봐야 하는 짝.
 */
const GOLD_SPARK_COUNT = 35;
/** 샴페인 골드 / 백금 두 색을 절반씩 교차 배치. */
const GOLD_SPARK_COLORS = ["#f5cf7a", "#e7ecf3"] as const;

interface GoldSparkParticle {
  id: number;
  size: number;
  color: string;
  durationMs: number;
  delayMs: number;
  dxMid: string;
  dyMid: string;
  dxEnd: string;
  dyEnd: string;
}

/**
 * "소멸 속도 0.03~0.045" — 파티클 시스템 관례대로 "프레임당(60fps 기준)
 * 잃는 불투명도"로 해석: 그 값의 역수만큼의 프레임 동안 완전히 사라지므로,
 * durationMs = (1000/60) / decayRate ≈ 0.045일 때 ~370ms, 0.03일 때 ~556ms —
 * 짧고 경쾌한 스파크 버스트에 맞는 자연스러운 범위로 변환됨.
 */
function decayRateToDurationMs(decayRate: number): number {
  return Math.round(1000 / 60 / decayRate);
}

function makeGoldSparkParticles(seed: number): GoldSparkParticle[] {
  return Array.from({ length: GOLD_SPARK_COUNT }, (_, i) => {
    const angle = Math.random() * Math.PI * 2;
    const launchDist = 16 + Math.random() * 20; // 16~36px — 방향별 발사 거리
    const gravityDrop = 14 + Math.random() * 22; // 14~36px — 각도와 무관하게 전부 아래로 추가 낙하
    const dxMid = Math.cos(angle) * launchDist;
    const dyMid = Math.sin(angle) * launchDist * 0.7; // 초반엔 아직 중력이 덜 붙어 옆으로 더 퍼짐
    const dxEnd = dxMid * 1.35;
    const dyEnd = dyMid + gravityDrop;
    const decayRate = 0.03 + Math.random() * 0.015; // 0.03~0.045
    return {
      id: seed * 1000 + i,
      size: 1.5 + Math.random() * 1.5, // 1.5~3.0px
      color: GOLD_SPARK_COLORS[i % 2],
      durationMs: decayRateToDurationMs(decayRate),
      delayMs: Math.random() * 40,
      dxMid: `${dxMid.toFixed(1)}px`,
      dyMid: `${dyMid.toFixed(1)}px`,
      dxEnd: `${dxEnd.toFixed(1)}px`,
      dyEnd: `${dyEnd.toFixed(1)}px`,
    };
  });
}

const GOLD_RAY_COUNT = 12;

interface GoldRay {
  angle: number;
  delayMs: number;
}

/** 12줄기 방사형 광선 — 매 클릭마다 각도는 고정(30°씩 균등 배치, 방사형
 * 광선다운 규칙성이 더 잘 읽힘)이고 지연만 살짝 무작위로 흩어 기계적으로
 * 똑같이 보이지 않게 함. */
function makeGoldRays(): GoldRay[] {
  return Array.from({ length: GOLD_RAY_COUNT }, (_, i) => ({
    angle: (360 / GOLD_RAY_COUNT) * i,
    delayMs: Math.random() * 30,
  }));
}

interface FxRipple {
  id: number;
  x: number;
  y: number;
  size: number;
  /** [베팅확정](`variant === "gold"`)에서만 채워짐 — 있으면 이 리플은 공용
   * `FX_PARTICLES` 대신 35개짜리 중력 스파크 버스트 + 12줄기 광선으로
   * 렌더링된다. */
  goldSparks?: GoldSparkParticle[];
  goldRays?: GoldRay[];
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
    const isGold = variant === "gold";
    setRipples((prev) => [
      ...prev,
      {
        id,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        size: Math.max(rect.width, rect.height) * 1.6,
        goldSparks: isGold ? makeGoldSparkParticles(id) : undefined,
        goldRays: isGold ? makeGoldRays() : undefined,
      },
    ]);
    setPressed(true);
    getSoundEngine().playUiClickTick();
  };
  const releasePress = () => setPressed(false);
  const removeRipple = (id: number) => setRipples((prev) => prev.filter((r) => r.id !== id));
  // [베팅확정](gold)만 클리핑을 끔 — 35개 중력 스파크와 12줄기 광선이
  // "사방으로 튀며"/"방출" 되려면 버튼 자신의 작은 경계 밖으로 자유롭게
  // 뻗어나가야 하는데, 다른 두 버튼처럼 `overflow-hidden`이 걸려 있으면
  // 버튼 테두리에서 전부 잘려 안 보인다. 이 버튼이 앉아 있는 배팅판 박스
  // 자체는 overflow를 걸지 않으므로(PerudoBoard.tsx) 주변으로 자유롭게
  // 번져나가도 더 바깥에서 잘릴 일은 없다.
  const isGold = variant === "gold";

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
      className={`relative transition ${isGold ? "" : "overflow-hidden"} ${pressed ? "scale-95" : ""} ${className}`}
    >
      <span className={`pointer-events-none absolute inset-0 ${isGold ? "" : "overflow-hidden"} rounded-[inherit]`} aria-hidden>
        {ripples.map((r: FxRipple) => (
          <span key={r.id}>
            {r.goldRays?.map((ray, i) => (
              <span
                key={i}
                className="absolute rounded-full"
                style={
                  {
                    left: r.x,
                    top: r.y,
                    width: "2.5px",
                    height: "34px",
                    marginLeft: "-1.25px",
                    marginTop: "-34px", // 광선의 "뿌리"(bottom)가 클릭 지점에 오도록 위로 34px 띄움
                    transformOrigin: "50% 100%", // 회전축을 막대 bottom(=클릭 지점)에 고정 — 그래야 12줄기가 전부 같은 원점에서 부채꼴로 퍼짐(center 회전이면 막대마다 뿌리 위치가 어긋남)
                    background: "linear-gradient(to top, transparent 0%, #fde68a 55%, transparent 100%)",
                    "--ray-angle": `${ray.angle}deg`,
                    animation: `perudo-gold-light-rays 420ms ease-out ${ray.delayMs.toFixed(0)}ms forwards`,
                  } as CSSProperties
                }
              />
            ))}
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
            {r.goldSparks
              ? r.goldSparks.map((s) => (
                  <span
                    key={s.id}
                    className="absolute rounded-full"
                    style={
                      {
                        left: r.x,
                        top: r.y,
                        width: `${s.size}px`,
                        height: `${s.size}px`,
                        background: s.color,
                        boxShadow: `0 0 ${(s.size * 2).toFixed(1)}px ${(s.size * 0.6).toFixed(1)}px ${s.color}`,
                        "--dx-mid": s.dxMid,
                        "--dy-mid": s.dyMid,
                        "--dx-end": s.dxEnd,
                        "--dy-end": s.dyEnd,
                        animation: `perudo-gold-spark-burst ${s.durationMs}ms cubic-bezier(0.25,0.65,0.4,1) ${s.delayMs.toFixed(0)}ms forwards`,
                      } as CSSProperties
                    }
                  />
                ))
              : FX_PARTICLES.map((_, i) => (
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
const SHOWDOWN_SPARK_COUNT = 14;

interface ShowdownPaletteEntry {
  vignette: string;
  ring: string;
  spark: string;
  textClass: string;
  glow: string;
  emblem: string;
  sub: (actorName: string, bidderName: string) => string;
  play: (engine: ReturnType<typeof getSoundEngine>) => void;
  /** 이 결과에서만 추가로 렌더되는 레이어 — 아래 구현부 참고. */
  extra: "glassShatter" | "crosshairGrave" | "cornerCrack" | "miracleBurst" | "smokeChains";
}

const SHOWDOWN_PALETTE: Record<PerudoShowdownOutcome, ShowdownPaletteEntry> = {
  dudoSuccess: {
    vignette: "radial-gradient(ellipse at center, transparent 20%, rgba(190,18,18,0.32) 55%, rgba(20,4,0,0.8) 100%)",
    ring: "rgba(239,68,68,0.9)",
    spark: "#f87171",
    textClass: "text-rose-300",
    glow: "drop-shadow(0 0 14px rgba(253,224,71,0.85)) drop-shadow(0 0 30px rgba(239,68,68,0.85))",
    emblem: "⚡ BLUFF BUSTED!",
    sub: (actorName, bidderName) => `${actorName}님이 ${bidderName}님의 블러핑을 적발!`,
    play: (e) => e.playPerudoBluffBustedGong(),
    extra: "crosshairGrave",
  },
  dudoFail: {
    vignette: "radial-gradient(ellipse at center, transparent 16%, rgba(120,10,10,0.5) 55%, rgba(10,0,0,0.88) 100%)",
    ring: "rgba(153,27,27,0.9)",
    spark: "#7f1d1d",
    textClass: "text-rose-500",
    glow: "drop-shadow(0 0 24px rgba(127,29,29,0.95))",
    emblem: "❌ REVERSE HIT!",
    sub: (actorName) => `${actorName}님의 섣부른 고발 — 역풍`,
    play: (e) => e.playPerudoReverseHitBuzzer(),
    extra: "cornerCrack",
  },
  calzaSuccess: {
    vignette: "radial-gradient(ellipse at center, transparent 16%, rgba(16,185,129,0.4) 55%, rgba(0,24,18,0.72) 100%)",
    ring: "rgba(94,234,212,0.95)",
    spark: "#5eead4",
    textClass: "text-teal-200",
    glow: "drop-shadow(0 0 18px rgba(255,255,255,0.9)) drop-shadow(0 0 34px rgba(45,212,191,0.9))",
    emblem: "🎯 MIRACLE CALZA!",
    sub: (actorName) => `${actorName}님의 신의 한 수 — 정확히 맞혔습니다`,
    play: (e) => e.playPerudoMiracleCalzaFanfare(),
    extra: "miracleBurst",
  },
  calzaFail: {
    vignette: "radial-gradient(ellipse at center, transparent 20%, rgba(60,60,68,0.4) 58%, rgba(8,8,10,0.82) 100%)",
    ring: "rgba(148,163,184,0.65)",
    spark: "#94a3b8",
    textClass: "text-slate-400",
    glow: "drop-shadow(0 0 20px rgba(100,116,139,0.6))",
    emblem: "💨 MISSED!",
    sub: (actorName) => `${actorName}님의 시도가 불일치로 끝났습니다`,
    play: (e) => e.playPerudoCalzaMissedScrape(),
    extra: "smokeChains",
  },
};

const GLASS_SHARD_COUNT = 9;
const SMOKE_COUNT = 6;

/** 유리 조각별 랜덤 궤적 — [블러핑 적발 성공] 전용. 컴포넌트 리렌더마다
 * 새로 만들면 안 되므로(매번 다른 파편이 되어 애니메이션이 뚝뚝 끊겨
 * 보임) `useState`의 lazy-init으로 마운트 시 한 번만 생성. */
function makeGlassShards() {
  return Array.from({ length: GLASS_SHARD_COUNT }, () => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 70;
    return {
      dx: `${(Math.cos(angle) * dist).toFixed(1)}px`,
      dy: `${(Math.sin(angle) * dist).toFixed(1)}px`,
      rot: `${(Math.random() * 360 - 180).toFixed(0)}deg`,
      size: 8 + Math.random() * 10,
      delayMs: Math.random() * 80,
    };
  });
}

function makeSmokePuffs() {
  return Array.from({ length: SMOKE_COUNT }, () => ({
    left: 50 + (Math.random() * 60 - 30),
    size: 28 + Math.random() * 24,
    delayMs: Math.random() * 200,
    durationMs: 900 + Math.random() * 400,
  }));
}

export function PerudoShowdownOverlay({
  outcome,
  actorName,
  bidderName,
  onDone,
}: {
  outcome: PerudoShowdownOutcome;
  /** 선언한 사람("페루도!"/"맞아!"를 외친 좌석)의 표시 이름. */
  actorName: string;
  /** 도전받은 베팅의 주인 — `dudoSuccess`/`dudoFail`에서만 실제로 쓰임
   * (crosshair 라벨: 성공 시 지목 대상, 실패 시는 본인이 곧 actorName이라
   * 별도로 안 씀). calza 결과에서는 무시돼도 안전하도록 빈 문자열 허용. */
  bidderName: string;
  onDone: () => void;
}) {
  const palette = SHOWDOWN_PALETTE[outcome];
  const [glassShards] = useState(makeGlassShards);
  const [smokePuffs] = useState(makeSmokePuffs);

  useEffect(() => {
    const engine = getSoundEngine();
    engine.unlock();
    palette.play(engine);
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
      {/* `filter`는 이 div 자신의 렌더링만 바꾸지 배경(보드)엔 영향이 없으므로
          — "보드 전체가 채도를 잃는" 효과는 여기가 아니라 `PerudoBoard.tsx`가
          자기 루트 패널에 직접 거는 `showdownBoardStyle`(perudo-desaturate-pulse)
          쪽에서 처리한다. 여기 vignette은 순수 색 오버레이만 담당. */}
      <div className="absolute inset-0" style={{ background: palette.vignette, animation: "perudo-showdown-vignette-in 0.35s ease-out both" }} />

      {/* [고발 실패/역풍] 전용 — 화면을 대각선으로 가로지르는 붉은 균열선
          두 줄기가 X자로 잠깐 번쩍임. */}
      {outcome === "dudoFail" &&
        ["45deg", "-45deg"].map((rot, i) => (
          <span
            key={i}
            className="absolute top-1/2 left-1/2 h-[1px] w-[70vmax]"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(239,68,68,0.9) 45%, transparent)",
              transform: `translate(-50%, -50%) rotate(${rot})`,
              animation: `perudo-corner-crack-in 0.4s ease-out ${(i * 0.05).toFixed(2)}s both`,
            }}
          />
        ))}

      {/* 공통 충격파 링 + 스파크 — [정확 일치]는 별도의 더 큰 팽창 링을 덧댐. */}
      <span
        className="absolute h-40 w-40 rounded-full sm:h-56 sm:w-56"
        style={{ boxShadow: `0 0 0 3px ${palette.ring}`, animation: "perudo-showdown-shockwave 0.9s ease-out 0.05s both" }}
      />
      {outcome === "calzaSuccess" && (
        <span
          className="absolute h-48 w-48 rounded-full sm:h-64 sm:w-64"
          style={{ boxShadow: `0 0 0 2px ${palette.ring}`, animation: "perudo-miracle-expansion-ring 1.1s ease-out 0.1s both" }}
        />
      )}
      {Array.from({ length: outcome === "calzaSuccess" ? 20 : SHOWDOWN_SPARK_COUNT }).map((_, i, arr) => (
        <span
          key={i}
          className="absolute top-1/2 left-1/2 h-2 w-2 rounded-full"
          style={
            {
              background: palette.spark,
              boxShadow: `0 0 8px 2px ${palette.spark}`,
              "--angle": `${(360 / arr.length) * i}deg`,
              animation: `perudo-showdown-spark 0.9s ease-out ${(0.1 + i * 0.015).toFixed(2)}s forwards`,
            } as CSSProperties
          }
        />
      ))}

      {/* [블러핑 적발 성공] 전용 — 유리 방벽이 쨍그랑 깨지는 파편. */}
      {outcome === "dudoSuccess" && (
        <>
          <span
            className="absolute h-56 w-56 rounded-2xl sm:h-72 sm:w-72"
            style={{ boxShadow: "inset 0 0 40px 8px rgba(255,255,255,0.5)", animation: "perudo-glass-crack-flash 0.3s ease-out both" }}
          />
          {glassShards.map((s, i) => (
            <span
              key={i}
              className="absolute top-1/2 left-1/2"
              style={
                {
                  width: `${s.size}px`,
                  height: `${s.size}px`,
                  background: "linear-gradient(135deg, rgba(255,255,255,0.9), rgba(191,219,254,0.35))",
                  clipPath: "polygon(50% 0%, 100% 38%, 78% 100%, 12% 82%)",
                  "--dx": s.dx,
                  "--dy": s.dy,
                  "--rot": s.rot,
                  animation: `perudo-glass-shard 0.65s cubic-bezier(0.25,0.65,0.4,1) ${s.delayMs.toFixed(0)}ms forwards`,
                } as CSSProperties
              }
            />
          ))}
        </>
      )}

      {/* [블러핑 적발 성공] 전용 — 지목당한 상대에게 잠깐 조여드는 붉은
          조준 레티클 + 그 상대의 주사위 1개가 부서지며 묘지로 낙하. */}
      {outcome === "dudoSuccess" && (
        <div className="relative flex flex-col items-center gap-1" style={{ animation: "perudo-crosshair-lock 0.7s ease-out 0.15s both" }}>
          <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-rose-400/90 sm:h-20 sm:w-20">
            <span className="absolute h-full w-[2px] bg-rose-400/70" />
            <span className="absolute h-[2px] w-full bg-rose-400/70" />
          </span>
          <span className="rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-bold break-keep text-rose-200">🎯 {bidderName}</span>
        </div>
      )}
      {outcome === "dudoSuccess" && (
        <span className="absolute top-[58%] left-1/2 text-xl" style={{ animation: "perudo-die-to-grave 0.6s ease-in 0.35s both" }}>
          🎲💥
        </span>
      )}

      {/* [불일치] 전용 — 잿빛 연기 + 쇠사슬. */}
      {outcome === "calzaFail" && (
        <>
          {smokePuffs.map((p, i) => (
            <span
              key={i}
              className="absolute top-1/2 rounded-full bg-slate-400/40 blur-md"
              style={{
                left: `${p.left}%`,
                width: p.size,
                height: p.size,
                animation: `perudo-smoke-drift ${p.durationMs}ms ease-out ${p.delayMs.toFixed(0)}ms forwards`,
              }}
            />
          ))}
          <span
            className="absolute top-[60%] left-1/2 text-2xl"
            style={{ animation: "perudo-chains-wobble 1s ease-in-out 0.2s both" }}
          >
            ⛓️
          </span>
        </>
      )}

      <div
        className="relative flex flex-col items-center gap-2 px-6 text-center"
        style={{ animation: "perudo-showdown-emblem-slam 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.05s both" }}
      >
        <span className={`text-4xl font-black tracking-wide break-keep sm:text-6xl ${palette.textClass}`} style={{ filter: palette.glow }}>
          {palette.emblem}
        </span>
        <span className="max-w-[280px] text-sm font-bold break-keep text-white/90 sm:max-w-none sm:text-base">
          {palette.sub(actorName, bidderName)}
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
