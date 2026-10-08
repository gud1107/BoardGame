"use client";

import { useState } from "react";
import { CHARACTERS } from "./arenaArt";
import { CharacterAvatar } from "./ArenaCanvas";
import { MAP_IDS, MAPS, type MapId } from "./maps";
import { DEFAULT_STOP_RULES, sameStopRules, STOP_PRESETS, STOP_RULE_OPTIONS, type StopRules } from "./engine";
import { DEFAULT_RT_RULES, RT_PRESETS, RT_RULE_OPTIONS, sameRules, type RtRules } from "./realtime";
import { MAX_PRESETS, PRESET_NAME_MAX, type MyPreset } from "./roomPrefs";

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

/** One-tap preset row (shared by both modes); the preset matching the current values lights up. */
function PresetButtons<T>({ presets, isOn, onPick }: { presets: { id: string; emoji: string; name: string; desc: string; rules: T }[]; isOn: (rules: T) => boolean; onPick: (rules: T) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
      {presets.map((p) => {
        const on = isOn(p.rules);
        return (
          <button
            key={p.id}
            type="button"
            title={p.desc}
            onClick={() => onPick(p.rules)}
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
  );
}

/** 🏃 Moving-mode tuning: preset buttons + one segmented row per rule (host only). */
export function RtRulesPicker({ value, onChange }: { value: RtRules; onChange: (r: RtRules) => void }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/5 p-2 light:bg-amber-50/60">
      <PresetButtons presets={RT_PRESETS} isOn={(p) => sameRules(value, p)} onPick={onChange} />
      <RuleRows rows={RT_RULE_OPTIONS} value={value} onChange={onChange} />
    </div>
  );
}

/** 🛑 Stop-mode settings (host only). */
export function StopRulesPicker({ value, onChange }: { value: StopRules; onChange: (r: StopRules) => void }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-sky-400/30 bg-sky-400/5 p-2 light:bg-sky-50/60">
      <PresetButtons presets={STOP_PRESETS} isOn={(p) => sameStopRules(value, p)} onPick={onChange} />
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
  if (!r) return "";
  const preset = STOP_PRESETS.find((p) => p.id !== "default" && sameStopRules(p.rules, r));
  return preset ? `${preset.emoji} ${preset.name}` : nonDefault(STOP_RULE_OPTIONS, r, DEFAULT_STOP_RULES);
}

/**
 * ⭐ 내 프리셋: tap a chip to load it, × to delete, "+ 지금 설정 저장" to name the
 * current combo (mode, map, both modes' settings). Saved per device, and to
 * the account when signed in (roomPrefs.ts).
 */
export function MyPresetsBar({
  presets,
  isActive,
  onApply,
  onDelete,
  onSave,
  onShare,
  onImport,
  synced,
}: {
  presets: MyPreset[];
  isActive: (p: MyPreset) => boolean;
  onApply: (p: MyPreset) => void;
  onDelete: (id: string) => void;
  onSave: (name: string) => void;
  /** Copies the preset's share link; resolves false when the clipboard isn't available. */
  onShare: (p: MyPreset) => Promise<boolean>;
  /** Adds a preset from a pasted link/code; returns an error message or null. */
  onImport: (text: string) => string | null;
  synced: boolean;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [importing, setImporting] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote((n) => (n === msg ? null : n)), 2500);
  };
  const commit = () => {
    if (!name.trim()) return;
    onSave(name);
    setName("");
    setNaming(false);
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-violet-400/30 bg-violet-400/5 p-2 light:bg-violet-50/60">
      <div className="flex flex-wrap items-center gap-x-2 text-[11px] font-semibold text-white/70 light:text-slate-600">
        ⭐ 내 프리셋
        <span className="font-normal text-white/40 light:text-slate-400">{synced ? "☁️ 계정에 저장돼 다른 기기에서도 보여요" : "이 기기에 저장 · 로그인하면 다른 기기에서도"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((p) => (
          <span
            key={p.id}
            className={`flex items-center overflow-hidden rounded-full border text-[11px] font-semibold ${
              isActive(p) ? "border-violet-400 bg-violet-500/25 text-white light:text-violet-900" : "border-white/15 text-white/70 light:border-slate-300 light:text-slate-700"
            }`}
          >
            <button
              type="button"
              onClick={() => onApply(p)}
              className="py-1 pr-1 pl-2.5"
              title={`${p.mode === "moving" ? "🏃 무빙" : "🛑 스탑"} 모드${p.playerCount ? ` · ${p.playerCount}인` : ""}${typeof p.character === "number" ? ` · ${CHARACTERS[p.character]?.name ?? ""}` : ""} 불러오기`}
            >
              {p.mode === "moving" ? "🏃" : "🛑"} {p.name}
            </button>
            <button
              type="button"
              onClick={async () => flash((await onShare(p)) ? `🔗 '${p.name}' 공유 링크를 복사했어요` : "복사하지 못했어요 — 브라우저가 클립보드를 막았어요")}
              className="px-1 py-1 text-white/40 hover:text-violet-300 light:text-slate-400"
              title="친구에게 보낼 링크 복사"
            >
              🔗
            </button>
            <button type="button" onClick={() => onDelete(p.id)} className="px-1.5 py-1 text-white/40 hover:text-rose-400 light:text-slate-400" title="삭제">
              ×
            </button>
          </span>
        ))}
        {presets.length < MAX_PRESETS &&
          (naming ? (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                value={name}
                maxLength={PRESET_NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    commit();
                  }
                  if (e.key === "Escape") setNaming(false);
                }}
                placeholder="이름 (예: 친구들이랑)"
                className="w-36 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-white placeholder:text-white/30 focus:border-violet-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-800"
              />
              <button type="button" onClick={commit} disabled={!name.trim()} className="rounded-full bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40">
                저장
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setNaming(true)} className="rounded-full border border-dashed border-violet-400/60 px-2.5 py-1 text-[11px] font-semibold text-violet-300 hover:bg-violet-500/15 light:text-violet-700">
              + 지금 설정 저장
            </button>
          ))}
        {presets.length >= MAX_PRESETS && <span className="text-[10px] text-white/40 light:text-slate-400">최대 {MAX_PRESETS}개 — 하나를 지우면 새로 저장할 수 있어요</span>}
        {importing ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="친구가 보낸 링크나 코드"
              className="w-44 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-white placeholder:text-white/30 focus:border-violet-400 focus:outline-none light:border-slate-300 light:bg-white light:text-slate-800"
            />
            <button
              type="button"
              disabled={!code.trim()}
              onClick={() => {
                const err = onImport(code);
                if (err) flash(err);
                else {
                  flash("📥 프리셋을 가져왔어요");
                  setCode("");
                  setImporting(false);
                }
              }}
              className="rounded-full bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
            >
              가져오기
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setImporting(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 hover:border-white/30 light:border-slate-300 light:text-slate-600">
            📥 가져오기
          </button>
        )}
      </div>
      {note && <p className="text-[11px] font-semibold text-violet-300 light:text-violet-700">{note}</p>}
    </div>
  );
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
