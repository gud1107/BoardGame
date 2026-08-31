"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import { handTierRank, type HandTier, type Suit, type Variant } from "./engine";
import { useCombinationEvaluator } from "./useCombinationEvaluator";

/**
 * Request's "손패 영역 상단 중앙에 고정 렌더링"되는 실시간 족보 뱃지. Numeric
 * "점수/배율"은 표시하지 않는다 — 룰북엔 그런 개념이 없고(§C/부록은 순위만
 * 규정), 이번 세션 AskUserQuestion에서 "족보명 + 등급색만" 쪽으로 확정.
 *
 * 등급 3단계(일반/레어/전설)는 `cards.ts`의 `HAND_TIER` 표를 그대로 따르고,
 * 색상은 요청 원문의 "골드, 마젠타, 다이아몬드" 순서를 그대로 매핑했다.
 */
const TIER_STYLE: Record<HandTier, { border: string; text: string; glowAnimation: string; icon: string }> = {
  common: {
    border: "border-amber-400/50",
    text: "text-amber-100",
    glowAnimation: "lwa-badge-glow-common 2.4s ease-in-out infinite",
    icon: "✨",
  },
  rare: {
    border: "border-fuchsia-400/70",
    text: "text-fuchsia-100",
    glowAnimation: "lwa-badge-glow-rare 1.8s ease-in-out infinite",
    icon: "🌟",
  },
  legendary: {
    border: "border-cyan-200/80",
    text: "text-cyan-50",
    glowAnimation: "lwa-badge-glow-legendary 1.1s ease-in-out infinite",
    icon: "💎",
  },
};

const TIER_UPGRADE_POP_MS = 900;

export interface CombinationBadgeProps {
  hand: Suit[];
  community: Suit | null;
  variant: Variant;
}

/** 실시간 족보 뱃지 — `useCombinationEvaluator`의 순수 계산 결과를 렌더링만 한다. */
export default function CombinationBadge({ hand, community, variant }: CombinationBadgeProps) {
  const { label, tier } = useCombinationEvaluator(hand, community, variant);
  const prevTierRankRef = useRef(handTierRank(tier));
  const [justUpgraded, setJustUpgraded] = useState(false);

  useEffect(() => {
    const rank = handTierRank(tier);
    const upgraded = rank < prevTierRankRef.current; // lower rank number = better tier (legendary=0 < rare=1 < common=2)
    prevTierRankRef.current = rank;
    if (!upgraded) return;
    const engine = getSoundEngine();
    engine.unlock();
    engine.playLwaBadgeUpgrade(tier === "legendary" ? "legendary" : "rare");
    setJustUpgraded(true);
    const timer = setTimeout(() => setJustUpgraded(false), TIER_UPGRADE_POP_MS);
    return () => clearTimeout(timer);
  }, [tier]);

  const style = TIER_STYLE[tier];
  const animation = justUpgraded ? `${style.glowAnimation}, lwa-badge-tier-pop 0.6s ease-out` : style.glowAnimation;

  return (
    <div
      className={`flex items-center justify-center rounded-full border bg-black/50 px-3.5 py-1.5 backdrop-blur-sm ${style.border}`}
      style={{ animation } as CSSProperties}
    >
      <span className={`break-keep text-xs font-bold tracking-wide sm:text-sm ${style.text}`}>
        {style.icon} 현재 족보: {label}
      </span>
    </div>
  );
}
