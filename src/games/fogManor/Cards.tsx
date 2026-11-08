"use client";

import { FLOOR_NAMES, ROOMS, ROOM_BASE, SUSPECTS, WEAPONS, WEAPON_BASE, WING_NAMES, categoryOf } from "./data";

/** 사건 카드 한 장 — 종류마다 테두리 색이 다르고, 특징 아이콘이 붙는다 (색만으로 구분하지 않게 종류 이름도 쓴다). */

const KIND = {
  suspect: { label: "용의자", ring: "border-rose-400/50", bg: "from-rose-950/80 to-slate-950/90", text: "text-rose-100" },
  weapon: { label: "흉기", ring: "border-sky-400/50", bg: "from-sky-950/80 to-slate-950/90", text: "text-sky-100" },
  room: { label: "장소", ring: "border-amber-400/50", bg: "from-amber-950/80 to-slate-950/90", text: "text-amber-100" },
} as const;

export function cardTraits(card: number): string[] {
  const cat = categoryOf(card);
  if (cat === "suspect") {
    const t = SUSPECTS[card].traits;
    return [t[0] ? "✋왼손" : "✋오른손", t[1] ? "📏큰 키" : "📏작은 키", t[2] ? "🚬담배" : "🌸향수"];
  }
  if (cat === "weapon") {
    const t = WEAPONS[card - WEAPON_BASE].traits;
    return [t[0] ? "🩸외상" : "💧무외상", t[1] ? "🏠저택" : "🧳반입"];
  }
  const r = ROOMS[card - ROOM_BASE];
  return [`🏢${FLOOR_NAMES[r.floor]}`, `🧭${WING_NAMES[r.wing]}`];
}

export function cardTitle(card: number): { icon: string; name: string; sub: string } {
  const cat = categoryOf(card);
  if (cat === "suspect") return { icon: SUSPECTS[card].icon, name: SUSPECTS[card].name, sub: SUSPECTS[card].job };
  if (cat === "weapon") return { icon: WEAPONS[card - WEAPON_BASE].icon, name: WEAPONS[card - WEAPON_BASE].name, sub: "흉기" };
  const r = ROOMS[card - ROOM_BASE];
  return { icon: r.icon, name: r.name, sub: "장소" };
}

export default function CaseCard({
  card,
  size = "md",
  selected = false,
  dim = false,
  onClick,
  badge,
}: {
  card: number;
  size?: "sm" | "md" | "lg";
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  badge?: string;
}) {
  const k = KIND[categoryOf(card)];
  const t = cardTitle(card);
  const w = size === "sm" ? "w-[4.4rem]" : size === "lg" ? "w-32" : "w-[5.6rem]";
  const body = (
    <>
      <span className="text-[9px] font-semibold tracking-wide text-white/45 uppercase">{k.label}</span>
      <span className={size === "lg" ? "text-4xl" : size === "sm" ? "text-xl" : "text-2xl"}>{t.icon}</span>
      <span className={`leading-tight font-bold break-keep ${k.text} ${size === "sm" ? "text-[11px]" : "text-xs"}`}>{t.name}</span>
      {size !== "sm" && <span className="text-[10px] text-white/45">{t.sub}</span>}
      {size !== "sm" && <span className="mt-0.5 flex flex-wrap justify-center gap-0.5 text-[9px] text-white/55">{cardTraits(card).map((x) => <span key={x}>{x}</span>)}</span>}
      {badge && <span className="absolute -top-1.5 -right-1.5 rounded-full bg-amber-400 px-1.5 text-[9px] font-bold text-slate-900">{badge}</span>}
    </>
  );
  const cls = `relative flex ${w} shrink-0 flex-col items-center gap-0.5 rounded-xl border bg-gradient-to-b p-1.5 text-center shadow-md transition ${k.ring} ${k.bg} ${
    selected ? "ring-2 ring-amber-300 -translate-y-1" : ""
  } ${dim ? "opacity-35" : ""}`;
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={`${cls} hover:-translate-y-0.5 hover:border-white/50`}>
      {body}
    </button>
  );
}
