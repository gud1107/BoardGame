"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import CharacterPicker from "./CharacterPicker";

/** Opens the 3D character picker — next to every online game's room nickname field, so guests can pick too. */
export default function CharacterButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs text-white/50 underline hover:text-white/80 light:text-slate-500 light:hover:text-slate-700"
      >
        🧑‍🎤 내 3D 캐릭터 고르기
      </button>
      {open && (
        <Overlay title="🧑‍🎤 내 3D 캐릭터" onClose={() => setOpen(false)}>
          <CharacterPicker />
        </Overlay>
      )}
    </>
  );
}
