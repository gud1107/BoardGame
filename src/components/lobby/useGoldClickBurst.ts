"use client";

import { useCallback, useState } from "react";
import { getSoundEngine } from "@/lib/audio/soundEngine";

export interface GoldParticle {
  id: number;
  x: number;
  y: number;
  angle: number;
  distance: number;
}

const PARTICLE_COUNT = 14;
const BURST_MS = 300;

/**
 * 로비 게임 카드 클릭 시네마틱 골드 버스트(2026-09-15 세션) — GameCard.tsx와
 * GameShowcaseCard.tsx가 공유. 카드 클릭은 실제로는 감싸는 next/link의 즉시
 * 페이지 이동이고(방 만들기/입장 선택은 공용 모달 없이 게임별 페이지 자체의
 * 개별 phase 플로우로 처리됨 — HANDOFF.md 참고) 그 네비게이션을 지연시키지
 * 않는 순수 장식 레이어만 담당한다: preventDefault도, setTimeout으로 실제
 * onClick을 미루는 로직도 없다.
 */
export function useGoldClickBurst() {
  const [particles, setParticles] = useState<GoldParticle[]>([]);
  const [isPressed, setIsPressed] = useState(false);

  const triggerBurst = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const originX = e.clientX - rect.left;
    const originY = e.clientY - rect.top;

    setParticles(
      Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
        id: Date.now() + i,
        x: originX,
        y: originY,
        angle: (360 / PARTICLE_COUNT) * i + (Math.random() * 14 - 7),
        distance: 42 + Math.random() * 34,
      })),
    );
    setIsPressed(true);

    const engine = getSoundEngine();
    engine.unlock();
    engine.playLuxuryChime();

    window.setTimeout(() => {
      setIsPressed(false);
      setParticles([]);
    }, BURST_MS);
  }, []);

  return { particles, isPressed, triggerBurst };
}
