import {
  PATCH_NOTES,
  getPatchNoteGameMeta,
  type PatchNoteChange,
  type PatchNoteChangeType,
  type PatchNoteGameTag,
} from "@/constants/patchNotes";

const TYPE_META: Record<PatchNoteChangeType, { label: string; className: string }> = {
  FEAT: { label: "NEW", className: "bg-emerald-500/20 text-emerald-300 light:bg-emerald-100 light:text-emerald-800" },
  IMPROVE: { label: "IMPROVE", className: "bg-sky-500/20 text-sky-300 light:bg-sky-100 light:text-sky-800" },
  FIX: { label: "FIX", className: "bg-rose-500/20 text-rose-300 light:bg-rose-100 light:text-rose-800" },
};

/**
 * A same-game group longer than this folds its extra lines behind a
 * "N개 더 보기" toggle, showing only the first `COLLAPSED_VISIBLE` lines.
 */
const COLLAPSE_OVER = 4;
const COLLAPSED_VISIBLE = 3;

function ChangeLine({ change }: { change: PatchNoteChange }) {
  const typeMeta = TYPE_META[change.type];
  return (
    <li className="flex items-start gap-1.5">
      <span className={`shrink-0 rounded-full px-1.5 py-0.5 font-semibold ${typeMeta.className}`}>
        {typeMeta.label}
      </span>
      <span className="flex-1">{change.desc}</span>
    </li>
  );
}

/** Same-game changes within one release, in first-appearance order. */
function groupByGame(changes: PatchNoteChange[]) {
  const groups = new Map<PatchNoteGameTag, PatchNoteChange[]>();
  for (const change of changes) {
    const group = groups.get(change.game);
    if (group) group.push(change);
    else groups.set(change.game, [change]);
  }
  return [...groups];
}

/**
 * Full release timeline — one card per `PatchNoteEntry`, newest on top
 * (array order, see `patchNotes.ts`), each change rendered as a single
 * scannable line ([게임 뱃지] [타입 뱃지] 설명) rather than prose. Shared by
 * both `/patch-notes` (the full page, for direct links) and the header
 * `PatchNoteButton`'s `Overlay` popup (2026-09-09 — reverted back to also
 * backing a modal so opening it in-game doesn't navigate away and unmount
 * the current game room; see `PatchNoteButton.tsx`'s doc comment).
 * Changes for the same game in one release share a single game badge
 * (2026-10-11) instead of repeating it on every line; long groups fold
 * behind a native `<details>` so this stays a server component.
 */
export default function PatchNoteList() {
  return (
    <ol className="flex flex-col gap-3">
      {PATCH_NOTES.map((entry) => (
        <li key={entry.version} className="rounded-2xl border border-white/10 bg-white/5 p-4 light:border-slate-200 light:bg-slate-50">
          <div className="mb-2.5 flex flex-wrap items-baseline gap-2">
            <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-200 light:bg-rose-100 light:text-rose-800">
              {entry.version}
            </span>
            <span className="text-xs text-white/40 light:text-slate-400">{entry.releaseDate}</span>
            <span className="text-sm font-semibold text-white light:text-slate-900">{entry.title}</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {groupByGame(entry.changes).map(([game, changes]) => {
              const gameMeta = getPatchNoteGameMeta(game);
              return (
                <li
                  key={game}
                  className="flex flex-wrap items-start gap-1.5 text-xs leading-relaxed text-white/70 sm:text-[13px] light:text-slate-600"
                >
                  <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-white/70 light:bg-slate-200 light:text-slate-600">
                    {gameMeta.emoji} {gameMeta.label}
                  </span>
                  <div className="flex flex-1 basis-60 flex-col gap-1">
                    <ul className="flex flex-col gap-1">
                      {(changes.length > COLLAPSE_OVER ? changes.slice(0, COLLAPSED_VISIBLE) : changes).map(
                        (change, i) => (
                          <ChangeLine key={i} change={change} />
                        ),
                      )}
                    </ul>
                    {changes.length > COLLAPSE_OVER && (
                      <details className="group">
                        <summary className="w-fit cursor-pointer list-none rounded-full px-1.5 py-0.5 text-white/50 hover:bg-white/10 hover:text-white/80 light:text-slate-500 light:hover:bg-slate-200 light:hover:text-slate-700 [&::-webkit-details-marker]:hidden">
                          <span className="group-open:hidden">
                            ▾ {changes.length - COLLAPSED_VISIBLE}개 더 보기
                          </span>
                          <span className="hidden group-open:inline">▴ 접기</span>
                        </summary>
                        <ul className="mt-1 flex flex-col gap-1">
                          {changes.slice(COLLAPSED_VISIBLE).map((change, i) => (
                            <ChangeLine key={i} change={change} />
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
