/**
 * Pure presentation for the 5 캐릭터 cards — no game logic. `boardGameRule/
 * 레지스탕스 쿠/카드1.jpg` (added since the last pass) shows the real card
 * photography, so the per-character palette below now tracks each card's
 * actual dominant color (Duke = magenta/purple ornate border, Contessa =
 * warm rust-red, Ambassador = gold/amber robe, Assassin = near-black
 * tactical, Captain = cool blue) instead of the earlier arbitrary mapping.
 * No original card art is reproduced. Faces are CSS/emoji by default; once
 * every character has an original oil portrait (generated offline, see
 * HANDOFF.md 이미지 생성 도구) it is painted underneath via `PORTRAIT`, with
 * the emoji kept as a corner badge and the name overlaid in code.
 */
import SkinBackFace from "@/components/skins/SkinBackFace";
import { useCardBackSkin } from "@/lib/skins/useSkins";
import { usePortrait } from "../shared/portrait/usePortrait";
import { CHARACTER_EMOJI, CHARACTER_NAMES, type Card, type Character } from "./engine";

/** Fill only when all 5 portraits exist — a half-painted deck reads as two different games. */
export const PORTRAIT: Partial<Record<Character, string>> = {
  duke: "/images/coup/duke.webp",
  assassin: "/images/coup/assassin.webp",
  contessa: "/images/coup/contessa.webp",
  captain: "/images/coup/captain.webp",
  ambassador: "/images/coup/ambassador.webp",
};

const CHARACTER_BG: Record<Character, string> = {
  duke: "linear-gradient(160deg,#4a1048 0%,#260826 55%,#100310 100%)",
  assassin: "linear-gradient(160deg,#20242c 0%,#121418 55%,#050608 100%)",
  contessa: "linear-gradient(160deg,#5a2010 0%,#2c1008 55%,#120602 100%)",
  captain: "linear-gradient(160deg,#123048 0%,#0a1a28 55%,#040d14 100%)",
  ambassador: "linear-gradient(160deg,#4a3010 0%,#241808 55%,#100c03 100%)",
};

const CHARACTER_BORDER: Record<Character, string> = {
  duke: "border-fuchsia-300/50",
  assassin: "border-slate-300/40",
  contessa: "border-orange-400/50",
  captain: "border-sky-300/50",
  ambassador: "border-amber-300/50",
};

export { CHARACTER_EMOJI, CHARACTER_NAMES };

const DIMS = { xs: "h-12 w-9", sm: "h-16 w-12", md: "h-24 w-16", lg: "h-32 w-22" } as const;
const TEXT_LABEL = { xs: "text-[9px]", sm: "text-[10px]", md: "text-xs", lg: "text-sm" } as const;
const TEXT_EMOJI = { xs: "text-base", sm: "text-lg", md: "text-2xl", lg: "text-3xl" } as const;

/** `owner` = the seat name holding it — their 🎨 card-back skin replaces the default when they picked one. */
export function CardBack({ size = "md", className = "", owner }: { size?: keyof typeof DIMS; className?: string; owner?: string }) {
  const skin = useCardBackSkin(owner);
  if (skin) return <SkinBackFace skin={skin} className={`${DIMS[size]} ${className}`} emblemClassName={TEXT_EMOJI[size]} />;
  return (
    <div
      className={`flex ${DIMS[size]} shrink-0 items-center justify-center rounded-lg border border-white/15 bg-[repeating-linear-gradient(135deg,#1a0d2e_0px,#1a0d2e_6px,#120822_6px,#120822_12px)] light:border-slate-300 light:shadow-sm ${className}`}
    >
      <span className="text-white/30">🂠</span>
    </div>
  );
}

export function CharacterCardFace({
  card,
  size = "md",
  dead = false,
  highlight = false,
  className = "",
}: {
  card: Card;
  size?: keyof typeof DIMS;
  /** Revealed/eliminated cards render face-up but visually "dead" (desaturated). */
  dead?: boolean;
  highlight?: boolean;
  className?: string;
}) {
  const art = usePortrait(PORTRAIT[card.character]);
  return (
    <div
      className={`relative flex ${DIMS[size]} shrink-0 flex-col items-center overflow-hidden rounded-lg border transition light:shadow-sm ${
        art.show ? "justify-end p-0" : "justify-between p-1"
      } ${CHARACTER_BORDER[card.character]} ${dead ? "opacity-45 grayscale" : ""} ${
        highlight ? "shadow-[0_0_16px_-2px_rgba(251,191,36,0.85)] ring-2 ring-amber-300/70" : ""
      } ${className}`}
      style={{ background: CHARACTER_BG[card.character] }}
    >
      {art.img}
      {art.show ? (
        <>
          <span className={`absolute top-0.5 left-0.5 rounded-md bg-black/55 px-0.5 ${TEXT_LABEL[size]} leading-none`}>
            {CHARACTER_EMOJI[card.character]}
          </span>
          <span
            className={`${TEXT_LABEL[size]} relative w-full bg-gradient-to-b from-transparent to-black/85 px-0.5 pt-[30%] pb-1 text-center leading-tight font-bold text-white/95 [text-shadow:0_1px_2px_#000]`}
          >
            {CHARACTER_NAMES[card.character]}
          </span>
        </>
      ) : (
        <>
          <span className={TEXT_EMOJI[size]}>{CHARACTER_EMOJI[card.character]}</span>
          <span className={`${TEXT_LABEL[size]} leading-tight font-bold text-white/90`}>{CHARACTER_NAMES[card.character]}</span>
        </>
      )}
      {dead && <span className="absolute top-0.5 right-0.5 text-[9px]">💀</span>}
    </div>
  );
}

/** What holding this card lets you do *truthfully* — mirrors engine.ts CLAIMED_CHARACTER_FOR_ACTION / BLOCK_CHARACTERS. */
export const CHARACTER_ABILITY: Record<Character, { act?: string; block?: string }> = {
  duke: { act: "👑 세금 +3🪙", block: "💸 외화 도입" },
  assassin: { act: "🗡️ 암살 (3🪙)" },
  contessa: { block: "🗡️ 암살" },
  captain: { act: "⚓ 갈취 2🪙", block: "⚓ 갈취" },
  ambassador: { act: "🕊️ 카드 교환", block: "⚓ 갈취" },
};

/** 행동/방어 caption shown under the viewer's own face-up hand cards — that panel is always dark, so no light: overrides. */
export function AbilityCaption({ character, active = false }: { character: Character; active?: boolean }) {
  const a = CHARACTER_ABILITY[character];
  const line = (tag: string, tagClass: string, text: string) => (
    <span className="flex items-center gap-1">
      <span className={`rounded px-1 py-px text-[9px] leading-none font-bold sm:text-[10px] ${tagClass}`}>{tag}</span>
      <span className="font-semibold">{text}</span>
    </span>
  );
  return (
    <div
      className={`flex min-w-16 flex-col gap-1 rounded-lg border px-1.5 py-1 text-[11px] leading-tight whitespace-nowrap shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition sm:text-xs ${
        active
          ? "border-emerald-300/80 bg-emerald-500/20 text-emerald-50 shadow-[0_0_12px_-3px_rgba(52,211,153,0.8)]"
          : `${CHARACTER_BORDER[character]} text-amber-50/95`
      }`}
      style={active ? undefined : { background: "linear-gradient(180deg,rgba(255,255,255,0.07) 0%,rgba(0,0,0,0.35) 100%)" }}
    >
      {a.act && line("⚡ 행동", "bg-amber-300 text-amber-950", a.act)}
      {a.block && line("🛡️ 방어", "bg-sky-300 text-sky-950", a.block)}
    </div>
  );
}

export function CoinStack({ coins }: { coins: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-xs font-bold text-amber-200 light:border-amber-400 light:bg-amber-50 light:text-amber-700 light:shadow-sm">
      🪙 {coins}
    </span>
  );
}
