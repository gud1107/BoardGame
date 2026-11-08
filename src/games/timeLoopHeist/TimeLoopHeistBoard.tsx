"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loading3D, ViewToggle, preferLowDetail, useBoardView } from "@/games/shared/three/viewPref";
import { REPLAY_TICK_MS, levelOf, mergedTracks, type GameState, type Seat } from "./engine";
import { parseLevel, type LevelDef } from "./levels";
import { canAct, simulate, sortTracks, actLabel, type Act, type Frame, type SelfTrack } from "./sim";
import { KEY_HELP, SEAT_COLORS, SEAT_MARKS, eventText, lootKindAt, selfMeta, type SelfMeta } from "./show";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm, type SoundCue } from "@/lib/audio/useProceduralSuite";
import { getTimeLoopHeistSound, heistPlay, tickSfx } from "./timeLoopHeistSound";
import { ThiefToken } from "./ThiefToken";

const HeistScene3D = dynamic(() => import("./three/HeistScene3D"), { ssr: false, loading: () => <Loading3D /> });

export interface TimeLoopHeistBoardProps {
  state: GameState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  deadlineMs: number | null;
  nowMs: number;
  onSubmit: (moves: string, auto: boolean) => void;
  onReady: () => void;
  onGameEnd: () => void;
}

// ------------------------------------------------------------------ 2D 격자

function Grid2D({ def, frame, meta }: { def: LevelDef; frame: Frame; meta: SelfMeta[] }) {
  const lv = parseLevel(def);
  const seen = new Set(frame.seen);
  const cells = [];
  for (let y = 0; y < lv.h; y++) {
    for (let x = 0; x < lv.w; x++) {
      const i = y * lv.w + x;
      const c = def.rows[y][x];
      let base = "";
      let cls = "bg-[#d9cdb4] light:bg-[#e7dcc4]";
      let title = "";
      if (lv.wall[i]) cls = "bg-[#4a4266]";
      const gate = lv.gateAt[i];
      if (gate) {
        const open = frame.open[gate];
        const g = lv.gates[gate];
        cls = open ? "bg-emerald-300/80" : g.kind === "laser" ? "bg-[repeating-linear-gradient(90deg,#fecaca_0,#fecaca_4px,#ef4444_4px,#ef4444_6px)]" : "bg-slate-500";
        base = open ? "" : g.kind === "laser" ? "" : "🚪";
        title = `문 ${gate}: ${g.need.join("+")} 필요 — ${open ? "열림" : "닫힘"}`;
      }
      if (lv.plates[c]) {
        cls = frame.active[c] ? "bg-yellow-300" : "bg-yellow-700/70";
        base = c;
        title = `발판 ${c}`;
      }
      if (lv.levers[c]) {
        base = frame.levers[c] ? "✅" : "🔧";
        title = `레버 ${c}`;
      }
      if (lv.consoles[c]) {
        base = "⚡";
        cls = frame.emp > 0 ? "bg-sky-300" : "bg-sky-700/60";
        title = "EMP 콘솔";
      }
      if (c === "V") {
        base = "🚐";
        title = "탈출 밴";
      }
      if (c === "S") {
        base = "◎";
        title = "출발점";
      }
      const loot = frame.loot.map((l, k) => ({ ...l, k })).filter((l) => l.state === "floor" && l.x === x && l.y === y);
      const guards = frame.guards.filter((g) => g.x === x && g.y === y);
      const selves = frame.selves.map((s, k) => ({ s, m: meta[k] })).filter(({ s, m }) => m && s.x === x && s.y === y && s.status !== "paradox");
      cells.push(
        <div key={i} title={title} className={`relative flex aspect-square items-center justify-center text-[clamp(8px,2.6vw,15px)] leading-none font-bold text-slate-900 ${cls}`}>
          {seen.has(i) && <span className="absolute inset-0 bg-red-500/45" />}
          <span className="relative">{base}</span>
          {loot.map((l) => (
            <span key={l.k} className="absolute inset-0 flex items-center justify-center">
              {lootKindAt(def, l.k) === "gem" ? "💎" : "🪙"}
            </span>
          ))}
          {guards.map((g, k) => (
            <span key={k} className="absolute inset-0 flex items-center justify-center">
              {frame.emp > 0 ? "💤" : "🤖"}
              <span className="absolute text-[0.6em] text-red-600" style={{ transform: `translate(${g.face === "E" ? 70 : g.face === "W" ? -70 : 0}%, ${g.face === "S" ? 70 : g.face === "N" ? -70 : 0}%)` }}>
                {g.face === "E" ? "▶" : g.face === "W" ? "◀" : g.face === "N" ? "▲" : "▼"}
              </span>
            </span>
          ))}
          {selves.length > 0 && (
            <span className="absolute inset-[6%] flex flex-wrap items-center justify-center gap-[1px]">
              {selves.slice(0, 4).map(({ s, m }, k) => (
                <span key={k} title={m.label} className={`relative flex items-center justify-center ${m.live ? "h-[88%] w-[88%]" : selves.length > 1 ? "h-[48%] w-[48%]" : "h-[70%] w-[70%]"}`}>
                  <ThiefToken color={m.color} caught={s.status === "caught"} ghost={!m.live} live={m.live} carrying={s.carry !== null} />
                  {!m.live && selves.length === 1 && <span className="absolute -right-[14%] -bottom-[10%] rounded bg-black/70 px-[2px] text-[0.42em] leading-tight text-white">{m.short}</span>}
                </span>
              ))}
            </span>
          )}
        </div>,
      );
    }
  }
  return (
    <div className="mx-auto w-full overflow-hidden rounded-xl border border-black/40" style={{ maxWidth: lv.w * 40 }}>
      <div className="grid gap-px bg-black/30" style={{ gridTemplateColumns: `repeat(${lv.w}, minmax(0, 1fr))` }}>
        {cells}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 공통 무대

interface StageProps {
  def: LevelDef;
  frame: Frame;
  meta: SelfMeta[];
  replay: boolean;
  board: ReturnType<typeof useBoardView>;
  zoom: boolean;
  onZoom: (v: boolean) => void;
  /** 확대할 때 따라갈 칸 — 녹화 중인 내 도둑, 재생이면 null(전체 보기만) */
  focus: { x: number; y: number } | null;
}

/** 3D 프레임 — 전체 보기는 지도 비율(기울기 반영)에 맞춘 높이로 빈 공간 없이, 확대는 정사각형 */
function Stage({ def, frame, meta, replay, board, zoom, onZoom, focus }: StageProps) {
  const [lowDetail] = useState(preferLowDetail);
  if (board.view === "3d") {
    const lv = parseLevel(def);
    const zoomed = zoom && focus !== null;
    const ratio = zoomed ? 1 : (lv.w + 0.6) / (lv.h * Math.sin((64 * Math.PI) / 180) + 1.4);
    return (
      <div className="relative z-10 w-full overflow-hidden rounded-2xl border border-black/50" style={{ aspectRatio: String(ratio), minHeight: 240, maxHeight: "70vh" }}>
        <HeistScene3D def={def} frame={frame} meta={meta} lowDetail={lowDetail} replay={replay} focus={zoomed ? focus : null} />
        {focus !== null && (
          <button
            type="button"
            onClick={() => {
              heistPlay("ui");
              onZoom(!zoom);
            }}
            className="absolute top-2 right-2 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-semibold text-white/90 backdrop-blur hover:bg-black/75"
          >
            {zoom ? "🗺️ 전체 보기" : "🔍 내 도둑 확대"}
          </button>
        )}
        {!zoomed && (
          <span className="pointer-events-none absolute bottom-2 left-1/2 max-w-[92%] -translate-x-1/2 truncate rounded-full bg-black/55 px-3 py-1 text-[11px] whitespace-nowrap text-white/75">
            {replay ? "재생 중 — 모든 루프의 자아가 함께 움직여요" : "노란 고리 = 나 · 반투명 = 유령 · 빨간 칸 = 경비 시야"}
          </span>
        )}
      </div>
    );
  }
  return <Grid2D def={def} frame={frame} meta={meta} />;
}

function Legend() {
  return (
    <p className="break-keep text-[11px] leading-relaxed text-white/45 light:text-slate-500">
      🚐 밴(보석 들고 밟으면 입금) · 💎 보석 · 🪙 동전 · <b className="text-yellow-300 light:text-yellow-700">P/Q</b> 발판(누가 서 있는 동안 켜짐) · 🔧 레버(한 번 당기면 고정) · ⚡ EMP 콘솔(로봇 8틱 정지) · 🤖 경비(바라보는 쪽 3칸) · 빨간 칸 = 들키는 칸
    </p>
  );
}

function Timeline({ T, t, marks, preview, onPreview }: { T: number; t: number; marks: { t: number; icon: string }[]; preview: number | null; onPreview?: (v: number | null) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-5 w-full rounded-full bg-white/10 light:bg-slate-200">
        <div className="absolute inset-y-0 left-0 rounded-full bg-violet-500/60" style={{ width: `${(t / T) * 100}%` }} />
        {marks.map((m, i) => (
          <span key={i} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px]" style={{ left: `${(m.t / T) * 100}%` }}>
            {m.icon}
          </span>
        ))}
        {preview !== null && <span className="absolute inset-y-0 w-0.5 bg-yellow-300" style={{ left: `${(preview / T) * 100}%` }} />}
      </div>
      {onPreview && (
        <label className="flex items-center gap-2 text-[11px] text-white/50 light:text-slate-500">
          👁 미리보기
          <input
            type="range"
            min={0}
            max={T}
            value={preview ?? t}
            onChange={(e) => onPreview(Number(e.target.value))}
            onPointerUp={() => onPreview(null)}
            onKeyUp={() => onPreview(null)}
            onBlur={() => onPreview(null)}
            className="flex-1 accent-yellow-300"
            aria-label="유령들이 앞으로 어떻게 움직이는지 미리보기 (손을 떼면 돌아와요)"
          />
        </label>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 녹화 조작

function HoldButton({ label, onAct, disabled, className = "", aria }: { label: string; onAct: () => void; disabled?: boolean; className?: string; aria: string }) {
  const timer = useRef<number | null>(null);
  const actRef = useRef(onAct);
  useEffect(() => {
    actRef.current = onAct;
  }, [onAct]);
  const stop = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      aria-label={aria}
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        if (disabled) return;
        actRef.current();
        stop();
        timer.current = window.setInterval(() => actRef.current(), 190);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex min-h-12 min-w-12 touch-none items-center justify-center rounded-xl border border-white/15 bg-white/10 text-lg font-bold text-white select-none active:bg-white/25 disabled:opacity-30 light:border-slate-300 light:bg-white light:text-slate-800 ${className}`}
    >
      {label}
    </button>
  );
}

// ------------------------------------------------------------------ 보드

export default function TimeLoopHeistBoard(props: TimeLoopHeistBoardProps) {
  const { state } = props;
  const def = levelOf(state);
  const T = def.ticks;
  const board = useBoardView("time-loop-heist-view");
  // 휴대폰에선 녹화할 때 내 도둑을 따라가며 확대해서 시작한다(전체 지도는 칸이 너무 작다)
  const [zoom, setZoom] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  const [briefOpen, setBriefOpen] = useState(state.loop === 1);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-bold text-white light:text-slate-900">
          {def.emoji} {def.name}
        </span>
        <span className="text-xs text-white/55 light:text-slate-500">
          🔁 루프 {state.loop}/{state.maxLoops} · 💎 목표 {state.need}개 · 기준 {state.par}루프
        </span>
      </div>
      <div className="flex items-center gap-2">
        <SuiteSoundHud suite={getTimeLoopHeistSound} icon="🕵️" label="Midnight Caper" preview="pick" />
        <button
          type="button"
          onClick={() => {
            heistPlay("ui");
            setBriefOpen((v) => !v);
          }}
          className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 light:border-slate-300 light:text-slate-600">
          📋 브리핑
        </button>
        <ViewToggle board={board} />
      </div>
    </div>
  );

  const brief = briefOpen && (
    <div className="rounded-xl border border-violet-400/30 bg-violet-500/10 p-3 text-xs leading-relaxed text-violet-50 light:text-violet-900">
      <p className="break-keep">{def.blurb}</p>
      <p className="mt-1 break-keep text-violet-200/80 light:text-violet-700">💡 {def.hint}</p>
      <p className="mt-1 break-keep text-violet-200/60 light:text-violet-600">같은 루프에 녹화하는 동료는 서로 안 보여요 — 재생 때 처음 만나요. 미리 말로 역할을 나누세요!</p>
    </div>
  );

  // 배경음악: 녹화 중엔 잔잔한 느와르 재즈, 재생 중엔 첩보 선율·현악이 더해진다
  useSuiteBgm(getTimeLoopHeistSound, true, state.phase === "record" ? 0 : 1);
  // 단계 전환·동료 진행 소리 (내 행동 소리는 각 화면이 바로 낸다)
  const viewer = props.viewerSeat;
  const phaseCues = useCallback(
    (prev: GameState, next: GameState): SoundCue[] => {
      const cues: SoundCue[] = [];
      if (prev.phase === "record" && next.phase !== "record") cues.push("rewind");
      else if (prev.phase === "replay" && next.phase === "record") cues.push("loopStart");
      if (prev.phase === next.phase && prev.stage === next.stage) {
        const mate = next.pending.some((m, s) => s !== viewer && m !== null && prev.pending[s] === null) || next.ready.some((r, s) => s !== viewer && r && !prev.ready[s]);
        if (mate) cues.push("mateDone");
      }
      return cues;
    },
    [viewer],
  );
  useSoundCues(state, getTimeLoopHeistSound, phaseCues);

  return (
    <div className="flex flex-col gap-3" onPointerDownCapture={() => getTimeLoopHeistSound().unlock()}>
      {header}
      {brief}
      {state.phase === "record" && <RecordView key={state.stage} {...props} def={def} T={T} board={board} zoom={zoom} onZoom={setZoom} />}
      {state.phase === "replay" && <ReplayView key={state.stage} {...props} def={def} T={T} board={board} zoom={zoom} onZoom={setZoom} tracks={mergedTracks(state)} />}
      {state.phase === "ended" && <ReplayView key={state.stage} {...props} def={def} T={T} board={board} zoom={zoom} onZoom={setZoom} tracks={state.tracks} />}
      <Legend />
    </div>
  );
}

type ViewProps = TimeLoopHeistBoardProps & { def: LevelDef; T: number; board: ReturnType<typeof useBoardView>; zoom: boolean; onZoom: (v: boolean) => void };

function RecordView({ state, viewerSeat, names, deadlineMs, nowMs, onSubmit, def, T, board, zoom, onZoom }: ViewProps) {
  const submitted = state.pending[viewerSeat];
  const [movesLocal, setMoves] = useState("");
  const moves = submitted ?? movesLocal;
  const movesRef = useRef(moves);
  useEffect(() => {
    movesRef.current = moves;
  }, [moves]);
  const [preview, setPreview] = useState<number | null>(null);

  const tracks: SelfTrack[] = useMemo(() => [...state.tracks, { seat: viewerSeat, loop: state.loop, moves }], [state.tracks, viewerSeat, state.loop, moves]);
  const run = useMemo(() => simulate(def, tracks, state.need), [def, tracks, state.need]);
  const ghostRun = useMemo(() => simulate(def, state.tracks, state.need), [def, state.tracks, state.need]);
  const meta = useMemo(() => selfMeta(tracks, names, { seat: viewerSeat, loop: state.loop }), [tracks, names, viewerSeat, state.loop]);
  const me = useMemo(() => sortTracks(tracks).findIndex((t) => t.seat === viewerSeat && t.loop === state.loop), [tracks, viewerSeat, state.loop]);
  const t = moves.length;
  const frame = run.frames[preview ?? t];
  const nowFrame = run.frames[t];
  const myNow = nowFrame.selves[me];
  const locked = submitted !== null;

  const plates = useMemo(() => Object.keys(parseLevel(def).plates), [def]);
  const coinOf = useCallback((loot: number) => lootKindAt(def, loot) === "coin", [def]);
  const act = useCallback(
    (a: Act, quiet = false) => {
      const cur = movesRef.current;
      if (locked || cur.length >= T) return;
      const r = simulate(def, [...state.tracks, { seat: viewerSeat, loop: state.loop, moves: cur }], state.need);
      if (!canAct(def, r.frames[cur.length], me, a)) {
        if (!quiet && a !== "." && a !== "U") heistPlay("blocked");
        return;
      }
      const next = cur + a;
      movesRef.current = next;
      setMoves(next);
      if (quiet) return;
      // 움직일 때마다 발걸음 · 대기는 째깍 · 그 틱에 일어난 일(줍기·레버·문·역설…)도 함께
      if (a === ".") heistPlay("wait");
      else if (a !== "U") heistPlay("step", cur.length);
      const r2 = simulate(def, [...state.tracks, { seat: viewerSeat, loop: state.loop, moves: next }], state.need);
      const cues = tickSfx(r2.events, cur.length, r2.frames[cur.length], r2.frames[cur.length + 1], plates, coinOf);
      for (const c of cues) heistPlay(c);
      if (a === "U" && cues.length === 0) heistPlay("ui");
    },
    [locked, T, def, state.tracks, viewerSeat, state.loop, state.need, me, plates, coinOf],
  );
  const undo = useCallback(() => {
    if (locked || movesRef.current.length === 0) return;
    const next = movesRef.current.slice(0, -1);
    movesRef.current = next;
    setMoves(next);
    heistPlay("undo");
  }, [locked]);
  const submit = useCallback(
    (auto: boolean) => {
      if (locked) return;
      heistPlay("submit");
      onSubmit(movesRef.current, auto);
    },
    [locked, onSubmit],
  );

  // 제한 시간 직전 자동 제출(지금까지 녹화한 만큼, 나머지는 대기)
  const autoSentRef = useRef<number | null>(null);
  useEffect(() => {
    if (locked || deadlineMs === null || autoSentRef.current === state.stage) return;
    if (nowMs >= deadlineMs - 800) {
      autoSentRef.current = state.stage;
      submit(true);
    }
  }, [locked, deadlineMs, nowMs, state.stage, submit]);

  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range")) return;
      if (el && (el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      const map: Record<string, Act> = { arrowup: "N", w: "N", arrowdown: "S", s: "S", arrowleft: "W", a: "W", arrowright: "E", d: "E", " ": ".", ".": ".", e: "U", f: "U" };
      if (map[k]) {
        e.preventDefault();
        act(map[k]);
      } else if (k === "z" || k === "backspace") {
        e.preventDefault();
        undo();
      } else if (k === "enter") {
        e.preventDefault();
        submit(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, act, undo, submit]);

  const out = myNow && myNow.status !== "ok";
  const use = myNow ? actLabel(def, nowFrame, me) : null;
  const ghostMarks = ghostRun.events
    .filter((e) => e.kind === "lever" || e.kind === "emp" || e.kind === "paradox" || e.kind === "caught" || e.kind === "bank")
    .map((e) => ({ t: e.t, icon: e.kind === "lever" ? "🔧" : e.kind === "emp" ? "⚡" : e.kind === "bank" ? "💎" : e.kind === "caught" ? "🚨" : "⚠️" }));
  const remaining = deadlineMs !== null ? Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000)) : null;
  // 제한 10초 전부터 매 초 삑
  const warnedRef = useRef<number | null>(null);
  useEffect(() => {
    if (locked || remaining === null || remaining > 10 || remaining <= 0 || warnedRef.current === remaining) return;
    warnedRef.current = remaining;
    heistPlay("timeWarn");
  }, [locked, remaining]);
  const brokenGhosts = run.events.filter((e) => (e.kind === "paradox" || e.kind === "caught") && e.self !== me && e.t < t);
  const myGems = run.final.gems;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-violet-500/20 px-2.5 py-1 font-semibold text-violet-100 light:text-violet-800">
          ⏺ 녹화 {t}/{T}틱
        </span>
        <span className="rounded-full bg-cyan-500/15 px-2.5 py-1 text-cyan-100 light:text-cyan-800">💎 지금 계획대로면 {myGems}/{state.need}</span>
        {remaining !== null && !locked && <span className={`rounded-full px-2.5 py-1 ${remaining <= 15 ? "bg-rose-500/25 text-rose-100 light:text-rose-700" : "bg-white/10 text-white/60 light:bg-slate-100 light:text-slate-600"}`}>⏱ {remaining}초</span>}
        {preview !== null && <span className="rounded-full bg-yellow-400/20 px-2.5 py-1 text-yellow-100 light:text-yellow-800">👁 {preview}틱 미리보기</span>}
      </div>

      <Stage def={def} frame={frame} meta={meta} replay={false} board={board} zoom={zoom} onZoom={onZoom} focus={frame.selves[me] ? { x: frame.selves[me].x, y: frame.selves[me].y } : null} />
      <Timeline T={T} t={t} marks={ghostMarks} preview={preview} onPreview={setPreview} />

      {out && (
        <p className="rounded-lg bg-rose-500/15 px-3 py-2 text-xs text-rose-100 light:text-rose-700">
          {myNow.status === "caught" ? "🚨 경비 로봇에게 들켰어요!" : "⚠️ 시간 역설!"} 이 자아는 여기서 멈춰요 — ↶ 되돌리기로 돌아가 다른 길을 찾거나, 그대로 녹화 완료하세요.
        </p>
      )}
      {brokenGhosts.length > 0 && (
        <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-100 light:text-amber-800">
          ⚠️ 지금 내 행동 때문에 지난 루프의 유령 {brokenGhosts.length}명이 망가졌어요 ({brokenGhosts.map((e) => meta[e.self]?.label).join(", ")}). 되돌릴지 생각해 보세요.
        </p>
      )}

      {!locked ? (
        <div className="flex flex-col items-center gap-2">
          <div className="grid grid-cols-3 gap-1.5">
            <span />
            <HoldButton label="↑" aria="위로" onAct={() => act("N")} disabled={out || t >= T} />
            <span />
            <HoldButton label="←" aria="왼쪽으로" onAct={() => act("W")} disabled={out || t >= T} />
            <HoldButton label="·" aria="한 틱 대기" onAct={() => act(".")} disabled={out || t >= T} className="text-2xl" />
            <HoldButton label="→" aria="오른쪽으로" onAct={() => act("E")} disabled={out || t >= T} />
            <HoldButton label="↶" aria="되돌리기" onAct={undo} disabled={t === 0} className="text-base" />
            <HoldButton label="↓" aria="아래로" onAct={() => act("S")} disabled={out || t >= T} />
            <button
              type="button"
              onClick={() => act("U")}
              disabled={out || t >= T || !use}
              className="min-h-12 min-w-12 rounded-xl border border-amber-300/40 bg-amber-400/20 px-1 text-[11px] font-bold text-amber-100 disabled:opacity-30 light:text-amber-800"
            >
              {use ?? "사용"}
            </button>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                heistPlay("waitMany");
                for (let i = 0; i < 5; i++) act(".", true);
              }}
              disabled={out || t >= T}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 disabled:opacity-30 light:border-slate-300 light:text-slate-600"
            >
              ⏩ 5틱 대기
            </button>
            <button
              type="button"
              onClick={() => {
                const cur = movesRef.current;
                if (cur.length < T) {
                  heistPlay("waitMany");
                  movesRef.current = cur + ".".repeat(T - cur.length);
                  setMoves(movesRef.current);
                }
              }}
              disabled={out || t >= T}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 disabled:opacity-30 light:border-slate-300 light:text-slate-600"
            >
              ⏭ 끝까지 대기
            </button>
            <button type="button" onClick={() => submit(false)} className="rounded-full bg-violet-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-violet-500">
              ✅ 녹화 완료
            </button>
          </div>
          <p className="hidden text-[11px] text-white/35 sm:block light:text-slate-400">{KEY_HELP}</p>
        </div>
      ) : (
        <p className="rounded-lg bg-white/5 px-3 py-2 text-center text-xs text-white/60 light:bg-slate-100 light:text-slate-600">녹화를 냈어요. 동료들이 녹화를 마치면 모든 루프를 합쳐 재생해요.</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {state.pending.map((m, s) => (
          <span key={s} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/70 light:border-slate-200 light:text-slate-600" style={{ borderColor: SEAT_COLORS[s] }}>
            {SEAT_MARKS[s]} {s === viewerSeat ? "나" : names[s]} {m !== null ? "✅" : "⏺ 녹화 중"}
          </span>
        ))}
      </div>
    </div>
  );
}

function ReplayView({ state, viewerSeat, names, onReady, onGameEnd, def, T, board, tracks, zoom, onZoom }: ViewProps & { tracks: SelfTrack[] }) {
  const run = useMemo(() => simulate(def, tracks, state.need), [def, tracks, state.need]);
  const meta = useMemo(() => selfMeta(tracks, names, null), [tracks, names]);
  const [startAt, setStartAt] = useState(() => Date.now());
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 70);
    return () => window.clearInterval(id);
  }, []);
  const tick = Math.max(0, Math.min(T, Math.floor((clock - startAt) / REPLAY_TICK_MS)));
  const done = tick >= T;
  const frame = run.frames[tick];
  const summary = state.history[state.history.length - 1];
  const cleared = run.clearedAt !== null;
  const lines = run.events
    .filter((e) => e.t < tick || done)
    .map((e) => eventText(e, meta, def))
    .filter((s): s is string => !!s);
  const ended = state.phase === "ended";
  const outcome = state.outcome;
  const iReady = state.ready[viewerSeat];

  // 재생 소리: 틱마다 그 틱의 사건 + 누군가 움직였으면 발걸음 한 번. ⏭ 건너뛰기면 생략.
  const plates = useMemo(() => Object.keys(parseLevel(def).plates), [def]);
  const lastTickRef = useRef(0);
  useEffect(() => {
    const from = lastTickRef.current;
    lastTickRef.current = tick;
    if (tick <= from || tick - from > 2) return;
    for (let t = from; t < tick; t++) {
      const a = run.frames[t];
      const b = run.frames[t + 1];
      const moved = b.selves.some((s, i) => s.status === "ok" && (s.x !== a.selves[i].x || s.y !== a.selves[i].y));
      if (moved) heistPlay("ghostStep", t);
      for (const c of tickSfx(run.events, t, a, b, plates, (l) => lootKindAt(def, l) === "coin")) heistPlay(c);
    }
  }, [tick, run, plates, def]);
  // 재생이 끝나면 결과 소리 한 번 (다시 보기마다 다시)
  const finaleRef = useRef<number | null>(null);
  useEffect(() => {
    if (!done || finaleRef.current === startAt) return;
    finaleRef.current = startAt;
    if (ended && outcome) heistPlay(outcome.cleared ? "victory" : "fail");
    else if (!cleared) heistPlay("loopEnd");
  }, [done, startAt, ended, outcome, cleared]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-fuchsia-500/20 px-2.5 py-1 font-semibold text-fuchsia-100 light:text-fuchsia-800">
          ▶ {ended ? "마지막 루프" : `${state.loop}루프`} 재생 {tick}/{T}틱
        </span>
        <span className="rounded-full bg-cyan-500/15 px-2.5 py-1 text-cyan-100 light:text-cyan-800">
          💎 {frame.gems}/{state.need} · 🪙 {frame.coins}
        </span>
        {frame.emp > 0 && <span className="rounded-full bg-sky-500/20 px-2.5 py-1 text-sky-100 light:text-sky-800">⚡ EMP {frame.emp}</span>}
      </div>
      <Stage def={def} frame={frame} meta={meta} replay board={board} zoom={zoom} onZoom={onZoom} focus={null} />
      <Timeline T={T} t={tick} marks={run.events.filter((e) => e.kind === "bank" || e.kind === "paradox" || e.kind === "caught").map((e) => ({ t: e.t, icon: e.kind === "bank" ? "💎" : e.kind === "caught" ? "🚨" : "⚠️" }))} preview={null} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            heistPlay("rewind");
            lastTickRef.current = 0;
            setStartAt(Date.now());
          }}
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 light:border-slate-300 light:text-slate-600">
          🔁 처음부터 다시 보기
        </button>
        {!done && (
          <button
            type="button"
            onClick={() => {
              heistPlay("waitMany");
              setStartAt(Date.now() - T * REPLAY_TICK_MS);
            }}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 light:border-slate-300 light:text-slate-600">
            ⏭ 끝으로
          </button>
        )}
      </div>

      {lines.length > 0 && (
        <ul className="max-h-36 overflow-y-auto rounded-lg bg-black/20 p-2 text-[11px] leading-relaxed text-white/70 light:bg-slate-100 light:text-slate-600">
          {lines.map((l, i) => (
            <li key={i} className="break-keep">
              {l}
            </li>
          ))}
        </ul>
      )}

      {done && !ended && summary && (
        <div className={`flex flex-col gap-2 rounded-xl border p-3 text-sm ${cleared ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/15 bg-white/5 light:border-slate-200 light:bg-white"}`}>
          <p className="font-bold text-white light:text-slate-900">{cleared ? "🎉 작전 성공! 보석을 모두 실었어요" : state.loop >= state.maxLoops ? "⌛ 시간 루프가 닫혔어요…" : `🔁 아직 💎 ${summary.gems}/${state.need} — 다음 루프로!`}</p>
          {!cleared && state.loop < state.maxLoops && (
            <p className="break-keep text-xs text-white/60 light:text-slate-500">이번 루프의 자아들은 유령이 되어 다음 루프에도 똑같이 움직여요. 남은 루프 {state.maxLoops - state.loop}번.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                heistPlay("mateDone");
                onReady();
              }}
              disabled={iReady} className="rounded-full bg-violet-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50">
              {iReady ? "기다리는 중…" : cleared || state.loop >= state.maxLoops ? "🏁 결과 보기" : "▶ 다음 루프"}
            </button>
            {state.ready.map((r, s) => (
              <span key={s} className="text-[11px] text-white/50 light:text-slate-500">
                {SEAT_MARKS[s]} {s === viewerSeat ? "나" : names[s]} {r ? "✅" : "…"}
              </span>
            ))}
          </div>
        </div>
      )}

      {ended && outcome && (
        <div className={`flex flex-col gap-2 rounded-xl border p-4 ${outcome.cleared ? "border-amber-300/50 bg-amber-400/10" : "border-white/15 bg-white/5 light:border-slate-200 light:bg-white"}`}>
          <p className="text-lg font-bold text-white light:text-slate-900">{outcome.cleared ? "🏆 대성공!" : "🚓 작전 실패"}</p>
          <p className="text-2xl tracking-widest" aria-label={`별 ${outcome.stars}개`}>
            {"⭐".repeat(outcome.stars)}
            <span className="opacity-25">{"⭐".repeat(3 - outcome.stars)}</span>
          </p>
          <ul className="text-xs leading-relaxed text-white/70 light:text-slate-600">
            <li>{outcome.cleared ? "⭐ 작전 성공" : "☆ 작전 성공"}</li>
            <li>
              {outcome.cleared && outcome.loopsUsed <= state.par ? "⭐" : "☆"} 기준 {state.par}루프 이내 (사용 {outcome.loopsUsed}루프)
            </li>
            <li>
              {outcome.cleared && outcome.coinTotal > 0 && outcome.coins >= outcome.coinTotal ? "⭐" : "☆"} 동전 모두 입금 ({outcome.coins}/{outcome.coinTotal})
            </li>
          </ul>
          <button type="button" onClick={onGameEnd} className="self-end rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-slate-900">
            결과 저장하고 나가기
          </button>
        </div>
      )}
    </div>
  );
}
