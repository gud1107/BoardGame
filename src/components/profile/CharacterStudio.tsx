"use client";

import { useState, type ReactNode } from "react";
import Overlay from "@/components/Overlay";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import CharacterPicker, { CharacterCustomizer } from "./CharacterPicker";

/**
 * The character picker in a modal, with 직접 꾸미기 one tap away instead of at the
 * bottom of the list: on PC (≥1024px) it opens as a panel to the right — the modal
 * widens and the panel stays in view while the list scrolls; on smaller screens it
 * replaces the list, with a back button. `children` render above the picker (the
 * profile's name/photo section).
 */
export default function CharacterStudio({ title, onClose, children }: { title: string; onClose: () => void; children?: ReactNode }) {
  const [customizing, setCustomizing] = useState(false);
  const sideBySide = useMediaQuery("(min-width: 1024px)");

  if (customizing && !sideBySide)
    return (
      <Overlay title={title} onClose={onClose}>
        <CharacterCustomizer onDone={() => setCustomizing(false)} doneLabel="← 캐릭터 목록" />
      </Overlay>
    );

  const list = (
    <div className="flex flex-col items-center gap-4">
      {children}
      <CharacterPicker showPreview={!customizing} customizing={customizing} onCustomize={() => setCustomizing((v) => !v)} />
    </div>
  );
  if (!customizing)
    return (
      <Overlay title={title} onClose={onClose}>
        {list}
      </Overlay>
    );
  return (
    <Overlay title={title} onClose={onClose} wide="xl">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6">
        {list}
        {/* stays in view (with its preview) while the list column scrolls */}
        <div className="sticky top-0 max-h-[calc(85vh-7rem)] self-start overflow-y-auto overscroll-contain rounded-xl border border-white/10 p-3 light:border-slate-200">
          <CharacterCustomizer onDone={() => setCustomizing(false)} doneLabel="닫기 ×" />
        </div>
      </div>
    </Overlay>
  );
}
