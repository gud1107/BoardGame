"use client";

import { useEffect, useRef, useState } from "react";
import { classOf, isRanged, type Frame } from "./combat";

/**
 * 첫 판 힌트 — 전투 재생에서 "줄 규칙 때문에" 공격 대상이 정해진 순간 짧게 알려 준다(룰북 §9.5-2).
 *  - 근접: 상대 뒷줄이 있는데 앞줄을 쳤다 → "앞줄을 먼저 뚫어야 해요"
 *  - 원거리: 앞줄을 건너뛰고 뒷줄을 쐈다
 *  - 암살자: 앞줄을 건너뛰고 뒷줄로 파고들었다
 *  - 근접인데 상대 앞줄이 비어 바로 뒷줄을 쳤다 → "앞줄이 비면 뒷줄을 쳐요"
 * 힌트가 뜬 프레임은 재생이 HINT_HOLD_MS만큼 더 머문다(배율과 상관없이) — 읽을 틈을 준다.
 * 종류마다 이 기기에서 최대 2번(localStorage), 한 전투에서 1번. 저장이 막혀 있으면 이 페이지 동안만 센다.
 */

export type ReachHintKind = "melee" | "ranged" | "assassin" | "emptyFront";

/** 힌트가 뜬 프레임에 더 머무는 시간(ms, 재생 배율과 무관) */
export const HINT_HOLD_MS = 500;

const TEXT: Record<ReachHintKind, { icon: string; title: string; body: string }> = {
  melee: { icon: "🛡️", title: "앞줄을 먼저 뚫어야 해요", body: "근접 유닛은 상대 앞줄이 남아 있으면 뒷줄을 칠 수 없어요." },
  ranged: { icon: "🏹", title: "원거리는 뒷줄도 쏴요", body: "궁수·마법사는 줄과 상관없이 아무 적이나 공격해요." },
  assassin: { icon: "🗡️", title: "암살자는 뒷줄부터!", body: "암살자는 앞줄을 건너뛰고 뒷줄을 먼저 노려요." },
  emptyFront: { icon: "🚪", title: "앞줄이 비면 뒷줄을 쳐요", body: "상대 앞줄에 아무도 없으면 근접 유닛도 바로 뒷줄을 공격해요." },
};

/** 힌트 종류 수(재생 길이 최대치 계산용) */
export const HINT_KIND_COUNT = Object.keys(TEXT).length;

const KEY = "tb.reachHint.v1";
const MAX_SHOWS = 2;
const memory: Partial<Record<ReachHintKind, number>> = {};

function seenCount(kind: ReachHintKind): number {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<Record<ReachHintKind, number>>;
    return Math.max(v[kind] ?? 0, memory[kind] ?? 0);
  } catch {
    return memory[kind] ?? 0;
  }
}

function bump(kind: ReachHintKind) {
  memory[kind] = (memory[kind] ?? 0) + 1;
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<Record<ReachHintKind, number>>;
    v[kind] = Math.max(v[kind] ?? 0, memory[kind]!);
    window.localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* 저장 불가 — 메모리로만 */
  }
}

/** 이 공격 프레임이 줄 규칙을 보여 주는 장면인가 */
export function reachHintFor(prev: Frame | null, frame: Frame): ReachHintKind | null {
  const ev = frame.ev;
  if (ev.t !== "attack") return null;
  const before = prev ?? frame;
  const attacker = before.sides[ev.side].find((u) => u.uid === ev.from);
  const foes = before.sides[1 - ev.side].filter((u) => u.hp > 0);
  const target = foes.find((u) => u.uid === ev.to);
  if (!attacker || !target) return null;
  const hasFront = foes.some((u) => !u.back);
  const hasBack = foes.some((u) => u.back);
  const melee = classOf(attacker.defId) !== "assassin" && !isRanged(attacker.defId);
  // 앞줄이 (처음부터 또는 다 쓰러져) 비어 근접이 뒷줄을 친 장면
  if (!hasFront && hasBack) return melee && target.back ? "emptyFront" : null;
  if (!hasFront || !hasBack) return null;
  if (classOf(attacker.defId) === "assassin") return target.back ? "assassin" : null;
  if (isRanged(attacker.defId)) return target.back ? "ranged" : null;
  return !target.back ? "melee" : null;
}

/** 지금 보일 힌트와, 그 힌트가 뜬 프레임 번호(at) — 재생 쪽은 idx === at이면 HINT_HOLD_MS만큼 더 머문다 */
export function useReachHint(frames: Frame[], idx: number, enabled = true): { kind: ReachHintKind; at: number } | null {
  const [hint, setHint] = useState<{ kind: ReachHintKind; at: number } | null>(null);
  const shown = useRef(new Set<ReachHintKind>());
  useEffect(() => {
    if (!enabled) return;
    const frame = frames[idx];
    if (!frame) return;
    const kind = reachHintFor(idx > 0 ? frames[idx - 1] : null, frame);
    if (!kind || shown.current.has(kind) || seenCount(kind) >= MAX_SHOWS) return;
    shown.current.add(kind);
    bump(kind);
    const t0 = window.setTimeout(() => setHint({ kind, at: idx }), 0);
    const t1 = window.setTimeout(() => setHint((h) => (h?.kind === kind ? null : h)), 3600);
    return () => {
      window.clearTimeout(t0);
      // 다음 프레임으로 넘어가도 힌트는 끝까지 보이게 — 닫기 타이머는 남겨 둔다
      void t1;
    };
  }, [frames, idx, enabled]);
  return hint;
}

export function ReachHintBanner({ kind }: { kind: ReachHintKind | null }) {
  if (!kind) return null;
  const t = TEXT[kind];
  return (
    <div className="pointer-events-none absolute inset-x-0 top-10 z-30 flex justify-center px-3">
      <div key={kind} className="tb-pop flex max-w-sm items-start gap-2 rounded-2xl border-2 border-yellow-300/80 bg-stone-950/95 px-3 py-2 shadow-[0_0_20px_rgba(250,204,21,0.35)]">
        <span className="text-2xl leading-none">{t.icon}</span>
        <span className="flex flex-col gap-0.5">
          <span className="text-xs font-black text-yellow-200">💡 {t.title}</span>
          <span className="break-keep text-[11px] text-white/80">{t.body}</span>
        </span>
      </div>
    </div>
  );
}
