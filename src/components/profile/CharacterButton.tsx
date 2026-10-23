"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { portraitKey, useMyCharacter } from "@/lib/character/myCharacter";
import CharacterPicker from "./CharacterPicker";

/** Opens the 3D character picker — next to every online game's room nickname field, so guests can pick too. */
export default function CharacterButton() {
  const [open, setOpen] = useState(false);
  const character = useMyCharacter((s) => s.character);
  const portrait = useMyCharacter((s) => s.portrait);
  const face = character && portrait?.key === portraitKey(character) ? portrait.url : null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 self-start text-xs text-white/50 underline hover:text-white/80 light:text-slate-500 light:hover:text-slate-700"
      >
        {face ? (
          // eslint-disable-next-line @next/next/no-img-element -- runtime-rendered data URL
          <img src={face} alt="" width={24} height={24} className="h-6 w-6 rounded-full border border-white/20 object-cover light:border-slate-300" />
        ) : (
          "🧑‍🎤"
        )}{" "}
        {face ? "내 3D 캐릭터 바꾸기" : "내 3D 캐릭터 고르기"}
      </button>
      {open && (
        <Overlay title="🧑‍🎤 내 3D 캐릭터" onClose={() => setOpen(false)}>
          <CharacterPicker />
        </Overlay>
      )}
    </>
  );
}
