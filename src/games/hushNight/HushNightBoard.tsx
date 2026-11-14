"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { Loading3D, preferLowDetail, useBoardView, ViewToggle } from "@/games/shared/three/viewPref";
import {
  computeRankings,
  EXIT,
  H,
  HEAR_PER_LEVEL,
  legalTargets,
  NOISE,
  phaseMs,
  previewMonster,
  rageFrom,
  startOf,
  W,
  WAKE_ROUND,
  type Cell,
  type Move,
  type MoveKind,
  type NightState,
  type RoundReport,
  type Seat,
} from "./engine";
import { getHushNightSound, hushIntensity, hushNightCues } from "./hushNightSound";
import RulebookModal from "./RulebookModal";

const HouseScene = dynamic(() => import("./three/HouseScene"), { ssr: false, loading: () => <Loading3D label="🕯️ 불 꺼진 집에 들어가는 중…" /> });

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
export const SEAT_COLORS = ["#f87171", "#60a5fa", "#a3e635", "#fbbf24"];
export const SEAT_MARKS = ["●", "◆", "▲", "■"];

const MODES: { kind: MoveKind; icon: string; label: string; sub: string; color: string }[] = [
  { kind: "hush", icon: "🤫", label: "숨죽이기", sub: "제자리 · 소리 0", color: "#94a3b8" },
  { kind: "walk", icon: "🚶", label: "걷기", sub: `1칸 · 소리 ${NOISE.walk}`, color: "#38bdf8" },
  { kind: "run", icon: "🏃", label: "달리기", sub: `2칸 · 소리 ${NOISE.run}`, color: "#f59e0b" },
  { kind: "throw", icon: "🪨", label: "돌 던지기", sub: `4칸 안 · 그곳에 소리 ${NOISE.throw}`, color: "#e5e7eb" },
];

function SeatChip({ seat }: { seat: Seat }) {
  return (
    <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white" style={{ background: SEAT_COLORS[seat % 4], textShadow: "0 1px 1px rgba(0,0,0,.6)" }}>
      {SEAT_MARKS[seat % 4]}
    </span>
  );
}

/** Plain-language lines for what happened last round. */
export function reportLines(r: RoundReport, name: (s: Seat) => string): string[] {
  const out: string[] = [];
  const t = r.target;
  if (r.round < WAKE_ROUND) out.push("😴 괴물은 아직 잠들어 있어요 — 다음 밤부터 소리를 들어요");
  else if (!t) out.push(r.monsterPath.length ? "👂 괴물은 아무것도 못 듣고 서성였어요" : "👂 괴물은 조용한 밤을 지켰어요");
  else {
    const what = t.why === "throw" ? `${name(t.seat)}이(가) 던진 돌 소리` : t.why === "run" ? `${name(t.seat)}의 뛰는 소리` : t.why === "key" ? `${name(t.seat)}의 열쇠 소리` : t.why === "door" ? `지하실 문 소리` : `${name(t.seat)}의 발소리`;
    out.push(r.monsterPath.length ? `👂 괴물이 ${what}를 듣고 ${r.monsterPath.length}칸 다가갔어요` : `👂 괴물이 서 있던 바로 그 자리에서 ${what}가 났어요`);
  }
  for (const b of r.bankedNow) out.push(`🕳️ ${name(b.seat)} — 열쇠 ${b.keys}개를 지하실로!`);
  for (const s of r.caught) out.push(`😱 ${name(s)} 잡힘 — 들고 있던 열쇠를 떨어뜨리고 처음 자리로`);
  return out;
}

function Grid2D({ s, targets, targetColor, selected, preview, onTap }: { s: NightState; targets: Cell[]; targetColor: string; selected: Cell | null; preview: Cell[]; onTap: ((c: Cell) => void) | null }) {
  const bs = new Set(s.blocked);
  const ts = new Set(targets);
  const ps = new Set(preview);
  return (
    <div className="grid h-full w-full gap-[2px] bg-black p-2" style={{ gridTemplateColumns: `repeat(${W}, 1fr)`, gridTemplateRows: `repeat(${H}, 1fr)` }}>
      {Array.from({ length: W * H }, (_, c) => {
        const pawns = s.seats.map((x, seat) => ({ ...x, seat })).filter((x) => x.at === c);
        const tap = onTap && ts.has(c) ? () => onTap(c) : undefined;
        return (
          <button
            key={c}
            type="button"
            onClick={tap}
            disabled={!tap}
            aria-label={`칸 ${c % W + 1},${Math.floor(c / W) + 1}`}
            className="relative flex items-center justify-center rounded-sm text-base disabled:cursor-default sm:text-xl"
            style={{ background: bs.has(c) ? "#57534e" : c === EXIT ? "#3b2a1a" : (c % W) + Math.floor(c / W) % 2 ? "#1c1410" : "#231a13", outline: ts.has(c) ? `2px solid ${targetColor}` : undefined, outlineOffset: -2, boxShadow: c === selected ? `inset 0 0 0 999px ${targetColor}55` : undefined }}
          >
            {bs.has(c) && "🛋️"}
            {c === EXIT && "🕳️"}
            {s.keys.includes(c) && "🗝️"}
            {ps.has(c) && <span className="absolute inset-1 rounded-full border-2 border-rose-500/80" />}
            {s.monster === c && <span className="absolute text-2xl sm:text-3xl">👹</span>}
            {pawns.map((p, i) => (
              <span key={p.seat} className="absolute flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black text-white sm:h-5 sm:w-5" style={{ background: SEAT_COLORS[p.seat], left: 2 + i * 8, bottom: 2 }}>
                {SEAT_MARKS[p.seat]}
              </span>
            ))}
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  state: NightState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  botSeats: Set<Seat>;
  phaseStart: number;
  nowMs: number;
  /** What I committed this round (kept by the room for the reveal), if anything. */
  myCommitted: Move | null;
  onCommit: (m: Move) => void;
  onGameEnd: () => void;
}

export default function HushNightBoard({ state, viewerSeat, names, connectedSeats, botSeats, phaseStart, nowMs, myCommitted, onCommit, onGameEnd }: Props) {
  const board = useBoardView("hush-night-view");
  const [lowDetail] = useState(preferLowDetail);
  const [rules, setRules] = useState(false);
  const [modeRaw, setMode] = useState<{ step: number; kind: MoveKind } | null>(null);
  const [selRaw, setSel] = useState<{ step: number; cell: Cell } | null>(null);
  const mode = modeRaw && modeRaw.step === state.step ? modeRaw.kind : null;
  const sel = selRaw && selRaw.step === state.step ? selRaw.cell : null;
  const name = useCallback((s: Seat) => (s === viewerSeat ? "나" : (names[s] ?? `${s + 1}번`)), [names, viewerSeat]);

  const playing = viewerSeat >= 0 && viewerSeat < state.playerCount;
  const me = playing ? state.seats[viewerSeat] : null;
  useSuiteBgm(getHushNightSound, state.phase !== "ended", playing ? hushIntensity(state, viewerSeat) : 0);
  const classify = useMemo(() => hushNightCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getHushNightSound, classify);

  const canChoose = playing && state.phase === "choose" && state.commits[viewerSeat] === null && !myCommitted;
  const targets = useMemo(() => (canChoose && mode && mode !== "hush" ? legalTargets(state, viewerSeat, mode) : []), [canChoose, mode, state, viewerSeat]);
  const draft = useMemo<Move | null>(() => (mode === "hush" ? { kind: "hush" } : mode && sel !== null ? ({ kind: mode, to: sel } as Move) : null), [mode, sel]);
  const preview = useMemo(() => (canChoose && draft && state.options.helper ? previewMonster(state, viewerSeat, draft) : null), [canChoose, draft, state, viewerSeat]);
  const modeColor = MODES.find((m) => m.kind === mode)?.color ?? "#38bdf8";

  const commit = useCallback(() => {
    if (!canChoose || !draft) return;
    getHushNightSound().play("commit");
    onCommit(draft);
  }, [canChoose, draft, onCommit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || !canChoose) return;
      const k = { "1": "hush", "2": "walk", "3": "run", "4": "throw" }[e.key] as MoveKind | undefined;
      if (k) setMode({ step: state.step, kind: k });
      else if (e.key === "Enter") commit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canChoose, commit, state.step]);

  const left = state.phase === "ended" ? null : Math.max(0, Math.ceil((phaseStart + phaseMs(state) - nowMs) / 1000));
  useEffect(() => {
    if (left !== null && left > 0 && left <= 5 && canChoose) getHushNightSound().play("tick");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const ended = state.phase === "ended";
  const rankings = computeRankings(state);
  const rage = state.round >= rageFrom(state.options.rounds);
  const dread = Math.min(1, state.round / state.options.rounds);
  const lines = state.last ? reportLines(state.last, name) : [];
  const tap = canChoose && mode && mode !== "hush" ? (c: Cell) => setSel({ step: state.step, cell: c }) : null;
  const pawns = state.seats.map((x, seat) => ({ seat, name: names[seat] ?? `${seat + 1}번`, color: SEAT_COLORS[seat], at: x.at, carry: x.carry, away: !connectedSeats.has(seat) && !botSeats.has(seat) }));
  const hint = state.phase === "choose" ? (canChoose ? (mode ? (mode === "hush" ? "숨을 죽이고 기다려요 — 확정을 누르세요" : sel === null ? "빛나는 칸을 눌러 고르세요" : "확정을 누르면 잠겨요") : "이번 밤에 할 일을 고르세요") : "다른 사람을 기다리는 중…") : state.phase === "reveal" ? "모두의 선택을 펼치는 중…" : state.phase === "resolved" ? (lines[0] ?? "") : "새벽이 밝았어요";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-indigo-950/80 px-2.5 py-1 text-xs font-black text-indigo-100 light:bg-indigo-100 light:text-indigo-800">🤫 숨죽인 밤</span>
        <span className="text-xs text-white/60 light:text-slate-500">
          {state.round} / {state.options.rounds}번째 밤{rage && <b className="ml-1 text-rose-300 light:text-rose-600">😡 괴물이 빨라졌어요</b>}
          {left !== null && state.phase === "choose" && <b className={`ml-1 tabular-nums ${left <= 5 ? "text-rose-300 light:text-rose-600" : ""}`}>⏱ {left}초</b>}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <SuiteSoundHud suite={getHushNightSound} icon="🤫" label="Held Breath" preview="key" />
          <ViewToggle board={board} />
          <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </div>
      </div>

      <div className="relative z-10 h-[360px] w-full overflow-hidden rounded-2xl border border-black/50 bg-black sm:h-[480px]">
        {board.view === "3d" ? (
          <HouseScene
            viewerSeat={viewerSeat}
            viewerCorner={startOf(playing ? viewerSeat : 0)}
            blocked={state.blocked}
            keys={state.keys}
            pawns={pawns}
            monster={state.monster}
            last={state.last}
            targets={targets}
            targetColor={modeColor}
            selected={sel}
            preview={preview?.path ?? []}
            dread={dread}
            lowDetail={lowDetail}
            onTap={tap}
          />
        ) : (
          <Grid2D s={state} targets={targets} targetColor={modeColor} selected={sel} preview={preview?.path ?? []} onTap={tap} />
        )}
        <span className={`pointer-events-none absolute top-2 left-1/2 max-w-[94%] -translate-x-1/2 truncate rounded-full px-3 py-1 text-xs font-bold ${state.phase === "resolved" && state.last?.caught.length ? "bg-rose-900/85 text-rose-50" : "bg-black/60 text-white/85"}`}>{hint}</span>
      </div>

      <div className={`${PANEL} flex flex-col gap-3`}>
        {playing && state.phase === "choose" && (
          <>
            <div className="grid grid-cols-4 gap-1.5">
              {MODES.map((m) => {
                const disabled = !canChoose || (m.kind === "throw" && (me?.pebbles ?? 0) <= 0);
                return (
                  <button
                    key={m.kind}
                    type="button"
                    disabled={disabled}
                    aria-pressed={mode === m.kind}
                    onClick={() => {
                      setMode({ step: state.step, kind: m.kind });
                      setSel(null);
                    }}
                    className={`flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-center text-[11px] transition disabled:opacity-35 ${mode === m.kind ? "border-white/60 bg-white/15 text-white light:border-slate-500 light:bg-slate-100 light:text-slate-900" : "border-white/15 text-white/70 light:border-slate-300 light:text-slate-600"}`}
                  >
                    <span className="text-xl" aria-hidden>
                      {m.icon}
                    </span>
                    <b>{m.label}</b>
                    <span className="text-[10px] opacity-70">{m.kind === "throw" ? `남은 돌 ${me?.pebbles ?? 0}` : m.sub}</span>
                  </button>
                );
              })}
            </div>
            {preview && draft && (
              <p className="rounded-lg bg-black/20 px-2 py-1.5 text-[11px] text-white/70 light:bg-slate-100 light:text-slate-600">
                🔰 다른 사람이 모두 숨죽인다면: {draft.kind === "hush" ? "나는 아무 소리도 안 내요" : `소리 ${draft.kind === "throw" ? NOISE.throw : NOISE[draft.kind]} → ${(draft.kind === "throw" ? NOISE.throw : NOISE[draft.kind]) * HEAR_PER_LEVEL}칸 안에서 들려요`}
                {" · "}
                {preview.target ? <b className="text-rose-300 light:text-rose-600">괴물이 듣고 {preview.path.length}칸 다가와요 (빨간 원)</b> : preview.path.length ? "괴물은 못 듣고 전에 들은 곳으로 가요" : "괴물은 못 들어요"}
              </p>
            )}
            <button className="rounded-xl bg-indigo-700 px-4 py-3 text-sm font-black text-white transition hover:bg-indigo-600 disabled:opacity-40" disabled={!canChoose || !draft} onClick={commit}>
              {myCommitted || state.commits[viewerSeat] !== null ? "🔒 정했어요 — 다른 사람을 기다리는 중" : "🔒 이렇게 하기 (Enter)"}
            </button>
          </>
        )}
        {lines.length > 0 && state.phase !== "choose" && (
          <ul className="flex flex-col gap-1 rounded-xl bg-black/20 px-3 py-2 text-xs text-white/80 light:bg-slate-100 light:text-slate-700" aria-live="polite">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}

        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {rankings.map((r) => {
            const x = state.seats[r.seat];
            const locked = state.phase === "choose" && state.commits[r.seat] !== null;
            return (
              <li key={r.seat} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${r.seat === viewerSeat ? "border-sky-400/50" : "border-white/10 light:border-slate-200"}`}>
                <SeatChip seat={r.seat} />
                <span className="min-w-0 flex-1 truncate font-bold text-white light:text-slate-900">
                  {name(r.seat)}
                  {!connectedSeats.has(r.seat) && !botSeats.has(r.seat) && " 📡"}
                </span>
                {state.phase === "choose" && <span title={locked ? "정함" : "고르는 중"}>{locked ? "🔒" : "…"}</span>}
                {x.carry > 0 && <span title="들고 있는 열쇠">🗝️{x.carry}</span>}
                <span title="남은 돌">🪨{x.pebbles}</span>
                {x.caught > 0 && <span title="잡힌 횟수">😱{x.caught}</span>}
                <b className="tabular-nums text-amber-100 light:text-amber-700" title="지하실로 가져간 열쇠">🕳️{x.banked}</b>
              </li>
            );
          })}
        </ul>
      </div>

      {ended && (
        <div className={`${PANEL} flex flex-col gap-3 text-center`}>
          <h3 className="text-lg font-black text-white light:text-slate-900">🌅 새벽이 밝았어요</h3>
          <ol className="flex flex-col gap-1 text-sm">
            {rankings.map((r) => (
              <li key={r.seat} className="flex items-center justify-center gap-2">
                <b className="w-8 text-right">{r.rank === 1 ? "👑" : `${r.rank}위`}</b>
                <SeatChip seat={r.seat} />
                <span className="w-28 truncate text-left text-white light:text-slate-900">{name(r.seat)}</span>
                <span className="w-12 text-right text-xs text-white/50 light:text-slate-500">😱{state.seats[r.seat].caught}</span>
                <b className="w-12 text-right tabular-nums">🗝️{r.score}</b>
              </li>
            ))}
          </ol>
          <button className="rounded-xl bg-indigo-700 px-4 py-3 text-sm font-black text-white hover:bg-indigo-600" onClick={onGameEnd}>
            🏁 결과 저장하고 마치기
          </button>
        </div>
      )}

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}
