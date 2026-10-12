"use client";

import type { Keyword } from "./units";
import { CLASSES, KEYWORDS, TRIBES, unitDef } from "./units";
import { AbilityText } from "./AbilityFeed";

export interface CardUnit {
  defId: string;
  atk: number;
  hp: number;
  golden: boolean;
  kw: Keyword[];
}

const TIER_BG = ["", "from-slate-600 to-slate-800", "from-emerald-600 to-emerald-900", "from-sky-600 to-sky-900", "from-violet-600 to-violet-900", "from-amber-500 to-orange-800", "from-rose-500 to-rose-900"];

/** 하스스톤 하수인 느낌의 카드 — 위에 그림(이모지), 아래 왼쪽 공격력·오른쪽 체력, 위쪽 등급 별. */
export default function UnitCard({
  unit,
  size = "md",
  selected,
  dim,
  flash,
  float,
  lift,
  onClick,
  draggable,
  onDragStart,
  glow,
}: {
  unit: CardUnit;
  size?: "sm" | "md" | "lg";
  selected?: boolean;
  dim?: boolean;
  /** 맞음(흔들림) */
  flash?: "hit" | "dead" | "pop" | null;
  /** 머리 위에 뜨는 숫자 (피해 등) */
  float?: string | null;
  /** 공격 중 — 상대 쪽으로 튀어 나감 */
  lift?: "up" | "down" | null;
  onClick?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  /** 능력 하이라이트(방금 강화됨) */
  glow?: boolean;
}) {
  const d = unitDef(unit.defId);
  const w = size === "sm" ? "w-[3.6rem] h-[4.9rem]" : size === "lg" ? "w-28 h-36" : "w-[3.9rem] h-[5.4rem] sm:w-20 sm:h-[6.8rem]";
  const emoji = size === "sm" ? "text-2xl" : size === "lg" ? "text-5xl" : "text-2xl sm:text-4xl";
  const stat = size === "sm" ? "h-5 w-5 text-[11px]" : size === "lg" ? "h-8 w-8 text-base" : "h-6 w-6 text-xs sm:h-7 sm:w-7 sm:text-sm";
  const buffedAtk = unit.atk > d.atk * (unit.golden ? 2 : 1);
  const buffedHp = unit.hp > d.hp * (unit.golden ? 2 : 1);
  const tribe = d.tribe ? TRIBES[d.tribe] : null;
  const hasShield = unit.kw.includes("shield");
  const liftCls = lift === "up" ? "-translate-y-6 scale-110 z-20" : lift === "down" ? "translate-y-6 scale-110 z-20" : "";
  const flashCls = flash === "hit" ? "tb-shake" : flash === "dead" ? "opacity-30 grayscale scale-90" : "";
  return (
    <button
      type="button"
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      className={`relative shrink-0 select-none rounded-xl transition-all duration-200 ${w} ${liftCls} ${flashCls} ${dim ? "opacity-50" : ""} ${glow ? "tb-glow" : ""} ${
        selected ? "ring-2 ring-yellow-300 ring-offset-2 ring-offset-transparent -translate-y-1" : ""
      } ${onClick ? "cursor-pointer" : "cursor-default"}`}
      title={`${d.name} (${d.tier}등급${tribe ? ` · ${tribe.name}` : ""}) ${d.text}`}
    >
      <div
        className={`absolute inset-0 overflow-hidden rounded-xl border-2 bg-gradient-to-b ${TIER_BG[d.tier]} ${
          unit.golden ? "border-yellow-300 shadow-[0_0_14px_rgba(253,224,71,0.7)]" : "border-black/30 light:border-slate-400"
        } ${hasShield ? "outline outline-2 outline-offset-1 outline-amber-200/80" : ""}`}
      >
        {unit.golden && <div className="tb-golden pointer-events-none absolute inset-0" />}
        <div className={`flex h-[62%] items-center justify-center ${emoji} drop-shadow`}>{d.emoji}</div>
        <div className="truncate px-1 text-center text-[9px] font-semibold leading-tight text-white/90 sm:text-[10px]">{d.name}</div>
        <div className="mt-0.5 flex justify-center gap-0.5 text-[9px] leading-none">
          {unit.kw.map((k) => (
            <span key={k} title={KEYWORDS[k].name}>
              {KEYWORDS[k].icon}
            </span>
          ))}
          {d.deathrattle && <span title="죽음의 메아리">🪦</span>}
          {d.battlecry && <span title="전투의 함성">📣</span>}
          {d.shopEnd && <span title="성장">🌱</span>}
        </div>
      </div>
      <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-1 text-[8px] leading-3 tracking-tighter text-yellow-300">
        {"★".repeat(d.tier)}
      </span>
      {tribe && (
        <span className="absolute -top-1.5 -right-1.5 rounded-full bg-black/70 px-0.5 text-[10px] leading-4" title={tribe.name}>
          {tribe.emoji}
        </span>
      )}
      {d.cls && (
        <span className="absolute -top-1.5 -left-1.5 rounded-full bg-black/70 px-0.5 text-[10px] leading-4" title={CLASSES[d.cls].name}>
          {CLASSES[d.cls].emoji}
        </span>
      )}
      <span className={`absolute -bottom-1.5 -left-1.5 flex items-center justify-center rounded-full border border-black/40 bg-amber-500 font-bold text-white ${stat} ${buffedAtk ? "text-lime-200" : ""}`}>
        {unit.atk}
      </span>
      <span className={`absolute -bottom-1.5 -right-1.5 flex items-center justify-center rounded-full border border-black/40 bg-rose-600 font-bold text-white ${stat} ${buffedHp ? "text-lime-200" : ""}`}>
        {Math.max(0, unit.hp)}
      </span>
      {float && <span className={`tb-float pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 text-lg font-black drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] ${float.startsWith("+") ? "text-lime-300" : "text-red-400"}`}>{float}</span>}
      {flash === "pop" && <span className="tb-pop pointer-events-none absolute inset-0 flex items-center justify-center text-2xl">✨</span>}
      {flash === "dead" && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-3xl">💥</span>}
    </button>
  );
}

/** 카드 설명 패널 — 선택한 유닛의 전체 정보 */
export function UnitDetail({ unit }: { unit: CardUnit }) {
  const d = unitDef(unit.defId);
  const tribe = d.tribe ? TRIBES[d.tribe] : null;
  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs text-white/80 light:text-slate-700">
      <p className="font-bold text-white light:text-slate-900">
        {d.emoji} {unit.golden ? "황금 " : ""}
        {d.name} <span className="text-yellow-400">{"★".repeat(d.tier)}</span>{" "}
        <span className="font-normal text-white/50 light:text-slate-500">
          {tribe ? `${tribe.emoji} ${tribe.name}` : "중립"}
          {d.cls ? ` · ${CLASSES[d.cls].emoji} ${CLASSES[d.cls].name}` : ""} · {unit.atk}/{unit.hp}
        </span>
      </p>
      {d.text && (
        <p className="break-keep">
          <AbilityText text={d.text} />
          {unit.golden && (d.battlecry || d.deathrattle || d.startOfCombat || d.onAttack || d.onAllyDeath || d.shopEnd || d.shopStart || d.onSell) ? " (황금: 효과 2배)" : ""}
        </p>
      )}
      {unit.kw.filter((k) => !d.keywords.includes(k)).length > 0 && (
        <p className="text-lime-300 light:text-lime-700">추가로 얻은 능력: {unit.kw.filter((k) => !d.keywords.includes(k)).map((k) => KEYWORDS[k].name).join(", ")}</p>
      )}
    </div>
  );
}
