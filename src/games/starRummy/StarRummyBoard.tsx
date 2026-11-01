"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
import { openingScore, solve } from "./bot";

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
  hint = false,
  dimmed = false,
  onClick,
  onDragStart,
}: {
  id: TileId;
  size?: TileSize;
  selected?: boolean;
  fresh?: boolean;
  glow?: boolean;
  /** Pulsing gold ring — "this tile is part of a playable first meld". */
  hint?: boolean;
  /** Faded while it's being dragged elsewhere. */
  dimmed?: boolean;
  onClick?: () => void;
  /** Pointer down on a draggable tile (mouse or touch). */
  onDragStart?: (e: ReactPointerEvent<HTMLButtonElement>) => void;
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
      onPointerDown={onDragStart}
      onContextMenu={onDragStart ? (e) => e.preventDefault() : undefined}
      disabled={!onClick}
      className={`relative flex ${onDragStart ? "select-none [-webkit-touch-callout:none]" : ""} ${dimmed ? "opacity-30" : ""} shrink-0 flex-col items-center justify-center rounded-[6px] border font-black leading-none shadow-[0_2px_0_rgba(0,0,0,0.35)] transition ${dims} ${
        wild ? "border-violet-300 bg-gradient-to-b from-violet-200 to-fuchsia-300" : "border-amber-200/80 bg-gradient-to-b from-[#fffaf0] to-[#efe2c4]"
      } ${selected ? "-translate-y-1.5 ring-2 ring-sky-400 ring-offset-1 ring-offset-black/40" : ""} ${fresh ? "outline-2 outline-dashed outline-sky-300 outline-offset-1" : ""} ${
        glow ? "shadow-[0_0_10px_3px_rgba(251,191,36,0.75)]" : ""
      } ${onClick ? "cursor-pointer hover:brightness-105" : "cursor-default"}`}
    >
      {hint && <span aria-hidden className="pointer-events-none absolute -inset-[3px] animate-pulse rounded-[8px] ring-2 ring-amber-300 shadow-[0_0_14px_4px_rgba(251,191,36,0.85)]" />}
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

/** Set once the player has finished a real touch drag (or closed the tip) — the "hold to pick up" tip never shows again. */
const HOLD_TIP_KEY = "star-rummy-hold-tip-v1";

function wantsHoldTip(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches && localStorage.getItem(HOLD_TIP_KEY) !== "done";
  } catch {
    return false;
  }
}

export default function StarRummyBoard({ state, viewerSeat, names, connectedSeats, isHost, onAction, onGameEnd, onRulebook }: StarRummyBoardProps) {
  const board3d = useBoardView("star-rummy-view");
  const [lowDetail] = useState(preferLowDetail);
  const [sortBy, setSortBy] = useState<"color" | "number">("color");
  const [draft, setDraft] = useState<TileId[][] | null>(null);
  const [selected, setSelected] = useState<TileId[]>([]);
  const [draftTurn, setDraftTurn] = useState(state.turn);
  const [drag, setDrag] = useState<{ ids: TileId[]; x: number; y: number; over: DropTarget | null } | null>(null);
  // a drag ends in pointerup → the browser still fires click on the tile; swallow it
  const suppressClickRef = useRef(false);
  // while a touch drag is live, the board's touchmove is cancelled so the page doesn't scroll
  const rootRef = useRef<HTMLDivElement>(null);
  const touchDragRef = useRef(false);
  // touch only: "hold to pick up" tip; "nudge" = they just swiped from a tile and got a scroll instead
  const [holdTip, setHoldTip] = useState<"off" | "show" | "nudge">(() => (wantsHoldTip() ? "show" : "off"));
  const closeHoldTip = () => {
    setHoldTip("off");
    try {
      localStorage.setItem(HOLD_TIP_KEY, "done");
    } catch {}
  };
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const block = (ev: TouchEvent) => {
      if (touchDragRef.current) ev.preventDefault();
    };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  // A new turn (mine or anyone's) throws the local draft away.
  if (draftTurn !== state.turn) {
    setDraftTurn(state.turn);
    setDraft(null);
    setSelected([]);
    setDrag(null);
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
  // First-meld hint: only when a 24+ meld set really exists in my hand.
  const handKey = myHand.join(",");
  const opening = useMemo(() => {
    if (!myTurn || opened || !handKey) return null;
    const sol = solve([], handKey.split(",").map(Number), 4000, openingScore);
    return sol && sol.score >= OPENING_MIN ? sol : null;
  }, [myTurn, opened, handKey]);
  const hintTiles = new Set(opening?.used ?? []);
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

  /** Move tiles onto a meld, into a new meld, or (this turn's own tiles only) back to the rack. */
  function moveTiles(ids: TileId[], target: DropTarget) {
    if (!myTurn) return;
    const moving = ids.filter(canPick);
    if (moving.length === 0) return;
    const current = draft ?? state.table;
    if (target === "rack") {
      const back = new Set(moving.filter((id) => !onTableBefore.has(id)));
      if (back.size > 0) setDraft(current.map((m) => m.filter((id) => !back.has(id))).filter((m) => m.length > 0).map((m) => orderMeld(m)));
      setSelected([]);
      return;
    }
    const sel = new Set(moving);
    if (typeof target === "number" && current[target]?.every((id) => sel.has(id))) return; // dropped on its own meld
    const base = current.map((m) => m.filter((id) => !sel.has(id)));
    if (target === "new" || base[target] === undefined) base.push(sortHand(moving));
    else base[target] = [...base[target], ...sortHand(moving)];
    setDraft(base.filter((m) => m.length > 0).map((m) => orderMeld(m)));
    setSelected([]);
  }

  const moveSelected = (target: number | "new") => moveTiles(selected, target);
  const returnToHand = () => moveTiles(selected, "rack");

  /**
   * Pointer drag of this tile, or of the whole selection if the tile is selected.
   * Mouse: past 6 px it becomes a drag. Touch: hold still ~0.2 s to pick it up —
   * a quick swipe that starts on a tile still scrolls the page.
   * Near the top/bottom edge of the screen the page scrolls along with the drag.
   */
  function startDrag(id: TileId, e: ReactPointerEvent<HTMLButtonElement>) {
    if (!canPick(id) || e.button > 0) return;
    const touch = e.pointerType !== "mouse";
    const sx = e.clientX;
    const sy = e.clientY;
    let x = sx;
    let y = sy;
    const ids = selected.includes(id) ? selected : [id];
    let dragging = false;
    let moved = false;
    let over: DropTarget | null = null;
    let raf = 0;
    const show = () => {
      over = dropTargetAt(x, y);
      setDrag({ ids, x, y, over });
    };
    const edgeScroll = () => {
      const edge = 72;
      const h = window.innerHeight;
      const v = y < edge ? -(edge - y) / edge : y > h - edge ? (y - (h - edge)) / edge : 0;
      if (v !== 0) {
        window.scrollBy(0, Math.round(v * 16));
        show();
      }
      raf = requestAnimationFrame(edgeScroll);
    };
    const begin = () => {
      dragging = true;
      touchDragRef.current = touch;
      if (touch) navigator.vibrate?.(12);
      show();
      raf = requestAnimationFrame(edgeScroll);
    };
    const hold = touch ? window.setTimeout(begin, 200) : 0;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      x = ev.clientX;
      y = ev.clientY;
      const far = Math.hypot(x - sx, y - sy) >= (touch ? 10 : 6);
      if (!dragging) {
        if (!far) return;
        if (touch) {
          setHoldTip((t) => (t === "off" ? t : "nudge"));
          return finish(ev); // moved before the hold → it's a scroll
        }
        begin();
      }
      if (far) moved = true;
      ev.preventDefault();
      show();
    };
    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.clearTimeout(hold);
      cancelAnimationFrame(raf);
      touchDragRef.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (!dragging) return;
      setDrag(null);
      if (!moved) return; // held and let go in place → plain tap
      suppressClickRef.current = true;
      window.setTimeout(() => (suppressClickRef.current = false), 0);
      if (ev.type !== "pointerup" || over === null) return;
      moveTiles(ids, over);
      if (touch) closeHoldTip();
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  /** onClick that ignores the click a finished drag leaves behind. */
  const tap = (fn: () => void) => () => {
    if (suppressClickRef.current) return;
    fn();
  };

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
    <div ref={rootRef} className="flex flex-col gap-3">
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
              rack: seat === viewerSeat ? sortHand(state.hands[seat], sortBy) : undefined,
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
          {table.length === 0 && !myTurn && <p className="m-auto text-xs text-white/35 light:text-slate-400">아직 테이블이 비어 있어요</p>}
          {table.map((meld, i) => (
            <div
              key={`${i}:${meld[0]}`}
              data-drop={i}
              role={myTurn && selected.length > 0 ? "button" : undefined}
              onClick={tap(() => moveSelected(i))}
              className={`flex items-center gap-0.5 rounded-lg border p-1 transition ${
                invalid.has(i) ? "border-rose-400 bg-rose-500/15" : "border-white/10 bg-black/20 light:border-slate-200 light:bg-slate-50"
              } ${myTurn && selected.length > 0 ? "cursor-pointer hover:border-sky-300" : ""} ${drag?.over === i ? "scale-105 ring-2 ring-sky-400" : ""}`}
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
                  dimmed={!!drag?.ids.includes(id)}
                  onDragStart={canPick(id) ? (e) => startDrag(id, e) : undefined}
                  onClick={
                    canPick(id)
                      ? tap(() => {
                          // tapping a tile while others are selected drops them into this meld
                          if (selected.length > 0 && !selected.includes(id)) moveSelected(i);
                          else toggle(id);
                        })
                      : undefined
                  }
                />
              ))}
            </div>
          ))}
          {myTurn && (
            <button
              type="button"
              data-drop="new"
              onClick={tap(() => moveSelected("new"))}
              disabled={selected.length === 0 && !drag}
              className={`flex h-[48px] min-w-[96px] flex-1 items-center justify-center rounded-lg border-2 border-dashed px-3 text-xs font-semibold transition disabled:cursor-default ${
                drag?.over === "new"
                  ? "border-sky-300 bg-sky-400/20 text-sky-100 light:text-sky-800"
                  : selected.length > 0 || drag
                    ? "border-sky-400/70 text-sky-200 hover:bg-sky-400/10 light:text-sky-700"
                    : "border-white/15 text-white/35 light:border-slate-300 light:text-slate-400"
              }`}
            >
              {selected.length > 0 || drag ? "＋ 새 조합 (여기에 놓기)" : "＋ 새 조합 — 타일을 끌어다 놓으세요"}
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

      {state.phase === "playing" && !opened && <OpeningBanner value={myTurn && dirty ? (check?.openingValue ?? 0) : null} />}

      {/* status + actions */}
      {myTurn && (
        <div className="flex flex-col gap-2">
          <p className={`text-center text-xs ${check && !check.ok ? "text-rose-300 light:text-rose-600" : "text-white/60 light:text-slate-500"}`}>
            {check
              ? check.ok
                ? `✔ 내려놓을 수 있어요 (${check.played.length}장${!opened ? ` · 첫 관측 ${check.openingValue}점` : ""})`
                : check.reason
              : !opened
                ? opening
                  ? `✨ 빛나는 타일로 첫 관측을 할 수 있어요 (${opening.score}점) — 골라서 조합을 만들어 보세요`
                  : `아직 ${OPENING_MIN}점 조합이 없어요 — 관측소나 더미에서 한 장 가져오세요`
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
      <section data-drop="rack" className={`${panel} flex flex-col gap-2 p-2.5 transition ${drag?.over === "rack" ? "ring-2 ring-sky-400" : ""}`}>
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
        {myTurn && holdTip !== "off" && (
          <div
            role="status"
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] leading-snug transition ${
              holdTip === "nudge" ? "border-amber-300 bg-amber-300/20 text-amber-100 light:bg-amber-50 light:text-amber-900" : "border-sky-300/40 bg-sky-400/10 text-sky-100 light:border-sky-300 light:bg-sky-50 light:text-sky-900"
            }`}
          >
            <span aria-hidden className="text-base">
              👆
            </span>
            <span className="flex-1">
              {holdTip === "nudge" ? (
                <>
                  바로 밀면 화면이 스크롤돼요 — 타일을 <b>꾹 눌러</b> 손가락 위로 떠오르면 그때 끌어 보세요
                </>
              ) : (
                <>
                  타일을 <b>꾹 눌러</b> 집은 뒤 조합으로 끌어 놓아요 · 짧게 누르면 선택
                </>
              )}
            </span>
            <button type="button" aria-label="안내 닫기" onClick={closeHoldTip} className="-my-1 px-1.5 py-1 text-sm opacity-70 hover:opacity-100">
              ✕
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {rack.map((id) => (
            <StarTile
              key={id}
              id={id}
              selected={selected.includes(id)}
              hint={hintTiles.has(id)}
              dimmed={!!drag?.ids.includes(id)}
              onDragStart={myTurn ? (e) => startDrag(id, e) : undefined}
              onClick={myTurn ? tap(() => toggle(id)) : undefined}
            />
          ))}
          {rack.length === 0 && <p className="text-xs text-white/40">모두 내려놓았어요!</p>}
        </div>
      </section>

      {drag && (
        <div className="pointer-events-none fixed z-50 flex gap-0.5 drop-shadow-[0_8px_12px_rgba(0,0,0,0.5)]" style={{ left: drag.x, top: drag.y, transform: "translate(-50%, -75%) rotate(-3deg)" }}>
          {drag.ids.map((id) => (
            <StarTile key={id} id={id} />
          ))}
        </div>
      )}

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

type DropTarget = number | "new" | "rack";

function dropTargetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
  const v = el?.dataset.drop;
  if (v === undefined) return null;
  return v === "new" || v === "rack" ? v : Number(v);
}

/** Always-on reminder of the first-meld rule, with a live total while drafting. */
function OpeningBanner({ value }: { value: number | null }) {
  const pct = value === null ? 0 : Math.min(100, (value / OPENING_MIN) * 100);
  const done = value !== null && value >= OPENING_MIN;
  return (
    <div className="rounded-xl border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-xs text-amber-100 light:border-amber-300 light:bg-amber-50 light:text-amber-900">
      <p className="font-semibold">🔰 첫 관측(첫 등록) 조건: 내 손의 타일로만 만든 조합의 숫자 합계 {OPENING_MIN}점 이상</p>
      <p className="mt-0.5 text-[11px] opacity-80">예) 7+8+9 = 24 · 8+8+8 = 24 · 혜성은 대신하는 숫자로 계산 · 테이블에 있는 조합은 이번엔 못 건드려요</p>
      {value !== null && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/30 light:bg-amber-200">
            <div className={`h-full rounded-full transition-all ${done ? "bg-emerald-400" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
          </div>
          <span className={`font-bold ${done ? "text-emerald-300 light:text-emerald-700" : ""}`}>
            지금 {value} / {OPENING_MIN}점{done ? " ✔" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
