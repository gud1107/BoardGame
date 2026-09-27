"use client";

import { GAME_MODES, MODES, TIME_MULTIPLIER_MAX, TIME_MULTIPLIER_MIN, TIME_MULTIPLIER_STEP, type GameOptions } from "./modes";

/**
 * Waiting-room "게임 모드 & 룰 설정" (rulebook §9). The host edits, everyone
 * else sees the same options read-only — the room adapter syncs them with a
 * `room-options` broadcast and bakes them into `game-start`.
 */
export default function LobbyOptionsPanel({
  options,
  isHost,
  onChange,
}: {
  options: GameOptions;
  isHost: boolean;
  onChange: (patch: Partial<GameOptions>) => void;
}) {
  const selected = MODES[options.mode];
  return (
    <section className="flex w-full flex-col gap-3 text-left">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-white light:text-slate-900">🎮 게임 모드</h3>
        {!isHost && <span className="text-[11px] text-white/40 light:text-slate-400">방장이 설정 중이에요</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {GAME_MODES.map((mode) => {
          const info = MODES[mode];
          const active = options.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              disabled={!isHost}
              aria-pressed={active}
              onClick={() => onChange({ mode })}
              className={`flex flex-col gap-1 rounded-xl border p-2.5 text-left transition disabled:cursor-default ${
                active
                  ? "border-fuchsia-400 bg-fuchsia-500/20 shadow-[0_0_14px_rgba(217,70,239,0.25)] light:bg-fuchsia-50"
                  : "border-white/10 bg-white/[0.03] enabled:hover:border-white/30 light:border-slate-200 light:bg-white"
              } ${!isHost && !active ? "opacity-50" : ""}`}
            >
              <span className="flex items-center justify-between">
                <span className="text-xl">{info.icon}</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] text-white/60 light:bg-slate-100 light:text-slate-500">{info.badge}</span>
              </span>
              <span className={`text-sm font-bold ${active ? "text-fuchsia-100 light:text-fuchsia-800" : "text-white light:text-slate-800"}`}>{info.title}</span>
              <span className="text-[10px] leading-snug text-white/55 light:text-slate-500">{info.description}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-black/20 p-3 light:border-slate-200 light:bg-slate-50">
        <label className="flex flex-col gap-1 text-xs text-white/70 light:text-slate-600">
          <span className="flex justify-between">
            <span>⏱ 제한 시간 배율</span>
            <b className="tabular-nums text-white light:text-slate-900">{options.timeMultiplier.toFixed(1)}×</b>
          </span>
          <input
            type="range"
            min={TIME_MULTIPLIER_MIN}
            max={TIME_MULTIPLIER_MAX}
            step={TIME_MULTIPLIER_STEP}
            value={options.timeMultiplier}
            disabled={!isHost}
            onChange={(e) => onChange({ timeMultiplier: Number(e.target.value) })}
            className="accent-fuchsia-500"
          />
          <span className="text-[10px] text-white/40 light:text-slate-400">기본 시간: {selected.timeLabel}</span>
        </label>

        {options.mode === "ANIMATION" && (
          <label className="flex items-center gap-2 text-xs text-white/80 light:text-slate-700">
            <input type="checkbox" checked={options.ghostFrames} disabled={!isHost} onChange={(e) => onChange({ ghostFrames: e.target.checked })} className="accent-fuchsia-500" />
            👻 어니언 스킨(앞 프레임 잔상) 표시
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-white/80 light:text-slate-700">
          <input type="checkbox" checked={options.allowUndo} disabled={!isHost} onChange={(e) => onChange({ allowUndo: e.target.checked })} className="accent-fuchsia-500" />
          ↶ 되돌리기(Undo) 허용
        </label>
      </div>
    </section>
  );
}
