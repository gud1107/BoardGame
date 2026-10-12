"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AbilityText } from "./AbilityFeed";
import { CLASSES, KEYWORDS, TRIBES, unitDef } from "./units";
import type { CardUnit } from "./UnitCard";

/**
 * 유닛 설명 툴팁 — 카드(2D)나 3D 캐릭터에 마우스를 올리면(터치는 탭하면) 뜬다.
 * 이름·등급·종족·직업·스탯(기본값 대비)·능력(핵심어 강조)·키워드 설명·종족/직업 시너지 단계를 보여 준다.
 * 화면에 하나만 뜨므로 모듈 상태 + useSyncExternalStore로 어디서든 열고 닫는다.
 */

type Tip = { unit: CardUnit; x: number; y: number; sticky: boolean; key: string } | null;

let tip: Tip = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function keyOf(u: CardUnit) {
  return `${u.defId}:${u.atk}:${u.hp}:${u.golden}:${u.kw.join(",")}`;
}

export const unitTip = {
  /** x,y = 화면 좌표(툴팁이 그 근처에 뜸) */
  show(unit: CardUnit, x: number, y: number, sticky = false) {
    tip = { unit, x, y, sticky, key: keyOf(unit) };
    emit();
  },
  /** 같은 유닛이면 닫고, 아니면 연다(터치용) */
  toggle(unit: CardUnit, x: number, y: number) {
    if (tip && tip.key === keyOf(unit)) unitTip.hide();
    else unitTip.show(unit, x, y, true);
  },
  hide() {
    if (!tip) return;
    tip = null;
    emit();
  },
};

function subscribe(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

function SynergyLines({ title, emoji, levels }: { title: string; emoji: string; levels: [number, string][] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="font-semibold text-white/80">
        {emoji} {title} 시너지
      </p>
      {levels.map(([n, t]) => (
        <p key={n} className="pl-2 text-white/60">
          ({n}) <AbilityText text={t} />
        </p>
      ))}
    </div>
  );
}

export function TooltipBody({ unit }: { unit: CardUnit }) {
  const d = unitDef(unit.defId);
  const tribe = d.tribe ? TRIBES[d.tribe] : null;
  const cls = d.cls ? CLASSES[d.cls] : null;
  const m = unit.golden ? 2 : 1;
  const baseAtk = d.atk * m;
  const baseHp = d.hp * m;
  const hasEffect = !!(d.battlecry || d.deathrattle || d.startOfCombat || d.onAttack || d.onAllyDeath || d.shopEnd || d.shopStart || d.onSell);
  return (
    <div className="flex flex-col gap-2 text-[11px] leading-snug text-white/85">
      <div className="flex items-center gap-2">
        <span className="text-3xl">{d.emoji}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-white">
            {unit.golden && <span className="text-yellow-300">황금 </span>}
            {d.name}
          </p>
          <p className="text-yellow-300">
            {"★".repeat(d.tier)} <span className="text-white/50">{d.token ? "토큰" : `${d.tier}등급`}</span>
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1 text-xs font-black">
          <span className="rounded-md bg-amber-500 px-1.5 py-0.5 text-white">⚔ {unit.atk}</span>
          <span className="rounded-md bg-rose-600 px-1.5 py-0.5 text-white">❤ {Math.max(0, unit.hp)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <span className="rounded-full border px-2 py-0.5 font-semibold" style={{ borderColor: tribe?.color ?? "#64748b", color: tribe?.color ?? "#cbd5e1" }}>
          {tribe ? `${tribe.emoji} ${tribe.name}` : "중립"}
        </span>
        {cls && (
          <span className="rounded-full border px-2 py-0.5 font-semibold" style={{ borderColor: cls.color, color: cls.color }}>
            {cls.emoji} {cls.name}
          </span>
        )}
        {(unit.atk !== baseAtk || unit.hp !== baseHp) && <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/60">기본 {baseAtk}/{baseHp}</span>}
      </div>
      <div className="rounded-lg bg-black/40 px-2 py-1.5">
        {d.text ? (
          <p className="break-keep text-[12px]">
            <AbilityText text={d.text} />
            {unit.golden && hasEffect && <span className="text-yellow-300"> (황금: 효과 2배)</span>}
          </p>
        ) : (
          <p className="text-white/50">특수 능력 없음 — 스탯으로 승부</p>
        )}
      </div>
      {unit.kw.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {unit.kw.map((k) => (
            <li key={k}>
              <b className="text-sky-300">
                {KEYWORDS[k].icon} {KEYWORDS[k].name}
              </b>{" "}
              <span className="text-white/65">{KEYWORDS[k].text}</span>
              {!d.keywords.includes(k) && <span className="text-lime-300"> (추가로 얻음)</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1.5 border-t border-white/10 pt-1.5 text-[10px]">
        {tribe && <SynergyLines title={tribe.name} emoji={tribe.emoji} levels={tribe.levels} />}
        {cls && <SynergyLines title={cls.name} emoji={cls.emoji} levels={cls.levels} />}
      </div>
    </div>
  );
}

/** 페이지에 한 번 올려 두는 툴팁 표시부 */
export function UnitTooltipHost() {
  const t = useSyncExternalStore(subscribe, () => tip, () => null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 화면 밖으로 나가지 않게 실제 크기로 위치를 잡는다
  useEffect(() => {
    if (!t || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = t.x + 18;
    if (left + r.width > vw - 8) left = Math.max(8, t.x - r.width - 18);
    let top = t.y - 20;
    if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
    const id = window.requestAnimationFrame(() => setPos({ left, top }));
    return () => window.cancelAnimationFrame(id);
  }, [t]);

  // 터치로 연 툴팁은 다음 터치에서 닫힘, 스크롤하면 닫힘
  useEffect(() => {
    if (!t) return;
    const close = () => unitTip.hide();
    const onDown = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      if (t.sticky) close();
    };
    const id = window.setTimeout(() => window.addEventListener("pointerdown", onDown, true), 0);
    window.addEventListener("scroll", close, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", close, true);
    };
  }, [t]);

  if (!t || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={box}
      className="tb-pop pointer-events-none fixed z-[70] w-[min(18rem,calc(100vw-16px))] rounded-2xl border border-amber-400/40 bg-stone-950/95 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.7)] backdrop-blur"
      style={{ left: pos?.left ?? t.x + 18, top: pos?.top ?? t.y - 20, visibility: pos ? "visible" : "hidden" }}
    >
      <TooltipBody unit={t.unit} />
    </div>,
    document.body,
  );
}
