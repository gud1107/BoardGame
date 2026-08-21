import type { ItemId } from "./engine";

/**
 * Real card-art photos synced from `boardGameRule/소환사의 협곡/` (user-provided
 * League of Legends splash-art crops used as this parody's item/monster
 * cards) into `public/images/summoners-rift/` — same "real box-cover asset
 * when we have one" convention as `public/games/<gameId>.*`
 * (GameThumbnail.tsx), just scoped to per-card art instead of one hub
 * thumbnail. No card-back photo was provided in that folder (the two
 * "설명카드" files are printed rules pages, not a card-back texture), so the
 * face-down Rift pile is rendered as a pure-CSS back (`DeckBack` in
 * `CardArt.tsx`) instead, matching how every other game in this project
 * renders hidden-card backs.
 */
/** The shared champion tile (rulebook §2-A, base HP 3) — synced from `boardGameRule/소환사의 협곡/용사.png`. Its "HP:3" label is baked into the art itself (the base HP never changes), so this is rendered as a static tile; the *live* total HP (base + equipped item bonuses) is computed separately (see `computeTotalHp`) and shown alongside it, never overlaid on this image. */
export const HERO_IMAGE = "/images/summoners-rift/champion/hero.png";

export const ITEM_IMAGES: Record<ItemId, string> = {
  1: "/images/summoners-rift/items/i1-ruby-crystal.jpg",
  2: "/images/summoners-rift/items/i2-javelin.jpg",
  3: "/images/summoners-rift/items/i3-sivir-spellshield.jpg",
  4: "/images/summoners-rift/items/i4-rammus.jpg",
  5: "/images/summoners-rift/items/i5-golden-spatula.jpg",
  6: "/images/summoners-rift/items/i6-smite.jpg",
};

export const MONSTER_IMAGES: Record<number, string> = {
  1: "/images/summoners-rift/monsters/m1-cannon-minion.jpg",
  2: "/images/summoners-rift/monsters/m2-zed.jpg",
  3: "/images/summoners-rift/monsters/m3-sion.jpg",
  4: "/images/summoners-rift/monsters/m4-vladimir.jpg",
  5: "/images/summoners-rift/monsters/m5-malphite.jpg",
  6: "/images/summoners-rift/monsters/m6-karthus.jpg",
  7: "/images/summoners-rift/monsters/m7-mordekaiser.jpg",
  9: "/images/summoners-rift/monsters/m9-dragon.jpg",
};
