"use client";

import { useEffect, useRef, useState } from "react";
import { SealStamp, RACE_WAX } from "./CardArt";
import { RACE_INFO } from "./data";
import type { AllianceToken, AllianceTokenId, CardColor } from "./types";

/**
 * Always-on tray of my permanent alliance powers (the non-one-shot tokens —
 * Ent/Wizard tokens fire once when taken and are not listed). Lives in the
 * sticky bottom HUD next to coins/techs. Each badge is the race's wax seal +
 * a short label; hover shows, tap/click pins a popover with WHEN it fires and
 * WHAT it does. While a pyramid card / landmark choice is open, the badges it
 * would trigger glow (`trigger`), so combos aren't forgotten.
 */

/** What is being chosen right now — used to light up matching passives. */
export interface PassiveTrigger {
  cardColor?: CardColor;
  mode?: "PLAY" | "DISCARD";
  viaChain?: boolean;
  /** The card's tech cost can't be fully paid by my own symbols. */
  needsTech?: boolean;
  landmark?: boolean;
}

const PASSIVE_INFO: Partial<Record<AllianceTokenId, { short: string; when: string; effect: string; fires: (t: PassiveTrigger) => boolean }>> = {
  ELF_YELLOW_EXTRA_TURN: { short: "노랑→추가 턴", when: "노란색(재정) 카드를 내려놓을 때", effect: "이번 차례를 마친 뒤 곧바로 추가 턴 1회", fires: (t) => t.mode === "PLAY" && t.cardColor === "YELLOW" },
  ELF_RED_ANYWHERE: { short: "빨강→전 지역", when: "빨간색(군사) 카드를 내려놓을 때", effect: "카드의 두 지역 제한을 무시하고 7개 지역 중 원하는 곳에 유닛을 전부 배치", fires: (t) => t.mode === "PLAY" && t.cardColor === "RED" },
  ELF_GREEN_MOVES: { short: "초록→이동 2", when: "초록색(종족) 카드를 내려놓을 때", effect: "지도 위 내 유닛 이동 2회", fires: (t) => t.mode === "PLAY" && t.cardColor === "GREEN" },
  DWARF_LANDMARK_DISCOUNT: { short: "요새비 면제", when: "랜드마크를 건설할 때", effect: "내 요새 수에 따라 붙는 추가 주화를 전액 면제", fires: (t) => !!t.landmark },
  DWARF_LANDMARK_EXTRA_TURN: { short: "건설→추가 턴", when: "랜드마크를 건설할 때", effect: "이번 차례를 마친 뒤 곧바로 추가 턴 1회", fires: (t) => !!t.landmark },
  DWARF_WILD_TECH: { short: "기술 +1", when: "차례마다 (비용 계산 시 자동)", effect: "원하는 기술 기호 1개를 무료로 공급 — 없는 기호 1개를 주화 없이 충당", fires: (t) => t.mode === "PLAY" && !!t.needsTech },
  HOBBIT_EAGLE: { short: "🦅 독수리", when: "항상", effect: "종족 동맹 승리(서로 다른 종족 6개)에서 1개 종족으로 인정", fires: (t) => t.mode === "PLAY" && t.cardColor === "GREEN" },
  HOBBIT_BLUE_UNIT: { short: "파랑→유닛 +1", when: "파란색(반지) 카드를 내려놓을 때", effect: "원하는 지역에 내 유닛 1개 추가 배치", fires: (t) => t.mode === "PLAY" && t.cardColor === "BLUE" },
  HOBBIT_DISCARD_DOUBLE: { short: "버리기 2배", when: "카드를 버릴 때", effect: "챕터 수의 2배 주화 획득 (1챕터 2 · 2챕터 4 · 3챕터 6)", fires: (t) => t.mode === "DISCARD" },
  HUMAN_YELLOW_RING: { short: "노랑→반지 +1", when: "노란색(재정) 카드를 내려놓을 때", effect: "원정 트랙에서 내 말 1칸 전진 (지나간 칸 보상 포함)", fires: (t) => t.mode === "PLAY" && t.cardColor === "YELLOW" },
  HUMAN_RED_EXTRA_UNIT: { short: "빨강→유닛 +1", when: "빨간색(군사) 카드를 내려놓을 때", effect: "배치하는 지역에 내 유닛 1개 추가", fires: (t) => t.mode === "PLAY" && t.cardColor === "RED" },
  HUMAN_CHAIN_BONUS: { short: "연계→+3주화", when: "연계 기호로 카드를 무료로 낼 때", effect: "은행에서 보너스 3주화", fires: (t) => t.mode === "PLAY" && !!t.viaChain },
};

export default function PlayerPassivesHUD({ tokens, trigger }: { tokens: AllianceToken[]; trigger?: PassiveTrigger | null }) {
  const passives = tokens.filter((t) => !t.isOneShot);
  const [hover, setHover] = useState<AllianceTokenId | null>(null);
  const [pinned, setPinned] = useState<AllianceTokenId | null>(null);
  const shownId = pinned ?? hover;
  const shown = passives.find((t) => t.id === shownId);
  const shownInfo = shown ? PASSIVE_INFO[shown.id] : undefined;
  // A tapped (pinned) popover closes on any tap outside the tray.
  const rootRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!pinned) return;
    const close = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPinned(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [pinned]);

  if (passives.length === 0) {
    return (
      <span className="rounded-xl border border-neutral-800 bg-neutral-950/60 px-2 py-1 text-[10px] text-neutral-500" title="같은 종족 2장 / 서로 다른 3종족 / 원정 트랙 5·16번 칸에서 동맹 토큰을 얻을 수 있습니다">
        📜 동맹 능력 없음
      </span>
    );
  }

  return (
    <span ref={rootRef} className="relative flex min-w-0 max-w-full flex-1 items-center gap-1.5 rounded-2xl border border-emerald-500/30 bg-neutral-950/80 px-2 pb-1 sm:flex-initial">
      <span className="flex shrink-0 items-center gap-1 border-r border-white/10 pr-1.5 font-serif text-[10px] font-bold text-emerald-300">
        📜<span className="hidden sm:inline">동맹 능력</span>
        <span className="font-mono text-emerald-400">({passives.length})</span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 overflow-x-auto pt-2 pb-0.5 [scrollbar-width:none]">
        {passives.map((t) => {
          const info = PASSIVE_INFO[t.id];
          const firing = !!(trigger && info?.fires(trigger));
          return (
            <button
              key={t.id}
              type="button"
              onMouseEnter={() => setHover(t.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setPinned((cur) => (cur === t.id ? null : t.id))}
              aria-label={`${RACE_INFO[t.race].name} ${t.name} — 설명 보기`}
              className={`relative flex shrink-0 items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap transition ${
                firing ? "lotrp-passive border-amber-300 bg-amber-500/20 text-amber-100" : "border-white/15 bg-neutral-900 text-neutral-100 hover:border-emerald-300/70"
              } ${shownId === t.id ? "ring-2 ring-amber-300" : ""}`}
              style={{ ["--wax" as string]: RACE_WAX[t.race].glow }}
            >
              <span className="inline-block h-5 w-5">
                <SealStamp race={t.id === "HOBBIT_EAGLE" ? "EAGLE" : t.race} />
              </span>
              {info?.short ?? t.name}
              {firing && <span className="absolute -top-1.5 -right-1 rounded-full bg-amber-400 px-1 text-[8px] font-black text-black">발동!</span>}
            </button>
          );
        })}
      </span>
      {shown && (
        <span
          onMouseEnter={() => setHover(shown.id)}
          onMouseLeave={() => setHover(null)}
          className="absolute bottom-full left-0 z-40 mb-3 w-80 max-w-[calc(100vw-2rem)] rounded-3xl border-2 bg-neutral-950/55 p-4 text-left shadow-2xl backdrop-blur-2xl backdrop-saturate-150"
          style={{ borderColor: RACE_WAX[shown.race].glow, boxShadow: `0 0 26px ${RACE_WAX[shown.race].glow}, inset 0 1px 0 rgba(255,255,255,.12)` }}
          role="tooltip"
        >
          <span className="mb-2 flex items-center justify-between gap-2 border-b border-white/10 pb-2">
            <span className="flex items-center gap-1.5 font-serif text-xs font-black tracking-wide" style={{ color: RACE_WAX[shown.race].wax }}>
              <span className="inline-block h-7 w-7 drop-shadow">
                <SealStamp race={shown.id === "HOBBIT_EAGLE" ? "EAGLE" : shown.race} />
              </span>
              {RACE_INFO[shown.race].name} 동맹
            </span>
            <span className="flex items-center gap-1">
              <span className="rounded-full border border-amber-500/40 bg-black/60 px-2 py-0.5 font-mono text-[9px] font-bold text-amber-300">♾️ 영구 지속</span>
              {pinned && (
                <button type="button" onClick={() => setPinned(null)} className="p-1 text-xs text-neutral-400 hover:text-white" aria-label="설명 닫기">
                  ✕
                </button>
              )}
            </span>
          </span>
          <span className="block font-serif text-sm font-black text-white">📜 {shown.name}</span>
          <span className="mt-1.5 block space-y-1 rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-[11px] leading-relaxed text-neutral-100 shadow-inner">
            <span className="block">
              <b className="text-amber-200">발동 조건</b> · {shownInfo?.when ?? "—"}
            </span>
            <span className="block">
              <b className="text-emerald-200">효과</b> · {shownInfo?.effect ?? shown.description}
            </span>
          </span>
          <span className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 font-mono text-[9px] text-neutral-400">
            {trigger && shownInfo?.fires(trigger) ? (
              <span className="font-bold text-amber-300">⚡ 지금 선택으로 발동</span>
            ) : (
              <span className="font-bold text-emerald-400">● 상시 발동 대기 중</span>
            )}
            <span>조건 달성 시 자동 적용</span>
          </span>
        </span>
      )}
    </span>
  );
}
