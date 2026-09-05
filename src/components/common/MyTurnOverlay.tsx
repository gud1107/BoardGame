"use client";

import { useEffect, useRef, useState } from "react";
import { getSoundEngine } from "@/lib/audio/soundEngine";

const VISIBLE_MS = 1200;

/**
 * Hub-wide "내 턴입니다" 알림 훅 (2026-09-05 세션) — 턴이 *막* 나에게 넘어온
 * 순간(false→true 전환)에만 배너를 띄우고 공용 `playMyTurnChime()` 벨소리를
 * 한 번 울린다. 이미 내 턴인 채로 다른 이유(무관한 상태 갱신)로 리렌더될
 * 때는 재발동하지 않도록 이전 값을 ref로 들고 엣지만 감지 — 페루도가
 * 2026-09-04에 처음 도입했던 `turnFxToken`/`wasMyTurnRef` 패턴을 그대로
 * 승격한 것. `token`은 나→남→나로 여러 번 턴이 돌아와도 매번 배너 CSS
 * 애니메이션이 새로 재생되도록 배너의 `key`로 꽂는 용도.
 *
 * `<MyTurnOverlay>`가 이 훅을 내부에서 이미 쓰므로, 대부분의 보드는 훅을
 * 직접 쓸 필요 없이 컴포넌트만 렌더하면 된다. 사운드/타이밍만 별도로
 * 재사용하고 싶은 특수 케이스를 위해 훅도 함께 export.
 */
export function useMyTurnAlert(isMyTurn: boolean) {
  const [token, setToken] = useState(0);
  const [visible, setVisible] = useState(false);
  const wasMyTurnRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const justBecameMyTurn = isMyTurn && !wasMyTurnRef.current;
    wasMyTurnRef.current = isMyTurn;
    if (!justBecameMyTurn) return;

    setToken((t) => t + 1);
    setVisible(true);
    const engine = getSoundEngine();
    engine.unlock(); // best-effort — a user gesture already happened earlier in the room lobby
    engine.playMyTurnChime();

    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setVisible(false), VISIBLE_MS);
  }, [isMyTurn]);

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  return { visible, token };
}

/**
 * 화면 중앙 "MY TURN!" 배너 — 모든 턴제 허브 게임이 `<MyTurnOverlay
 * isMyTurn={isMyTurn} />` 한 줄로 동일하게 재사용한다(게임별 재구현 없음).
 * 탄성 스케일 팝업(0.5→1.05→1) + 골드/네온 텍스트 + 원형 충격파 방출 후
 * 1.2초 시점에 위로 페이드아웃. `pointer-events-none`을 강제해 배너가 떠
 * 있는 동안에도 카드/주사위/말 등 게임 조작이 즉시 가능하다.
 */
export default function MyTurnOverlay({ isMyTurn }: { isMyTurn: boolean }) {
  const { visible, token } = useMyTurnAlert(isMyTurn);
  if (!visible) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[97] flex items-center justify-center">
      <div key={`wave-${token}`} className="my-turn-shockwave absolute h-24 w-24 rounded-full border-amber-300/70 sm:h-32 sm:w-32" />
      <span
        key={`text-${token}`}
        className="my-turn-pop-fade relative text-4xl font-extrabold tracking-wide break-keep text-amber-300 [text-shadow:0_0_18px_rgba(251,191,36,0.85),0_0_36px_rgba(250,204,21,0.5)] sm:text-5xl"
      >
        MY TURN!
      </span>
    </div>
  );
}
