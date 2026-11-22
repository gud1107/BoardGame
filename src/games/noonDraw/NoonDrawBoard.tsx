"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { useBoardView } from "@/games/shared/three/viewPref";
import { DRAW_LIMIT_MS, FEINT_INFO, MIN_HUMAN_RT_MS, MODE_INFO, roundName, SEAT_COLOR_NAMES, SEAT_COLORS, SEAT_SYMBOLS } from "./data";
import { activeParticipants, currentStage, matchIndexOf, type NoonAction, type NoonState, type PointReason } from "./engine";
import { getNoonDrawSound } from "./noonDrawSound";
import RulebookModal from "./RulebookModal";

const DuelScene = dynamic(() => import("./three/DuelScene"), { ssr: false, loading: () => null });

/**
 * 정오의 발도 보드: 3D 무대(또는 2D 그림) 위에 ❗ 신호·가짜 신호 알림·점수·결과 글자를 DOM으로 얹는다.
 *
 * 반응 시간은 여기서 잰다 (룰북 §5): 이 기기 화면에 신호가 그려지는 순간(`useLayoutEffect`)부터 손가락·키를 누른
 * 순간(`pointerdown`/`keydown`, click이 아님 — 휴대폰 지연을 줄이려고)까지. 신호가 오기 전에 누르면 부정 출발로 보낸다.
 */

export interface NoonDrawBoardProps {
  state: NoonState;
  mySeat: number;
  names: string[];
  botSeats: Set<number>;
  onAction: (a: NoonAction) => void;
}

const REASON_TEXT: Record<PointReason, string> = {
  faster: "더 빨랐다!",
  early: "상대 부정 출발",
  miss: "상대가 칼을 못 뽑음",
  "double-early": "둘 다 부정 출발 — 다시",
  "double-miss": "둘 다 못 뽑음 — 다시",
  tie: "완전히 같은 순간 — 다시",
};

/** 자리 색 기호 + 이름. 늘 어두운 판 위에 쓸 땐 `onDark` (라이트 모드에서도 흰 글자 유지). */
function Tag({ seat, name, onDark }: { seat: number; name: string; onDark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 font-bold" style={{ color: SEAT_COLORS[seat] }}>
      <span aria-hidden>{SEAT_SYMBOLS[seat]}</span>
      <span className={onDark ? "text-white" : "text-white light:text-slate-900"}>{name}</span>
    </span>
  );
}

function Pips({ n, of }: { n: number; of: number }) {
  return (
    <span className="tracking-tight" aria-label={`${n}/${of}승`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={i < n ? "text-amber-300" : "text-white/25"}>
          {i < n ? "●" : "○"}
        </span>
      ))}
    </span>
  );
}

export default function NoonDrawBoard({ state, mySeat, names, botSeats, onAction }: NoonDrawBoardProps) {
  const sound = getNoonDrawSound;
  const bout = state.bout;
  const finished = state.phase === "finished";
  const amIn = !!bout && bout.participants.includes(mySeat);
  const myRec = bout?.draws[mySeat];
  const { view, setView, canToggle } = useBoardView("noon-draw-view");
  const [lowFps, setLowFps] = useState(false);
  const [touch] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches);
  const quality: "high" | "low" = touch || lowFps ? "low" : "high";
  const [rulebook, setRulebook] = useState(false);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const [watch, setWatch] = useState<number | null>(null);

  /* ── 반응 시간 재기 ─────────────────────────────────────────────── */
  const shownAt = useRef<{ bout: number; t: number } | null>(null);
  const sent = useRef<number>(-1);
  const [myFeedback, setMyFeedback] = useState<{ bout: number; text: string; tone: "good" | "bad" | "info" } | null>(null);
  const signalUp = bout?.phase === "draw" && bout.signalAt !== null;

  useLayoutEffect(() => {
    if (!bout || !signalUp) return;
    if (shownAt.current?.bout === bout.id) return;
    shownAt.current = { bout: bout.id, t: performance.now() };
  }, [bout, signalUp]);

  const drawNow = useCallback(() => {
    const b = state.bout;
    if (!b || state.phase !== "bout" || !b.participants.includes(mySeat) || b.draws[mySeat] || sent.current === b.id) return;
    if (b.phase === "ready") {
      setMyFeedback({ bout: b.id, text: "아직 자세를 잡는 중이에요", tone: "info" });
      return;
    }
    if (b.phase === "result") return;
    sent.current = b.id;
    const t = performance.now();
    if (b.phase === "wait" || shownAt.current?.bout !== b.id) {
      onAction({ type: "draw", seat: mySeat, early: true });
      setMyFeedback({ bout: b.id, text: "부정 출발!", tone: "bad" });
      return;
    }
    const rt = Math.round(t - shownAt.current.t);
    onAction({ type: "draw", seat: mySeat, rt });
    sound().play("draw");
    setMyFeedback({ bout: b.id, text: rt > DRAW_LIMIT_MS ? `${rt}ms · 늦음` : rt < MIN_HUMAN_RT_MS ? `${rt}ms · 부정 출발` : `${rt}ms`, tone: rt < MIN_HUMAN_RT_MS || rt > DRAW_LIMIT_MS ? "bad" : "good" });
  }, [state, mySeat, onAction, sound]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space" || e.code === "Enter" || e.code === "KeyJ" || e.code === "KeyF") {
        e.preventDefault();
        drawNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawNow]);

  /* ── 소리·진동 ──────────────────────────────────────────────────── */
  const bgmLevel = !bout || state.phase !== "bout" ? 0 : bout.phase === "wait" || bout.phase === "draw" ? 2 : bout.phase === "ready" ? 1 : 0;
  useSuiteBgm(sound, !finished, bgmLevel);
  const prev = useRef<NoonState>(state);
  useEffect(() => {
    const p = prev.current;
    prev.current = state;
    if (p === state) return;
    const s = sound();
    const pb = p.bout;
    const b = state.bout;
    if (state.phase === "between" && p.phase !== "between") s.play("round");
    if (state.phase === "finished" && p.phase !== "finished") return;
    if (!b) return;
    const same = pb?.id === b.id;
    if (b.phase === "ready" && (!same || pb?.phase !== "ready") && b.participants.includes(mySeat)) s.play("ready");
    const before = same ? pb!.feints.length : 0;
    for (let i = before; i < b.feints.length; i++) s.play(b.feints[i].kind);
    if (b.phase === "draw" && (!same || pb?.phase !== "draw")) {
      s.play("signal");
      if (b.participants.includes(mySeat)) navigator.vibrate?.(40);
    }
    for (const [k, rec] of Object.entries(b.draws)) {
      const seat = Number(k);
      if (same && pb!.draws[seat]) continue;
      if (rec.kind === "early") s.play("early");
      else if (seat !== mySeat) s.play("drawFar");
    }
    if (b.phase === "result" && (!same || pb?.phase !== "result") && b.result) {
      const r = b.result;
      if (r.fastest !== null) s.play("slash");
      if (state.mode === "tournament") {
        const idx = matchIndexOf(state, mySeat);
        const pt = r.points?.find((x) => x.match === idx);
        const m = currentStage(state)[idx];
        if (pt && b.participants.includes(mySeat)) {
          if (pt.winner === mySeat) s.play(m?.winner === mySeat ? "advance" : "point");
          else if (pt.winner === null) s.play("replay");
          else s.play(m?.winner !== null ? "out" : "lose");
        }
      } else if (r.hits?.some((h) => h.seat === mySeat)) s.play(state.alive[mySeat] ? "heart" : "out");
      else if (amIn) s.play("point");
    }
  }, [state, mySeat, sound, amIn]);

  /* ── 무엇을 보여 줄지 ───────────────────────────────────────────── */
  const stage = currentStage(state);
  const myMatch = matchIndexOf(state, mySeat);
  const liveMatches = stage.map((m, i) => ({ m, i })).filter(({ m }) => m.b !== null && (m.winner === null || bout?.participants.includes(m.a)));
  const shownMatch = (() => {
    if (state.mode !== "tournament") return -1;
    const mine = stage[myMatch];
    if (mine && mine.b !== null && (amIn || mine.winner === null)) return myMatch;
    if (watch !== null && stage[watch] && stage[watch].b !== null) return watch;
    if (bout) {
      const idx = stage.findIndex((m) => m.b !== null && bout.participants.includes(m.a));
      if (idx >= 0) return idx;
    }
    if (finished || state.phase === "between") {
      const last = state.bracket[state.bracket.length - 1];
      return last.length === 1 ? 0 : stage.findIndex((m) => m.b !== null);
    }
    return stage.findIndex((m) => m.b !== null);
  })();
  const shownStage = finished ? state.bracket[state.bracket.length - 1] : stage;
  const focus = (() => {
    if (state.mode === "brawl") return Array.from({ length: state.playerCount }, (_, i) => i);
    const m = shownStage[Math.max(0, shownMatch)];
    return m ? (m.b === null ? [m.a] : [m.a, m.b]) : [];
  })();

  const signal = bout?.phase === "draw";
  const lastFeint = bout && bout.phase !== "result" && bout.feints.length ? bout.feints[bout.feints.length - 1] : null;
  const feintKey = lastFeint && bout ? `${bout.id}:${bout.feints.length}` : null;
  const [expiredFeint, setExpiredFeint] = useState<string | null>(null);
  useEffect(() => {
    if (!feintKey) return;
    const id = window.setTimeout(() => setExpiredFeint(feintKey), 1300);
    return () => window.clearTimeout(id);
  }, [feintKey]);
  const feintShown = lastFeint && feintKey !== expiredFeint ? { kind: lastFeint.kind } : null;

  const res = bout?.phase === "result" ? bout.result : null;
  const fb = myFeedback && bout && myFeedback.bout === bout.id ? myFeedback : null;

  const headline = (() => {
    if (state.phase === "intro") return state.mode === "tournament" ? `⚔️ ${roundName(stage.length)} — 대진표 공개` : `🌪️ 난투 — ${state.playerCount}명이 한꺼번에`;
    if (state.phase === "between") return `🥁 ${roundName(stage.length)} 진출자 결정 — 곧 ${roundName(Math.max(1, stage.length / 2))}`;
    if (finished) return "🏆 결투 끝!";
    if (!bout) return "";
    if (bout.phase === "ready") return amIn ? "자세를 잡으세요…" : "결투자들이 자세를 잡는 중";
    if (bout.phase === "wait") return amIn ? "❗가 뜨는 순간 누르세요" : "숨죽이고 지켜보는 중…";
    if (bout.phase === "draw") return amIn && !myRec ? "지금!" : "칼이 빛난다!";
    return "";
  })();

  const resultLines = (() => {
    if (!res || !bout) return [] as { key: string; node: ReactNode }[];
    const out: { key: string; node: ReactNode }[] = [];
    const rtText = (seat: number) => {
      const v = res.verdicts[seat];
      if (!v) return "";
      if (v.v === "valid") return `${v.rt}ms`;
      if (v.v === "early") return bout.draws[seat]?.tooFast ? "부정 출발 (100ms 미만)" : "부정 출발";
      return "못 뽑음";
    };
    if (state.mode === "tournament") {
      const idx = shownMatch;
      const pt = res.points?.find((p) => p.match === idx);
      const m = stage[idx];
      if (pt && m && m.b !== null) {
        out.push({
          key: "pt",
          node:
            pt.winner === null ? (
              <span>🔁 {REASON_TEXT[pt.reason]}</span>
            ) : (
              <span>
                ⚔️ <Tag seat={pt.winner} onDark name={names[pt.winner]} /> 한 판! <span className="text-white/60">({REASON_TEXT[pt.reason]})</span>
              </span>
            ),
        });
        out.push({
          key: "rt",
          node: (
            <span className="text-sm text-white/80">
              <Tag seat={m.a} onDark name={names[m.a]} /> {rtText(m.a)} · <Tag seat={m.b} onDark name={names[m.b]} /> {rtText(m.b)}
            </span>
          ),
        });
        if (m.winner !== null) out.push({ key: "w", node: <span className="text-amber-200">🏅 {m.decidedBy === "judge" ? "심판 판정 — " : ""}<Tag seat={m.winner} onDark name={names[m.winner]} /> 승리!</span> });
      }
    } else {
      const hits = res.hits ?? [];
      if (res.fastest !== null) out.push({ key: "f", node: <span>⚡ 가장 빠름 <Tag seat={res.fastest} onDark name={names[res.fastest]} /> {rtText(res.fastest)}</span> });
      if (hits.length)
        out.push({
          key: "h",
          node: (
            <span className="text-sm">
              💔{" "}
              {hits.map((h, i) => (
                <span key={h.seat}>
                  {i > 0 && " · "}
                  <Tag seat={h.seat} onDark name={names[h.seat]} /> {h.reason === "slow" ? `느림 ${rtText(h.seat)}` : rtText(h.seat)}
                  {!state.alive[h.seat] && " ☠️ 탈락"}
                </span>
              ))}
            </span>
          ),
        });
    }
    return out;
  })();

  const canPick = state.mode === "tournament" && !!bout && !amIn && (bout.phase === "ready" || bout.phase === "wait") && !finished;
  const myPick = bout?.picks[mySeat];
  const shownM = state.mode === "tournament" ? shownStage[shownMatch] : undefined;

  const use3d = view === "3d";

  return (
    <div className="flex flex-col gap-2">
      {/* 상단 정보 */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-white/70 light:text-slate-600">
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-200 light:text-amber-800">
          {MODE_INFO[state.mode].emoji} {MODE_INFO[state.mode].label}
        </span>
        {state.mode === "tournament" ? <span>{roundName(stage.length)}</span> : <span>{state.round + 1}합째</span>}
        {bout && <span>· 긴장 {"🔥".repeat(bout.heat + 1)}</span>}
        <span className="ml-auto flex gap-1">
          {canToggle && (
            <button onClick={() => setView(use3d ? "2d" : "3d")} className="rounded-full border border-white/15 px-2.5 py-1 light:border-slate-300">
              {use3d ? "🖼️ 2D" : "🧊 3D"}
            </button>
          )}
          <button onClick={() => setRulebook(true)} className="rounded-full border border-white/15 px-2.5 py-1 light:border-slate-300">
            📖 룰북
          </button>
        </span>
      </div>

      {state.mode === "brawl" && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {names.slice(0, state.playerCount).map((nm, seat) => (
            <span key={seat} className={state.alive[seat] ? "" : "opacity-40 line-through"}>
              <Tag seat={seat} name={seat === mySeat ? `${nm}(나)` : nm} /> {"❤️".repeat(state.hearts[seat])}
              {state.hearts[seat] === 0 && "☠️"}
            </span>
          ))}
        </div>
      )}

      {/* 무대 */}
      <div
        className="relative aspect-[16/10] w-full touch-none overflow-hidden rounded-2xl border border-amber-200/20 bg-[#e9dcc0] select-none sm:aspect-[16/9]"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drawNow();
        }}
        role="button"
        aria-label="칼 뽑기 (화면을 누르거나 Space)"
      >
        {use3d ? (
          <DuelScene state={state} focus={focus} names={names} quality={quality} labels={labels} onFps={(f) => f < 28 && setLowFps(true)} />
        ) : (
          <Stage2D state={state} focus={focus} names={names} />
        )}

        {/* 이름표 (3D) */}
        {use3d &&
          focus.map((seat) => (
            <div
              key={seat}
              ref={(el) => {
                labels.current[seat] = el;
              }}
              className="pointer-events-none absolute top-0 left-0 rounded-full bg-black/55 px-2 py-0.5 text-[11px] whitespace-nowrap text-white"
            >
              <span style={{ color: SEAT_COLORS[seat] }}>{SEAT_SYMBOLS[seat]}</span> {names[seat]}
              {seat === mySeat && " (나)"}
              {botSeats.has(seat) && " 🤖"}
              {bout?.draws[seat]?.kind === "early" && " ⚠️"}
            </div>
          ))}

        {/* 점수판 (토너먼트) */}
        {shownM && shownM.b !== null && (
          <div className="pointer-events-none absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/55 px-3 py-1 text-xs text-white">
            <span style={{ color: SEAT_COLORS[shownM.a] }}>{SEAT_SYMBOLS[shownM.a]}</span>
            <span className="max-w-[6rem] truncate">{names[shownM.a]}</span>
            <Pips n={shownM.winsA} of={shownM.target} />
            <span className="text-white/50">vs</span>
            <Pips n={shownM.winsB} of={shownM.target} />
            <span className="max-w-[6rem] truncate">{names[shownM.b]}</span>
            <span style={{ color: SEAT_COLORS[shownM.b] }}>{SEAT_SYMBOLS[shownM.b]}</span>
          </div>
        )}

        {/* 상태 글자 */}
        {headline && !signal && !res && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-4 py-1.5 text-sm font-semibold whitespace-nowrap text-white">
            {headline}
          </div>
        )}

        {/* 가짜 신호 알림 (소리 없이도 보이게) — 화면 왼쪽 위, ❗와 다른 자리·모양 */}
        {feintShown && bout?.phase === "wait" && (
          <div className="pointer-events-none absolute top-11 left-2 flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1 text-xs text-white/90">
            <span className="text-lg">{FEINT_INFO[feintShown.kind].emoji}</span>
            {FEINT_INFO[feintShown.kind].label}
          </div>
        )}

        {/* ❗ 진짜 신호 */}
        {signal && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="noon-signal flex h-28 w-28 items-center justify-center rounded-full border-4 border-white bg-red-600 text-7xl font-black text-white shadow-[0_0_60px_rgba(255,80,40,0.9)] sm:h-36 sm:w-36 sm:text-8xl">!</div>
          </div>
        )}

        {/* 내 반응 */}
        {fb && (
          <div
            className={`pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-xl px-3 py-2 text-xl font-black tabular-nums shadow-lg ${
              fb.tone === "good" ? "bg-emerald-500/85 text-white" : fb.tone === "bad" ? "bg-rose-600/90 text-white" : "bg-black/60 text-white/90"
            }`}
          >
            {fb.text}
          </div>
        )}

        {/* 합 결과 */}
        {res && (
          <>
            <div className="noon-flash pointer-events-none absolute inset-0 bg-white" />
            <div className="pointer-events-none absolute right-2 bottom-2 left-2 flex flex-col items-center gap-1 rounded-xl bg-black/65 px-3 py-2 text-center text-sm text-white">
              {resultLines.map((l) => (
                <div key={l.key}>{l.node}</div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 휴대폰용 큰 버튼 */}
      {amIn && !finished && (
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            drawNow();
          }}
          className={`h-16 w-full rounded-2xl text-lg font-black transition sm:h-14 ${
            myRec ? "bg-white/10 text-white/50 light:bg-slate-200 light:text-slate-500" : signal ? "bg-red-600 text-white" : "bg-amber-500/90 text-slate-900"
          }`}
        >
          {myRec ? (myRec.kind === "valid" ? `🗡️ ${myRec.rt}ms` : myRec.kind === "early" ? "⚠️ 부정 출발" : "⌛ 늦었어요") : "🗡️ 발도! (화면 아무 데나 · Space)"}
        </button>
      )}

      {/* 🔮 예측 */}
      {canPick && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-violet-400/30 bg-violet-500/10 p-2 text-xs text-violet-100 light:text-violet-800">
          <span className="font-semibold">🔮 이번 합은 누가 이길까요? (맞히면 예측 +1)</span>
          <div className="flex flex-wrap gap-1.5">
            {(shownM && shownM.b !== null ? [shownM.a, shownM.b] : activeParticipants(state)).map((seat) => (
              <button
                key={seat}
                onClick={() => {
                  sound().play("pick");
                  onAction({ type: "pick", seat: mySeat, target: seat });
                }}
                className={`rounded-full border px-3 py-1 ${myPick === seat ? "border-violet-300 bg-violet-500/40 text-white" : "border-violet-300/30"}`}
              >
                {SEAT_SYMBOLS[seat]} {names[seat]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 다른 경기 보기 */}
      {state.mode === "tournament" && !amIn && liveMatches.length > 1 && (
        <div className="flex flex-wrap gap-1 text-xs">
          <span className="text-white/50 light:text-slate-500">👀 보기:</span>
          {liveMatches.map(({ m, i }) => (
            <button
              key={i}
              onClick={() => setWatch(i)}
              className={`rounded-full border px-2 py-0.5 ${i === shownMatch ? "border-amber-400 bg-amber-500/20" : "border-white/15 light:border-slate-300"}`}
            >
              {names[m.a]} vs {m.b !== null ? names[m.b] : "-"}
            </button>
          ))}
        </div>
      )}

      {/* 대진표 */}
      {state.mode === "tournament" && <Bracket state={state} names={names} mySeat={mySeat} />}

      {rulebook && <RulebookModal onClose={() => setRulebook(false)} />}
      <style>{`
        .noon-signal { animation: noonPop 0.16s cubic-bezier(.2,1.6,.4,1) both; }
        .noon-flash { animation: noonFlash 0.35s ease-out both; }
        @keyframes noonPop { from { transform: scale(0.3); opacity: 0.2; } to { transform: scale(1); opacity: 1; } }
        @keyframes noonFlash { from { opacity: 0.85; } to { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .noon-signal, .noon-flash { animation: none; } .noon-flash { display: none; } }
      `}</style>
    </div>
  );
}

function Bracket({ state, names, mySeat }: { state: NoonState; names: string[]; mySeat: number }) {
  return (
    <div className="flex gap-2 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-2 text-[11px] light:border-slate-200 light:bg-white">
      {state.bracket.map((stage, r) => (
        <div key={r} className="flex min-w-[8.5rem] flex-col gap-1">
          <span className="font-semibold text-white/50 light:text-slate-500">{roundName(stage.length)}</span>
          {stage.map((m, i) => {
            const row = (seat: number | null, wins: number) =>
              seat === null ? (
                <div className="text-white/30 light:text-slate-400">부전승</div>
              ) : (
                <div className={`flex items-center justify-between gap-1 ${m.winner !== null && m.winner !== seat ? "opacity-40" : ""} ${seat === mySeat ? "font-bold" : ""}`}>
                  <span className="truncate">
                    <span style={{ color: SEAT_COLORS[seat] }}>{SEAT_SYMBOLS[seat]}</span> {names[seat]}
                  </span>
                  <span className="tabular-nums">{m.b === null ? "" : wins}</span>
                </div>
              );
            return (
              <div key={i} className={`rounded-md border px-1.5 py-1 ${m.winner === null && m.b !== null ? "border-amber-400/40" : "border-white/10 light:border-slate-200"}`}>
                {row(m.a, m.winsA)}
                {row(m.b, m.winsB)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** WebGL이 없을 때의 2D 무대: 모래 마당 위 두 사람(또는 둥근 원). 같은 상태로 그린다. */
function Stage2D({ state, focus, names }: { state: NoonState; focus: number[]; names: string[] }) {
  const b = state.bout;
  const res = b?.phase === "result" ? b.result : null;
  return (
    <div className="absolute inset-0 bg-[linear-gradient(#9cc8ec_0%,#e9edea_45%,#d8bf8a_46%,#c9ac74_100%)]">
      <div className="absolute top-[18%] left-1/2 -translate-x-1/2 text-4xl" aria-hidden>
        {b?.phase === "draw" ? "🔔" : "🪘"}
      </div>
      <div className={`absolute inset-x-0 top-[48%] flex ${focus.length > 2 ? "flex-wrap justify-center gap-3 px-4" : "justify-between px-[12%]"}`}>
        {focus.map((seat) => {
          const rec = b?.draws[seat];
          const v = res?.verdicts[seat]?.v;
          const lost = res ? (state.mode === "brawl" ? res.hits?.some((h) => h.seat === seat) : res.points?.some((p) => p.winner !== null && p.winner !== seat && b?.participants.includes(seat))) : false;
          const icon = state.mode === "brawl" && !state.alive[seat] && !res ? "💀" : lost ? "🧎" : rec?.kind === "valid" || v === "valid" ? "🤺" : rec?.kind === "early" ? "😵" : "🧍";
          return (
            <div key={seat} className="flex flex-col items-center gap-0.5">
              <span className="text-5xl" style={{ transform: focus.length === 2 && focus.indexOf(seat) === 1 ? "scaleX(-1)" : undefined }}>
                {icon}
              </span>
              <span className="rounded-full bg-black/50 px-1.5 text-[11px] text-white">
                <span style={{ color: SEAT_COLORS[seat] }}>{SEAT_SYMBOLS[seat]}</span> {names[seat]} <span className="sr-only">{SEAT_COLOR_NAMES[seat]}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
