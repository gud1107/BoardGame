"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import CityMap, { cellLabel, HELI_STYLES, TOKEN_CLASS } from "./CityMap";
import {
  currentActor,
  currentPoliceBelief,
  heliController,
  HELI_COUNT,
  latestSearchByCell,
  legalThiefCells,
  pointCells,
  pointNeighbors,
  tokenColor,
  TOTAL_ROUNDS,
  type Cell,
  type CityChaseState,
  type EngineAction,
  type Point,
  type SeatIndex,
} from "./engine";
import { playCityEventSound } from "./cityChaseAudio";

export interface CityChaseBoardProps {
  state: CityChaseState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: ReadonlySet<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

export default function CityChaseBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: CityChaseBoardProps) {
  const isThief = viewerSeat === state.thiefSeat;
  const actor = currentActor(state);
  const isMyTurn = actor === viewerSeat;
  const over = state.phase === "gameOver";
  const [showHeat, setShowHeat] = useState(false);

  // SFX once per applied action.
  const soundSeqRef = useRef(state.seq);
  useEffect(() => {
    if (state.seq === soundSeqRef.current) return;
    soundSeqRef.current = state.seq;
    if (state.lastEvent) playCityEventSound(state.lastEvent);
  }, [state.seq, state.lastEvent]);

  const latestSearch = useMemo(() => latestSearchByCell(state), [state]);

  // The police team's deduction heat — only ever built from public info.
  const heat = useMemo(() => {
    if (!showHeat || isThief || over || state.path.length === 0) return null;
    return currentPoliceBelief(state, 2000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHeat, isThief, over, state.seq]);

  const thiefTargets = useMemo(
    () => (isThief && isMyTurn && state.phase === "thief" ? new Set(legalThiefCells(state)) : undefined),
    [isThief, isMyTurn, state],
  );
  const heliControls =
    !isThief && isMyTurn && state.phase === "police"
      ? {
          heli: state.heliTurn,
          moveTargets: pointNeighbors(state.helis[state.heliTurn]),
          searchTargets: pointCells(state.helis[state.heliTurn]),
        }
      : null;

  function handleCell(cell: Cell) {
    if (thiefTargets?.has(cell)) onAction({ type: "THIEF_MOVE", seat: viewerSeat, cell });
    else if (heliControls?.searchTargets.includes(cell)) onAction({ type: "HELI_SEARCH", seat: viewerSeat, heli: heliControls.heli, cell });
  }
  function handlePoint(p: Point) {
    if (heliControls?.moveTargets.includes(p)) onAction({ type: "HELI_MOVE", seat: viewerSeat, heli: heliControls.heli, to: p });
  }

  const thiefName = names[state.thiefSeat] ?? "도둑";
  const status = (() => {
    if (over) {
      if (state.winner === "police") return { tone: "police", text: `🚨 검거 성공! 경찰 팀 승리 (${state.round}라운드)` };
      return { tone: "thief", text: `🏁 ${thiefName}이(가) 11라운드를 버텨내고 도주 성공!` };
    }
    if (state.phase === "thief") {
      if (isThief) return { tone: "thief", text: state.round === 1 ? "차를 숨길 건물을 고르세요 (아무 건물이나)" : "상·하·좌·우로 붙은 건물로 이동하세요" };
      return { tone: "wait", text: "🙈 도둑이 몰래 이동 중… 경찰은 눈을 감으세요" };
    }
    const heliName = `🚁${state.heliTurn + 1}`;
    const pilot = names[heliController(state, state.heliTurn)] ?? "경찰";
    if (!isThief && isMyTurn) return { tone: "police", text: `${heliName} 조종 차례 — 교차로로 이동(↗)하거나 맞닿은 건물을 수색(🔍)하세요` };
    return { tone: "wait", text: `${heliName} ${pilot} 조종 중…` };
  })();

  const toneClass =
    status.tone === "police"
      ? "border-sky-400/40 bg-sky-500/15 text-sky-100 light:bg-sky-50 light:text-sky-900 light:border-sky-300"
      : status.tone === "thief"
        ? "border-rose-400/40 bg-rose-500/15 text-rose-100 light:bg-rose-50 light:text-rose-900 light:border-rose-300"
        : "border-white/10 bg-white/5 text-white/70 light:bg-slate-50 light:text-slate-600 light:border-slate-200";

  return (
    <div className="flex flex-col gap-3">
      <MyTurnOverlay isMyTurn={isMyTurn && !over} />

      {/* Role + round track */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            isThief ? "bg-rose-600 text-white" : "bg-sky-600 text-white"
          }`}
        >
          {isThief ? "🦹 나는 도둑" : "🚓 나는 경찰"}
        </span>
        <div className="flex items-center gap-1" aria-label="라운드 트랙">
          {Array.from({ length: TOTAL_ROUNDS }, (_, i) => {
            const r = i + 1;
            const done = r < state.round || (over && r <= state.round);
            const current = r === state.round && !over;
            return (
              <span
                key={r}
                title={`${r}라운드`}
                className={`flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-bold sm:h-6 sm:w-6 sm:text-[10px] ${TOKEN_CLASS[tokenColor(r)]} ${
                  done ? "opacity-35" : ""
                } ${current ? "scale-125 ring-2 ring-white shadow-[0_0_10px_rgba(255,255,255,0.6)]" : ""} text-black/80`}
              >
                {r}
              </span>
            );
          })}
        </div>
      </div>

      <div className={`rounded-xl border px-3 py-2 text-center text-sm font-semibold ${toneClass}`}>{status.text}</div>

      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        <div className="relative md:flex-1">
          <CityMap
            state={state}
            showSecret={isThief || over}
            thiefTargets={thiefTargets}
            heliControls={heliControls}
            onCellClick={handleCell}
            onPointClick={handlePoint}
            heat={heat}
            latestSearch={latestSearch}
          />
          {!isThief && !over && state.phase === "thief" && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-3xl bg-black/55 backdrop-blur-[2px]">
              <div className="text-center">
                <div className="text-4xl">🙈</div>
                <p className="mt-1 text-sm font-semibold text-white">도둑이 차를 옮기는 중…</p>
              </div>
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="flex flex-col gap-2 md:w-60">
          <div className="grid grid-cols-3 gap-1.5 md:grid-cols-1">
            {Array.from({ length: HELI_COUNT }, (_, h) => {
              const seat = heliController(state, h);
              const active = state.phase === "police" && state.heliTurn === h && !over;
              return (
                <div
                  key={h}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] ${
                    active ? "border-white/40 bg-white/10 light:bg-slate-100" : "border-white/10 light:border-slate-200"
                  }`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${HELI_STYLES[h].bg} text-[10px] font-bold text-white`}>{h + 1}</span>
                  <span className="truncate text-white/80 light:text-slate-700">
                    {seat === viewerSeat ? "나" : names[seat]}
                    {!connectedSeats.has(seat) && " ⚠️"}
                  </span>
                </div>
              );
            })}
          </div>

          {!isThief && !over && (
            <button
              type="button"
              onClick={() => setShowHeat((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                showHeat
                  ? "border-rose-400/60 bg-rose-500/20 text-rose-100 light:text-rose-800 light:bg-rose-50"
                  : "border-white/15 text-white/70 hover:border-white/30 light:border-slate-300 light:text-slate-600"
              }`}
            >
              🗺️ 수사 지도 {showHeat ? "끄기" : "켜기"}
            </button>
          )}

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2 light:border-slate-200 light:bg-white">
            <p className="mb-1 text-[11px] font-semibold text-white/50 light:text-slate-500">🔍 수색 기록</p>
            {state.searches.length === 0 ? (
              <p className="text-[11px] text-white/35 light:text-slate-400">아직 수색한 건물이 없어요.</p>
            ) : (
              <ul className="flex max-h-40 flex-col-reverse gap-0.5 overflow-y-auto md:max-h-72">
                {state.searches.map((s, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-[11px] text-white/75 light:text-slate-700">
                    <span className="w-6 shrink-0 text-white/40 light:text-slate-400">R{s.round}</span>
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${HELI_STYLES[s.heli].bg}`} />
                    <span className="font-semibold">{cellLabel(s.cell)}</span>
                    {s.result === "caught" ? (
                      <span className="font-bold text-red-400">🚗 검거!</span>
                    ) : s.result === "trail" ? (
                      <span className="flex items-center gap-0.5 text-amber-300 light:text-amber-600">
                        흔적
                        {s.tokens.map((t, k) => (
                          <span key={k} className={`h-2 w-2 rounded-full border ${TOKEN_CLASS[t]}`} />
                        ))}
                      </span>
                    ) : (
                      <span className="text-white/40 light:text-slate-400">빈 건물</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isThief && !over && (
            <p className="rounded-lg bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-100/80 light:bg-rose-50 light:text-rose-800">
              💡 파란 빛 건물은 지금 헬기가 바로 들어 올릴 수 있는 곳이에요. 숫자는 내가 지나간 라운드.
            </p>
          )}
        </div>
      </div>

      {over && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center light:border-slate-200 light:bg-white">
          <p className="text-sm text-white/70 light:text-slate-600">
            도둑의 실제 경로: <span className="font-semibold text-white light:text-slate-900">{state.path.map(cellLabel).join(" → ")}</span>
          </p>
          <button onClick={onGameEnd} className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
            결과 확인
          </button>
        </div>
      )}
    </div>
  );
}
