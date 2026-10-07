"use client";

import { CHARACTERS } from "./arenaArt";
import { CharacterAvatar } from "./ArenaCanvas";
import { MAP_IDS, MAPS, type MapId } from "./maps";

/** Grid of the selectable characters; `takenBy` greys out ones another player already picked. */
export function CharacterPicker({ value, onChange, takenBy = {} }: { value: number | null; onChange: (c: number) => void; takenBy?: Record<number, string> }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      {CHARACTERS.map((art, c) => {
        const owner = takenBy[c];
        const selected = value === c;
        return (
          <button
            key={art.name}
            type="button"
            disabled={owner !== undefined && !selected}
            onClick={() => onChange(c)}
            title={owner ? `${owner} 님이 골랐어요` : art.name}
            className={`flex flex-col items-center gap-0.5 rounded-xl border-2 px-1 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-35 ${
              selected ? "scale-105 shadow-md" : "border-white/10 hover:border-white/30 light:border-slate-200 light:hover:border-slate-400"
            }`}
            style={selected ? { borderColor: art.base, background: `${art.light}55` } : undefined}
          >
            <CharacterAvatar char={c} size={40} />
            <span className="text-[10px] leading-tight font-semibold text-white/80 light:text-slate-700">{art.name}</span>
            {owner && !selected && <span className="max-w-full truncate text-[9px] text-white/40 light:text-slate-400">{owner}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function MapPicker({ value, onChange }: { value: MapId | "random"; onChange: (m: MapId | "random") => void }) {
  const options: (MapId | "random")[] = [...MAP_IDS, "random"];
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
      {options.map((m) => {
        const info = m === "random" ? { emoji: "🎲", name: "랜덤", rule: "매 판 무작위 맵" } : MAPS[m];
        const selected = value === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={`flex flex-col items-start gap-0.5 rounded-xl border-2 px-2 py-1.5 text-left transition ${
              selected ? "border-emerald-400 bg-emerald-500/15 light:bg-emerald-50" : "border-white/10 hover:border-white/30 light:border-slate-200 light:hover:border-slate-400"
            }`}
          >
            <span className="text-xs font-bold text-white light:text-slate-800">
              {info.emoji} {info.name}
            </span>
            <span className="text-[10px] leading-tight text-white/50 light:text-slate-500">{info.rule}</span>
          </button>
        );
      })}
    </div>
  );
}

export function mapLabel(m: MapId | "random" | undefined): string {
  if (!m) return "";
  return m === "random" ? "🎲 랜덤 맵" : `${MAPS[m].emoji} ${MAPS[m].name}`;
}
