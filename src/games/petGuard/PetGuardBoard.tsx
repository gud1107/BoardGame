"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import {
  computeRankings,
  DESIGN_MS,
  pendingSeats,
  ROUNDS,
  roundSeed,
  scenarioOf,
  senderOf,
  targetOf,
  type EngineAction,
  type PetState,
  type SeatIndex,
} from "./engine";
import { canBuild, H, HIT_LABEL, layoutCost, PIECES, recordSim, twistedEmitters, TWISTS, W, type Frame, type Piece, type Scenario } from "./sim";
import { designFrame, drawFrame, PET_EMOJI, type DrawOpts } from "./render";
import { eventCues, getPetGuardSound, petSoundCues } from "./petGuardSound";

interface Props {
  state: PetState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  isHost: boolean;
  onAction: (a: EngineAction) => void;
  onGameEnd: () => void;
  onRulebook: () => void;
}

const MATS = PIECES.map((p) => p.mat);
const PREVIEWS = 3;
const TPS = 15;
const TIER_LABEL = ["", "⭐ 쉬움", "⭐⭐ 보통", "⭐⭐⭐ 어려움"];

export default function PetGuardBoard({ state, viewerSeat, names, connectedSeats, isHost, onAction, onGameEnd, onRulebook }: Props) {
  const sound = getPetGuardSound;
  useSoundCues(state, sound, petSoundCues);
  const sc = scenarioOf(state);
  useSuiteBgm(sound, state.phase !== "gameOver", state.phase === "result" || sc.tier === 3 ? 1 : 0);
  const nameOf = (s: SeatIndex) => names[s] ?? `${s + 1}번`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-white light:text-slate-900">
          <span className="rounded-full bg-white/10 light:bg-slate-200 px-2.5 py-1 text-xs">
            라운드 {Math.min(state.round + 1, ROUNDS)}/{ROUNDS}
          </span>
          <span>
            {sc.emoji} {sc.name}
          </span>
          <span className="text-xs text-amber-300 light:text-amber-600">{TIER_LABEL[sc.tier]}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <SuiteSoundHud suite={sound} icon="🐶" label="Rescue Patrol" preview="survive" />
          <button onClick={onRulebook} className="rounded-full border border-white/15 light:border-slate-300 px-3 py-1 text-xs text-white/70 light:text-slate-600">
            📖 룰북
          </button>
        </div>
      </div>
      <ScoreStrip state={state} nameOf={nameOf} viewerSeat={viewerSeat} connectedSeats={connectedSeats} />
      {state.phase === "design" && <DesignPanel key={`d${state.seed}-${state.round}`} state={state} sc={sc} viewerSeat={viewerSeat} nameOf={nameOf} isHost={isHost} onAction={onAction} />}
      {state.phase === "result" && <ReplayPanel key={`r${state.seed}-${state.round}`} state={state} viewerSeat={viewerSeat} nameOf={nameOf} isHost={isHost} onAction={onAction} />}
      {state.phase === "gameOver" && <FinalPanel state={state} nameOf={nameOf} viewerSeat={viewerSeat} onGameEnd={onGameEnd} />}
    </div>
  );
}

function ScoreStrip({ state, nameOf, viewerSeat, connectedSeats }: { state: PetState; nameOf: (s: number) => string; viewerSeat: number; connectedSeats: Set<number> }) {
  const pending = new Set(pendingSeats(state));
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {state.scores.map((score, seat) => (
        <div
          key={seat}
          className={`flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-xs ${seat === viewerSeat ? "border-amber-400/60 bg-amber-400/10 light:bg-amber-50" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"}`}
        >
          <span className="text-lg">{PET_EMOJI[seat % PET_EMOJI.length]}</span>
          <span className="min-w-0 flex-1 truncate text-white/80 light:text-slate-700">
            {nameOf(seat)}
            {!connectedSeats.has(seat) && <span className="ml-1 text-rose-300">⚠️</span>}
          </span>
          <span className="font-bold text-white light:text-slate-900">{score}</span>
          {state.phase === "design" && <span title={pending.has(seat) ? "설계 중" : "제출 완료"}>{pending.has(seat) ? "⏳" : "✅"}</span>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

function useBoardWidth(max: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(max);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.min(max, el.clientWidth)));
    ro.observe(el);
    setW(Math.min(max, el.clientWidth));
    return () => ro.disconnect();
  }, [max]);
  return { ref, cell: Math.max(10, Math.floor(w / W)) };
}

function BoardCanvas({
  sc,
  frame,
  cell,
  opts,
  onCell,
  onHover,
}: {
  sc: Scenario;
  frame: Frame;
  cell: number;
  opts: Omit<DrawOpts, "cell" | "time">;
  onCell?: (x: number, y: number) => void;
  onHover?: (c: { x: number; y: number } | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const latest = useRef({ sc, frame, cell, opts });
  useEffect(() => {
    latest.current = { sc, frame, cell, opts };
  });
  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      const cv = ref.current;
      if (cv) {
        const { sc: s, frame: f, cell: c, opts: o } = latest.current;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const wpx = W * c;
        const hpx = H * c;
        if (cv.width !== Math.round(wpx * dpr)) {
          cv.width = Math.round(wpx * dpr);
          cv.height = Math.round(hpx * dpr);
        }
        const ctx = cv.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawFrame(ctx, s, f, { ...o, cell: c, time: t });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * W);
    const y = Math.floor(((e.clientY - r.top) / r.height) * H);
    return x >= 0 && x < W && y >= 0 && y < H ? { x, y } : null;
  };
  return (
    <canvas
      ref={ref}
      style={{ width: W * cell, height: H * cell, touchAction: "manipulation" }}
      className="rounded-xl shadow-lg ring-1 ring-black/30"
      onPointerUp={(e) => {
        const c = cellAt(e);
        if (c && onCell) onCell(c.x, c.y);
      }}
      onPointerMove={(e) => onHover?.(e.pointerType === "mouse" ? cellAt(e) : null)}
      onPointerLeave={() => onHover?.(null)}
    />
  );
}

/** Derived FX for frame index `fi` (warnings live 10 ticks, bolts 3, booms 4). */
function fxAt(frames: Frame[], fi: number) {
  const warnCols: number[] = [];
  const bolts: { x: number; y: number; rod: boolean }[] = [];
  const booms: { x: number; y: number; age: number }[] = [];
  for (let k = Math.max(0, fi - 10); k <= fi; k++) {
    for (const e of frames[k]?.events ?? []) {
      if (e.k === "warn") warnCols.push(e.x);
      if (e.k === "bolt" && fi - k <= 2) bolts.push({ x: e.x, y: e.y, rod: e.rod });
      if (e.k === "boom" && fi - k <= 3) booms.push({ x: e.x, y: e.y, age: fi - k });
    }
  }
  // a warning ends when its bolt lands
  const struck = new Set(bolts.map((b) => b.x));
  return { warnCols: warnCols.filter((x) => !struck.has(x)), bolts, booms };
}

// ---------------------------------------------------------------------------
// Design phase
// ---------------------------------------------------------------------------

function DesignPanel({ state, sc, viewerSeat, nameOf, isHost, onAction }: { state: PetState; sc: Scenario; viewerSeat: number; nameOf: (s: number) => string; isHost: boolean; onAction: (a: EngineAction) => void }) {
  const sound = getPetGuardSound;
  const seated = viewerSeat >= 0 && viewerSeat < state.playerCount;
  const submitted = seated && !!state.subs[viewerSeat];
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [tool, setTool] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const hand = seated ? state.hands[viewerSeat] : [];
  const [twist, setTwist] = useState<number>(hand[0] ?? 0);
  const [previewsLeft, setPreviewsLeft] = useState(PREVIEWS);
  const [preview, setPreview] = useState<{ frames: Frame[]; at: number } | null>(null);
  const [startAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const { ref, cell } = useBoardWidth(432);
  const spent = layoutCost(pieces);
  const left = sc.budget - spent;
  const remainMs = Math.max(0, DESIGN_MS - (now - startAt));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  // keep the latest layout for the auto-submit
  const draft = useRef({ pieces, twist });
  useEffect(() => {
    draft.current = { pieces, twist };
  }, [pieces, twist]);
  const sentRef = useRef(false);
  const submit = () => {
    if (!seated || submitted || sentRef.current) return;
    sentRef.current = true;
    onAction({ type: "submit", seat: viewerSeat, round: state.round, pieces: draft.current.pieces, twist: draft.current.twist });
  };
  // time's up → my current layout goes in as is
  useEffect(() => {
    if (remainMs <= 0) submit();
    if (remainMs > 0 && remainMs <= 10_000 && Math.floor(remainMs / 1000) !== Math.floor((remainMs + 250) / 1000) && !submitted) sound().play("tick");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainMs]);
  // host fallback for seats that never answer (disconnected, closed tab)
  const forcedRef = useRef(false);
  useEffect(() => {
    if (!isHost || forcedRef.current) return;
    if (now - startAt > DESIGN_MS + 6000 && pendingSeats(state).length > 0) {
      forcedRef.current = true;
      onAction({ type: "force", round: state.round });
    }
  }, [now, startAt, isHost, state, onAction]);

  // preview playback
  useEffect(() => {
    if (!preview) return;
    if (preview.at >= preview.frames.length - 1) return;
    const id = window.setTimeout(() => {
      const next = preview.at + 2;
      for (const c of eventCues(preview.frames[Math.min(next, preview.frames.length - 1)].events)) sound().play(c);
      setPreview({ ...preview, at: Math.min(next, preview.frames.length - 1) });
    }, 1000 / TPS);
    return () => window.clearTimeout(id);
  }, [preview, sound]);

  const emitters = useMemo(() => twistedEmitters(sc, -1), [sc]);
  const staticFrame = useMemo(() => designFrame(sc, pieces, MATS), [sc, pieces]);

  function onCell(x: number, y: number) {
    if (submitted || !seated) return;
    if (preview) setPreview(null);
    const at = pieces.findIndex((p) => p.x === x && p.y === y);
    if (at >= 0) {
      const old = pieces[at];
      if (old.k === tool) {
        setPieces(pieces.filter((_, i) => i !== at));
        sound().play("remove");
      } else if (PIECES[tool].cost - PIECES[old.k].cost <= left) {
        setPieces(pieces.map((p, i) => (i === at ? { ...p, k: tool } : p)));
        sound().play("place");
      } else sound().play("invalid");
      return;
    }
    if (!canBuild(sc, x, y) || PIECES[tool].cost > left) {
      sound().play("invalid");
      return;
    }
    setPieces([...pieces, { x, y, k: tool }]);
    sound().play("place");
  }

  function runPreview() {
    if (previewsLeft <= 0) return;
    setPreviewsLeft(previewsLeft - 1);
    setPreview({ frames: recordSim(sc, pieces, -1, roundSeed(state)), at: 0 });
    sound().play("ui");
  }

  const pf = preview ? preview.frames[preview.at] : null;
  const pDone = preview && preview.at >= preview.frames.length - 1;
  const pending = pendingSeats(state);
  const target = seated ? targetOf(state, viewerSeat) : 0;
  const hoverOk = hover ? canBuild(sc, hover.x, hover.y) && (pieces.some((p) => p.x === hover.x && p.y === hover.y) || PIECES[tool].cost <= left) : false;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-white/10 bg-white/[0.04] light:border-slate-200 light:bg-white p-3 text-xs">
        <p className="text-white/85 light:text-slate-700">{sc.desc}</p>
        <p className="mt-1 text-sky-200 light:text-sky-700">💡 {sc.hint}</p>
        <p className="mt-1 text-white/50 light:text-slate-500">
          ⏱ {sc.ticks}틱 버티기 · 펫 바로 옆 8칸(빨간 칸)과 맨 윗줄엔 못 지어요 · 위험이 나오는 곳은 아이콘으로 표시돼요
        </p>
      </div>

      <div className="flex flex-col items-center gap-2 lg:flex-row lg:items-start">
        <div ref={ref} className="flex w-full max-w-[432px] flex-col items-center gap-1.5">
          <div className="flex w-full items-center justify-between text-xs">
            <span className={`font-bold ${left === 0 ? "text-amber-300" : "text-white light:text-slate-900"}`}>
              🪙 {left}/{sc.budget} 남음
            </span>
            <span className={`tabular-nums ${remainMs < 10_000 ? "text-rose-300 light:text-rose-600" : "text-white/60 light:text-slate-500"}`}>⏳ {Math.ceil(remainMs / 1000)}초</span>
          </div>
          <BoardCanvas
            sc={sc}
            frame={pf ?? staticFrame}
            cell={cell}
            opts={{
              petEmoji: PET_EMOJI[Math.max(0, viewerSeat) % PET_EMOJI.length],
              design: !pf,
              emitters,
              hover: hover && !pf ? { ...hover, ok: hoverOk } : null,
              ...(pf && preview ? fxAt(preview.frames, preview.at) : {}),
            }}
            onCell={onCell}
            onHover={setHover}
          />
          {preview && (
            <div className="flex w-full items-center justify-between rounded-lg bg-black/30 light:bg-slate-100 px-2 py-1 text-xs text-white light:text-slate-800">
              <span>
                🔍 시험 가동 {pf?.tick ?? 0}/{preview.frames[preview.frames.length - 1].tick}틱 ·{" "}
                {pDone ? (pf?.hit ? <b className="text-rose-300 light:text-rose-600">{HIT_LABEL[pf.hit.cause]} ({pf.hit.tick}틱)</b> : <b className="text-emerald-300 light:text-emerald-600">무사히 버텼어요!</b>) : "재생 중…"}
              </span>
              <button onClick={() => setPreview(null)} className="rounded bg-white/15 light:bg-white px-2 py-0.5">
                설계로 ↩
              </button>
            </div>
          )}
        </div>

        <div className="flex w-full max-w-[432px] flex-col gap-2 lg:max-w-xs">
          <div className="grid grid-cols-4 gap-1.5">
            {PIECES.map((p, k) => (
              <button
                key={k}
                disabled={submitted}
                onClick={() => {
                  setTool(k);
                  sound().play("ui");
                }}
                className={`flex flex-col items-center rounded-xl border px-1 py-1.5 text-[11px] transition ${tool === k ? "border-amber-400 bg-amber-400/20 light:bg-amber-100" : "border-white/10 bg-white/[0.04] light:border-slate-200 light:bg-white"} ${p.cost > left ? "opacity-50" : ""}`}
              >
                <span className="text-xl leading-none">{p.emoji}</span>
                <span className="mt-0.5 truncate text-white/80 light:text-slate-700">{p.name}</span>
                <span className="font-bold text-amber-300 light:text-amber-600">🪙{p.cost}</span>
              </button>
            ))}
          </div>
          <p className="min-h-[2.5em] text-[11px] text-white/60 light:text-slate-500">
            {PIECES[tool].emoji} {PIECES[tool].desc} 같은 기물을 다시 누르면 치워요.
          </p>
          {seated && (
            <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 light:bg-fuchsia-50 p-2">
              <p className="mb-1.5 text-xs font-semibold text-fuchsia-200 light:text-fuchsia-700">
                🎴 {nameOf(target)} {PET_EMOJI[target % PET_EMOJI.length]}에게 보낼 변수 (시작할 때 공개)
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {hand.map((id) => {
                  const t = TWISTS[id];
                  return (
                    <button
                      key={id}
                      disabled={submitted}
                      onClick={() => setTwist(id)}
                      className={`rounded-lg border p-1.5 text-left text-[10px] leading-tight ${twist === id ? "border-fuchsia-300 bg-fuchsia-400/25 light:bg-fuchsia-100" : "border-white/10 light:border-slate-200"}`}
                    >
                      <span className="block text-sm font-bold text-white light:text-slate-900">
                        {t.emoji} {t.name}
                      </span>
                      <span className="text-white/65 light:text-slate-600">{t.desc}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] text-white/45 light:text-slate-500">나도 {nameOf(senderOf(state, viewerSeat))}에게서 변수 하나를 받아요 — 무엇일지는 모릅니다.</p>
            </div>
          )}
          <div className="flex gap-1.5">
            <button
              disabled={submitted || previewsLeft <= 0 || !seated}
              onClick={runPreview}
              className="flex-1 rounded-xl border border-sky-400/40 bg-sky-500/15 py-2.5 text-xs font-semibold text-sky-100 light:text-sky-700 disabled:opacity-40"
            >
              🔍 시험 가동 ({previewsLeft}/{PREVIEWS})
            </button>
            <button
              disabled={submitted || !seated}
              onClick={() => {
                if (preview) setPreview(null);
                submit();
              }}
              className="flex-1 rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-black hover:bg-amber-300 disabled:opacity-50"
            >
              {submitted ? "✅ 제출 완료" : `✅ 제출 (🪙${spent})`}
            </button>
          </div>
          <p className="text-[11px] text-white/45 light:text-slate-500">시험 가동은 변수 없이 돌려요. 실제로는 받은 변수가 더해져요.</p>
          {submitted && pending.length > 0 && <p className="text-xs text-white/60 light:text-slate-500">⏳ 기다리는 중: {pending.map(nameOf).join(", ")}</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Replay + results
// ---------------------------------------------------------------------------

const NEXT_DELAY_MS = 9000;

function ReplayPanel({ state, viewerSeat, nameOf, isHost, onAction }: { state: PetState; viewerSeat: number; nameOf: (s: number) => string; isHost: boolean; onAction: (a: EngineAction) => void }) {
  const sound = getPetGuardSound;
  const rec = state.history[state.round];
  const sc = scenarioOf(state);
  const allFrames = useMemo(() => rec.subs.map((sub, seat) => recordSim(sc, sub.pieces, rec.results[seat].twistIn, rec.seed)), [rec, sc]);
  const maxLen = Math.max(...allFrames.map((f) => f.length));
  const [fi, setFi] = useState(0);
  const [speed, setSpeed] = useState(1);
  const done = fi >= maxLen - 1;
  const me = viewerSeat >= 0 && viewerSeat < state.playerCount ? viewerSeat : 0;
  const { ref, cell } = useBoardWidth(432);
  const small = Math.max(8, Math.floor(Math.min(cell * 0.55, 200 / W)));
  const [doneAt, setDoneAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const finish = () => {
    setFi(maxLen - 1);
    setDoneAt((d) => {
      if (d === null && rec.results[me]?.survived) sound().play("survive");
      return d ?? Date.now();
    });
  };

  useEffect(() => {
    if (done) return;
    const id = window.setTimeout(() => {
      const next = Math.min(maxLen - 1, fi + speed);
      const mine = allFrames[me];
      for (let k = fi + 1; k <= next; k++) if (k < mine.length) for (const c of eventCues(mine[k].events)) sound().play(c);
      if (next >= maxLen - 1) finish();
      else setFi(next);
    }, 1000 / TPS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fi, done, speed, maxLen, allFrames, me, sound]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  // host advances on its own after everyone has had time to read the table
  const sentRef = useRef(false);
  useEffect(() => {
    if (!isHost || sentRef.current || doneAt === null) return;
    if (now - doneAt >= NEXT_DELAY_MS) {
      sentRef.current = true;
      onAction({ type: "next", round: state.round });
    }
  }, [isHost, now, doneAt, onAction, state.round]);

  const frameOf = (seat: number) => {
    const fr = allFrames[seat];
    return fr[Math.min(fi, fr.length - 1)];
  };
  const myRes = rec.results[me];
  const myTwist = myRes.twistIn >= 0 ? TWISTS[myRes.twistIn] : null;
  const order = [me, ...rec.results.map((r) => r.seat).filter((s) => s !== me)];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-2 lg:flex-row lg:items-start">
        <div ref={ref} className="flex w-full max-w-[432px] flex-col items-center gap-1.5">
          <div className="flex w-full items-center justify-between text-xs text-white light:text-slate-800">
            <span>
              {PET_EMOJI[me % PET_EMOJI.length]} <b>{nameOf(me)}</b>의 방어선 · 받은 변수{" "}
              {myTwist && (
                <b className="text-fuchsia-300 light:text-fuchsia-700">
                  {myTwist.emoji} {myTwist.name}
                </b>
              )}{" "}
              <span className="text-white/50 light:text-slate-500">(보낸 사람 {nameOf(senderOf(state, me))})</span>
            </span>
            <span className="tabular-nums">
              {frameOf(me).tick}/{myRes.ticks}틱
            </span>
          </div>
          <BoardCanvas sc={sc} frame={frameOf(me)} cell={cell} opts={{ petEmoji: PET_EMOJI[me % PET_EMOJI.length], ...fxAt(allFrames[me], Math.min(fi, allFrames[me].length - 1)) }} />
          <div className="flex w-full gap-1.5">
            {[1, 2, 4].map((sp) => (
              <button key={sp} onClick={() => setSpeed(sp)} className={`flex-1 rounded-lg border py-1 text-xs ${speed === sp ? "border-amber-400 bg-amber-400/20" : "border-white/10 light:border-slate-200"} text-white light:text-slate-800`}>
                ▶ {sp}배
              </button>
            ))}
            <button onClick={finish} className="flex-1 rounded-lg border border-white/10 light:border-slate-200 py-1 text-xs text-white light:text-slate-800">
              ⏭ 결과
            </button>
          </div>
        </div>
        <div className="grid w-full max-w-[432px] grid-cols-2 gap-2 lg:max-w-sm">
          {order.slice(1).map((seat) => (
            <div key={seat} className="flex flex-col items-center gap-0.5 text-[11px] text-white/80 light:text-slate-700">
              <span className="truncate">
                {PET_EMOJI[seat % PET_EMOJI.length]} {nameOf(seat)} · {TWISTS[rec.results[seat].twistIn]?.emoji}
              </span>
              <BoardCanvas sc={sc} frame={frameOf(seat)} cell={small} opts={{ petEmoji: PET_EMOJI[seat % PET_EMOJI.length], ...fxAt(allFrames[seat], Math.min(fi, allFrames[seat].length - 1)) }} />
            </div>
          ))}
        </div>
      </div>

      {done && (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] light:border-slate-200 light:bg-white p-3">
          <table className="w-full text-xs text-white/85 light:text-slate-700">
            <thead>
              <tr className="text-white/50 light:text-slate-500">
                <th className="text-left font-normal">플레이어</th>
                <th className="text-left font-normal">받은 변수</th>
                <th className="text-left font-normal">결과</th>
                <th className="text-right font-normal">🪙</th>
                <th className="text-right font-normal">점수</th>
              </tr>
            </thead>
            <tbody>
              {[...rec.results]
                .sort((a, b) => b.score - a.score || a.seat - b.seat)
                .map((r) => (
                  <tr key={r.seat} className={r.seat === me ? "font-semibold text-amber-200 light:text-amber-700" : ""}>
                    <td className="py-0.5">
                      {PET_EMOJI[r.seat % PET_EMOJI.length]} {nameOf(r.seat)}
                    </td>
                    <td>{TWISTS[r.twistIn] ? `${TWISTS[r.twistIn].emoji} ${TWISTS[r.twistIn].name}` : "-"}</td>
                    <td>{r.survived ? "🛡️ 무사!" : `${HIT_LABEL[r.cause!]} (${r.hitTick}틱)`}</td>
                    <td className="text-right">{r.spent}</td>
                    <td className="text-right">+{r.score}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-white/50 light:text-slate-500">무사하면 10점 + 남긴 🪙 · 다치면 버틴 시간만큼 0~6점</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-white/60 light:text-slate-500">
              {state.round + 1 >= ROUNDS ? "최종 결과로" : "다음 라운드로"} {doneAt ? Math.max(0, Math.ceil((NEXT_DELAY_MS - (now - doneAt)) / 1000)) : ""}초 뒤 넘어가요
            </span>
            {isHost && (
              <button
                onClick={() => {
                  if (sentRef.current) return;
                  sentRef.current = true;
                  onAction({ type: "next", round: state.round });
                }}
                className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold text-black hover:bg-amber-300"
              >
                {state.round + 1 >= ROUNDS ? "🏆 최종 결과" : "다음 라운드 ▶"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FinalPanel({ state, nameOf, viewerSeat, onGameEnd }: { state: PetState; nameOf: (s: number) => string; viewerSeat: number; onGameEnd: () => void }) {
  const ranks = computeRankings(state);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 light:bg-amber-50 p-4">
      <h3 className="text-center text-lg font-bold text-white light:text-slate-900">🏆 최종 결과</h3>
      <div className="flex flex-col gap-1.5">
        {ranks.map((r) => {
          const survived = state.history.filter((h) => h.results[r.seat]?.survived).length;
          return (
            <div key={r.seat} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${r.seat === viewerSeat ? "bg-amber-400/25" : "bg-black/20 light:bg-white"}`}>
              <span className="w-6 font-bold text-white light:text-slate-900">{r.rank}</span>
              <span className="text-xl">{PET_EMOJI[r.seat % PET_EMOJI.length]}</span>
              <span className="flex-1 truncate text-white light:text-slate-800">{nameOf(r.seat)}</span>
              <span className="text-xs text-white/60 light:text-slate-500">
                🛡️ {survived}/{ROUNDS}
              </span>
              <span className="w-10 text-right font-bold text-white light:text-slate-900">{r.total}</span>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-6 gap-1 text-center text-[11px] text-white/70 light:text-slate-600">
        {state.history.map((h, i) => {
          const s = state.history[i] && scenarioOf(state, i);
          const mine = h.results[viewerSeat];
          return (
            <div key={i} className="rounded-lg bg-black/20 light:bg-white p-1">
              <div className="text-base">{s?.emoji}</div>
              <div className="truncate">{s?.name}</div>
              {mine && <div>{mine.survived ? "🛡️" : "💥"} +{mine.score}</div>}
            </div>
          );
        })}
      </div>
      <button onClick={onGameEnd} className="rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-black hover:bg-amber-300">
        결과 확인
      </button>
    </div>
  );
}
