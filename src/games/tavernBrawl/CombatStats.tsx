"use client";

import { useEffect, useMemo, useState } from "react";
import { simulateCombat, type UnitCombatStat } from "./combat";
import type { CombatRecord } from "./engine";
import { unitDef } from "./units";

/**
 * 전투 통계 — 이번 전투에서 유닛마다 넣은 피해(⚔)와 받은 피해(🛡).
 * 같은 시드로 다시 시뮬해서 얻는다(상태/네트워크에 안 실음). 전투가 끝나면 잠깐 떴다가 저절로 닫히고,
 * 헤더의 📊 버튼으로 언제든 다시 열고 닫는다.
 */

export const STATS_AUTO_CLOSE_MS = 5000;

function Bar({ v, max, tone }: { v: number; max: number; tone: "atk" | "hurt" }) {
  const w = max > 0 ? Math.max(v > 0 ? 6 : 0, (v / max) * 100) : 0;
  return (
    <span className="relative flex h-3.5 flex-1 items-center overflow-hidden rounded bg-white/5">
      <span className={`absolute inset-y-0 left-0 rounded ${tone === "atk" ? "bg-gradient-to-r from-amber-600 to-yellow-300" : "bg-gradient-to-r from-rose-700 to-rose-400"}`} style={{ width: `${w}%` }} />
      <span className="relative ml-1 text-[10px] font-black tabular-nums text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">{v}</span>
    </span>
  );
}

function SideList({ title, list, max, mine }: { title: string; list: UnitCombatStat[]; max: number; mine: boolean }) {
  const best = list.reduce<UnitCombatStat | null>((b, u) => (u.dealt > (b?.dealt ?? 0) ? u : b), null);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <p className={`truncate text-[11px] font-black ${mine ? "text-emerald-300" : "text-rose-300"}`}>{title}</p>
      {list.map((u) => {
        const d = unitDef(u.defId);
        return (
          <div key={u.uid} className={`flex items-center gap-1.5 ${u.died ? "opacity-55" : ""}`} title={`${d.name} — 넣은 피해 ${u.dealt} · 받은 피해 ${u.taken}${u.blocked ? ` · 보호막으로 ${u.blocked}번 막음` : ""}${u.died ? " · 쓰러짐" : ""}`}>
            <span className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base ${u.golden ? "bg-yellow-400/30 ring-1 ring-yellow-300" : "bg-white/10"}`}>
              {d.emoji}
              {u.died && <span className="absolute -bottom-1 -right-1 text-[10px]">💀</span>}
              {best === u && <span className="absolute -left-1 -top-1.5 text-[10px]">👑</span>}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-1">
                <span className="w-3 text-[10px]">⚔</span>
                <Bar v={u.dealt} max={max} tone="atk" />
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 text-[10px]">🛡</span>
                <Bar v={u.taken} max={max} tone="hurt" />
                {u.blocked > 0 && <span className="shrink-0 text-[9px] text-sky-300">🫧{u.blocked}</span>}
              </span>
            </span>
          </div>
        );
      })}
      {list.length === 0 && <p className="text-[10px] text-white/40">유닛 없음</p>}
    </div>
  );
}

export default function CombatStats({
  combat,
  viewSide,
  names,
  autoClose,
  onClose,
}: {
  combat: CombatRecord;
  /** 0 = A가 내 편 */
  viewSide: 0 | 1;
  /** [내 편, 상대] 이름 */
  names: [string, string];
  /** true면 STATS_AUTO_CLOSE_MS 뒤 저절로 닫힘(패널을 누르면 고정) */
  autoClose: boolean;
  onClose: () => void;
}) {
  const stats = useMemo(() => simulateCombat(combat.sideA, combat.sideB, combat.seed, true).stats, [combat]);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!autoClose || pinned) return;
    const t = window.setTimeout(onClose, STATS_AUTO_CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [autoClose, pinned, onClose]);

  const order = (s: 0 | 1) => stats.filter((u) => u.side === s).sort((a, b) => b.dealt - a.dealt || b.taken - a.taken);
  const mine = order(viewSide);
  const theirs = order(viewSide === 0 ? 1 : 0);
  const max = Math.max(1, ...stats.map((u) => Math.max(u.dealt, u.taken)));
  const total = (l: UnitCombatStat[]) => l.reduce((s, u) => s + u.dealt, 0);
  const won = combat.winner === null ? null : combat.winner === viewSide;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[70] flex justify-center px-3">
      <div onPointerDown={() => setPinned(true)} className="tb-pop pointer-events-auto relative w-full max-w-lg overflow-hidden rounded-2xl border border-amber-400/40 bg-stone-950/95 p-3 shadow-2xl backdrop-blur">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-black text-amber-200">📊 전투 통계</span>
          {won !== null && <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${won ? "bg-emerald-500 text-black" : "bg-rose-600 text-white"}`}>{won ? "승리" : "패배"}</span>}
          {won === null && <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-black text-white">무승부</span>}
          <span className="text-[10px] text-white/50">
            총 피해 {total(mine)} : {total(theirs)}
          </span>
          <button type="button" onClick={onClose} className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/70 hover:bg-white/20" aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="flex max-h-[45vh] gap-3 overflow-y-auto">
          <SideList title={names[0]} list={mine} max={max} mine />
          <SideList title={names[1]} list={theirs} max={max} mine={false} />
        </div>
        <p className="mt-1.5 text-[9px] text-white/35">⚔ 넣은 피해 · 🛡 받은 피해 · 🫧 보호막으로 막음 · 👑 최다 딜 · 💀 쓰러짐</p>
        {autoClose && !pinned && <span className="tb-statbar absolute bottom-0 left-0 h-0.5 bg-amber-400" style={{ animationDuration: `${STATS_AUTO_CLOSE_MS}ms` }} />}
        <style>{`@keyframes tb-statbar{from{width:100%}to{width:0}}.tb-statbar{animation:tb-statbar linear forwards}`}</style>
      </div>
    </div>
  );
}
