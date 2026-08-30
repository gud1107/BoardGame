"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { DeckBack } from "./CardArt";
import type { SeatIndex, SummonersRiftState } from "./engine";

/**
 * Purely cosmetic flourish for the Rift pile's "cards physically piling up"
 * moment (task brief §2 "협곡 카드 덱이 누적되는 연출") — no game logic lives
 * here. Same "diff two consecutive lockstep states, portal a fixed-position
 * element, animate its left/top via a CSS *transition* while a globals.css
 * keyframe adds the flourish on top" technique as every other game's
 * `*Effects.tsx` (five-cucumbers/CardEffects.tsx, no-thanks/AuctionEffects.tsx,
 * las-vegas/DiceEffects.tsx), so every connected client renders the same
 * flight for the same push — not just whoever tapped the button.
 *
 * The dungeon phase's "card removal animation" (task brief §2, a monster
 * being slain or dealing damage and then discarded) is handled separately,
 * directly inside `SummonersRiftBoard.tsx` as a keyed CSS animation on the
 * single reveal slot — no source/target flight is needed there since there's
 * only ever one "current" monster card, unlike the many-seats-pushing-at-once
 * case this file exists for.
 */

export interface RiftPushEvent {
  id: number;
  seat: SeatIndex;
}

/**
 * A push (rulebook §4 옵션 A-1 "협곡에 집어넣기") always transitions
 * `pendingDraw: {seat, card} -> null` in the *same* step that grows
 * `riftPile` by exactly one — `removeItem` also clears `pendingDraw` but
 * never touches `riftPile`, which is what distinguishes the two here without
 * needing a dedicated action-kind field on the state itself.
 */
export function detectRiftPushEvent(prev: SummonersRiftState, next: SummonersRiftState): Omit<RiftPushEvent, "id"> | null {
  if (prev === next) return null;
  if (prev.pendingDraw && !next.pendingDraw && next.riftPile.length === prev.riftPile.length + 1) {
    return { seat: prev.pendingDraw.seat };
  }
  return null;
}

function rectCenter(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function FlyingRiftCard({
  event,
  getSourceEl,
  getTargetEl,
  onDone,
}: {
  event: RiftPushEvent;
  getSourceEl: () => HTMLElement | null;
  getTargetEl: () => HTMLElement | null;
  onDone: (id: number) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);

  // Mount-only flight — this component is always freshly mounted with a
  // stable `key={event.id}`, and re-running mid-flight on a source/target
  // re-render would restart it (same convention as FlyingPlayedCard).
  useLayoutEffect(() => {
    const el = elRef.current;
    const source = getSourceEl();
    const target = getTargetEl();
    if (!el || !source || !target) {
      onDone(event.id);
      return;
    }
    const from = rectCenter(source.getBoundingClientRect());
    const to = rectCenter(target.getBoundingClientRect());

    el.style.transition = "none";
    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    void el.offsetHeight; // force layout so the "from" position + transition:none commits before re-enabling the transition
    el.style.transition = "left 0.42s cubic-bezier(0.22,1,0.36,1), top 0.42s cubic-bezier(0.22,1,0.36,1)";

    const raf = requestAnimationFrame(() => {
      const live = elRef.current;
      if (!live) return;
      live.style.left = `${to.x}px`;
      live.style.top = `${to.y}px`;
    });
    const timeout = setTimeout(() => onDone(event.id), 460);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see comment above
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={elRef}
      className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-1/2"
      style={{ left: 0, top: 0, animation: "rift-card-toss 0.42s ease-out forwards" }}
    >
      <DeckBack className="h-16 w-12" />
    </div>,
    document.body,
  );
}

/**
 * 2026-08-30 던전 몬스터 등장 연출 세션 (작업 지시 §2 "보스/네임드 몬스터 등장
 * 시 카메라 줌인 또는 은은한 백드롭 딤(Dim) 처리") — 조우 유지창(5초) 동안
 * 전체 화면을 어둡게 깔아 시선을 중앙의 대형 HP 배너 쪽으로 모으는 순수 연출용
 * 백드롭. `FlyingRiftCard`와 같은 이유로 `document.body`에 포털링한다: 이
 * 컴포넌트가 보드 레이아웃 안쪽 어디에 마운트되든(좌측 몬스터 기록 패널이 있는
 * 3열 레이아웃이든 1열로 좁아진 모바일이든) 항상 뷰포트 전체를 덮어야 하기
 * 때문 — `position: fixed`만으로는 `SummonersRiftBoard`가 감싸고 있는 스크롤
 * 컨테이너 기준으로 잘릴 수 있어 포털이 필요하다. 딤 배경 자체는 `pointer-events-none`이라
 * 뒤쪽 보드 상호작용을 막지 않는다(스킵 버튼 등은 이 위에 z-index로 얹힌 실제
 * 보드 콘텐츠 쪽에 있으므로 여전히 클릭 가능).
 */
export function NamedMonsterDim() {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-40"
      style={{
        background: "radial-gradient(circle at 50% 38%, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.78) 100%)",
        animation: "rift-named-dim-in 0.35s ease-out",
      }}
    />,
    document.body,
  );
}

/**
 * 2026-08-30 카드 공개 방식 선택 + 생사 이펙트 세션 — 라운드가 성공(협곡을
 * 끝까지 클리어해 생존)으로 확정되는 그 순간 화면 전체를 압도하는 축하 연출
 * (작업 지시 §2 "생존(Survival) 판정 시"). `NamedMonsterDim`과 같은 이유로
 * `document.body`에 포털링 — `SummonersRiftBoard`가 gameOver/playing 두
 * 갈래로 분기돼도(부모의 `lifeDeathOverlay` 변수가 양쪽 모두에 렌더) 항상
 * 뷰포트 전체를 덮어야 한다. 배경/링/텍스트는 모두 `pointer-events-none`이라
 * 뒤쪽 보드 상호작용을 막지 않고, 스킵 버튼만 `pointer-events-auto`로 켠다.
 */
export function SurvivalEffect({ onSkip }: { onSkip: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(circle at 50% 50%, rgba(250,204,21,0.32) 0%, rgba(16,185,129,0.2) 45%, rgba(0,0,0,0) 78%)",
          animation: "rift-survive-bg-flash 2.5s ease-out forwards",
        }}
      />
      {/* 황금빛/에메랄드빛 링 파티클 — 중앙에서 동심원으로 퍼져나가며 사라진다 (작업 지시 §2 "황금빛 링 파티클 방출"). */}
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="absolute h-20 w-20 rounded-full border-4"
          style={{
            borderColor: i % 2 === 0 ? "rgba(250,204,21,0.85)" : "rgba(52,211,153,0.75)",
            opacity: 0,
            animation: `rift-survive-ring-expand 1.3s ease-out ${i * 0.18}s forwards`,
          }}
        />
      ))}
      <div className="flex flex-col items-center gap-2" style={{ animation: "rift-survive-text-slam 0.6s cubic-bezier(0.34,1.56,0.64,1) forwards" }}>
        <span
          className="text-4xl font-black tracking-wider sm:text-6xl"
          style={{ color: "#faf3c8", textShadow: "0 0 24px rgba(250,204,21,0.95), 0 0 60px rgba(16,185,129,0.6)" }}
        >
          🛡️ SURVIVED
        </span>
        <span className="text-base font-bold sm:text-xl" style={{ color: "#e8c77a" }}>
          생존 성공!
        </span>
      </div>
      <button
        onClick={onSkip}
        className="pointer-events-auto absolute bottom-10 rounded-full px-4 py-1.5 text-[11px] font-black text-black shadow-[0_0_16px_rgba(250,204,21,0.6)] transition hover:brightness-110 active:scale-95"
        style={{ background: "linear-gradient(135deg,#fde68a,#c8933e)" }}
      >
        ⏩ 스킵
      </button>
    </div>,
    document.body,
  );
}

/**
 * `SurvivalEffect`의 반대 — 라운드가 실패(체력 0, 사망/처치)로 확정되는 순간의
 * 전체 화면 연출(작업 지시 §2 "사망/처치(Defeated/Death) 판정 시"): 붉은
 * 비네트 암전 펄스 + 유리 조각처럼 흩날리는 크랙 샤드 + 무겁게 내리찍히는
 * 해골 엠블럼 텍스트.
 */
export function DeathEffect({ onSkip }: { onSkip: () => void }) {
  if (typeof document === "undefined") return null;
  const shardCount = 8;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center overflow-hidden">
      {/* 화면 모서리 붉은색 비네트 플래시 — 작업 지시 §2 "animate-pulse"를 그대로 사용. */}
      <div
        className="absolute inset-0 animate-pulse"
        style={{ background: "radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 28%, rgba(140,10,10,0.55) 78%, rgba(50,0,0,0.85) 100%)" }}
      />
      {/* 유리가 산산조각 나는 듯한 크랙 샤드 — 중앙에서 8방향으로 튀어나가며 사라진다. */}
      {Array.from({ length: shardCount }, (_, i) => {
        const angle = (i / shardCount) * Math.PI * 2;
        const dx = Math.round(Math.cos(angle) * 220);
        const dy = Math.round(Math.sin(angle) * 220);
        return (
          <span
            key={i}
            className="absolute h-10 w-4 bg-white/70"
            style={
              {
                left: "50%",
                top: "50%",
                clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
                opacity: 0,
                "--dx": `${dx}px`,
                "--dy": `${dy}px`,
                "--rot": `${i * 47}deg`,
                animation: `rift-death-shard-fly 0.7s ease-out ${i * 0.02}s forwards`,
              } as CSSProperties
            }
          />
        );
      })}
      <div className="flex flex-col items-center gap-2" style={{ animation: "rift-death-text-slam 0.55s ease-out forwards" }}>
        <span
          className="text-4xl font-black tracking-wider sm:text-6xl"
          style={{ color: "#ff6b6b", textShadow: "0 0 20px rgba(220,20,20,0.9), 0 0 50px rgba(0,0,0,0.9)" }}
        >
          💀 YOU DIED
        </span>
        <span className="text-base font-bold sm:text-xl" style={{ color: "#f3a5a5" }}>
          처치됨
        </span>
      </div>
      <button
        onClick={onSkip}
        className="pointer-events-auto absolute bottom-10 rounded-full border border-white/30 px-4 py-1.5 text-[11px] font-black text-white/80 transition hover:border-white/50 active:scale-95"
        style={{ background: "rgba(0,0,0,0.5)" }}
      >
        ⏩ 스킵
      </button>
    </div>,
    document.body,
  );
}
