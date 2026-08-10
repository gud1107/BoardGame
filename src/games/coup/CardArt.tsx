/**
 * Pure presentation for the 5 캐릭터 cards — no game logic. This game has no
 * provided card photography (`boardGameRule/레지스탕스 쿠/` holds only the
 * rulebook markdown), so every card face is drawn with CSS/emoji, same
 * approach as coyote/CardArt.tsx.
 */
import { CHARACTER_EMOJI, CHARACTER_NAMES, type Card, type Character } from "./engine";

const CHARACTER_BG: Record<Character, string> = {
  duke: "linear-gradient(160deg,#4a3010 0%,#241808 55%,#100c03 100%)",
  assassin: "linear-gradient(160deg,#3a1024 0%,#1e0a15 55%,#0a0308 100%)",
  contessa: "linear-gradient(160deg,#123a2e 0%,#0a2118 55%,#04120c 100%)",
  captain: "linear-gradient(160deg,#123048 0%,#0a1a28 55%,#040d14 100%)",
  ambassador: "linear-gradient(160deg,#2a1848 0%,#160c28 55%,#0a0514 100%)",
};

const CHARACTER_BORDER: Record<Character, string> = {
  duke: "border-amber-300/50",
  assassin: "border-rose-400/50",
  contessa: "border-emerald-300/50",
  captain: "border-sky-300/50",
  ambassador: "border-purple-300/50",
};

export { CHARACTER_EMOJI, CHARACTER_NAMES };

const DIMS = { xs: "h-12 w-9", sm: "h-16 w-12", md: "h-24 w-16", lg: "h-32 w-22" } as const;
const TEXT_LABEL = { xs: "text-[9px]", sm: "text-[10px]", md: "text-xs", lg: "text-sm" } as const;
const TEXT_EMOJI = { xs: "text-base", sm: "text-lg", md: "text-2xl", lg: "text-3xl" } as const;

export function CardBack({ size = "md", className = "" }: { size?: keyof typeof DIMS; className?: string }) {
  return (
    <div
      className={`flex ${DIMS[size]} shrink-0 items-center justify-center rounded-lg border border-white/15 bg-[repeating-linear-gradient(135deg,#1a0d2e_0px,#1a0d2e_6px,#120822_6px,#120822_12px)] ${className}`}
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
  return (
    <div
      className={`relative flex ${DIMS[size]} shrink-0 flex-col items-center justify-between rounded-lg border p-1 transition ${CHARACTER_BORDER[card.character]} ${
        dead ? "opacity-45 grayscale" : ""
      } ${highlight ? "shadow-[0_0_16px_-2px_rgba(251,191,36,0.85)] ring-2 ring-amber-300/70" : ""} ${className}`}
      style={{ background: CHARACTER_BG[card.character] }}
    >
      <span className={TEXT_EMOJI[size]}>{CHARACTER_EMOJI[card.character]}</span>
      <span className={`${TEXT_LABEL[size]} leading-tight font-bold text-white/90`}>{CHARACTER_NAMES[card.character]}</span>
      {dead && <span className="absolute top-0.5 right-0.5 text-[9px]">💀</span>}
    </div>
  );
}

export function CoinStack({ coins }: { coins: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-xs font-bold text-amber-200">
      🪙 {coins}
    </span>
  );
}
