"use client";

import type { Keyword } from "./units";
import { CLASSES, KEYWORDS, TRIBES, unitDef } from "./units";
import { AbilityText } from "./AbilityFeed";
import { MANA_RULES, skillOf, skillPower } from "./skills";
import { unitTip } from "./UnitTooltip";
import { useRef } from "react";

export interface CardUnit {
  defId: string;
  atk: number;
  hp: number;
  golden: boolean;
  kw: Keyword[];
  /** 전투 중 기력(설명창에 "지금 기력" 표시) */
  mana?: number;
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
  onPointerDown,
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
  /** 끌어다 놓기 시작(포인터) */
  onPointerDown?: (e: React.PointerEvent) => void;
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
  const cls = d.cls ? CLASSES[d.cls] : null;
  const lastPointer = useRef("mouse");
  const tipAt = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.right, y: r.top };
  };
  return (
    <button
      type="button"
      onClick={(e) => {
        if (onClick) onClick();
        else if (lastPointer.current !== "mouse") {
          // 터치: 누를 데가 없는 카드(전투·관전)는 탭하면 설명
          const p = tipAt(e.currentTarget);
          unitTip.toggle(unit, p.x, p.y);
        }
      }}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        const p = tipAt(e.currentTarget);
        unitTip.show(unit, p.x, p.y);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") unitTip.hide();
      }}
      onPointerDown={(e) => {
        lastPointer.current = e.pointerType;
        onPointerDown?.(e);
      }}
      onContextMenu={onPointerDown ? (e) => e.preventDefault() : undefined}
      style={onPointerDown ? { WebkitTouchCallout: "none", userSelect: "none" } : undefined}
      className={`relative shrink-0 select-none rounded-xl transition-all duration-200 ${w} ${liftCls} ${flashCls} ${dim ? "opacity-50" : ""} ${glow ? "tb-glow" : ""} ${
        selected ? "ring-2 ring-yellow-300 ring-offset-2 ring-offset-transparent -translate-y-1" : ""
      } ${onClick ? "cursor-pointer" : "cursor-default"}`}
    >
      <div
        className={`absolute inset-0 overflow-hidden rounded-xl border-2 bg-gradient-to-b ${
          unit.golden
            ? "border-yellow-100 from-yellow-200 via-amber-400 to-amber-700 shadow-[0_0_0_2px_#92400e,0_0_18px_4px_rgba(250,204,21,0.75)]"
            : `${TIER_BG[d.tier]} border-black/30 light:border-slate-400`
        } ${hasShield ? "outline outline-2 outline-offset-1 outline-amber-200/80" : ""}`}
      >
        {unit.golden && (
          <>
            {/* 금박 결 + 안쪽 테두리 + 네 귀퉁이 보석 */}
            <div className="pointer-events-none absolute inset-0 opacity-40 mix-blend-overlay [background:repeating-linear-gradient(135deg,rgba(255,255,255,.5)_0_2px,transparent_2px_7px)]" />
            <div className="pointer-events-none absolute inset-[3px] rounded-lg border border-yellow-50/80 shadow-[inset_0_0_10px_rgba(120,53,15,.55)]" />
            {(["left-[3px] top-[3px]", "right-[3px] top-[3px]", "left-[3px] bottom-[3px]", "right-[3px] bottom-[3px]"] as const).map((pos) => (
              <span key={pos} className={`pointer-events-none absolute ${pos} h-1.5 w-1.5 rotate-45 bg-gradient-to-br from-white to-amber-500 shadow-[0_0_4px_#fde047]`} />
            ))}
            <div className="tb-golden pointer-events-none absolute inset-0" />
          </>
        )}
        <div
          className={`flex h-[54%] items-center justify-center ${emoji} drop-shadow ${
            unit.golden ? "[background:radial-gradient(circle_at_50%_55%,rgba(255,255,255,.7),transparent_62%)]" : ""
          }`}
        >
          {d.emoji}
        </div>
        <div
          className={`truncate px-1 text-center text-[9px] leading-tight sm:text-[10px] ${
            unit.golden ? "font-black text-amber-950 drop-shadow-[0_1px_0_rgba(255,255,255,.6)]" : "font-semibold text-white/90"
          }`}
        >
          {d.name}
        </div>
        <div className={`truncate px-0.5 text-center text-[8px] leading-tight sm:text-[9px] ${unit.golden ? "mx-1 rounded-full bg-black/45" : ""}`}>
          <span style={{ color: tribe?.color ?? "#cbd5e1" }}>{tribe ? tribe.name : "중립"}</span>
          {cls && (
            <>
              <span className="text-white/40">·</span>
              <span style={{ color: cls.color }}>{cls.name}</span>
            </>
          )}
        </div>
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
      <span
        className={`absolute -top-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-1 text-[8px] leading-3 tracking-tighter ${
          unit.golden ? "border border-amber-800 bg-gradient-to-b from-yellow-100 to-amber-400 font-black text-amber-900 shadow-[0_0_6px_#facc15]" : "bg-black/70 text-yellow-300"
        }`}
      >
        {unit.golden ? "👑" : ""}
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
      <span className={`absolute -bottom-1.5 -left-1.5 flex items-center justify-center rounded-full border font-bold text-white ${unit.golden ? "border-yellow-100 bg-gradient-to-b from-amber-400 to-orange-600 ring-2 ring-yellow-300" : "border-black/40 bg-amber-500"} ${stat} ${buffedAtk ? "text-lime-200" : ""}`}>
        {unit.atk}
      </span>
      <span className={`absolute -bottom-1.5 -right-1.5 flex items-center justify-center rounded-full border font-bold text-white ${unit.golden ? "border-yellow-100 bg-gradient-to-b from-rose-500 to-rose-700 ring-2 ring-yellow-300" : "border-black/40 bg-rose-600"} ${stat} ${buffedHp ? "text-lime-200" : ""}`}>
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
  const skill = skillOf(unit.defId);
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
      {skill && (
        <p className="break-keep text-sky-300 light:text-sky-700">
          ⚡ 스킬 {skill.emoji} {skill.name} (기력 {skill.mana}): {skill.text(skillPower(unit.defId, unit.golden))}
        </p>
      )}
      {skill && (
        <p className="break-keep text-[11px] text-sky-200/70 light:text-sky-800/80">
          {unit.mana !== undefined ? `🔷 지금 기력 ${unit.mana}/${skill.mana} · ` : ""}전투마다 기력 {MANA_RULES.start}칸 채워진 채 시작, 공격할 때·맞고 버틸 때 +1씩 — 가득 차면 자기 차례에 스킬
        </p>
      )}
      {unit.kw.filter((k) => !d.keywords.includes(k)).length > 0 && (
        <p className="text-lime-300 light:text-lime-700">추가로 얻은 능력: {unit.kw.filter((k) => !d.keywords.includes(k)).map((k) => KEYWORDS[k].name).join(", ")}</p>
      )}
    </div>
  );
}
