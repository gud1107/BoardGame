"use client";

import { CARDS, CHARACTERS } from "./data";
import type { CardEffect, CharacterId } from "./types";

export const EFFECT_ICON: Partial<Record<CardEffect, string>> = {
  MAGIC: "✨",
  RETREAT: "↩️",
  ELVEN_BOW: "🏹",
  ELVEN_CLOAK: "🧥",
  MITHRIL_MAIL: "🛡️",
  PHIAL: "🌟",
  ANDURIL: "⚔️",
  ENTS: "🌳",
  EAGLES: "🦅",
  SMITE: "☀️",
  ATHELAS: "🌿",
  EYE_OF_SAURON: "👁️",
  MORGUL_BLADE: "🗡️",
  DARK_DESPAIR: "🌑",
  GROND: "🔨",
  BLACK_SORCERY: "🔮",
  TREACHERY: "🎭",
  ORC_MOB: "👹",
  NAZGUL_SHRIEK: "😱",
  WEB: "🕸️",
};

/** One combat card. `size="sm"` for hand chips, `"lg"` for the combat reveal. */
export function CardFace({
  cardId,
  size = "sm",
  selected,
  disabled,
  onClick,
  faceDown,
  flip,
}: {
  cardId: string | null;
  size?: "sm" | "lg";
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  faceDown?: boolean;
  flip?: boolean;
}) {
  const card = cardId ? CARDS[cardId] : null;
  const lg = size === "lg";
  const dims = lg ? "h-32 w-24" : "h-[4.5rem] w-[3.25rem]";
  if (!card || faceDown) {
    return (
      <div className={`${dims} flex shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-[repeating-linear-gradient(45deg,#1a1410,#1a1410_6px,#241a12_6px,#241a12_12px)] shadow-inner`}>
        <span className="font-serif text-2xl text-amber-400/50">ᚱ</span>
      </div>
    );
  }
  const fellowship = card.faction === "FELLOWSHIP";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      title={`${card.name} (+${card.power}) — ${card.description}`}
      className={[
        dims,
        "relative flex shrink-0 flex-col items-center justify-between overflow-hidden rounded-xl border p-1 text-center transition",
        fellowship ? "border-sky-300/50 bg-[linear-gradient(170deg,#1e3a5f,#0b1426)]" : "border-red-400/50 bg-[linear-gradient(170deg,#5b1414,#1a0707)]",
        card.type === "SPECIAL" ? "shadow-[0_0_10px_rgba(251,191,36,0.25)]" : "",
        selected ? "-translate-y-1.5 ring-2 ring-yellow-300 shadow-[0_0_16px_rgba(253,224,71,0.6)]" : "",
        onClick && !disabled ? "cursor-pointer hover:-translate-y-1" : "",
        disabled ? "opacity-40" : "",
        flip ? "lotr-card-flip" : "",
      ].join(" ")}
    >
      <span className={`font-serif leading-none font-black text-amber-200 ${lg ? "text-3xl" : "text-lg"}`}>{card.power > 0 ? `+${card.power}` : "0"}</span>
      {card.effectType && <span className={lg ? "text-2xl" : "text-sm"}>{EFFECT_ICON[card.effectType]}</span>}
      <span className={`w-full truncate leading-tight font-semibold text-amber-50/90 ${lg ? "text-xs" : "text-[8.5px]"}`}>{card.effectType ? card.name : "전투"}</span>
      {lg && card.effectType && <span className="line-clamp-3 text-[9px] leading-tight text-white/60">{card.description}</span>}
      {card.type === "SPECIAL" && <span className="absolute top-0.5 right-1 text-[7px] text-amber-300">★</span>}
    </Tag>
  );
}

export function CharacterCard({ id, flip, dead, power, label }: { id: CharacterId; flip?: boolean; dead?: boolean; power?: number | null; label?: string }) {
  const c = CHARACTERS[id];
  const fellowship = c.faction === "FELLOWSHIP";
  return (
    <div
      className={[
        "relative flex w-32 flex-col items-center gap-1 rounded-2xl border p-2 text-center sm:w-36",
        fellowship ? "border-sky-300/50 bg-[linear-gradient(170deg,#1b3561,#0a1222)] shadow-[0_0_24px_rgba(56,189,248,0.2)]" : "border-red-400/50 bg-[linear-gradient(170deg,#651515,#170606)] shadow-[0_0_24px_rgba(239,68,68,0.25)]",
        flip ? "lotr-card-flip" : "",
        dead ? "lotr-dead grayscale" : "",
      ].join(" ")}
    >
      {label && <span className="text-[9px] font-bold tracking-widest text-white/50">{label}</span>}
      <span className="text-4xl">{c.emoji}</span>
      <span className="font-serif text-sm font-black text-amber-100">{c.name}</span>
      <span className="text-[10px] text-amber-300">기본 전투력 {c.basePower}</span>
      <span className="text-[9px] leading-tight text-white/55">
        <b className="text-white/75">{c.abilityName}</b> · {c.abilityDescription}
      </span>
      {power != null && <span className="mt-1 rounded-full bg-black/40 px-2 py-0.5 font-serif text-lg font-black text-yellow-300">⚔ {power}</span>}
      {dead && <span className="absolute inset-0 flex items-center justify-center text-5xl">💀</span>}
    </div>
  );
}
