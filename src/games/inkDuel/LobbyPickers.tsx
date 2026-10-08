"use client";

import { CHARACTERS } from "./arenaArt";
import { CharacterAvatar } from "./ArenaCanvas";
import { MAP_IDS, MAPS, type MapId } from "./maps";
import { DEFAULT_STOP_RULES, STOP_RULE_OPTIONS, type StopRules } from "./engine";
import { DEFAULT_RT_RULES, RT_PRESETS, RT_RULE_OPTIONS, sameRules, type RtRules } from "./realtime";

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

export type GameMode = "stop" | "moving";

const MODES: { id: GameMode; emoji: string; name: string; desc: string }[] = [
  { id: "stop", emoji: "🛑", name: "스탑 모드", desc: "포트리스처럼 한 명씩 차례대로 — 천천히 그리고 조준" },
  { id: "moving", emoji: "🏃", name: "무빙 모드", desc: "모두 동시에 실시간으로 뛰어다니며 공격 · 3분" },
];

export function ModePicker({ value, onChange }: { value: GameMode; onChange: (m: GameMode) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onChange(m.id)}
          className={`flex flex-col items-start gap-0.5 rounded-xl border-2 px-2.5 py-2 text-left transition ${
            value === m.id ? "border-amber-400 bg-amber-500/15 light:bg-amber-50" : "border-white/10 hover:border-white/30 light:border-slate-200 light:hover:border-slate-400"
          }`}
        >
          <span className="text-sm font-bold text-white light:text-slate-800">
            {m.emoji} {m.name}
          </span>
          <span className="text-[10px] leading-tight text-white/50 light:text-slate-500">{m.desc}</span>
        </button>
      ))}
    </div>
  );
}

type RuleRow = { label: string; title: string; options: { label: string; value: number }[] };

/** One segmented row per setting (shared by both modes' settings pickers). */
function RuleRows<T extends object>({ rows, value, onChange }: { rows: { [K in keyof T]: RuleRow }; value: T; onChange: (r: T) => void }) {
  return (
    <>
      {(Object.keys(rows) as (keyof T)[]).map((key) => {
        const row = rows[key];
        return (
          <div key={String(key)} className="flex items-center gap-2" title={row.title}>
            <span className="w-20 shrink-0 text-[11px] font-semibold text-white/70 light:text-slate-600">{row.label}</span>
            <div className="grid flex-1 grid-cols-3 gap-1">
              {row.options.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => onChange({ ...value, [key]: o.value })}
                  className={`rounded-lg border px-1 py-1 text-[11px] font-semibold transition ${
                    (value[key] as unknown as number) === o.value ? "border-amber-400 bg-amber-500/20 text-white light:text-amber-800" : "border-white/10 text-white/60 hover:border-white/30 light:border-slate-200 light:text-slate-600"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** 🏃 Moving-mode tuning: preset buttons + one segmented row per rule (host only). */
export function RtRulesPicker({ value, onChange }: { value: RtRules; onChange: (r: RtRules) => void }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/5 p-2 light:bg-amber-50/60">
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {RT_PRESETS.map((p) => {
          const on = sameRules(value, p.rules);
          return (
            <button
              key={p.id}
              type="button"
              title={p.desc}
              onClick={() => onChange(p.rules)}
              className={`flex flex-col items-start rounded-lg border-2 px-2 py-1 text-left transition ${
                on ? "border-amber-400 bg-amber-500/20" : "border-white/10 hover:border-white/30 light:border-slate-200 light:hover:border-slate-400"
              }`}
            >
              <span className="text-xs font-bold text-white light:text-slate-800">
                {p.emoji} {p.name}
              </span>
              <span className="text-[9px] leading-tight text-white/50 light:text-slate-500">{p.desc}</span>
            </button>
          );
        })}
      </div>
      <RuleRows rows={RT_RULE_OPTIONS} value={value} onChange={onChange} />
    </div>
  );
}

/** 🛑 Stop-mode settings (host only). */
export function StopRulesPicker({ value, onChange }: { value: StopRules; onChange: (r: StopRules) => void }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-sky-400/30 bg-sky-400/5 p-2 light:bg-sky-50/60">
      <RuleRows rows={STOP_RULE_OPTIONS} value={value} onChange={onChange} />
    </div>
  );
}

function nonDefault<T extends object>(rows: { [K in keyof T]: RuleRow }, value: T, defaults: T): string {
  return (Object.keys(rows) as (keyof T)[])
    .map((key) => {
      const v = value[key] as unknown as number;
      const opt = rows[key].options.find((o) => o.value === v);
      return opt && v !== (defaults[key] as unknown as number) ? `${rows[key].label} ${opt.label}` : null;
    })
    .filter((x): x is string => x !== null)
    .join(" · ");
}

/** Guest-facing summary of the moving-mode settings: the preset name, or the non-default rows. */
export function rtRulesLabel(r: RtRules | undefined): string {
  if (!r) return "";
  const preset = RT_PRESETS.find((p) => p.id !== "default" && sameRules(p.rules, r));
  return preset ? `${preset.emoji} ${preset.name}` : nonDefault(RT_RULE_OPTIONS, r, DEFAULT_RT_RULES);
}

export function stopRulesLabel(r: StopRules | undefined): string {
  return r ? nonDefault(STOP_RULE_OPTIONS, r, DEFAULT_STOP_RULES) : "";
}

export function modeLabel(m: GameMode | undefined): string {
  if (!m) return "";
  const info = MODES.find((x) => x.id === m)!;
  return `${info.emoji} ${info.name}`;
}

export function mapLabel(m: MapId | "random" | undefined): string {
  if (!m) return "";
  return m === "random" ? "🎲 랜덤 맵" : `${MAPS[m].emoji} ${MAPS[m].name}`;
}
