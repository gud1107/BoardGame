"use client";

import { useEffect, useRef, useState } from "react";
import { BOSS_EVERY, COMBO, GAMBLE_COST, START_GEMS, type Board } from "./engine";

/**
 * The 💎 counter as a button: tap for "보석 얻는 법" — every way the engine
 * hands out gems, each with where this board stands right now (next boss
 * wave, this wave's 20-combo gem). The count pops when it goes up.
 */
export default function GemGuide({ board, wave }: { board: Board; wave: number }) {
  const [open, setOpen] = useState(false);
  const [pop, setPop] = useState<{ key: number; gain: number } | null>(null);
  const prev = useRef(board.gems);
  useEffect(() => {
    const gain = board.gems - prev.current;
    prev.current = board.gems;
    if (gain <= 0) return;
    setPop((p) => ({ key: (p?.key ?? 0) + 1, gain }));
    const t = window.setTimeout(() => setPop(null), 1300);
    return () => window.clearTimeout(t);
  }, [board.gems]);

  const bossOnRoad = board.mobs.some((m) => m.kind === "boss" && m.hp > 0);
  const nextBoss = Math.max(BOSS_EVERY, Math.ceil((wave + 1) / BOSS_EVERY) * BOSS_EVERY);
  const comboDone = board.comboGemWave === wave && wave > 0;
  const chain = board.critChain ?? 0;

  const rows: { icon: string; title: string; gain: string; status: string; hot?: boolean }[] = [
    {
      icon: "👑",
      title: "보스 처치",
      gain: "+2",
      status: bossOnRoad ? "지금 내 길에 보스가 있어요 — 잡으세요!" : `다음 보스: WAVE ${nextBoss} (${nextBoss - wave}웨이브 뒤)`,
      hot: bossOnRoad,
    },
    {
      icon: "😡",
      title: "광폭화한 보스·전쟁군주 처치",
      gain: "+1",
      status: "졸개를 다 부른 뒤 붉게 변한 보스는 보석을 하나 더 줘요",
    },
    {
      icon: "⚡",
      title: `치명타 ${COMBO.gemAt}콤보`,
      gain: "+1",
      status: comboDone ? "이번 웨이브 보석 받음 ✓ (웨이브마다 1번)" : `웨이브마다 1번 · 지금 ${chain}콤보 — 🎯 집중을 올리면 쉬워져요`,
      hot: !comboDone && chain >= COMBO.gemAt * 0.6,
    },
    { icon: "🎁", title: "시작 보석", gain: `+${START_GEMS}`, status: "판이 시작될 때 받아요" },
  ];

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="보석 얻는 법"
        className="inline-flex items-center gap-0.5 rounded-full border border-fuchsia-300/40 bg-fuchsia-500/15 px-2 py-0.5 font-bold text-fuchsia-100 hover:border-fuchsia-300/80 light:border-fuchsia-300 light:bg-fuchsia-50 light:text-fuchsia-800"
      >
        💎 {board.gems}
        <span className="ml-0.5 text-[10px] opacity-70">ⓘ</span>
      </button>
      {pop && (
        <span
          key={pop.key}
          className="pointer-events-none absolute -top-4 left-full ml-1 animate-[md-gold-rise_1.2s_ease-out_forwards] rounded-full bg-fuchsia-400/90 px-1.5 text-[11px] font-black whitespace-nowrap text-fuchsia-950 shadow"
        >
          +💎{pop.gain}
        </span>
      )}
      {open && (
        <div className="absolute top-8 left-1/2 z-30 w-64 -translate-x-1/2 rounded-xl border border-fuchsia-300/30 bg-slate-950/95 p-2.5 text-left text-[11px] text-white shadow-2xl light:border-fuchsia-200 light:bg-white light:text-slate-800">
          <div className="mb-1.5 flex items-center justify-between">
            <b className="text-xs">💎 보석 얻는 법</b>
            <button type="button" onClick={() => setOpen(false)} className="px-1 opacity-60 hover:opacity-100" aria-label="닫기">
              ✕
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {rows.map((r) => (
              <li
                key={r.title}
                className={`flex gap-2 rounded-lg px-2 py-1 ${r.hot ? "bg-amber-400/15 ring-1 ring-amber-300/50" : "bg-white/5 light:bg-slate-50"}`}
              >
                <span className="text-base leading-tight">{r.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex justify-between gap-1 font-bold">
                    {r.title}
                    <span className="text-fuchsia-300 light:text-fuchsia-700">{r.gain}</span>
                  </span>
                  <span className="block break-keep text-white/60 light:text-slate-500">{r.status}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 border-t border-white/10 pt-1.5 break-keep text-white/60 light:border-slate-200 light:text-slate-500">
            쓰는 곳: <b className="text-white light:text-slate-800">💎 도박</b> — 보석 {GAMBLE_COST}개로 희귀~전설 유닛 (빈 칸 필요)
          </p>
        </div>
      )}
    </span>
  );
}
