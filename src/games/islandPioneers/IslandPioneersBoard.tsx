"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Frame3D, Loading3D, preferLowDetail, useBoardView, ViewToggle } from "@/games/shared/three/viewPref";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import {
  analyze,
  BOARD,
  cellX,
  cellY,
  COMPLETE_POINTS,
  fits,
  frontier,
  legalPlacements,
  previewPlacement,
  QUEST_FIRST,
  QUEST_LATER,
  questDef,
  SETTLERS,
  settlerOptions,
  supplyOf,
  tilesLeft,
  TURN_MS,
  type EngineAction,
  type IslandState,
  type SeatIndex,
} from "./engine";
import { distinctRotations, quadTerrain, RESOURCE_EMOJI, RESOURCE_NAMES, TERRAIN_EMOJI, TERRAIN_NAMES } from "./tiles";
import { PioneerFlag, SEAT_COLORS, SEAT_SHAPES, TileCard, TileShape, triCenter, triPoints } from "./TileArt";
import { getIslandPioneersSound, islandIntensity, islandSoundCues } from "./islandPioneersSound";

const IslandScene3D = dynamic(() => import("./three/IslandScene3D"), { ssr: false, loading: () => <Loading3D /> });

export interface IslandPioneersBoardProps {
  state: IslandState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  isHost: boolean;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
  onRulebook: () => void;
}

/** Ms left in this turn by this client's own clock (negative once overdue). */
function useTurnClock(turn: number): number {
  const [left, setLeft] = useState({ turn, ms: TURN_MS });
  useEffect(() => {
    const at = Date.now();
    const tick = () => setLeft({ turn, ms: TURN_MS - (Date.now() - at) });
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [turn]);
  return left.turn === turn ? left.ms : TURN_MS;
}

interface Draft {
  pick: number;
  cell: number | null;
  rot: number;
  settler: number | null;
}

const SIDE_NAMES = ["북", "동", "남", "서"];

export default function IslandPioneersBoard({ state, viewerSeat, names, connectedSeats, isHost, onAction, onGameEnd, onRulebook }: IslandPioneersBoardProps) {
  const board3d = useBoardView("island-pioneers-view");
  const [lowDetail] = useState(preferLowDetail);
  const sound = getIslandPioneersSound;
  useSoundCues(state, sound, islandSoundCues);
  useSuiteBgm(sound, state.phase !== "gameOver", islandIntensity(state));

  const myTurn = state.phase === "playing" && state.active === viewerSeat;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftTurn, setDraftTurn] = useState(state.turn);
  if (draftTurn !== state.turn) {
    setDraftTurn(state.turn);
    setDraft(null);
  }
  const nameOf = (seat: SeatIndex) => names[seat] ?? `${seat + 1}번`;

  // ── my-turn chime + last-10-seconds ticks ──
  const remaining = useTurnClock(state.turn);
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const chimedRef = useRef(-1);
  useEffect(() => {
    if (myTurn && chimedRef.current !== state.turn) {
      chimedRef.current = state.turn;
      sound().play("myTurn");
    }
  }, [myTurn, state.turn, sound]);
  const tickRef = useRef(-1);
  useEffect(() => {
    if (!myTurn || seconds > 10 || seconds <= 0 || tickRef.current === seconds) return;
    tickRef.current = seconds;
    sound().play("tick");
  }, [myTurn, seconds, sound]);

  // My own timer runs out → automatic tile; the host covers a silent seat 6 s later.
  const timedOutRef = useRef(-1);
  useEffect(() => {
    if (state.phase !== "playing" || timedOutRef.current === state.turn) return;
    const seat = myTurn ? viewerSeat : isHost && remaining <= -6000 ? state.active : null;
    if (seat === null || remaining > 0) return;
    timedOutRef.current = state.turn;
    onAction({ type: "timeout", seat, turn: state.turn });
  }, [remaining, myTurn, isHost, state.phase, state.turn, state.active, viewerSeat, onAction]);

  // ── derived board data ──
  const fr = useMemo(() => frontier(state.board), [state.board]);
  const pickedTile = draft ? state.market[draft.pick] : undefined;
  const spots = useMemo(() => {
    if (pickedTile === undefined) return new Map<number, number[]>();
    const m = new Map<number, number[]>();
    for (const p of legalPlacements(state.board, pickedTile, fr)) m.set(p.cell, [...(m.get(p.cell) ?? []), p.rot]);
    return m;
  }, [state.board, pickedTile, fr]);
  const ghostOk = draft && draft.cell !== null && pickedTile !== undefined && fits(state.board, draft.cell, pickedTile, draft.rot);
  const settlerChoices = useMemo(() => {
    if (!draft || draft.cell === null || pickedTile === undefined || !ghostOk) return [];
    if (supplyOf(state, viewerSeat) <= 0) return [];
    const b = state.board.slice();
    b[draft.cell] = { tile: pickedTile, rot: draft.rot, by: viewerSeat };
    return settlerOptions(b, state.settlers, draft.cell);
  }, [draft, pickedTile, ghostOk, state, viewerSeat]);
  const preview = useMemo(() => {
    if (!myTurn || !draft || draft.cell === null || !ghostOk) return null;
    return previewPlacement(state, viewerSeat, draft.pick, draft.cell, draft.rot, draft.settler);
  }, [myTurn, draft, ghostOk, state, viewerSeat]);

  // board viewport: the island's bounding box + 1 empty ring, at least 5×5
  const view = useMemo(() => {
    let x0 = BOARD;
    let y0 = BOARD;
    let x1 = -1;
    let y1 = -1;
    state.board.forEach((p, c) => {
      if (!p) return;
      x0 = Math.min(x0, cellX(c));
      y0 = Math.min(y0, cellY(c));
      x1 = Math.max(x1, cellX(c));
      y1 = Math.max(y1, cellY(c));
    });
    x0 = Math.max(0, x0 - 1);
    y0 = Math.max(0, y0 - 1);
    x1 = Math.min(BOARD - 1, x1 + 1);
    y1 = Math.min(BOARD - 1, y1 + 1);
    while (x1 - x0 < 4) {
      if (x0 > 0) x0--;
      if (x1 - x0 < 4 && x1 < BOARD - 1) x1++;
    }
    while (y1 - y0 < 4) {
      if (y0 > 0) y0--;
      if (y1 - y0 < 4 && y1 < BOARD - 1) y1++;
    }
    return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }, [state.board]);

  const ev = state.lastEvent;
  const flashCells = useMemo(() => new Set(ev?.scored.flatMap((r) => r.cells) ?? []), [ev]);
  const [flashSeq, setFlashSeq] = useState<number | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  if (ev && ev.seq !== flashSeq) {
    setFlashSeq(ev.seq);
    setFlashOn(ev.scored.length > 0 || ev.quests.length > 0);
  }
  useEffect(() => {
    if (!flashOn) return;
    const id = window.setTimeout(() => setFlashOn(false), 2600);
    return () => window.clearTimeout(id);
  }, [flashOn, flashSeq]);

  // ── interactions ──
  function choosePick(pick: number) {
    if (!myTurn) return;
    const tile = state.market[pick];
    if (tile === undefined) return;
    sound().play("pick");
    setDraft({ pick, cell: null, rot: distinctRotations(tile)[0], settler: null });
  }
  function chooseCell(cell: number) {
    if (!myTurn || !draft) return;
    const rots = spots.get(cell);
    if (!rots) {
      if (!state.board[cell]) sound().play("invalid");
      return;
    }
    sound().play("ui");
    setDraft({ ...draft, cell, rot: rots.includes(draft.rot) ? draft.rot : rots[0], settler: null });
  }
  function rotate(dir: 1 | -1) {
    if (!myTurn || !draft || pickedTile === undefined) return;
    sound().play("rotate");
    if (draft.cell !== null) {
      const rots = spots.get(draft.cell) ?? [];
      if (rots.length === 0) return;
      const i = rots.indexOf(draft.rot);
      setDraft({ ...draft, rot: rots[(i + dir + rots.length) % rots.length], settler: null });
    } else setDraft({ ...draft, rot: (draft.rot + dir + 4) % 4 });
  }
  function toggleSettler(q: number) {
    if (!draft) return;
    sound().play(draft.settler === q ? "ui" : "settler");
    setDraft({ ...draft, settler: draft.settler === q ? null : q });
  }
  function confirm() {
    if (!myTurn || !draft || draft.cell === null || !ghostOk) return;
    onAction({ type: "place", seat: viewerSeat, turn: state.turn, pick: draft.pick, cell: draft.cell, rot: draft.rot, settler: draft.settler });
  }
  useEffect(() => {
    if (!myTurn) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea")) return;
      if (e.key === "r" || e.key === "R") rotate(1);
      else if (e.key === "e" || e.key === "E") rotate(-1);
      else if (e.key === "Enter") confirm();
      else if (e.key === "Escape") setDraft(null);
      else if (["1", "2", "3"].includes(e.key)) choosePick(Number(e.key) - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── text ──
  const eventText = (() => {
    if (!ev) return "🏕️ 상륙 캠프에서 개척이 시작돼요 — 🛶 항구에서 타일을 골라 섬에 이어 붙이세요";
    const who = ev.seat === viewerSeat ? "내가" : `${nameOf(ev.seat)} 님이`;
    const parts = [`${ev.timeout ? "⏰ " : ""}${who} 타일을 놓았어요${ev.settler !== null ? " · 🚩 개척자 배치" : ""}${ev.picked >= 0 ? ` · ${RESOURCE_EMOJI[ev.picked]} 획득` : ""}`];
    for (const r of ev.scored) {
      const label = r.lagoon ? "🏝️ 석호" : `${TERRAIN_EMOJI[r.terrain]} ${TERRAIN_NAMES[r.terrain]}`;
      parts.push(`${label} ${r.tiles}칸 완성 → ${r.owners.map(nameOf).join("·")} +${r.points}`);
    }
    for (const q of ev.quests) parts.push(`📜 ${nameOf(q.seat)} «${questDef(q.quest).name}» +${q.points}`);
    if (ev.washed.length) parts.push(`🌊 놓을 곳 없는 타일 ${ev.washed.length}장이 떠내려갔어요`);
    return parts.join(" · ");
  })();

  const previewText = (() => {
    if (!myTurn) return null;
    if (!draft) return `🛶 항구에서 타일을 고르세요 (1·2·3 키) · ⏱ ${seconds}초`;
    if (draft.cell === null) return spots.size ? "💡 빛나는 칸을 눌러 놓을 자리를 정하세요 · R로 돌리기" : "이 타일은 놓을 곳이 없어요";
    if (!preview) return "이 방향으로는 맞지 않아요 — 돌려 보세요";
    const pe = preview.lastEvent!;
    const bits: string[] = [];
    for (const r of pe.scored) bits.push(`${r.lagoon ? "🏝️" : TERRAIN_EMOJI[r.terrain]} ${r.tiles}칸 완성 → ${r.owners.map((o) => (o === viewerSeat ? "나" : nameOf(o))).join("·")} +${r.points}`);
    for (const q of pe.quests) bits.push(`📜 ${q.seat === viewerSeat ? "나" : nameOf(q.seat)} +${q.points}`);
    if (pe.picked >= 0) bits.push(`${RESOURCE_EMOJI[pe.picked]} +1`);
    const delta = preview.scores[viewerSeat] - state.scores[viewerSeat];
    return `${bits.length ? bits.join(" · ") : "점수 변화 없음"}${delta ? ` (나 +${delta})` : ""}`;
  })();

  const settlerMap = useMemo(() => {
    const an = analyze(state.board, state.settlers);
    return { an };
  }, [state.board, state.settlers]);
  const [hoverRegion, setHoverRegion] = useState<number | null>(null);
  const hoverInfo = hoverRegion !== null ? settlerMap.an.regions[hoverRegion] : null;

  const panel = "rounded-2xl border border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white/90 light:shadow-sm";
  const seats = Array.from({ length: state.playerCount }, (_, i) => (viewerSeat + i) % state.playerCount);

  return (
    <div onPointerDownCapture={() => sound().unlock()} className="flex flex-col gap-3">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-white/70 light:text-slate-600">🏝️ 남은 타일 {tilesLeft(state)} · 🌊 떠내려감 {state.washed.length}</span>
        <div className="flex items-center gap-1.5">
          <SuiteSoundHud suite={sound} icon="🏝️" label="Trade Winds" preview="complete" />
          <ViewToggle board={board3d} />
          <button onClick={onRulebook} className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/50 hover:border-white/25 light:border-slate-200 light:text-slate-500">
            📖 룰북
          </button>
        </div>
      </div>

      {/* players */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        {seats.map((seat) => {
          const active = state.phase === "playing" && state.active === seat;
          const res = state.resources[seat];
          return (
            <div
              key={seat}
              className={`flex flex-col gap-0.5 rounded-xl border px-2.5 py-1.5 text-[11px] ${active ? "border-amber-300/70 bg-amber-300/10 light:bg-amber-50" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"}`}
            >
              <span className="flex items-center gap-1 truncate font-semibold text-white light:text-slate-800">
                <span style={{ color: SEAT_COLORS[seat] }} className="drop-shadow-[0_0_1px_#000]">
                  {SEAT_SHAPES[seat]}
                </span>
                {active && "▶"}
                <span className="truncate">{seat === viewerSeat ? `${nameOf(seat)} (나)` : nameOf(seat)}</span>
                {!connectedSeats.has(seat) && <span title="연결 끊김">📴</span>}
              </span>
              <span className="flex justify-between text-white/70 light:text-slate-600">
                <b>⭐ {state.scores[seat]}점</b>
                <span title="남은 개척자">🚩×{supplyOf(state, seat)}</span>
              </span>
              <span className="flex justify-between text-white/60 light:text-slate-500">
                <span title="목재·양털·광석·물고기">
                  {res.map((n, k) => (
                    <span key={k} className={n ? "" : "opacity-40"}>
                      {RESOURCE_EMOJI[k]}
                      {n}{" "}
                    </span>
                  ))}
                </span>
                {active && <span className={seconds <= 10 ? "font-bold text-rose-300 light:text-rose-600" : ""}>⏱{seconds}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* quests */}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {state.quests.map((id, i) => {
          const q = questDef(id);
          const done = state.questDone[i];
          return (
            <div key={id} className={`${panel} flex items-start gap-2 px-2.5 py-1.5 text-[11px]`}>
              <span className="text-lg leading-none">{q.emoji}</span>
              <span className="flex-1">
                <b className="text-white light:text-slate-800">📜 {q.name}</b> <span className="text-white/45 light:text-slate-400">처음 +{QUEST_FIRST} · 이후 +{QUEST_LATER}</span>
                <br />
                <span className="text-white/60 light:text-slate-500">{q.desc}</span>
                {done.length > 0 && <span className="block text-emerald-300 light:text-emerald-700">✔ {done.map((s) => (s === viewerSeat ? "나" : nameOf(s))).join(" → ")}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {board3d.view === "3d" && (
        <Frame3D hint="타일 고르기·놓기는 아래 지도에서 · 드래그로 둘러보기">
          <IslandScene3D
            board={state.board}
            settlers={state.settlers}
            ghost={myTurn && draft && draft.cell !== null && pickedTile !== undefined ? { cell: draft.cell, tile: pickedTile, rot: draft.rot, ok: !!ghostOk, settler: draft.settler, seat: viewerSeat } : null}
            flashCells={flashOn ? [...flashCells] : []}
            lastCell={ev?.cell ?? null}
            lowDetail={lowDetail}
          />
        </Frame3D>
      )}

      <p className="rounded-xl bg-black/25 px-3 py-2 text-center text-xs leading-relaxed text-white/80 light:bg-slate-100 light:text-slate-700">{eventText}</p>

      {/* harbour */}
      <section className={`${panel} flex flex-col gap-2 p-2.5`}>
        <div className="flex items-center justify-between text-[11px] text-white/50 light:text-slate-500">
          <span>🛶 항구 — 이번 차례에 놓을 타일 하나를 고르세요</span>
          <span>🎒 남은 더미 {state.bag.length}</span>
        </div>
        <div className="flex items-center justify-center gap-3">
          {state.market.map((tile, i) => {
            const sel = draft?.pick === i;
            const rot = sel ? draft!.rot : 0;
            return (
              <button
                key={`${tile}-${i}`}
                type="button"
                disabled={!myTurn}
                onClick={() => choosePick(i)}
                aria-label={`항구 타일 ${i + 1}: 북 ${TERRAIN_NAMES[quadTerrain(tile, rot, 0)]}, 동 ${TERRAIN_NAMES[quadTerrain(tile, rot, 1)]}, 남 ${TERRAIN_NAMES[quadTerrain(tile, rot, 2)]}, 서 ${TERRAIN_NAMES[quadTerrain(tile, rot, 3)]}`}
                className={`relative rounded-xl border-2 p-1 transition ${sel ? "-translate-y-1 border-sky-300 bg-sky-400/15 shadow-[0_0_14px_rgba(56,189,248,0.6)]" : "border-white/10 light:border-slate-200"} ${myTurn ? "hover:border-sky-200" : "opacity-80"}`}
              >
                <TileCard tile={tile} rot={rot} size={72} className="transition-transform" />
                <span className="absolute -top-2 -left-2 rounded-full bg-black/70 px-1.5 text-[10px] text-white">{i + 1}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* map */}
      <section className={`${panel} relative p-1.5`}>
        <svg
          viewBox={`${view.x0 - 0.15} ${view.y0 - 0.15} ${view.w + 0.3} ${view.h + 0.3}`}
          className="mx-auto block w-full max-w-[640px] touch-manipulation select-none"
          style={{ aspectRatio: `${view.w + 0.3} / ${view.h + 0.3}` }}
          role="img"
          aria-label="섬 지도"
          onPointerLeave={() => setHoverRegion(null)}
        >
          <defs>
            <pattern id="ip-waves" width="0.5" height="0.25" patternUnits="userSpaceOnUse">
              <path d="M0,0.15 Q0.125,0.05 0.25,0.15 T0.5,0.15" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.02" />
            </pattern>
          </defs>
          <rect x={view.x0 - 0.15} y={view.y0 - 0.15} width={view.w + 0.3} height={view.h + 0.3} fill="#0c4a6e" />
          <rect x={view.x0 - 0.15} y={view.y0 - 0.15} width={view.w + 0.3} height={view.h + 0.3} fill="url(#ip-waves)" />
          {state.board.map((p, c) => {
            if (!p) return null;
            const x = cellX(c);
            const y = cellY(c);
            return (
              <g key={c}>
                <TileShape tile={p.tile} rot={p.rot} x={x} y={y} />
                {flashOn && flashCells.has(c) && <rect x={x} y={y} width={1} height={1} fill="#fde047" opacity={0.45} className="animate-pulse" style={{ pointerEvents: "none" }} />}
                {ev?.cell === c && !flashOn && <rect x={x + 0.03} y={y + 0.03} width={0.94} height={0.94} fill="none" stroke="#fde047" strokeWidth={0.05} strokeDasharray="0.12 0.08" style={{ pointerEvents: "none" }} />}
                {p.tile === 0 && (
                  <text x={x + 0.5} y={y + 0.5} fontSize={0.3} textAnchor="middle" dominantBaseline="central" style={{ pointerEvents: "none" }}>
                    🏕️
                  </text>
                )}
                {[0, 1, 2, 3].map((d) => (
                  <polygon key={d} points={triPoints(x, y, d)} fill="transparent" onPointerEnter={() => setHoverRegion(settlerMap.an.regionOf[c * 4 + d])} />
                ))}
              </g>
            );
          })}
          {/* hovered region outline */}
          {hoverInfo &&
            hoverInfo.nodes.map((node) => (
              <polygon key={`h${node}`} points={triPoints(cellX(node >> 2), cellY(node >> 2), node & 3)} fill="rgba(255,255,255,0.18)" style={{ pointerEvents: "none" }} />
            ))}
          {/* pioneers */}
          {state.settlers.map((s) => {
            const [cx, cy] = triCenter(cellX(s.cell), cellY(s.cell), s.quad);
            return <PioneerFlag key={`${s.cell}-${s.quad}`} seat={s.seat} cx={cx} cy={cy} />;
          })}
          {/* legal spots for the chosen tile */}
          {myTurn &&
            draft &&
            fr.map((c) => {
              const ok = spots.has(c);
              const x = cellX(c);
              const y = cellY(c);
              if (draft.cell === c) return null;
              return (
                <rect
                  key={`f${c}`}
                  x={x + 0.06}
                  y={y + 0.06}
                  width={0.88}
                  height={0.88}
                  rx={0.08}
                  fill={ok ? "rgba(125,211,252,0.28)" : "rgba(255,255,255,0.04)"}
                  stroke={ok ? "#7dd3fc" : "rgba(255,255,255,0.12)"}
                  strokeWidth={0.04}
                  strokeDasharray={ok ? undefined : "0.08 0.08"}
                  className={ok ? "animate-pulse cursor-pointer" : ""}
                  onClick={() => chooseCell(c)}
                />
              );
            })}
          {/* ghost tile */}
          {myTurn && draft && draft.cell !== null && pickedTile !== undefined && (
            <g>
              <TileShape tile={pickedTile} rot={draft.rot} x={cellX(draft.cell)} y={cellY(draft.cell)} opacity={0.92} />
              <rect x={cellX(draft.cell)} y={cellY(draft.cell)} width={1} height={1} fill="none" stroke={ghostOk ? "#7dd3fc" : "#f43f5e"} strokeWidth={0.06} />
              {settlerChoices.map((q) => {
                const [cx, cy] = triCenter(cellX(draft.cell!), cellY(draft.cell!), q);
                const on = draft.settler === q;
                return (
                  <g key={`sc${q}`} onClick={() => toggleSettler(q)} className="cursor-pointer">
                    <circle cx={cx} cy={cy} r={0.15} fill={on ? SEAT_COLORS[viewerSeat] : "rgba(0,0,0,0.45)"} stroke="#fff" strokeWidth={0.025} />
                    {on ? <PioneerFlag seat={viewerSeat} cx={cx} cy={cy} size={0.26} /> : <text x={cx} y={cy} fontSize={0.14} textAnchor="middle" dominantBaseline="central" fill="#fff" style={{ pointerEvents: "none" }}>🚩</text>}
                  </g>
                );
              })}
            </g>
          )}
          {/* compass coords for screen readers / orientation */}
          <text x={view.x0 + 0.1} y={view.y0 + 0.12} fontSize={0.2} fill="rgba(255,255,255,0.6)" dominantBaseline="hanging">
            N↑
          </text>
        </svg>
        {hoverInfo && (
          <div className="pointer-events-none absolute top-2 right-2 rounded-lg bg-black/75 px-2 py-1 text-[11px] text-white">
            {hoverInfo.terrain === 3 ? (hoverInfo.ocean ? "🌊 바다 (먼바다와 이어짐)" : "🏝️ 바다 → 막으면 석호") : `${TERRAIN_EMOJI[hoverInfo.terrain]} ${TERRAIN_NAMES[hoverInfo.terrain]}`} {hoverInfo.cells.length}칸 ·{" "}
            {hoverInfo.open === 0 ? "완성" : `열린 변 ${hoverInfo.open}`}
            {hoverInfo.resources > 0 && ` · 자원 ${hoverInfo.resources}`}
            {hoverInfo.settlers.length > 0 && ` · 🚩 ${hoverInfo.settlers.map((s) => SEAT_SHAPES[s.seat]).join("")}`}
            {hoverInfo.open > 0 && !hoverInfo.ocean && ` · 완성 시 ${hoverInfo.cells.length * COMPLETE_POINTS[hoverInfo.terrain]}점+`}
          </div>
        )}
      </section>

      {/* actions */}
      {myTurn && (
        <div className="flex flex-col gap-2">
          <p className="text-center text-xs text-white/70 light:text-slate-600">{previewText}</p>
          {draft && draft.cell !== null && ghostOk && (
            <p className="text-center text-[11px] text-white/55 light:text-slate-500">
              {supplyOf(state, viewerSeat) <= 0
                ? "🚩 남은 개척자가 없어요 — 지역이 완성되면 돌아와요"
                : settlerChoices.length === 0
                  ? "🚩 이 타일의 땅은 모두 누군가 차지했어요"
                  : draft.settler === null
                    ? `🚩 개척자를 세우려면 타일 위 깃발 칸을 누르세요 (남은 ${supplyOf(state, viewerSeat)}/${SETTLERS})`
                    : `🚩 ${SIDE_NAMES[draft.settler]}쪽 ${TERRAIN_NAMES[quadTerrain(pickedTile!, draft.rot, draft.settler)]}에 개척자를 세워요 — 다시 누르면 취소`}
            </p>
          )}
          <div className="grid grid-cols-4 gap-1.5">
            <button onClick={() => rotate(-1)} disabled={!draft} className="min-h-11 rounded-xl border border-white/15 py-2.5 text-xs text-white/80 disabled:opacity-35 light:border-slate-300 light:text-slate-700">
              ⟲ 왼쪽
            </button>
            <button onClick={() => rotate(1)} disabled={!draft} className="min-h-11 rounded-xl border border-white/15 py-2.5 text-xs text-white/80 disabled:opacity-35 light:border-slate-300 light:text-slate-700">
              ⟳ 돌리기 (R)
            </button>
            <button onClick={() => { sound().play("ui"); setDraft(null); }} disabled={!draft} className="min-h-11 rounded-xl border border-white/15 py-2.5 text-xs text-white/80 disabled:opacity-35 light:border-slate-300 light:text-slate-700">
              ↩ 취소
            </button>
            <button onClick={confirm} disabled={!ghostOk} className="min-h-11 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white disabled:bg-emerald-900/50 disabled:text-white/40">
              ✔ 놓기
            </button>
          </div>
        </div>
      )}
      {!myTurn && state.phase === "playing" && (
        <p className="text-center text-xs text-white/55 light:text-slate-500">
          ⏳ {nameOf(state.active)} 님이 타일을 고르는 중… ({seconds}초)
        </p>
      )}

      {state.phase === "gameOver" && <FinalPanel state={state} nameOf={nameOf} viewerSeat={viewerSeat} onGameEnd={onGameEnd} />}
    </div>
  );
}

function FinalPanel({ state, nameOf, viewerSeat, onGameEnd }: { state: IslandState; nameOf: (s: SeatIndex) => string; viewerSeat: SeatIndex; onGameEnd: () => void }) {
  const rows = [...(state.final ?? [])].sort((a, b) => b.total - a.total);
  const best = rows[0]?.total;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-3 sm:items-center">
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-2xl border border-amber-300/40 bg-[#0b2a3a] p-4 text-white shadow-2xl">
        <h2 className="text-center text-base font-bold">🏝️ 개척 완료! 최종 점수</h2>
        <table className="w-full text-xs">
          <thead className="text-white/50">
            <tr>
              <th className="text-left">개척자</th>
              <th title="게임 중 얻은 점수(완성·의뢰)">진행</th>
              <th title="미완성 지역 1칸 1점">미완성</th>
              <th title="자원 1개 1점">자원</th>
              <th title="4종 세트마다 +3">세트</th>
              <th>합계</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.seat} className="border-t border-white/10">
                <td className="py-1.5 font-semibold">
                  {r.total === best && "👑 "}
                  <span style={{ color: SEAT_COLORS[r.seat] }}>{SEAT_SHAPES[r.seat]}</span> {nameOf(r.seat)}
                  {r.seat === viewerSeat && " (나)"}
                </td>
                <td className="text-center">{r.total - r.incomplete - r.resources - r.setBonus}</td>
                <td className="text-center">+{r.incomplete}</td>
                <td className="text-center">+{r.resources}</td>
                <td className="text-center">+{r.setBonus}</td>
                <td className="text-center font-bold text-amber-300">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-center text-[11px] text-white/50">
          자원: {RESOURCE_NAMES.map((n, k) => `${RESOURCE_EMOJI[k]}${n}`).join(" · ")} — 동점이면 자원이 많은 사람이 앞서요
        </p>
        <button onClick={onGameEnd} className="rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-black hover:bg-amber-400">
          🏆 결과 확정
        </button>
      </div>
    </div>
  );
}

