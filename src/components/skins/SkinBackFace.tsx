import type { CSSProperties } from "react";
import { patternCss, type CardBackSkin } from "@/lib/skins/catalog";

/**
 * A 2D card back in a player's 🎨 skin. The game's own `CardBack` renders this
 * instead of its default art when the card's owner picked a skin — callers keep
 * their own size classes (`className`) so the layout never shifts.
 */
export default function SkinBackFace({ skin, className = "", emblemClassName = "text-base" }: { skin: CardBackSkin; className?: string; emblemClassName?: string }) {
  const style: CSSProperties = { background: patternCss(skin.pattern, skin.colors), borderColor: skin.accent, boxShadow: `inset 0 0 0 2px ${skin.colors[0]}, inset 0 0 0 3px ${skin.accent}55` };
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-lg border-2 ${className}`} style={style} title={`${skin.emoji} ${skin.name}`} aria-label="카드 뒷면">
      <span className={`leading-none drop-shadow ${emblemClassName}`} style={{ color: skin.accent }}>
        {skin.emblem}
      </span>
    </div>
  );
}
