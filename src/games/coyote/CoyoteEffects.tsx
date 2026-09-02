"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import type { Resolution, SeatIndex, CoyoteState } from "./engine";

/**
 * Purely cosmetic flourishes — no game logic lives here. Task brief §2
 * "'코요테!' 외침 애니메이션": a desert/Indian-themed wolf-howl overlay the
 * instant the showdown triggers, plus a per-card 3D flip so every forehead
 * card visibly turns face-up together. Both play identically for every
 * connected client off the shared lockstep state transition (not a local
 * click) — same "diff two consecutive snapshots, portal a fixed overlay,
 * drive it with a globals.css keyframe" technique as every other
 * `<Game>Effects.tsx` in this project (dalmuti/DalmutiEffects.tsx,
 * five-cucumbers/CardEffects.tsx, lasVegas/DiceEffects.tsx, ...).
 *
 * 2026-09-03 세션 추가분 — "?" 카드 치환 연출 + 판정 패널 3초 유지/스킵 규격
 * (CoyoteBoard.tsx가 이 파일의 `REVEAL_HOLD_MS`/`QUESTION_*_MS`/
 * `questionCardSeat`/`QuestionCardFlyGhost`를 가지고 직접 스테이지를
 * 오케스트레이션한다). `AskUserQuestion`으로 확인된 결정: ①연쇄 발동된
 * 특수카드도 동일하게 뒤집기만 하고 별도 배지는 없음(엔진의 최종 합산은 이미
 * 원자적으로 계산되어 있어 이건 순수 연출 문제) ②치환은 해당 좌석 자리에서
 * 제자리로 일어남(중앙 전용 연출 영역 없음) ③기존 2초 하울 배너(스킵 불가)를
 * 3초 유지+스킵 하나로 통합 — 배너 자체는 `durationMs`를 짧게 줄여 그 아래
 * 좌석의 카드 애니메이션이 보이도록 하는 "짧은 플래시"로만 남는다.
 */

/** True exactly the render where the showdown just fired (phase left "playing" for "reveal"/"gameOver"). */
export function detectCoyoteCallEvent(prev: CoyoteState, next: CoyoteState): boolean {
  return prev !== next && prev.phase === "playing" && next.phase !== "playing";
}

/**
 * 보드게임허브 공통 규격 — 판정 패널(하울 배너+카드 공개+"?" 치환 포함 전체)의
 * 최소 유지시간. 직하단 스킵 버튼을 누르면 이 시간을 기다리지 않고 즉시
 * 최종 치환/합산 완료 화면으로 넘어간다(CoyoteBoard.tsx의 `handleSkipReveal`).
 */
export const REVEAL_HOLD_MS = 3000;
/** "?" 치환 연출 1단계(시선 집중 펄스)의 길이 — 이 시간이 지나면 2단계(비행)로 넘어간다. */
export const QUESTION_PULSE_MS = 500;
/** "?" 치환 연출 2단계(덱→좌석 비행)의 길이. */
export const QUESTION_FLY_MS = 650;

/**
 * 이번 판정에서 "?" 카드를 이마에 달고 있던 좌석(있다면). 물리 덱에는 "?"가
 * 정확히 1장뿐이라(engine.ts 모듈 doc 가정 #1) 항상 0또는 1개 좌석만
 * 해당된다 — 있다면 그 좌석의 카드가 `res.extraDrawnCards[0]`으로 치환되는
 * 애니메이션의 대상이 된다.
 */
export function questionCardSeat(res: Resolution): SeatIndex | null {
  const entry = Object.entries(res.tableCards).find(([, c]) => c.kind === "question");
  return entry ? Number(entry[0]) : null;
}

function rectCenter(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function CoyoteHowlBanner({
  callerName,
  onDone,
  durationMs = 2000,
}: {
  callerName: string;
  onDone: () => void;
  /** 2026-09-03: 코요테 판정 패널 전체가 하나의 3초 유지+스킵 시퀀스로 통합되면서, 이 배너는 그 시퀀스 맨 앞의 짧은 "플래시"로만 쓰인다 — CoyoteBoard.tsx가 REVEAL_HOLD_MS보다 짧은 값을 넘긴다. */
  durationMs?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, durationMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see DalmutiEffects.tsx's RevolutionBanner for the same pattern
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0 bg-gradient-to-b from-orange-950/70 via-black/60 to-black/90"
        style={{ animation: `coyote-desert-flash ${durationMs}ms ease-out forwards` }}
      />
      <div
        className="relative flex flex-col items-center gap-2 rounded-3xl border-4 border-orange-300 bg-gradient-to-b from-orange-950/95 to-black/95 px-10 py-8 text-center shadow-[0_0_90px_-10px_rgba(251,146,60,0.7)]"
        style={{ animation: `coyote-howl-burst ${durationMs}ms ease-out forwards` }}
      >
        <span className="text-6xl">🐺</span>
        <h2 className="break-keep text-3xl font-black tracking-wide text-orange-200">코요테!!!</h2>
        <p className="break-keep text-sm text-white/70">{callerName}님이 울부짖었습니다 — 모두의 이마 카드가 공개됩니다!</p>
      </div>
    </div>,
    document.body,
  );
}

/**
 * "?" 치환 연출 2단계(덱 드로우 → 좌석까지 비행) — 테이블 중앙에서 목표
 * 좌석까지 신비 카드 한 장이 곡선을 그리며 날아가는 포탈 오버레이. Dalmuti의
 * `FlyingExchangeCard`와 동일한 "getBoundingClientRect 좌표를 fixed portal의
 * left/top 트랜지션으로 잇는다" 기법 — 도착 타이밍(`QUESTION_FLY_MS`)은
 * CoyoteBoard.tsx의 스테이지 타이머가 소유하므로 이 컴포넌트는 순수하게
 * 시각 궤적만 그린다(자체 onDone 콜백 없음, 부모가 같은 시간에 다음 스테이지로
 * 전환).
 */
export function QuestionCardFlyGhost({ getFromEl, getToEl }: { getFromEl: () => HTMLElement | null; getToEl: () => HTMLElement | null }) {
  const elRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = elRef.current;
    const fromEl = getFromEl();
    const toEl = getToEl();
    if (!el || !fromEl || !toEl) return;
    const from = rectCenter(fromEl.getBoundingClientRect());
    const to = rectCenter(toEl.getBoundingClientRect());

    getSoundEngine().playCardDrawWhoosh();

    el.style.transition = "none";
    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    void el.offsetHeight; // force layout so the "from" position + transition:none commits before re-enabling the transition
    el.style.transition = `left ${QUESTION_FLY_MS}ms cubic-bezier(0.3,0.85,0.4,1), top ${QUESTION_FLY_MS}ms cubic-bezier(0.3,0.85,0.4,1)`;

    const raf = requestAnimationFrame(() => {
      const live = elRef.current;
      if (!live) return;
      live.style.left = `${to.x}px`;
      live.style.top = `${to.y}px`;
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see dalmuti/DalmutiEffects.tsx's FlyingExchangeCard for the same pattern
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div ref={elRef} className="pointer-events-none fixed z-[75]" style={{ left: 0, top: 0 }}>
      <div
        className="relative flex h-14 w-10 flex-col items-center justify-center rounded-lg border border-violet-300/70 text-xl shadow-[0_0_22px_-2px_rgba(192,132,252,0.85)]"
        style={{
          background: "linear-gradient(160deg,#4a3312 0%,#241a08 55%,#100b03 100%)",
          animation: `coyote-question-fly ${QUESTION_FLY_MS}ms ease-out forwards`,
        }}
      >
        🎁
      </div>
    </div>,
    document.body,
  );
}

/** Stage-1 "시선 집중" 펄스용 클래스 — `renderSeat`가 "?" 좌석에 조건부로 덧씌운다. */
export const QUESTION_PULSE_CLASS = "coyote-question-pulse";

/**
 * Wraps a forehead `CardFace` so it plays a single 3D flip the moment it
 * becomes visible (round moves to "reveal"/"gameOver"). `flipKey` should
 * change once per new reveal (e.g. `${seat}-${roundNumber}-${phase}`) so the
 * remount — and therefore the animation — fires exactly once per showdown,
 * never replaying on every unrelated re-render.
 */
export function CardFlipWrapper({ flipKey, revealed, children }: { flipKey: string; revealed: boolean; children: React.ReactNode }) {
  return (
    <div key={flipKey} style={revealed ? { animation: "coyote-card-flip 0.6s ease-out" } : undefined} className="[transform-style:preserve-3d]">
      {children}
    </div>
  );
}
