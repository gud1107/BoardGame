"use client";

import Overlay from "@/components/Overlay";
import {
  PATCH_NOTES,
  getPatchNoteGameMeta,
  type PatchNoteChangeType,
} from "@/constants/patchNotes";

const TYPE_META: Record<PatchNoteChangeType, { label: string; className: string }> = {
  FEAT: { label: "NEW", className: "bg-emerald-500/20 text-emerald-300" },
  IMPROVE: { label: "IMPROVE", className: "bg-sky-500/20 text-sky-300" },
  FIX: { label: "FIX", className: "bg-rose-500/20 text-rose-300" },
};

/**
 * Compact release-timeline modal — one card per `PatchNoteEntry`, newest on
 * top (array order, see `patchNotes.ts`), each change rendered as a single
 * scannable line ([게임 뱃지] [타입 뱃지] 설명) rather than prose. Reuses the
 * shared `Overlay` (dark theme, bottom-sheet on mobile / centered dialog on
 * desktop, internal scroll capped at 85vh) so this matches every other
 * modal in the app (e.g. `SoundSettingsModal`) instead of introducing a
 * one-off layout.
 */
export default function PatchNoteModal({ onClose }: { onClose: () => void }) {
  const latest = PATCH_NOTES[0];

  return (
    <Overlay
      title={`📋 패치노트 · 최신 ${latest.version} (${latest.releaseDate})`}
      onClose={onClose}
      wide
    >
      <ol className="flex flex-col gap-3">
        {PATCH_NOTES.map((entry) => (
          <li
            key={entry.version}
            className="rounded-xl border border-white/10 bg-white/5 p-3.5"
          >
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-200">
                {entry.version}
              </span>
              <span className="text-xs text-white/40">{entry.releaseDate}</span>
              <span className="text-sm font-semibold text-white">{entry.title}</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {entry.changes.map((change, i) => {
                const gameMeta = getPatchNoteGameMeta(change.game);
                const typeMeta = TYPE_META[change.type];
                return (
                  <li
                    key={i}
                    className="flex flex-wrap items-start gap-1.5 text-xs leading-relaxed text-white/70 sm:text-[13px]"
                  >
                    <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-white/70">
                      {gameMeta.emoji} {gameMeta.label}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 font-semibold ${typeMeta.className}`}
                    >
                      {typeMeta.label}
                    </span>
                    <span className="flex-1 basis-40">{change.desc}</span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </Overlay>
  );
}
