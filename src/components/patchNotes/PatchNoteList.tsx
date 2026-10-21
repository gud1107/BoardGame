import { getPatchNoteGameMeta, type PatchNoteChange, type PatchNoteChangeType } from "@/constants/patchNotes";
import { groupPatchNotesByDay, type PatchNoteDay, type PatchNoteDayGroup } from "@/constants/patchNoteDays";

const TYPE_META: Record<PatchNoteChangeType, { label: string; className: string }> = {
  FEAT: { label: "NEW", className: "bg-emerald-500/20 text-emerald-300 light:bg-emerald-100 light:text-emerald-800" },
  IMPROVE: { label: "IMPROVE", className: "bg-sky-500/20 text-sky-300 light:bg-sky-100 light:text-sky-800" },
  FIX: { label: "FIX", className: "bg-rose-500/20 text-rose-300 light:bg-rose-100 light:text-rose-800" },
};

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

function ChangeLines({ changes, className = "" }: { changes: PatchNoteChange[]; className?: string }) {
  return (
    <ul className={`flex flex-col gap-1 ${className}`}>
      {changes.map((change, i) => (
        <ChangeLine key={i} change={change} />
      ))}
    </ul>
  );
}

/** A folded group: summary line + "N개 보기", all lines behind a native `<details>`. */
function CollapsedGroup({ group }: { group: PatchNoteDayGroup }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-1.5 gap-y-0.5 rounded-lg px-1 py-0.5 hover:bg-white/5 light:hover:bg-slate-200/60 [&::-webkit-details-marker]:hidden">
        <span className="text-white/85 light:text-slate-700">{group.summary}</span>
        <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-white/55 group-hover:text-white/80 light:bg-slate-200 light:text-slate-500 light:group-hover:text-slate-700">
          <span className="group-open:hidden">▾ 변경 {group.changes.length}개 보기</span>
          <span className="hidden group-open:inline">▴ 접기</span>
        </span>
      </summary>
      <ChangeLines changes={group.changes} className="mt-1.5" />
    </details>
  );
}

function DayCard({ day }: { day: PatchNoteDay }) {
  const newest = day.entries[0];
  const oldest = day.entries[day.entries.length - 1];
  return (
    <li className="rounded-2xl border border-white/10 bg-white/5 p-4 light:border-slate-200 light:bg-slate-50">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-200 light:bg-rose-100 light:text-rose-800">
          {day.entries.length > 1 ? `${oldest.version} ~ ${newest.version}` : newest.version}
        </span>
        <span className="text-xs text-white/40 light:text-slate-400">{day.releaseDate}</span>
        <span className="text-sm font-semibold text-white light:text-slate-900">
          {day.entries.map((e) => e.title).join(" · ")}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {day.groups.map((group) => {
          const gameMeta = getPatchNoteGameMeta(group.game);
          return (
            <li
              key={group.game}
              className="flex flex-wrap items-start gap-1.5 text-xs leading-relaxed text-white/70 sm:text-[13px] light:text-slate-600"
            >
              <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-white/70 light:bg-slate-200 light:text-slate-600">
                {gameMeta.emoji} {gameMeta.label}
              </span>
              <div className="flex-1 basis-60">
                {group.collapsed ? <CollapsedGroup group={group} /> : <ChangeLines changes={group.changes} />}
              </div>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/**
 * Full release timeline — one card per **release date** (2026-10-21; was one
 * per version), newest on top. A day's versions share a card and each game's
 * lines that day share one badge; a game with many lines that day starts
 * folded behind its one-line summary (`patchNoteDays.ts`). Shared by both
 * `/patch-notes` (the full page, for direct links) and the header
 * `PatchNoteButton`'s `Overlay` popup (2026-09-09 — a modal so opening it
 * in-game doesn't navigate away and unmount the current game room; see
 * `PatchNoteButton.tsx`'s doc comment). Native `<details>` keeps this a
 * server component.
 */
export default function PatchNoteList() {
  return (
    <ol className="flex flex-col gap-3">
      {groupPatchNotesByDay().map((day) => (
        <DayCard key={day.releaseDate} day={day} />
      ))}
    </ol>
  );
}
