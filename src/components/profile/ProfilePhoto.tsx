"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { portraitKey, useMyCharacter } from "@/lib/character/myCharacter";
import { useProfileStore } from "@/store/profileStore";
import { getAuthSupabase } from "@/lib/supabase/authClient";
import { publishPortrait, shrinkPortrait } from "@/lib/stats/gameChampions";

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

/**
 * Keeps the signed-in player's public portrait (shown next to their name on
 * the per-game boards) in step with the profile picture: the character
 * portrait while that is the picture, cleared otherwise — an uploaded photo
 * already reaches the boards as `public_avatar_url`. Mount once (SiteHeader).
 */
export function PublicPortraitPublisher() {
  const character = useMyCharacter((s) => s.character);
  const portrait = useMyCharacter((s) => s.portrait);
  const mode = useMyCharacter((s) => s.photoMode);
  const hydrated = useMyCharacter((s) => s.hydrated);
  const [authTick, setAuthTick] = useState(0);
  useEffect(() => {
    const supabase = getAuthSupabase();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") setAuthTick((t) => t + 1);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const fresh = character && portrait && portrait.key === portraitKey(character) ? portrait : null;
    // a character still waiting for its portrait: wait for OwnPortraitKeeper
    if (mode === "character" && character && !fresh) return;
    let cancelled = false;
    void (async () => {
      if (mode === "character" && fresh) {
        const small = await shrinkPortrait(fresh.url);
        if (!cancelled && small) await publishPortrait(fresh.key, small);
      } else {
        await publishPortrait("none", null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, character, portrait, mode, authTick]);
  return null;
}
