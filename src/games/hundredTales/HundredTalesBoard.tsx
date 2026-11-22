"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { Frame3D, Loading3D, preferLowDetail, useBoardView, ViewToggle } from "@/games/shared/three/viewPref";
import {
  canStop,
  computeRankings,
  curseFine,
  drawOdds,
  GHOST_EMOJI,
  GHOST_LABEL,
  GHOSTS,
  nextCard,
  RELIGHT,
  storyPoints,
  unseenCards,
  type EngineAction,
  type TaleEvent,
  type Seat,
  type TaleCard,
  type TalesState,
} from "./engine";
import { getHundredTalesSound, hundredTalesCues, talesIntensity } from "./hundredTalesSound";
import { eventText, seatColor, seatMark } from "./labels";
import RulebookModal from "./RulebookModal";
import { addVerdict, advise, EMPTY_TALLY, GRADE_STYLE, judge, standing, tallyTip, tookLead, type CoachTally, type Grade, type Verdict } from "./coach";
import { shakeFor, TalesFxLayer, TalesFxStyles } from "./TalesFx";

const TalesTable3D = dynamic(() => import("./three/TalesTable3D"), { ssr: false, loading: () => <Loading3D label="🕯️ 촛불을 켜는 중…" /> });

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
const PRIMARY = "rounded-xl bg-rose-700 px-4 py-3 text-sm font-black text-white transition hover:bg-rose-600 disabled:opacity-40";
const SECOND = "rounded-xl border border-amber-300/40 bg-amber-400/10 px-4 py-3 text-sm font-black text-amber-100 transition hover:bg-amber-400/20 disabled:opacity-40 light:border-amber-500 light:bg-amber-50 light:text-amber-800";

interface Props {
  state: TalesState;
  viewerSeat: Seat;
  names: Record<Seat, string>;
  connectedSeats: Set<Seat>;
  botSeats: Set<Seat>;
  deadlineMs: number | null;
  nowMs: number;
  onAction: (a: EngineAction) => void;
  onGameEnd: () => void;
}

export function SeatChip({ seat, size = 18 }: { seat: Seat; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-black text-white" style={{ width: size, height: size, background: seatColor(seat), fontSize: size * 0.58, textShadow: "0 1px 1px rgba(0,0,0,.6)" }}>
      {seatMark(seat)}
    </span>
  );
}

function TaleChip({ card, big }: { card: TaleCard; big?: boolean }) {
  const scary = card.fear >= 3;
  return (
    <span
      title={GHOST_LABEL[card.kind]}
      className={`inline-flex flex-col items-center justify-center rounded-lg border font-black ${big ? "h-20 w-14 text-2xl" : "h-14 w-10 text-lg"} ${scary ? "border-rose-400/60 bg-rose-950/60 light:bg-rose-50" : "border-white/20 bg-stone-900/70 light:border-slate-300 light:bg-stone-100"}`}
    >
      <span aria-hidden>{GHOST_EMOJI[card.kind]}</span>
      <span className="text-[10px] text-white/80 light:text-slate-700">{card.fear > 0 ? `공포 ${card.fear}` : GHOST_LABEL[card.kind]}</span>
    </span>
  );
}

/** §7 candle meter — the shared pie. */
const CandleMeter = memo(function CandleMeter({ candles, max, ev }: { candles: number; max: number; ev: TaleEvent | null }) {
  const frac = max > 0 ? candles / max : 0;
  const tone = frac <= 0.1 ? "bg-rose-500" : frac <= 0.33 ? "bg-amber-500" : "bg-amber-300";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-bold text-white/70 light:text-slate-600">🕯️ 남은 촛불</span>
        <span className={`relative font-black tabular-nums ${frac <= 0.1 ? "text-rose-300 light:text-rose-600" : "text-amber-100 light:text-amber-700"}`}>
          {ev && "card" in ev && (ev.card.fear > 0 || ev.card.kind === "candle") && (
            <span key={`${ev.act}-${ev.turn}`} className={`tales-num absolute -top-3 right-full mr-1 text-[11px] ${ev.card.kind === "candle" ? "text-emerald-300 light:text-emerald-600" : "text-rose-300 light:text-rose-600"}`}>
              {ev.card.kind === "candle" ? `+${RELIGHT}` : `−${ev.card.fear}`}
            </span>
          )}
          {frac <= 0.1 && "⚠ "}
          {candles} / {max}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-white/10 light:bg-slate-200" role="meter" aria-valuenow={candles} aria-valuemin={0} aria-valuemax={max} aria-label="남은 촛불">
        <div className={`h-full ${tone} transition-all duration-700`} style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  );
});

/** 2D candle strip — memoised: 100 glowing spans only redraw when the count changes. */
const CandleStrip = memo(function CandleStrip({ candles, max }: { candles: number; max: number }) {
  return (
    <div className="flex flex-wrap justify-center gap-[3px]" aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`h-3 w-1.5 rounded-sm ${i < candles ? "bg-amber-200 shadow-[0_0_6px_rgba(251,191,36,.9)]" : "bg-stone-700"}`} />
      ))}
    </div>
  );
});

const GRADE_TONE: Record<Grade, string> = {
  good: "border-emerald-400/50 bg-emerald-500/10 text-emerald-100 light:bg-emerald-50 light:text-emerald-800",
  ok: "border-white/15 bg-white/[0.04] text-white/80 light:border-slate-200 light:bg-slate-50 light:text-slate-700",
  early: "border-sky-400/40 bg-sky-500/10 text-sky-100 light:bg-sky-50 light:text-sky-800",
  unlucky: "border-sky-400/40 bg-sky-500/10 text-sky-100 light:bg-sky-50 light:text-sky-800",
  greedy: "border-rose-400/50 bg-rose-500/10 text-rose-100 light:bg-rose-50 light:text-rose-800",
  bold: "border-amber-400/50 bg-amber-500/10 text-amber-100 light:bg-amber-50 light:text-amber-800",
  timeout: "border-rose-400/50 bg-rose-500/10 text-rose-100 light:bg-rose-50 light:text-rose-800",
};
const GRADE_SOUND: Record<Grade, string | null> = { good: "good", ok: null, early: "sigh", unlucky: "sigh", greedy: "greedy", bold: "greedy", timeout: null };

interface CoachState {
  prev: TalesState;
  verdict: Verdict | null;
  /** turn of the latest verdict (sound trigger) */
  at: number;
  tally: CoachTally;
  /** turn I last took sole first place */
  lead: number;
}

export default function HundredTalesBoard({ state, viewerSeat, names, connectedSeats, botSeats, deadlineMs, nowMs, onAction, onGameEnd }: Props) {
  const board = useBoardView("hundred-tales-view");
  const [lowDetail] = useState(preferLowDetail);
  const [rules, setRules] = useState(false);
  const [sentTurn, setSentTurn] = useState<number | null>(null);
  const name = useCallback((s: Seat) => (s === viewerSeat ? "나" : (names[s] ?? `${s + 1}번`)), [names, viewerSeat]);

  useSuiteBgm(getHundredTalesSound, state.phase !== "ended", talesIntensity(state));
  const classify = useMemo(() => hundredTalesCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getHundredTalesSound, classify);

  // 🧭 coach — graded during render from the previous state (no extra effect pass)
  const [coach, setCoach] = useState<CoachState>(() => ({ prev: state, verdict: null, at: -1, tally: EMPTY_TALLY, lead: -1 }));
  if (coach.prev !== state) {
    const v = viewerSeat >= 0 ? judge(coach.prev, state, viewerSeat) : null;
    const led = viewerSeat >= 0 && state.phase === "play" && tookLead(coach.prev, state, viewerSeat);
    setCoach({ prev: state, verdict: v ?? coach.verdict, at: v ? state.turn : coach.at, tally: v ? addVerdict(coach.tally, v) : coach.tally, lead: led ? state.turn : coach.lead });
  }
  const verdictGrade = coach.verdict?.grade ?? null;
  useEffect(() => {
    const cue = verdictGrade ? GRADE_SOUND[verdictGrade] : null;
    if (coach.at >= 0 && cue) getHundredTalesSound().play(cue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach.at]);
  useEffect(() => {
    if (coach.lead >= 0) getHundredTalesSound().play("lead");
  }, [coach.lead]);
  useEffect(() => {
    if (state.turn === 0 && state.phase === "play") getHundredTalesSound().play("start");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myTurn = state.phase === "play" && state.seat === viewerSeat && sentTurn !== state.turn;
  const send = useCallback(
    (type: "draw" | "stop") => {
      if (!myTurn) return;
      setSentTurn(state.turn);
      getHundredTalesSound().play("press");
      onAction({ type, seat: viewerSeat, turn: state.turn });
    },
    [myTurn, onAction, state.turn, viewerSeat],
  );

  // keyboard: Space / Enter = 이야기 더, S / Esc = 여기까지
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!myTurn || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        send("draw");
      } else if ((e.key === "s" || e.key === "S" || e.key === "Escape") && canStop(state)) send("stop");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [myTurn, send, state]);

  const remaining = deadlineMs === null ? null : Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
  useEffect(() => {
    if (remaining !== null && remaining > 0 && remaining <= 5 && myTurn) getHundredTalesSound().play("tick");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const ended = state.phase === "ended";
  const rankings = computeRankings(state);
  const winner = ended ? rankings[0].seat : null;
  const odds = drawOdds(state);
  const stake = storyPoints(state.story);
  const peek = useMemo(() => (state.peek ? nextCard(state) : null), [state]);
  const advice = state.options.helper && myTurn ? advise(state, viewerSeat) : null;
  const risky = myTurn && state.told > 0 && odds.bust + odds.curse >= 0.35;
  const stand = viewerSeat >= 0 && viewerSeat < state.playerCount ? standing(state, viewerSeat) : null;
  const firstTime = myTurn && state.told === 0 && coach.tally.decisions === 0 && !state.log.some((e) => e.seat === viewerSeat);
  const ev = state.lastEvent;
  const inStory = new Set(state.story.map((c) => c.kind));
  const pool = unseenCards(state);
  const left = (g: string) => pool.filter((c) => c.kind === g).length;
  const actorName = state.phase === "play" ? name(state.seat) : null;
  const frac = state.candles / state.candlesMax;

  // stable between clock ticks so the memoised 3D table doesn't re-render
  const { playerCount, scores, salts } = state;
  const seats3d = useMemo(
    () =>
      Array.from({ length: playerCount }, (_, seat) => ({
        seat,
        name: names[seat] ?? `${seat + 1}번`,
        color: seatColor(seat),
        away: !connectedSeats.has(seat) && !botSeats.has(seat),
        score: scores[seat],
        salts: salts[seat],
      })),
    [playerCount, names, connectedSeats, botSeats, scores, salts],
  );

  return (
    <div className="flex flex-col gap-3">
      <TalesFxStyles />
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-rose-900/50 px-2.5 py-1 text-xs font-black text-rose-100 light:bg-rose-100 light:text-rose-800">🕯️ 백 개의 괴담</span>
        {!ended && actorName && (
          <span className="text-xs text-white/60 light:text-slate-500">
            {state.seat === viewerSeat ? "내가 이야기할 차례" : `${actorName}의 이야기`}
            {remaining !== null && <b className={`ml-1 tabular-nums ${remaining <= 5 ? "text-rose-300 light:text-rose-600" : ""}`}>⏱ {remaining}초</b>}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <SuiteSoundHud suite={getHundredTalesSound} icon="🕯️" label="Candle Vigil" preview="stop" />
          <ViewToggle board={board} />
          <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </div>
      </div>

      <div className={`relative ${shakeFor(ev)}`}>
      <TalesFxLayer ev={ev} />
      {board.view === "3d" ? (
        <Frame3D hint={ended ? undefined : "드래그로 둘러보기 · 🎥/🪑 시점 전환"}>
          <TalesTable3D
            playerCount={state.playerCount}
            viewerSeat={viewerSeat}
            seats={seats3d}
            activeSeat={state.phase === "play" ? state.seat : null}
            story={state.story}
            candles={state.candles}
            candlesMax={state.candlesMax}
            lastEvent={ev}
            peekCard={peek}
            deckCount={state.deck.length}
            ended={ended}
            winnerSeat={winner}
            cursedSeat={state.cursedSeat}
            lowDetail={lowDetail}
          />
        </Frame3D>
      ) : (
        // 2D: a dark strip of candles that dims with what's left
        <div className="relative overflow-hidden rounded-2xl border border-black/40 p-4 text-center" style={{ background: `radial-gradient(circle at 50% 40%, rgba(251,191,36,${0.08 + frac * 0.3}), #050303 70%)` }}>
          <CandleStrip candles={state.candles} max={state.candlesMax} />
          <div className="mt-3 flex items-center justify-center gap-3">
            {ev && "card" in ev && <TaleChip card={ev.card} big />}
            {peek && (
              <span className="flex flex-col items-center gap-1 text-[11px] text-sky-200">
                🪞 다음 이야기
                <TaleChip card={peek} />
              </span>
            )}
          </div>
        </div>
      )}
      </div>

      {/* last event banner */}
      {ev && (
        <div
          className={`rounded-xl border px-3 py-2 text-sm font-bold ${ev.act === "bust" || ev.act === "curse" ? "border-rose-400/50 bg-rose-600/20 text-rose-100 light:bg-rose-50 light:text-rose-800" : ev.act === "perfect" ? "border-amber-300/50 bg-amber-400/15 text-amber-100 light:bg-amber-50 light:text-amber-800" : "border-white/10 bg-white/[0.03] text-white/80 light:border-slate-200 light:bg-slate-50 light:text-slate-700"}`}
          aria-live="polite"
        >
          {eventText(ev, name)}
        </div>
      )}

      <div className={`${PANEL} flex flex-col gap-3`}>
        <CandleMeter candles={state.candles} max={state.candlesMax} ev={ev} />
        {stand && <p className="-mt-1 text-[11px] font-bold text-white/60 light:text-slate-500">{stand.text}</p>}
        {coach.verdict && (
          <div key={coach.at} className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold ${GRADE_TONE[coach.verdict.grade]}`} aria-live="polite">
            🧭 {coach.verdict.text}
            {coach.tally.decisions > 0 && (
              <span className="ml-1 font-normal opacity-70">
                · 판단 {coach.tally.agreed}/{coach.tally.decisions}
              </span>
            )}
          </div>
        )}
        {!ended && (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-bold text-white/70 light:text-slate-600">{state.seat === viewerSeat ? "📜 내 이야기 (아직 안 모음)" : `📜 ${actorName}의 이야기`}</span>
                <span className="font-black tabular-nums text-amber-100 light:text-amber-700">{stake}점 걸림</span>
              </div>
              <div className="flex min-h-14 flex-wrap gap-1.5">
                {state.story.length === 0 ? <span className="self-center text-xs text-white/40 light:text-slate-400">아직 들려준 이야기가 없어요</span> : state.story.map((c) => <TaleChip key={c.id} card={c} />)}
              </div>
              {/* ghosts still missing for 다섯 귀신 + how many of each are unseen */}
              <div className="flex flex-wrap gap-1 text-[11px]">
                {GHOSTS.map((g) => (
                  <span key={g} className={`rounded-full border px-1.5 py-0.5 ${inStory.has(g) ? "border-rose-400/60 bg-rose-500/15 text-rose-100 light:text-rose-700" : "border-white/10 text-white/50 light:border-slate-300 light:text-slate-500"}`}>
                    {GHOST_EMOJI[g]} {inStory.has(g) ? "또 나오면 씌임" : "아직"} · 남은 {left(g)}
                  </span>
                ))}
              </div>
            </div>

            {state.options.helper && state.told > 0 && (
              <p className="rounded-lg bg-black/20 px-2 py-1.5 text-[11px] text-white/70 light:bg-slate-100 light:text-slate-600">
                🔰 다음 이야기: 씌일 확률 <b className={odds.bust >= 0.35 ? "text-rose-300 light:text-rose-600" : ""}>{Math.round(odds.bust * 100)}%</b>
                {odds.curse > 0 && (
                  <>
                    {" "}
                    · 💀 저주 확률 <b className="text-rose-300 light:text-rose-600">{Math.round(odds.curse * 100)}%</b> (−{curseFine(state.scores[state.seat])})
                  </>
                )}
                {odds.perfect > 0 && <> · 👻 다섯 귀신 {Math.round(odds.perfect * 100)}%</>} · 기대 {odds.gain >= 0 ? "+" : ""}
                {odds.gain.toFixed(1)}점 {state.salts[state.seat] > 0 && "· 🧂 부적이 한 번 막아줘요"}
              </p>
            )}

            {firstTime && (
              <ol className="list-decimal space-y-0.5 rounded-lg border border-amber-300/30 bg-amber-400/10 py-2 pl-7 pr-2 text-[11px] text-amber-100 light:text-amber-800">
                <li>
                  <b>🕯️ 이야기 시작</b>으로 카드를 뒤집어요 — 귀신의 공포 숫자만큼 점수가 쌓여요.
                </li>
                <li>
                  이번 차례에 <b>같은 귀신이 또 나오면 씌어서</b> 쌓인 점수가 날아가요.
                </li>
                <li>
                  적당히 쌓이면 <b>🛑 여기까지</b>로 점수를 지키세요. 🧭 코치가 판단을 채점해 줘요.
                </li>
              </ol>
            )}
            {advice && (
              <p className={`rounded-lg border px-2 py-1.5 text-[11px] font-bold ${advice.pick === "stop" ? "border-amber-300/40 text-amber-100 light:text-amber-800" : advice.pick === "draw" ? "border-emerald-400/40 text-emerald-100 light:text-emerald-800" : "border-white/15 text-white/70 light:text-slate-600"}`}>
                🧭 {advice.text}
              </p>
            )}
            {state.seat === viewerSeat ? (
              <div className="tales-myturn grid grid-cols-2 gap-2 rounded-xl">
                <button
                  className={`${PRIMARY} relative ${risky ? "tales-danger" : ""} ${advice?.pick === "draw" ? "ring-2 ring-emerald-300" : ""} active:scale-95`}
                  onClick={() => send("draw")}
                  disabled={!myTurn}
                >
                  {state.told === 0 ? "🕯️ 이야기 시작" : "👻 한 이야기 더"}
                  {risky && <span className="block text-[10px] font-bold text-rose-100">⚠ 위험 {Math.round((odds.bust + odds.curse) * 100)}%</span>}
                  {advice?.pick === "draw" && <span className="absolute -right-1 -top-2 rounded-full bg-emerald-500 px-1.5 text-[10px] text-white">🧭 추천</span>}
                </button>
                <button className={`${SECOND} relative ${advice?.pick === "stop" ? "ring-2 ring-amber-300" : ""} active:scale-95`} onClick={() => send("stop")} disabled={!myTurn || !canStop(state)}>
                  🛑 여기까지 (+{stake})
                  {advice?.pick === "stop" && <span className="absolute -right-1 -top-2 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">🧭 추천</span>}
                </button>
              </div>
            ) : (
              <p className="text-center text-xs text-white/50 light:text-slate-500">{actorName}이(가) 이야기하는 중… 숨죽이고 들어요</p>
            )}
          </>
        )}

        {/* scoreboard */}
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {rankings.map((r) => (
            <li key={r.seat} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${r.seat === state.seat && !ended ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 light:border-slate-200"} ${r.seat === viewerSeat ? "ring-1 ring-sky-400/50" : ""}`}>
              <SeatChip seat={r.seat} />
              <span className="min-w-0 flex-1 truncate font-bold text-white light:text-slate-900">
                {name(r.seat)}
                {!connectedSeats.has(r.seat) && !botSeats.has(r.seat) && " 📡"}
              </span>
              {state.salts[r.seat] > 0 && <span title="소금 부적">🧂{state.salts[r.seat]}</span>}
              {state.busts[r.seat] > 0 && <span title="씌인 횟수" className="text-rose-300 light:text-rose-600">😱{state.busts[r.seat]}</span>}
              <b className="relative tabular-nums text-amber-100 light:text-amber-700">
                {ev && ev.seat === r.seat && (ev.act === "stop" || ev.act === "perfect") && ev.gained > 0 && (
                  <span key={ev.turn} className="tales-num absolute -top-4 right-0 text-[11px] text-emerald-300 light:text-emerald-600">
                    +{ev.gained}
                  </span>
                )}
                {ev && ev.seat === r.seat && ev.act === "curse" && (
                  <span key={ev.turn} className="tales-num absolute -top-4 right-0 text-[11px] text-rose-300">
                    💀
                  </span>
                )}
                {r.score}
              </b>
            </li>
          ))}
        </ul>
      </div>

      {ended && (
        <div className={`${PANEL} flex flex-col gap-3 text-center`}>
          <h3 className="text-lg font-black text-white light:text-slate-900">🕯️ 마지막 촛불이 꺼졌어요</h3>
          {state.cursedSeat !== null && <p className="text-sm text-rose-200 light:text-rose-700">💀 백 번째 이야기를 한 {name(state.cursedSeat)} — 저주로 점수 절반을 잃었어요</p>}
          <ol className="flex flex-col gap-1 text-sm">
            {rankings.map((r) => (
              <li key={r.seat} className="flex items-center justify-center gap-2">
                <b className="w-8 text-right">{r.rank === 1 ? "👑" : `${r.rank}위`}</b>
                <SeatChip seat={r.seat} />
                <span className="w-28 truncate text-left text-white light:text-slate-900">{name(r.seat)}</span>
                <b className="w-10 text-right tabular-nums">{r.score}</b>
              </li>
            ))}
          </ol>
          {coach.tally.decisions > 0 && (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-left text-xs text-white/80 light:border-slate-200 light:bg-slate-50 light:text-slate-700">
              <p className="mb-1 font-black">
                🧭 나의 판단 리포트 — 코치와 같은 판단 {coach.tally.agreed}/{coach.tally.decisions} ({Math.round((coach.tally.agreed / coach.tally.decisions) * 100)}%)
              </p>
              <p className="flex flex-wrap gap-x-2 gap-y-0.5">
                {(Object.keys(GRADE_STYLE) as Grade[])
                  .filter((g) => (coach.tally.grades[g] ?? 0) > 0)
                  .map((g) => (
                    <span key={g}>
                      {GRADE_STYLE[g].icon} {GRADE_STYLE[g].label} {coach.tally.grades[g]}
                    </span>
                  ))}
              </p>
              <p className="mt-1 text-white/60 light:text-slate-500">{tallyTip(coach.tally)}</p>
            </div>
          )}
          <button className={PRIMARY} onClick={onGameEnd}>
            🏁 결과 저장하고 마치기
          </button>
        </div>
      )}

      <details className={`${PANEL} text-xs text-white/60 light:text-slate-600`}>
        <summary className="cursor-pointer font-bold">📜 지난 이야기</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {state.log.map((e, i) => (
            <li key={`${e.turn}-${i}`}>{eventText(e, name)}</li>
          ))}
        </ul>
      </details>

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}
