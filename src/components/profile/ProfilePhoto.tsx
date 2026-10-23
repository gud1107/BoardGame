"use client";

import { useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { portraitKey, useMyCharacter } from "@/lib/character/myCharacter";
import { useProfileStore } from "@/store/profileStore";

const CharacterThumbs3D = dynamic(() => import("./CharacterThumbs3D"), { ssr: false });

/** The `CharacterThumbs3D` cache key of the player's own character portrait. */
const ownKey = (key: string) => `me-face:${key}`;

/**
 * The picture the profile shows (header, profile modal, /account): the chosen
 * 3D character's portrait, unless the player switched to an uploaded image
 * (`photoMode: "upload"`). Falls back to whichever exists; null → Avatar's default.
 */
export function useProfilePhoto(): string | null {
  const uploaded = useProfileStore((s) => s.avatarUrl);
  const character = useMyCharacter((s) => s.character);
  const portrait = useMyCharacter((s) => s.portrait);
  const mode = useMyCharacter((s) => s.photoMode);
  const init = useMyCharacter((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
  const own = character && portrait && portrait.key === portraitKey(character) ? portrait.url : null;
  if (mode === "upload" && uploaded) return uploaded;
  return own ?? uploaded;
}

/**
 * Renders the own character's portrait off-screen whenever it is missing or
 * out of date (first visit on a new device, or right after re-styling).
 * Mount once near the root (SiteHeader); three.js only loads when needed.
 */
export function OwnPortraitKeeper() {
  const character = useMyCharacter((s) => s.character);
  const portrait = useMyCharacter((s) => s.portrait);
  const setPortrait = useMyCharacter((s) => s.setPortrait);
  const init = useMyCharacter((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
  const key = character ? portraitKey(character) : null;
  const items = useMemo(() => (character && key ? [{ key: ownKey(key), look: character }] : []), [character, key]);
  const onShot = useCallback(
    (k: string, url: string) => {
      if (key && k === ownKey(key)) setPortrait({ key, url });
    },
    [key, setPortrait],
  );
  if (!key || portrait?.key === key) return null;
  return <CharacterThumbs3D items={items} onShot={onShot} framing="face" />;
}
