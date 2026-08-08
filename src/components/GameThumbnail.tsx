import Image from "next/image";
import type { GameMeta } from "@/games/types";

/**
 * Renders a game's box-cover photo when the registry entry has one
 * (`thumbnail.image`, see `src/games/types.ts`), falling back to the
 * generated emoji-on-gradient look otherwise — the same "real asset when we
 * have one, procedural placeholder when we don't" split this project
 * already uses for Perudo's face icon vs. its 3D dice colorways. Every
 * caller wraps this in its own sized `relative` container (`next/image`'s
 * `fill` needs one); pass `imageClassName` for image-specific overrides
 * (e.g. `object-cover` vs `object-contain`) separate from the emoji's own
 * `className`.
 */
export default function GameThumbnail({
  game,
  className,
  imageClassName,
  imageSizes,
}: {
  game: GameMeta;
  /** Applied to the emoji `<span>` fallback only. */
  className?: string;
  /** Applied to the `<Image>` when a box-cover photo is available. */
  imageClassName?: string;
  imageSizes?: string;
}) {
  if (game.thumbnail.image) {
    return (
      <Image
        src={game.thumbnail.image}
        alt={`${game.name} 박스 이미지`}
        fill
        sizes={imageSizes ?? "200px"}
        className={imageClassName ?? "object-cover"}
      />
    );
  }
  return <span className={className}>{game.thumbnail.emoji}</span>;
}
