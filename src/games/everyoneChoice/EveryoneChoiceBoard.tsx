"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { CATEGORY_LABEL, QUESTIONS } from "./data";
import { BETS, computeRankings, KIND_INFO, kindOf, LONE_BONUS, LOSS, phaseMs, questionOf, titles, type Bet, type ChoiceState, type Move, type RoundKind, type RoundReport, type Seat } from "./engine";
import { everyoneChoiceCues, getEveryoneChoiceSound } from "./everyoneChoiceSound";
import RulebookModal from "./RulebookModal";

const PANEL = "rounded-2xl border border-white/10 bg-white/[0.04] p-3 light:border-slate-200 light:bg-white light:shadow-sm";
/** Options are told apart by colour AND shape mark (colour-blind safe). */
export const OPT_COLORS = ["#f472b6", "#38bdf8", "#a3e635", "#fbbf24"];
export const OPT_MARKS = ["●", "◆", "▲", "■"];
const KIND_STYLE: Record<RoundKind, string> = {
  major: "border-sky-400/40 bg-sky-500/10 text-sky-100 light:border-sky-300 light:bg-sky-50 light:text-sky-800",
  reverse: "border-fuchsia-400/50 bg-fuchsia-500/15 text-fuchsia-100 light:border-fuchsia-300 light:bg-fuchsia-50 light:text-fuchsia-800",
  lone: "border-amber-400/50 bg-amber-500/15 text-amber-100 light:border-amber-300 light:bg-amber-50 light:text-amber-800",
  double: "border-yellow-300/60 bg-yellow-400/15 text-yellow-100 light:border-yellow-400 light:bg-yellow-50 light:text-yellow-800",
};
const BET_KEYS: Record<string, Bet> = { q: 1, w: 2, e: 3 };

const ANIM = `
@keyframes ec-pop { 0% { transform: scale(.4); opacity: 0 } 70% { transform: scale(1.12); opacity: 1 } 100% { transform: scale(1) } }
@keyframes ec-grow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes ec-rise { 0% { transform: translateY(8px); opacity: 0 } 25% { opacity: 1 } 100% { transform: translateY(-4px); opacity: 1 } }
@keyframes ec-glow { 0%,100% { box-shadow: 0 0 0 0 rgba(250,204,21,.0) } 50% { box-shadow: 0 0 18px 2px rgba(250,204,21,.45) } }
@media (prefers-reduced-motion: reduce) { .ec-anim { animation: none !important } }
`;

function OptMark({ i, size = 20 }: { i: number; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-black text-black/80" style={{ width: size, height: size, fontSize: size * 0.55, background: OPT_COLORS[i] }} aria-hidden>
      {OPT_MARKS[i]}
    </span>
  );
}

const coins = (b: number) => "🪙".repeat(Math.max(0, b));
const signed = (d: number) => (d > 0 ? `+${d}` : `${d}`);

/** Headline for a resolved round. */
export function headline(r: RoundReport, name: (s: Seat) => string): string {
  const q = QUESTIONS[r.q];
  const opt = (i: number) => q.opts[i].label;
  const list = r.winners.map(opt).join(" · ");
  switch (r.note) {
    case "empty":
      return "🤐 아무도 답하지 않았어요";
    case "unanimous":
      return r.kind === "reverse" ? "" : `🤝 만장일치! 모두 ${list}`;
    case "no-minority":
      return "🔄 모두 같은 걸 골라서 소수파가 없어요 — 모두 졌어요";
    case "minority":
      return `🔄 반전! 가장 적은 쪽 ${list} 승리`;
    case "tie":
      return `⚖️ 동률 — ${list} 모두 승리`;
    case "lone":
      return `🐺 외톨이 ${name(r.loners[0])}! 혼자 ${opt(r.picks[r.loners[0]]!)}`;
    case "lones":
      return `🐺 외톨이 ${r.loners.length}명 — ${r.loners.map(name).join(", ")}`;
    case "no-lone":
      return `🐺 외톨이가 없어서 다수파 ${list} 승리`;
    default:
      return `${r.kind === "double" ? "✨" : "👥"} 다수파 ${list} 승리`;
  }
}

interface Props {
  state: ChoiceState;
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

export default function EveryoneChoiceBoard({ state, viewerSeat, names, connectedSeats, botSeats, phaseStart, nowMs, myCommitted, onCommit, onGameEnd }: Props) {
  const [rules, setRules] = useState(false);
  const [pickRaw, setPick] = useState<{ step: number; i: number } | null>(null);
  const [betRaw, setBet] = useState<{ step: number; b: Bet } | null>(null);
  const pick = pickRaw && pickRaw.step === state.step ? pickRaw.i : null;
  const bet: Bet = betRaw && betRaw.step === state.step ? betRaw.b : 1;
  const name = useCallback((s: Seat) => (s === viewerSeat ? "나" : (names[s] ?? `${s + 1}번`)), [names, viewerSeat]);

  const playing = viewerSeat >= 0 && viewerSeat < state.playerCount;
  const q = questionOf(state);
  const kind = kindOf(state);
  const mult = kind === "double" ? 2 : 1;
  const ended = state.phase === "ended";
  const left = ended ? null : Math.max(0, Math.ceil((phaseStart + phaseMs(state) - nowMs) / 1000));
  const frac = ended ? 0 : Math.max(0, Math.min(1, (phaseStart + phaseMs(state) - nowMs) / phaseMs(state)));

  useSuiteBgm(getEveryoneChoiceSound, !ended, state.phase === "choose" && left !== null && left <= 5 ? 1 : 0);
  const classify = useMemo(() => everyoneChoiceCues(viewerSeat), [viewerSeat]);
  useSoundCues(state, getEveryoneChoiceSound, classify);

  const canChoose = playing && state.phase === "choose" && state.commits[viewerSeat] === null && !myCommitted;
  const commit = useCallback(() => {
    if (!canChoose || pick === null) return;
    getEveryoneChoiceSound().play("commit");
    onCommit({ pick, bet });
  }, [canChoose, pick, bet, onCommit]);

  const choose = useCallback(
    (i: number) => {
      if (!canChoose) return;
      getEveryoneChoiceSound().play("pick");
      setPick({ step: state.step, i });
    },
    [canChoose, state.step],
  );
  const chooseBet = useCallback(
    (b: Bet) => {
      if (!canChoose) return;
      getEveryoneChoiceSound().play("chip");
      setBet({ step: state.step, b });
    },
    [canChoose, state.step],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || !canChoose) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= q.opts.length) choose(n - 1);
      else if (BET_KEYS[e.key.toLowerCase()]) chooseBet(BET_KEYS[e.key.toLowerCase()]);
      else if (e.key === "Enter") commit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canChoose, commit, choose, chooseBet, q.opts.length]);

  useEffect(() => {
    if (left !== null && left > 0 && left <= 5 && canChoose) getEveryoneChoiceSound().play("tick");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const rankings = computeRankings(state);
  const r = state.phase === "resolved" || ended ? state.last : null;
  const lockedCount = state.commits.filter((c) => c !== null).length;
  const myLocked = myCommitted && state.phase === "choose" ? myCommitted : null;
  const info = KIND_INFO[kind];
  const title = ended ? titles(state) : null;

  return (
    <div className="flex flex-col gap-3">
      <style>{ANIM}</style>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-violet-950/80 px-2.5 py-1 text-xs font-black text-violet-100 light:bg-violet-100 light:text-violet-800">🗳️ 모두의 선택</span>
        <span className="text-xs text-white/60 light:text-slate-500">
          {state.round} / {state.options.rounds}번째 질문
          {left !== null && state.phase === "choose" && <b className={`ml-1 tabular-nums ${left <= 5 ? "text-rose-300 light:text-rose-600" : ""}`}>⏱ {left}초</b>}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <SuiteSoundHud suite={getEveryoneChoiceSound} icon="🗳️" label="Show of Hands" preview="win" />
          <button onClick={() => setRules(true)} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/70 light:border-slate-300 light:text-slate-600">
            📖 룰북
          </button>
        </div>
      </div>

      {/* question card */}
      <div className={`${PANEL} flex flex-col gap-3`}>
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${KIND_STYLE[kind]}`}>
          <span className="text-xl leading-none" aria-hidden>
            {info.icon}
          </span>
          <span className="min-w-0 break-keep">
            <b className="block text-sm">{info.label} 라운드</b>
            {info.rule}
          </span>
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-[11px] text-white/50 light:text-slate-500">{CATEGORY_LABEL[q.cat]}</span>
          <h2 key={state.round} className="ec-anim break-keep text-xl font-black text-white light:text-slate-900 sm:text-2xl" style={{ animation: "ec-pop .45s ease-out" }}>
            {q.text}
          </h2>
        </div>
        {!ended && (
          <div className="h-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200" aria-hidden>
            <div className={`h-full rounded-full ${state.phase === "choose" ? (left !== null && left <= 5 ? "bg-rose-400" : "bg-violet-400") : "bg-white/30 light:bg-slate-400"}`} style={{ width: `${frac * 100}%`, transition: "width .2s linear" }} />
          </div>
        )}

        {state.phase === "choose" || state.phase === "reveal" ? (
          <>
            <div className={`grid gap-2 ${q.opts.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2"}`}>
              {q.opts.map((o, i) => {
                const mine = myLocked ? myLocked.pick === i : pick === i;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={!canChoose}
                    aria-pressed={mine}
                    onClick={() => choose(i)}
                    className={`flex min-h-[64px] items-center gap-2 rounded-xl border-2 px-3 py-2 text-left text-sm font-bold transition disabled:cursor-default ${mine ? "text-white light:text-slate-900" : "border-white/10 text-white/85 hover:border-white/30 light:border-slate-200 light:text-slate-700 light:hover:border-slate-400"} ${!canChoose && !mine ? "opacity-60" : ""}`}
                    style={mine ? { borderColor: OPT_COLORS[i], background: `${OPT_COLORS[i]}2e` } : undefined}
                  >
                    <OptMark i={i} size={24} />
                    <span className="min-w-0 flex-1 break-keep">{o.label}</span>
                    <span className="hidden text-[10px] text-white/40 sm:inline light:text-slate-400">{i + 1}</span>
                  </button>
                );
              })}
            </div>

            {playing && state.phase === "choose" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] text-white/60 light:text-slate-500">🪙 확신 칩 — 맞으면 얻고, 틀리면 잃어요{mult > 1 && <b className="ml-1 text-yellow-200 light:text-yellow-700">✨ 이번엔 두 배!</b>}</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {BETS.map((b) => {
                      const on = (myLocked ? myLocked.bet : bet) === b;
                      return (
                        <button
                          key={b}
                          type="button"
                          disabled={!canChoose}
                          aria-pressed={on}
                          onClick={() => chooseBet(b)}
                          className={`flex flex-col items-center rounded-xl border px-1 py-1.5 text-[11px] transition disabled:cursor-default ${on ? "border-yellow-300 bg-yellow-400/15 text-yellow-50 light:border-yellow-500 light:bg-yellow-50 light:text-yellow-900" : "border-white/15 text-white/70 light:border-slate-300 light:text-slate-600"}`}
                        >
                          <span className="text-base leading-tight">{coins(b)}</span>
                          <b>
                            +{b * mult} / {LOSS[b] ? `−${LOSS[b] * mult}` : "0"}
                          </b>
                          <span className="hidden text-[10px] opacity-60 sm:inline">{["Q", "W", "E"][b - 1]}</span>
                        </button>
                      );
                    })}
                  </div>
                  {kind === "lone" && <span className="text-[11px] text-amber-200/80 light:text-amber-700">🐺 혼자 고른 사람이 딱 1명이면 칩 + {LONE_BONUS}점 · 외톨이가 있으면 나머지는 점수 변화 없음</span>}
                </div>
                <button className="rounded-xl bg-violet-700 px-4 py-3 text-sm font-black text-white transition hover:bg-violet-600 disabled:opacity-40" disabled={!canChoose || pick === null} onClick={commit}>
                  {myLocked || state.commits[viewerSeat] !== null ? `🔒 잠갔어요 — 다른 사람 기다리는 중 (${lockedCount}/${state.playerCount})` : pick === null ? "선택지를 골라 주세요" : "🔒 이걸로! (Enter)"}
                </button>
              </>
            )}
            {state.phase === "reveal" && <p className="text-center text-xs font-bold text-white/70 light:text-slate-600">🥁 모두의 선택을 펼치는 중…</p>}
          </>
        ) : r ? (
          <ResultView r={r} name={name} viewerSeat={viewerSeat} />
        ) : null}
      </div>

      {/* players */}
      <div className={PANEL}>
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {rankings.map((row) => {
            const seat = row.seat;
            const locked = state.phase === "choose" && state.commits[seat] !== null;
            const d = r ? r.deltas[seat] : 0;
            return (
              <li key={seat} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${seat === viewerSeat ? "border-violet-400/60" : "border-white/10 light:border-slate-200"}`}>
                <b className="w-6 shrink-0 text-center text-[11px] text-white/50 light:text-slate-400">{row.rank === 1 ? "👑" : `${row.rank}`}</b>
                <span className="min-w-0 flex-1 truncate font-bold text-white light:text-slate-900">
                  {name(seat)}
                  {!connectedSeats.has(seat) && !botSeats.has(seat) && " 📡"}
                </span>
                {state.phase === "choose" && <span title={locked ? "정함" : "고르는 중"}>{locked ? "🔒" : "…"}</span>}
                {r && d !== 0 && <span className={`tabular-nums font-bold ${d > 0 ? "text-emerald-300 light:text-emerald-600" : "text-rose-300 light:text-rose-600"}`}>{signed(d)}</span>}
                <b className="w-8 text-right tabular-nums text-yellow-100 light:text-yellow-700">{row.score}</b>
              </li>
            );
          })}
        </ul>
      </div>

      {ended && (
        <div className={`${PANEL} flex flex-col gap-3 text-center`}>
          <h3 className="text-lg font-black text-white light:text-slate-900">🏁 모두의 선택이 끝났어요</h3>
          <ol className="flex flex-col gap-1 text-sm">
            {rankings.map((row) => (
              <li key={row.seat} className="flex items-center justify-center gap-2">
                <b className="w-8 text-right">{row.rank === 1 ? "👑" : `${row.rank}위`}</b>
                <span className="w-32 truncate text-left text-white light:text-slate-900">{name(row.seat)}</span>
                <span className="w-14 text-right text-xs text-white/50 light:text-slate-500">✔ {state.wins[row.seat]}번</span>
                <b className="w-12 text-right tabular-nums">{row.score}점</b>
              </li>
            ))}
          </ol>
          {title && (title.mainstream !== null || title.maverick !== null) && (
            <div className="flex flex-wrap justify-center gap-2 text-xs">
              {title.mainstream !== null && <span className="rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1 text-sky-100 light:text-sky-800">👥 대세 감별사 — {name(title.mainstream)}</span>}
              {title.maverick !== null && <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-amber-100 light:text-amber-800">🦄 마이웨이 — {name(title.maverick)}</span>}
            </div>
          )}
          <button className="rounded-xl bg-violet-700 px-4 py-3 text-sm font-black text-white hover:bg-violet-600" onClick={onGameEnd}>
            🏁 결과 저장하고 마치기
          </button>
        </div>
      )}

      {rules && <RulebookModal onClose={() => setRules(false)} />}
    </div>
  );
}

function ResultView({ r, name, viewerSeat }: { r: RoundReport; name: (s: Seat) => string; viewerSeat: Seat }) {
  const q = QUESTIONS[r.q];
  const answered = r.picks.filter((p) => p !== null).length;
  const max = Math.max(1, ...r.counts);
  const myD = viewerSeat >= 0 ? r.deltas[viewerSeat] : undefined;
  const myPick = viewerSeat >= 0 ? r.picks[viewerSeat] : null;
  const head = headline(r, name);
  const silent = r.picks.map((p, seat) => (p === null ? seat : -1)).filter((s) => s >= 0);
  return (
    <div key={r.round} className="flex flex-col gap-2" aria-live="polite">
      {head && <p className="ec-anim text-center text-sm font-black text-white light:text-slate-900" style={{ animation: "ec-pop .5s ease-out" }}>{head}</p>}
      {myPick !== null && myPick !== undefined && myD !== undefined && (
        <p className={`ec-anim text-center text-2xl font-black tabular-nums ${myD > 0 ? "text-emerald-300 light:text-emerald-600" : myD < 0 ? "text-rose-300 light:text-rose-600" : "text-white/60 light:text-slate-500"}`} style={{ animation: "ec-rise .9s ease-out both" }}>
          {myD > 0 ? `🎉 ${signed(myD)}점` : myD < 0 ? `😵 ${signed(myD)}점` : "😐 ±0"}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {q.opts.map((o, i) => {
          const win = r.winners.includes(i);
          const who = r.picks.map((p, seat) => (p === i ? seat : -1)).filter((s) => s >= 0);
          return (
            <li
              key={i}
              className={`ec-anim relative overflow-hidden rounded-xl border-2 px-3 py-2 ${win ? "border-yellow-300 light:border-yellow-500" : "border-white/10 light:border-slate-200"}`}
              style={win ? { animation: "ec-glow 1.6s ease-in-out 1s 2" } : undefined}
            >
              <span className="ec-anim absolute inset-y-0 left-0 origin-left opacity-25" style={{ width: `${(r.counts[i] / max) * 100}%`, background: OPT_COLORS[i], animation: `ec-grow .7s ease-out ${0.15 * i}s both` }} aria-hidden />
              <div className="relative flex items-center gap-2 text-sm">
                <OptMark i={i} />
                <b className="min-w-0 flex-1 break-keep text-white light:text-slate-900">
                  {o.label}
                  {win && " 👑"}
                </b>
                <b className="tabular-nums text-white/80 light:text-slate-700">
                  {r.counts[i]}명{answered > 0 && <span className="ml-1 text-[11px] font-normal text-white/50 light:text-slate-500">{Math.round((r.counts[i] / answered) * 100)}%</span>}
                </b>
              </div>
              {who.length > 0 && (
                <div className="relative mt-1.5 flex flex-wrap gap-1">
                  {who.map((seat, k) => (
                    <span
                      key={seat}
                      className={`ec-anim inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${seat === viewerSeat ? "bg-violet-500/40 text-white light:bg-violet-200 light:text-violet-900" : "bg-black/30 text-white/90 light:bg-slate-100 light:text-slate-700"}`}
                      style={{ animation: `ec-pop .35s ease-out ${0.5 + 0.15 * i + 0.06 * k}s both` }}
                    >
                      {r.loners.includes(seat) && "🐺"}
                      {name(seat)} <span aria-label={`칩 ${r.bets[seat]}개`}>{coins(r.bets[seat])}</span>
                      {r.deltas[seat] !== 0 && <span className={r.deltas[seat] > 0 ? "text-emerald-300 light:text-emerald-600" : "text-rose-300 light:text-rose-600"}>{signed(r.deltas[seat])}</span>}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {silent.length > 0 && <p className="text-center text-[11px] text-white/50 light:text-slate-500">🤐 답 없음: {silent.map(name).join(", ")}</p>}
    </div>
  );
}
