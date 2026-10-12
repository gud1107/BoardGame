"use client";

import { useState } from "react";
import { classCounts, synergyLevel, tribeCounts } from "./combat";
import { AbilityText } from "./AbilityFeed";
import { CLASSES, CLASS_ORDER, POOL_UNITS, TRIBES, TRIBE_ORDER, unitDef, type Tribe } from "./units";
import type { CardUnit } from "./UnitCard";

/**
 * 롤토체스식 시너지 표 — 항상 떠 있다(넓은 화면은 왼쪽 세로 패널, 좁은 화면은 위에 붙는 가로 띠).
 * 줄마다 육각 배지(브론즈 2 · 실버 4 · 골드 6), 이름, 인원/다음 단계, 2·4·6 눈금, 짧은 설명.
 * 마우스를 올리면(모바일은 탭) 단계별 효과, 내 유닛 중 해당 유닛, 이번 판 풀의 해당 유닛 목록.
 */

type Trait = { key: string; kind: "tribe" | "class"; emoji: string; name: string; color: string; short: string; levels: [number, string][]; count: number };

const LEVEL_STYLE = [
  "bg-stone-700 text-white/60 border-white/15", // 0
  "",
  "bg-gradient-to-b from-amber-600 to-amber-900 text-amber-50 border-amber-400/70", // 2 브론즈
  "",
  "bg-gradient-to-b from-slate-200 to-slate-500 text-slate-900 border-white/80", // 4 실버
  "",
  "bg-gradient-to-b from-yellow-200 to-yellow-500 text-yellow-950 border-yellow-100 shadow-[0_0_12px_rgba(250,204,21,0.7)]", // 6 골드
];

function traitsOf(board: readonly { defId: string }[]): Trait[] {
  const tc = tribeCounts(board);
  const cc = classCounts(board);
  const list: Trait[] = [
    ...TRIBE_ORDER.filter((t) => tc[t] > 0).map((t) => ({ key: t, kind: "tribe" as const, ...TRIBES[t], count: tc[t] })),
    ...CLASS_ORDER.filter((k) => cc[k] > 0).map((k) => ({ key: k, kind: "class" as const, ...CLASSES[k], count: cc[k] })),
  ];
  return list.sort((a, b) => synergyLevel(b.count) - synergyLevel(a.count) || b.count - a.count || (a.kind === "tribe" ? -1 : 1));
}

function currentText(t: Trait): string {
  const lv = synergyLevel(t.count);
  const cur = t.levels.find(([n]) => n === lv);
  const next = t.levels.find(([n]) => n > t.count);
  if (cur) return cur[1];
  return next ? `${next[0]}명: ${next[1]}` : t.short;
}

function Hex({ t }: { t: Trait }) {
  const lv = synergyLevel(t.count);
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center border text-base ${LEVEL_STYLE[lv]}`}
      style={{ clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0% 50%)" }}
    >
      {t.emoji}
    </span>
  );
}

function Pips({ t }: { t: Trait }) {
  return (
    <span className="flex items-center gap-0.5 text-[10px] font-bold">
      {t.levels.map(([n], i) => (
        <span key={n} className="flex items-center gap-0.5">
          {i > 0 && <span className="text-white/25">›</span>}
          <span className={t.count >= n ? "text-yellow-300" : "text-white/35"}>{n}</span>
        </span>
      ))}
    </span>
  );
}

/** 마우스를 올리거나 탭했을 때 보이는 자세한 설명 */
function TraitDetail({ t, board, owned, tribesInPlay }: { t: Trait; board: readonly CardUnit[]; owned: readonly CardUnit[]; tribesInPlay?: Tribe[] }) {
  const has = (defId: string) => (t.kind === "tribe" ? unitDef(defId).tribe === t.key : unitDef(defId).cls === t.key);
  const onBoard = board.filter((u) => has(u.defId));
  const ownedIds = new Set(owned.map((u) => u.defId));
  const pool = POOL_UNITS.filter((d) => has(d.id) && (d.tribe === null || !tribesInPlay || tribesInPlay.includes(d.tribe))).sort((a, b) => a.tier - b.tier);
  return (
    <div className="flex flex-col gap-2 text-[11px] leading-snug text-white/85">
      <div className="flex items-center gap-2">
        <Hex t={t} />
        <div>
          <p className="text-sm font-black text-white">
            {t.name} <span className="text-white/50">({t.kind === "tribe" ? "종족" : "직업"})</span>
          </p>
          <p className="text-white/60">{t.short}</p>
        </div>
        <span className="ml-auto text-lg font-black text-yellow-300">{t.count}</span>
      </div>
      <ul className="flex flex-col gap-1 rounded-lg bg-black/40 p-2">
        {t.levels.map(([n, text]) => {
          const on = synergyLevel(t.count) === n || (t.count >= n && !t.levels.some(([m]) => m > n && t.count >= m));
          return (
            <li key={n} className={`flex gap-1.5 ${on ? "font-semibold text-yellow-100" : t.count >= n ? "text-white/70" : "text-white/45"}`}>
              <span className={`shrink-0 rounded px-1 text-[10px] font-black ${on ? "bg-yellow-400 text-black" : "bg-white/10"}`}>{n}</span>
              <span>
                <AbilityText text={text} />
              </span>
            </li>
          );
        })}
      </ul>
      {onBoard.length > 0 && (
        <p>
          <b className="text-emerald-300">보드에서 세는 유닛</b>{" "}
          {onBoard.map((u, i) => (
            <span key={i} className="mr-1 whitespace-nowrap">
              {unitDef(u.defId).emoji}
              {unitDef(u.defId).name}
            </span>
          ))}
        </p>
      )}
      <div>
        <p className="mb-1 font-bold text-white/70">이번 판에 나오는 {t.name} 유닛</p>
        <div className="flex flex-wrap gap-1">
          {pool.map((d) => (
            <span key={d.id} className={`whitespace-nowrap rounded-md px-1.5 py-0.5 ${ownedIds.has(d.id) ? "bg-emerald-500/25 text-emerald-100" : "bg-white/5 text-white/70"}`}>
              {d.emoji} {d.name} <span className="text-yellow-300">{d.tier}★</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SynergyTracker({
  board,
  owned = board,
  tribesInPlay,
  enemyBoard,
  layout,
}: {
  board: readonly CardUnit[];
  /** 내가 가진 유닛(보드+손패) — 풀 목록에서 보유 표시 */
  owned?: readonly CardUnit[];
  tribesInPlay?: Tribe[];
  /** 전투 중 상대 보드(탭으로 전환) */
  enemyBoard?: readonly CardUnit[];
  layout: "column" | "strip";
}) {
  const [tab, setTab] = useState<"me" | "enemy">("me");
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const shown = tab === "enemy" && enemyBoard ? enemyBoard : board;
  const traits = traitsOf(shown);
  const openKey = pinned ?? hover;
  const open = traits.find((t) => t.key === openKey) ?? null;

  const tabs = enemyBoard && (
    <span className="flex gap-1 text-[10px]">
      {(["me", "enemy"] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => {
            setTab(k);
            setPinned(null);
          }}
          className={`rounded-full px-2 py-0.5 font-bold ${tab === k ? (k === "me" ? "bg-emerald-500 text-black" : "bg-rose-500 text-white") : "bg-white/10 text-white/60"}`}
        >
          {k === "me" ? "내 시너지" : "상대 시너지"}
        </button>
      ))}
    </span>
  );

  if (layout === "strip") {
    return (
      <div className="sticky top-0 z-30 -mx-1 flex flex-col gap-1 rounded-b-xl border-b border-amber-900/40 bg-stone-950/92 px-1 py-1.5 backdrop-blur">
        <div className="flex items-center gap-2 px-1">
          <span className="text-[11px] font-black text-amber-200">⚡ 시너지</span>
          {tabs}
          {traits.length === 0 && <span className="text-[10px] text-white/40">같은 종족·직업을 2명 모으면 켜져요</span>}
        </div>
        {traits.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {traits.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setPinned(pinned === t.key ? null : t.key)}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-1.5 py-1 text-left ${pinned === t.key ? "border-yellow-300 bg-yellow-300/10" : "border-white/10 bg-black/30"} ${synergyLevel(t.count) ? "" : "opacity-60"}`}
              >
                <Hex t={t} />
                <span className="flex flex-col leading-tight">
                  <span className="text-[11px] font-bold text-white">
                    {t.name} <span className="text-yellow-300">{t.count}</span>
                  </span>
                  <span className="max-w-[9rem] truncate text-[10px] text-white/55">{t.short}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {open && pinned && (
          <div className="tb-pop mx-1 rounded-xl border border-amber-400/40 bg-stone-900 p-2.5">
            <TraitDetail t={open} board={shown} owned={tab === "me" ? owned : []} tribesInPlay={tribesInPlay} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="sticky top-2 z-40 flex flex-col gap-1.5 rounded-2xl border border-amber-900/30 bg-stone-900/70 p-2 light:border-amber-200 light:bg-amber-50/80">
      <div className="flex items-center justify-between gap-1 px-1">
        <span className="text-[11px] font-black tracking-wide text-amber-200 light:text-amber-800">⚡ 시너지</span>
        {tabs}
      </div>
      {traits.length === 0 && <p className="px-1 text-[11px] text-white/45">같은 종족·직업을 2·4·6명 모으면 시너지가 켜져요. 마우스를 올리면 자세히 보여요.</p>}
      {traits.map((t) => {
        const active = synergyLevel(t.count) > 0;
        const next = t.levels.find(([n]) => n > t.count)?.[0];
        return (
          <div
            key={t.key}
            className="relative"
            onMouseEnter={() => setHover(t.key)}
            onMouseLeave={() => setHover((h) => (h === t.key ? null : h))}
          >
            <button
              type="button"
              onClick={() => setPinned(pinned === t.key ? null : t.key)}
              className={`flex w-full items-center gap-2 rounded-xl border px-1.5 py-1 text-left transition ${
                openKey === t.key ? "border-yellow-300/70 bg-yellow-300/10" : "border-transparent hover:bg-white/5"
              } ${active ? "" : "opacity-55"}`}
            >
              <Hex t={t} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-white light:text-slate-900">{t.name}</span>
                  <span className="text-xs font-black text-yellow-300 light:text-amber-600">
                    {t.count}
                    {next ? <span className="font-normal text-white/40">/{next}</span> : ""}
                  </span>
                  <span className="ml-auto">
                    <Pips t={t} />
                  </span>
                </span>
                <span className="block truncate text-[10px] text-white/55 light:text-slate-500">{active ? currentText(t) : t.short}</span>
              </span>
            </button>
            {openKey === t.key && (
              <div className="tb-pop absolute left-full top-0 z-50 ml-2 w-72 rounded-2xl border border-amber-400/40 bg-stone-950/95 p-3 shadow-2xl backdrop-blur">
                <TraitDetail t={t} board={shown} owned={tab === "me" ? owned : []} tribesInPlay={tribesInPlay} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
