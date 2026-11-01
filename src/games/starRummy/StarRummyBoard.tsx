"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Frame3D, Loading3D, preferLowDetail, useBoardView, ViewToggle } from "@/games/shared/three/viewPref";
import {
  checkCommit,
  COLOR_NAMES,
  COLOR_SHAPES,
  handValue,
  isWild,
  OPENING_MIN,
  orderMeld,
  sortHand,
  tileOf,
  TURN_MS,
  type EngineAction,
  type SeatIndex,
  type StarRummyState,
  type TileId,
} from "./engine";

const StarRummyTable3D = dynamic(() => import("./three/StarRummyTable3D"), { ssr: false, loading: () => <Loading3D /> });

/** Number ink per colour — also used by the 3D tiles. */
export const STAR_INK = ["#e11d48", "#2563eb", "#c47a06", "#059669"] as const;

export interface StarRummyBoardProps {
  state: StarRummyState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  isHost: boolean;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
  onRulebook: () => void;
}

type TileSize = "sm" | "md";

export function StarTile({
  id,
  size = "md",
  selected = false,
  fresh = false,
  glow = false,
  onClick,
}: {
  id: TileId;
  size?: TileSize;
  selected?: boolean;
  fresh?: boolean;
  glow?: boolean;
  onClick?: () => void;
}) {
  const t = tileOf(id);
  const dims = size === "md" ? "h-[50px] w-[36px] text-[19px]" : "h-[38px] w-[27px] text-[14px]";
  const wild = isWild(id);
  const label = wild ? "혜성 (만능)" : `${COLOR_NAMES[t.color!]} ${t.num}`;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={onClick}
      disabled={!onClick}
      className={`relative flex shrink-0 flex-col items-center justify-center rounded-[6px] border font-black leading-none shadow-[0_2px_0_rgba(0,0,0,0.35)] transition ${dims} ${
        wild ? "border-violet-300 bg-gradient-to-b from-violet-200 to-fuchsia-300" : "border-amber-200/80 bg-gradient-to-b from-[#fffaf0] to-[#efe2c4]"
      } ${selected ? "-translate-y-1.5 ring-2 ring-sky-400 ring-offset-1 ring-offset-black/40" : ""} ${fresh ? "outline-2 outline-dashed outline-sky-300 outline-offset-1" : ""} ${
        glow ? "shadow-[0_0_10px_3px_rgba(251,191,36,0.75)]" : ""
      } ${onClick ? "cursor-pointer hover:brightness-105" : "cursor-default"}`}
    >
      {wild ? (
        <>
          <span className={size === "md" ? "text-[20px]" : "text-[15px]"}>☄️</span>
          <span className="mt-0.5 text-[8px] font-bold text-violet-900">혜성</span>
        </>
      ) : (
        <>
          <span style={{ color: STAR_INK[t.color!] }}>{t.num}</span>
          <span className={size === "md" ? "mt-1 text-[10px]" : "mt-0.5 text-[8px]"} style={{ color: STAR_INK[t.color!] }}>
            {COLOR_SHAPES[t.color!]}
          </span>
        </>
      )}
    </button>
  );
}

function sameTable(a: readonly TileId[][], b: readonly TileId[][]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => m.length === b[i].length && m.every((id, j) => id === b[i][j]));
}

/** Ms left in this turn by this client's own clock (negative once overdue). */
function useTurnClock(turn: number): number {
  const [left, setLeft] = useState({ turn, ms: TURN_MS });
  useEffect(() => {
    const at = Date.now();
    const tick = () => setLeft({ turn, ms: TURN_MS - (Date.now() - at) });
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [turn]);
  return left.turn === turn ? left.ms : TURN_MS;
}

export default function StarRummyBoard({ state, viewerSeat, names, connectedSeats, isHost, onAction, onGameEnd, onRulebook }: StarRummyBoardProps) {
  const board3d = useBoardView("star-rummy-view");
  const [lowDetail] = useState(preferLowDetail);
  const [sortBy, setSortBy] = useState<"color" | "number">("color");
  const [draft, setDraft] = useState<TileId[][] | null>(null);
  const [selected, setSelected] = useState<TileId[]>([]);
  const [draftTurn, setDraftTurn] = useState(state.turn);

  // A new turn (mine or anyone's) throws the local draft away.
  if (draftTurn !== state.turn) {
    setDraftTurn(state.turn);
    setDraft(null);
    setSelected([]);
  }

  const myTurn = state.phase === "playing" && state.active === viewerSeat;
  const opened = state.opened[viewerSeat];
  const table = myTurn && draft ? draft : state.table;
  const onTableBefore = useMemo(() => new Set(state.table.flat()), [state.table]);
  const onTableNow = useMemo(() => new Set(table.flat()), [table]);
  const myHand = state.hands[viewerSeat] ?? [];
  const rack = sortHand(
    myHand.filter((id) => !onTableNow.has(id)),
    sortBy,
  );
  const dirty = draft !== null && !sameTable(draft, state.table);
  const check = myTurn && dirty ? checkCommit(state, viewerSeat, draft!) : null;
  const invalid = new Set(check && !check.ok ? check.invalidMelds : []);
  const lastPlayed = new Set(state.lastEvent && (state.lastEvent.kind === "meld" || state.lastEvent.kind === "out") ? state.lastEvent.played : []);
  const remaining = useTurnClock(state.turn);
  const seconds = Math.max(0, Math.ceil(remaining / 1000));

  // My own timer runs out → draw (the draft is lost). The host also covers a
  // silent seat 8 s later so the table never hangs.
  const timedOutRef = useRef(-1);
  useEffect(() => {
    if (state.phase !== "playing" || timedOutRef.current === state.turn) return;
    const seat = myTurn ? viewerSeat : isHost && remaining <= -8000 ? state.active : null;
    if (seat === null || remaining > 0) return;
    timedOutRef.current = state.turn;
    onAction({ type: "timeout", seat, turn: state.turn });
  }, [remaining, myTurn, isHost, state.phase, state.turn, state.active, viewerSeat, onAction]);

  const canPick = (id: TileId) => myTurn && (opened || !onTableBefore.has(id));

  function toggle(id: TileId) {
    if (!canPick(id)) return;
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function moveSelected(target: number | "new") {
    if (!myTurn || selected.length === 0) return;
    const sel = new Set(selected);
    const base = (draft ?? state.table).map((m) => m.filter((id) => !sel.has(id)));
    const moving = sortHand(selected);
    if (target === "new") base.push(moving);
    else base[target] = [...base[target], ...moving];
    setDraft(base.filter((m) => m.length > 0).map((m) => orderMeld(m)));
    setSelected([]);
  }

  function returnToHand() {
    const back = new Set(selected.filter((id) => !onTableBefore.has(id)));
    if (back.size === 0 || !draft) return;
    setDraft(draft.map((m) => m.filter((id) => !back.has(id))).filter((m) => m.length > 0).map((m) => orderMeld(m)));
    setSelected([]);
  }

  function reset() {
    setDraft(null);
    setSelected([]);
  }

  function commit() {
    if (!draft || !check?.ok) return;
    onAction({ type: "commit", seat: viewerSeat, turn: state.turn, table: draft });
  }

  function draw(from: "pool" | number) {
    if (!myTurn || dirty) return;
    onAction({ type: "draw", seat: viewerSeat, turn: state.turn, from });
  }

  const seats = Array.from({ length: state.playerCount }, (_, i) => (viewerSeat + i) % state.playerCount);
  const nothingLeft = state.pool.length === 0 && state.observatory.length === 0;
  const nameOf = (seat: SeatIndex) => names[seat] ?? `${seat + 1}번`;

  const eventText = (() => {
    const e = state.lastEvent;
    if (!e) return state.round === 1 ? "✨ 첫 관측은 내 손의 조합만으로 합계 24점 이상!" : `🌠 라운드 ${state.round} 시작`;
    const who = e.seat === viewerSeat ? "내가" : `${nameOf(e.seat)} 님이`;
    if (e.kind === "out") return `🎉 ${who} 마지막 타일까지 내려놓았어요 — 러미!`;
    if (e.kind === "meld") return `${e.opened ? "✨ 첫 관측! " : ""}${who} ${e.played.length}장을 내려놓았어요${e.rearranged ? " (테이블 재배치)" : ""}`;
    if (e.kind === "pass") return `${who} 넘겼어요 (더 뽑을 타일 없음)${e.timeout ? " ⏰" : ""}`;
    return e.from === "observatory" ? `🔭 ${who} 관측소에서 한 장 가져갔어요` : `🎴 ${who} 한 장 뽑았어요${e.timeout ? " (⏰ 시간 초과)" : ""}`;
  })();

  const panel = "rounded-2xl border border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white/90 light:shadow-sm";

  return (
    <div className="flex flex-col gap-3">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-white/70 light:text-slate-600">
          🌌 라운드 {state.round}/{state.totalRounds} · 🎴 남은 타일 {state.pool.length}
        </span>
        <div className="flex items-center gap-1.5">
          <ViewToggle board={board3d} />
          <button onClick={onRulebook} className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/50 hover:border-white/25 light:border-slate-200 light:text-slate-500">
            📖 룰북
          </button>
        </div>
      </div>

      {/* players */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {seats.map((seat) => {
          const active = state.phase === "playing" && state.active === seat;
          return (
            <div
              key={seat}
              className={`flex flex-col gap-0.5 rounded-xl border px-2.5 py-1.5 text-[11px] ${
                active ? "border-amber-300/70 bg-amber-300/10 light:bg-amber-50" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"
              }`}
            >
              <span className="flex items-center gap-1 truncate font-semibold text-white light:text-slate-800">
                {active && "▶ "}
                {seat === viewerSeat ? `${nameOf(seat)} (나)` : nameOf(seat)}
                {!connectedSeats.has(seat) && <span title="연결 끊김">📴</span>}
              </span>
              <span className="text-white/60 light:text-slate-500">
                🀫 {state.hands[seat].length}장 · {state.opened[seat] ? "✨ 관측 완료" : "관측 전"}
              </span>
              <span className="flex justify-between text-white/60 light:text-slate-500">
                <span>⭐ {state.scores[seat]}점</span>
                {active && <span className={seconds <= 15 ? "font-bold text-rose-300 light:text-rose-600" : ""}>⏱ {seconds}s</span>}
              </span>
            </div>
          );
        })}
      </div>

      {board3d.view === "3d" && (
        <Frame3D hint="타일 조작은 아래 테이블에서 · 드래그로 둘러보기">
          <StarRummyTable3D
            playerCount={state.playerCount}
            viewerSeat={viewerSeat}
            seats={seats.map((seat) => ({
              seat,
              name: nameOf(seat),
              tiles: state.hands[seat].length,
              score: state.scores[seat],
              opened: state.opened[seat],
              away: !connectedSeats.has(seat),
            }))}
            activeSeat={state.phase === "playing" ? state.active : null}
            table={state.table}
            observatory={state.observatory}
            poolCount={state.pool.length}
            lastEvent={state.lastEvent}
            round={state.round}
            totalRounds={state.totalRounds}
            overview={state.phase !== "playing"}
            lowDetail={lowDetail}
          />
        </Frame3D>
      )}

      <p className="rounded-xl bg-black/25 px-3 py-2 text-center text-xs text-white/80 light:bg-slate-100 light:text-slate-700">{eventText}</p>

      {/* table */}
      <section className={`${panel} flex flex-col gap-2 p-2.5`}>
        <div className="flex items-center justify-between text-[11px] text-white/50 light:text-slate-500">
          <span>🌌 별자리 테이블 · 조합 {table.length}개</span>
          {myTurn && selected.length > 0 && <span className="text-sky-300 light:text-sky-700">놓을 조합을 누르세요</span>}
        </div>
        <div className="flex min-h-[64px] flex-wrap gap-1.5">
          {table.length === 0 && !(myTurn && selected.length > 0) && <p className="m-auto text-xs text-white/35 light:text-slate-400">아직 테이블이 비어 있어요</p>}
          {table.map((meld, i) => (
            <div
              key={`${i}:${meld[0]}`}
              role={myTurn && selected.length > 0 ? "button" : undefined}
              onClick={() => moveSelected(i)}
              className={`flex items-center gap-0.5 rounded-lg border p-1 ${
                invalid.has(i) ? "border-rose-400 bg-rose-500/15" : "border-white/10 bg-black/20 light:border-slate-200 light:bg-slate-50"
              } ${myTurn && selected.length > 0 ? "cursor-pointer hover:border-sky-300" : ""}`}
            >
              {invalid.has(i) && <span className="px-0.5 text-[10px] font-bold text-rose-300 light:text-rose-600">✕</span>}
              {meld.map((id) => (
                <StarTile
                  key={id}
                  id={id}
                  size="sm"
                  selected={selected.includes(id)}
                  fresh={myTurn && dirty && !onTableBefore.has(id)}
                  glow={!dirty && lastPlayed.has(id)}
                  onClick={
                    canPick(id)
                      ? () => {
                          // tapping a tile while others are selected drops them into this meld
                          if (selected.length > 0 && !selected.includes(id)) moveSelected(i);
                          else toggle(id);
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          ))}
          {myTurn && selected.length > 0 && (
            <button
              type="button"
              onClick={() => moveSelected("new")}
              className="flex h-[48px] items-center rounded-lg border-2 border-dashed border-sky-400/70 px-3 text-xs font-semibold text-sky-200 hover:bg-sky-400/10 light:text-sky-700"
            >
              ＋ 새 조합
            </button>
          )}
        </div>
      </section>

      {/* observatory + pool */}
      <section className={`${panel} flex items-center gap-2 p-2.5`}>
        <span className="text-[11px] text-white/50 light:text-slate-500">🔭 관측소</span>
        <div className="flex gap-1.5">
          {state.observatory.map((id, i) => (
            <StarTile key={id} id={id} size="sm" onClick={myTurn && !dirty ? () => draw(i) : undefined} />
          ))}
        </div>
        <button
          type="button"
          disabled={!myTurn || dirty}
          onClick={() => draw("pool")}
          className="ml-auto rounded-lg border border-white/15 bg-gradient-to-b from-indigo-700 to-indigo-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {nothingLeft ? "넘기기" : `🎴 뽑기 (${state.pool.length})`}
        </button>
      </section>

      {/* status + actions */}
      {myTurn && (
        <div className="flex flex-col gap-2">
          <p className={`text-center text-xs ${check && !check.ok ? "text-rose-300 light:text-rose-600" : "text-white/60 light:text-slate-500"}`}>
            {check
              ? check.ok
                ? `✔ 내려놓을 수 있어요 (${check.played.length}장${!opened ? ` · 첫 관측 ${check.openingValue}점` : ""})`
                : check.reason
              : !opened
                ? `내 차례 — 첫 관측은 손의 조합만으로 ${OPENING_MIN}점 이상. 아니면 관측소/더미에서 한 장`
                : "내 차례 — 타일을 골라 조합에 놓거나, 한 장 뽑으세요"}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            <button onClick={reset} disabled={!draft && selected.length === 0} className="rounded-xl border border-white/15 py-2.5 text-xs text-white/75 disabled:opacity-35 light:border-slate-300 light:text-slate-600">
              ↩ 되돌리기
            </button>
            <button
              onClick={returnToHand}
              disabled={!selected.some((id) => onTableNow.has(id) && !onTableBefore.has(id))}
              className="rounded-xl border border-white/15 py-2.5 text-xs text-white/75 disabled:opacity-35 light:border-slate-300 light:text-slate-600"
            >
              ✋ 손으로
            </button>
            <button onClick={commit} disabled={!check?.ok} className="rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white disabled:bg-emerald-900/50 disabled:text-white/40">
              ✔ 내려놓기
            </button>
          </div>
        </div>
      )}

      {/* my rack */}
      <section className={`${panel} flex flex-col gap-2 p-2.5`}>
        <div className="flex items-center justify-between text-[11px] text-white/50 light:text-slate-500">
          <span>
            🪵 내 타일 {rack.length}장 · 남으면 −{handValue(rack)}점
          </span>
          <div className="flex overflow-hidden rounded-full border border-white/15 light:border-slate-300">
            {(["color", "number"] as const).map((k) => (
              <button key={k} onClick={() => setSortBy(k)} className={`px-2.5 py-0.5 ${sortBy === k ? "bg-white/15 font-semibold text-white light:bg-slate-800" : "light:text-slate-600"}`}>
                {k === "color" ? "색깔순" : "숫자순"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {rack.map((id) => (
            <StarTile key={id} id={id} selected={selected.includes(id)} onClick={myTurn ? () => toggle(id) : undefined} />
          ))}
          {rack.length === 0 && <p className="text-xs text-white/40">모두 내려놓았어요!</p>}
        </div>
      </section>

      {(state.phase === "roundEnd" || state.phase === "gameOver") && <RoundResultPanel state={state} nameOf={nameOf} viewerSeat={viewerSeat} onNext={() => onAction({ type: "nextRound", round: state.round })} onGameEnd={onGameEnd} />}
    </div>
  );
}

function RoundResultPanel({
  state,
  nameOf,
  viewerSeat,
  onNext,
  onGameEnd,
}: {
  state: StarRummyState;
  nameOf: (s: SeatIndex) => string;
  viewerSeat: SeatIndex;
  onNext: () => void;
  onGameEnd: () => void;
}) {
  const r = state.results[state.results.length - 1];
  if (!r) return null;
  const over = state.phase === "gameOver";
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-3 sm:items-center">
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-2xl border border-amber-300/40 bg-[#14112a] p-4 text-white shadow-2xl">
        <h2 className="text-center text-base font-bold">
          {r.outSeat !== null ? `🎉 ${nameOf(r.outSeat)} 님 러미!` : "🌑 타일이 바닥났어요"} — 라운드 {r.round} 결과
        </h2>
        <div className="flex flex-col gap-2">
          {r.delta
            .map((d, seat) => ({ d, seat }))
            .sort((a, b) => b.d - a.d)
            .map(({ d, seat }) => (
              <div key={seat} className="rounded-xl border border-white/10 bg-white/[0.04] p-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold">
                    {r.winners.includes(seat) && "👑 "}
                    {nameOf(seat)}
                    {seat === viewerSeat && " (나)"}
                  </span>
                  <span>
                    <b className={d >= 0 ? "text-emerald-300" : "text-rose-300"}>
                      {d >= 0 ? "+" : ""}
                      {d}
                    </b>{" "}
                    → 합계 {state.scores[seat]}점
                  </span>
                </div>
                {r.hands[seat].length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-0.5">
                    {r.hands[seat].map((id) => (
                      <StarTile key={id} id={id} size="sm" />
                    ))}
                    <span className="ml-1 self-center text-[11px] text-white/50">남은 타일 −{r.penalties[seat]}</span>
                  </div>
                )}
              </div>
            ))}
        </div>
        {over ? (
          <button onClick={onGameEnd} className="rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-black hover:bg-amber-400">
            🏆 최종 결과 보기
          </button>
        ) : (
          <>
            <button onClick={onNext} className="rounded-xl bg-emerald-600 py-2.5 text-sm font-bold hover:bg-emerald-500">
              🌠 다음 라운드 ({state.round + 1}/{state.totalRounds})
            </button>
            <p className="text-center text-[11px] text-white/45">잠시 뒤 자동으로 다음 라운드가 시작돼요</p>
          </>
        )}
      </div>
    </div>
  );
}
