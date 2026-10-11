"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import type { MindState } from "./engine";
import Timeline, { SEAT_COLORS } from "./Timeline";

/**
 * 📜 지난 기록 — every level of this game so far: which cards landed in what
 * order (and who played them), what a mistake or ⚡ threw away, and — only
 * for finished levels — everyone's starting hand. The level in progress
 * never shows hands, since they're still secret.
 */
export default function HistoryModal({ state, names, onClose, initialIndex }: { state: MindState; names: string[]; onClose: () => void; initialIndex?: number }) {
  const lastIdx = state.log.length - 1;
  const [idx, setIdx] = useState(Math.min(lastIdx, Math.max(0, initialIndex ?? lastIdx)));
  const log = state.log[idx];
  const finished = state.phase === "won" || state.phase === "lost";
  const inProgress = idx === lastIdx && !log.cleared && !finished;
  const plays = log.entries.filter((e) => e.kind === "play");
  const thrown = log.entries.filter((e) => e.kind !== "play");
  const color = (seat: number) => SEAT_COLORS[seat % SEAT_COLORS.length];

  return (
    <Overlay title="📜 지난 기록" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm text-white/80 light:text-slate-700">
        <div className="flex flex-wrap gap-1.5">
          {state.log.map((lv, i) => (
            <button
              key={lv.level}
              type="button"
              onClick={() => setIdx(i)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                i === idx ? "bg-indigo-500 text-white" : "border border-white/15 text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600"
              }`}
            >
              레벨 {lv.level}
              {i === lastIdx && !lv.cleared && !finished ? " · 진행 중" : lv.mistakes > 0 ? ` · 💔${lv.mistakes}` : lv.cleared ? " · ✓" : ""}
            </button>
          ))}
        </div>

        <p className="text-xs text-white/60 light:text-slate-500">
          레벨 {log.level} · {inProgress ? "진행 중" : log.cleared ? "통과" : "여기서 끝남"} · 낸 카드 {plays.length}장 · 실수 {log.mistakes}번
        </p>

        <section>
          <h3 className="mb-2 text-xs font-semibold text-white/50 light:text-slate-500">더미에 쌓인 순서</h3>
          {plays.length === 0 ? (
            <p className="text-xs text-white/40 light:text-slate-400">아직 낸 카드가 없어요</p>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              {plays.map((e, i) => (
                <span key={`${e.card}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <span className="text-white/30 light:text-slate-300">→</span>}
                  <span className="flex flex-col items-center rounded-lg border px-2 py-0.5" style={{ borderColor: color(e.seat) }}>
                    <span className="text-sm font-black tabular-nums text-white light:text-slate-900">{e.card}</span>
                    <span className="max-w-[4.5rem] truncate text-[9px]" style={{ color: color(e.seat) }}>
                      {names[e.seat]}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          )}
        </section>

        {thrown.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold text-white/50 light:text-slate-500">더미에 못 가고 버려진 카드</h3>
            <div className="flex flex-wrap gap-1.5">
              {thrown.map((e, i) => (
                <span
                  key={`${e.card}-t${i}`}
                  className={`flex flex-col items-center rounded-lg border px-2 py-0.5 ${e.kind === "mistake" ? "border-rose-400/60 bg-rose-500/10" : "border-dashed border-amber-300/70 bg-amber-400/10"}`}
                >
                  <span className="text-sm font-black tabular-nums text-white light:text-slate-900">{e.card}</span>
                  <span className="text-[9px] text-white/60 light:text-slate-500">
                    {e.kind === "mistake" ? "💔 실수" : "⚡ 번뜩임"} · <span style={{ color: color(e.seat) }}>{names[e.seat]}</span>
                  </span>
                </span>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-xs font-semibold text-white/50 light:text-slate-500">시간 흐름</h3>
          <Timeline log={log} names={names} showHands={!inProgress} />
          {inProgress && <p className="mt-1 text-[11px] text-white/40 light:text-slate-400">진행 중인 레벨이라 각자 처음 받은 카드는 레벨이 끝난 뒤에 보여요.</p>}
        </section>
      </div>
    </Overlay>
  );
}
