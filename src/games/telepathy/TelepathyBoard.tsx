"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CANCEL_LOCK_MS,
  FREE_CANCELS,
  HOLD_TO_PLAY_MS,
  pileTop,
  REACH_VISIBLE_MS,
  RESYNC_PER_LEVEL,
  type MindAction,
  type MindState,
  type Reveal,
} from "./engine";
import Timeline, { SEAT_COLORS } from "./Timeline";
import { telepathySound } from "./telepathySound";
import RulebookModal from "./RulebookModal";

/**
 * In-game screen for 텔레파시. Purely a view of the host's snapshot + intent
 * sender; every rule decision happens on the host (engine.ts).
 *
 * Times in the state are host clock — `hostOffset` (host − local) converts.
 */
export interface TelepathyBoardProps {
  state: MindState;
  mySeat: number;
  names: string[];
  botSeats: ReadonlySet<number>;
  hostOffset: number;
  onAction: (action: MindAction) => void;
}

/** Wall + monotonic clock sampled ~20×/s while `active`, so clocks and countdowns move. */
function useFrame(active: boolean) {
  const [frame, setFrame] = useState(() => ({ wall: Date.now(), perf: performance.now() }));
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setFrame({ wall: Date.now(), perf: performance.now() }), 50);
    return () => window.clearInterval(id);
  }, [active]);
  return frame;
}

function seatColor(seat: number) {
  return SEAT_COLORS[seat % SEAT_COLORS.length];
}

function RevealChips({ revealed, names, tone }: { revealed: Reveal[]; names: string[]; tone: "rose" | "amber" }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {revealed.map((r) => (
        <div
          key={`${r.seat}-${r.card}`}
          className={`flex flex-col items-center rounded-xl border px-3 py-1.5 tlp-flip ${
            tone === "rose" ? "border-rose-400/60 bg-rose-500/15" : "border-amber-300/60 bg-amber-400/10"
          }`}
        >
          <span className="text-xl font-black tabular-nums text-white light:text-slate-900">{r.card}</span>
          <span className="text-[10px]" style={{ color: seatColor(r.seat) }}>
            {names[r.seat]}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function TelepathyBoard({ state, mySeat, names, botSeats, hostOffset, onAction }: TelepathyBoardProps) {
  const timed = state.phase !== "won" && state.phase !== "lost";
  const frame = useFrame(timed);
  const hostNow = frame.wall + hostOffset;
  const sound = telepathySound();

  const [rulebook, setRulebook] = useState<null | "all" | "star">(null);
  const myHand = state.hands[mySeat] ?? [];
  const myLow = myHand[0];

  // ---------------------------------------------------------------- holding
  const [hold, setHold] = useState<{ start: number; card: number } | null>(null);
  const reachSentRef = useRef(false);
  const [sentCard, setSentCard] = useState<number | null>(null);
  const [cancelInfo, setCancelInfo] = useState<{ level: number; count: number; lockUntil: number }>({ level: state.level, count: 0, lockUntil: 0 });
  const cancels = cancelInfo.level === state.level ? cancelInfo : { level: state.level, count: 0, lockUntil: 0 };
  const locked = frame.wall < cancels.lockUntil;

  // The card actually leaves the hand on the host; until the snapshot shows it
  // gone we fade it locally so the press feels instant (§5-4 "보냄").
  if (sentCard !== null && myLow !== sentCard) setSentCard(null);
  const visibleHand = sentCard !== null ? myHand.slice(1) : myHand;
  const nextCard = visibleHand[0];

  const canPlay = state.phase === "playing" && nextCard !== undefined && sentCard === null && !locked;

  const startHold = useCallback(() => {
    if (!canPlay || hold !== null || nextCard === undefined) return;
    sound.unlock();
    reachSentRef.current = false;
    setHold({ start: performance.now(), card: nextCard });
  }, [canPlay, hold, nextCard, sound]);

  const endHold = useCallback(
    (countAsCancel: boolean) => {
      if (hold === null) return;
      setHold(null);
      if (reachSentRef.current) onAction({ type: "reach", seat: mySeat, on: false });
      reachSentRef.current = false;
      if (!countAsCancel) return;
      const count = cancels.count + 1;
      setCancelInfo({ level: state.level, count, lockUntil: count > FREE_CANCELS ? Date.now() + CANCEL_LOCK_MS : 0 });
    },
    [hold, onAction, mySeat, cancels.count, state.level],
  );

  // Drive the hold: reach glow after REACH_VISIBLE_MS, play at HOLD_TO_PLAY_MS.
  useEffect(() => {
    if (hold === null) return;
    let raf = 0;
    const step = () => {
      const elapsed = performance.now() - hold.start;
      if (!reachSentRef.current && elapsed >= REACH_VISIBLE_MS) {
        reachSentRef.current = true;
        onAction({ type: "reach", seat: mySeat, on: true });
      }
      if (elapsed >= HOLD_TO_PLAY_MS) {
        reachSentRef.current = false;
        setHold(null);
        setSentCard(hold.card);
        onAction({ type: "play", seat: mySeat, card: hold.card });
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      // The engine clears everyone's reach on any phase change, so a hold
      // dropped below needs no "reach off".
      reachSentRef.current = false;
    };
  }, [hold, onAction, mySeat]);

  // Phase left "playing" or the card vanished (mistake/⚡) mid-hold → drop it, no penalty.
  if (hold !== null && (state.phase !== "playing" || nextCard !== hold.card)) setHold(null);

  // Space bar = the big card, for keyboards.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
      startHold();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      endHold(true);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [startHold, endHold]);

  const holdProgress = hold === null ? 0 : Math.min(1, Math.max(0, frame.perf - hold.start) / HOLD_TO_PLAY_MS);

  // ------------------------------------------------------------------ sound
  const prevRef = useRef({ pile: state.pile.length, phase: state.phase, level: state.level, countdown: -1 });
  useEffect(() => {
    const prev = prevRef.current;
    if (state.pile.length > prev.pile && state.level === prev.level) sound.card(pileTop(state));
    if (state.phase !== prev.phase) {
      if (state.phase === "mistake") sound.mistake();
      else if (state.phase === "starReveal") sound.star();
      else if (state.phase === "starVote") sound.vote();
      else if (state.phase === "break") sound.clear();
      else if (state.phase === "won") sound.won();
      else if (state.phase === "lost") sound.lost();
    }
    prevRef.current = { ...prev, pile: state.pile.length, phase: state.phase, level: state.level };
  }, [state, sound]);

  const countdownLeft = state.phase === "sync" && state.phaseUntil !== null ? Math.max(0, state.phaseUntil - hostNow) : null;
  const countdownNumber = countdownLeft === null ? null : Math.ceil(countdownLeft / 1000);
  useEffect(() => {
    const prev = prevRef.current;
    if (countdownNumber === null) {
      prev.countdown = -1;
      return;
    }
    if (countdownNumber !== prev.countdown) {
      prev.countdown = countdownNumber;
      if (countdownNumber >= 1) sound.countdown(false);
    }
  }, [countdownNumber, sound]);
  const prevPhaseForGo = useRef(state.phase);
  useEffect(() => {
    if (prevPhaseForGo.current === "sync" && state.phase === "playing") sound.countdown(true);
    prevPhaseForGo.current = state.phase;
  }, [state.phase, sound]);

  // ------------------------------------------------------------- derived
  const flowRunning = state.phase === "playing" || state.phase === "starVote" || state.phase === "resume";
  const flowElapsed = flowRunning ? Math.max(0, (state.pausedAt ?? hostNow) - state.flowStartAt) : 0;
  const top = pileTop(state);
  const recent = state.pile.slice(-6, -1);
  const holdsCount = state.holds.filter(Boolean).length;
  const myHolding = state.holds[mySeat];
  const resyncLeft = RESYNC_PER_LEVEL - (state.resyncUsed[mySeat] ?? 0);
  const starCooldown = Math.max(0, state.starCooldownUntil - hostNow);
  const canStar = state.phase === "playing" && state.stars > 0 && starCooldown === 0;
  const vote = state.starVote;
  const myVote = vote?.yes[mySeat] ?? null;
  const breakLeft = state.phase === "break" && state.phaseUntil !== null ? Math.max(0, Math.ceil((state.phaseUntil - hostNow) / 1000)) : null;
  const levelLog = state.log[state.log.length - 1];

  const lastPlay = state.pile.length > 0 ? state.pile[state.pile.length - 1] : null;
  const playedBy = state.hands.map((_, seat) => state.pile.filter((p) => p.seat === seat).length);
  const levelTotal = state.level * state.playerCount;
  const levelOut = levelTotal - state.hands.reduce((n, h) => n + h.length, 0);
  const reachingOthers = state.phase === "playing" ? state.reaching.map((r, seat) => (r && seat !== mySeat ? seat : -1)).filter((seat) => seat >= 0) : [];
  const starDiscards = state.discards.filter((d) => d.reason === "star");
  const mistakeDiscards = state.discards.filter((d) => d.reason === "mistake");

  const ring = 2 * Math.PI * 54;
  const ringFrac = (flowElapsed % 10_000) / 10_000;

  return (
    <div className="flex flex-col gap-3">
      <style>{`
        @keyframes tlp-reach { 0%,100% { box-shadow: 0 0 0 2px rgba(250,204,21,.7), 0 0 18px 2px rgba(250,204,21,.35) } 50% { box-shadow: 0 0 0 5px rgba(250,204,21,.95), 0 0 42px 12px rgba(250,204,21,.55) } }
        .tlp-reach { animation: tlp-reach .7s ease-in-out infinite; }
        @keyframes tlp-hand { 0%,100% { transform: translateY(0) rotate(-8deg) scale(1) } 50% { transform: translateY(-7px) rotate(8deg) scale(1.15) } }
        .tlp-hand { animation: tlp-hand .55s ease-in-out infinite; display: inline-block; }
        @keyframes tlp-banner { 0%,100% { opacity: .85; transform: scale(1) } 50% { opacity: 1; transform: scale(1.06) } }
        .tlp-banner { animation: tlp-banner .7s ease-in-out infinite; }
        @keyframes tlp-shock { from { transform: scale(.55); opacity: .95 } to { transform: scale(2.6); opacity: 0 } }
        .tlp-shock { animation: tlp-shock .75s cubic-bezier(.15,.7,.3,1) both; }
        @keyframes tlp-spark { 0% { transform: translate(-50%,-50%) scale(1); opacity: 1 } 100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(.2); opacity: 0 } }
        .tlp-spark { animation: tlp-spark .8s cubic-bezier(.1,.8,.3,1) both; }
        @keyframes tlp-tag { 0% { transform: translate(-50%, 8px) scale(.8); opacity: 0 } 20% { transform: translate(-50%, 0) scale(1.05); opacity: 1 } 75% { opacity: 1 } 100% { transform: translate(-50%, -26px); opacity: 0 } }
        .tlp-tag { animation: tlp-tag 1.4s ease-out both; }
        @keyframes tlp-seatflash { from { opacity: 1 } to { opacity: 0 } }
        .tlp-seatflash { animation: tlp-seatflash 1s ease-out both; }
        @keyframes tlp-flip { from { transform: rotateY(90deg); opacity: 0 } to { transform: rotateY(0); opacity: 1 } }
        .tlp-flip { animation: tlp-flip .45s ease-out both; }
        @keyframes tlp-land { 0% { transform: translateY(-46px) rotate(-14deg) scale(1.45); opacity: 0 } 60% { transform: translateY(3px) rotate(2deg) scale(.96); opacity: 1 } 100% { transform: none } }
        .tlp-land { animation: tlp-land .42s cubic-bezier(.2,.9,.3,1.2) both; }
        @keyframes tlp-shake { 0%,100% { transform: none } 20% { transform: translateX(-6px) } 40% { transform: translateX(6px) } 60% { transform: translateX(-4px) } 80% { transform: translateX(3px) } }
        .tlp-shake { animation: tlp-shake .5s ease-out; }
        @keyframes tlp-pop { 0% { transform: scale(.4); opacity: 0 } 60% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1) } }
        .tlp-pop { animation: tlp-pop .5s ease-out both; }
        @media (prefers-reduced-motion: reduce) { .tlp-reach,.tlp-flip,.tlp-land,.tlp-shake,.tlp-pop,.tlp-hand,.tlp-banner,.tlp-shock,.tlp-spark,.tlp-tag,.tlp-seatflash { animation: none } .tlp-spark,.tlp-shock,.tlp-tag,.tlp-seatflash { display: none } }
      `}</style>

      {/* Status strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-indigo-400/20 bg-indigo-950/40 px-4 py-2.5 light:border-indigo-200 light:bg-indigo-50">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-indigo-200/70 light:text-indigo-500">레벨</span>
          <span className="text-xl font-black text-white light:text-slate-900">
            {state.level}
            <span className="text-sm font-semibold text-white/40 light:text-slate-400"> / {state.maxLevel}</span>
          </span>
          {state.practice && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold text-emerald-200 light:text-emerald-700">연습</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span
            className={`flex items-center gap-1 rounded-full border border-rose-300/30 bg-rose-500/10 px-2 py-1 font-semibold text-rose-100 light:border-rose-200 light:bg-rose-50 light:text-rose-700 ${state.phase === "mistake" ? "tlp-shake" : ""}`}
            title="하트: 실수할 때마다 1개씩 깨져요. 0개가 되면 패배"
          >
            {state.lives > 0 || state.practice ? "❤️" : "💔"} 하트 {state.practice ? "∞" : state.lives}
          </span>
          <button
            type="button"
            onClick={() => setRulebook("star")}
            className="flex items-center gap-1 rounded-full border border-amber-300/50 bg-amber-400/15 px-2 py-1 font-semibold text-amber-100 transition hover:bg-amber-400/25 light:border-amber-300 light:bg-amber-50 light:text-amber-800"
            title="번뜩임: 모두가 가장 낮은 카드 1장씩 공개하고 버리는 팀 공용 능력 (눌러서 설명 보기)"
          >
            ⚡ 번뜩임 {state.practice ? "∞" : state.stars} <span className="text-[10px] opacity-70">ⓘ</span>
          </button>
          <button
            type="button"
            onClick={() => setRulebook("all")}
            className="rounded-full border border-white/20 px-2 py-1 font-semibold text-white/80 transition hover:bg-white/10 light:border-slate-300 light:text-slate-700"
          >
            📖 룰북
          </button>
        </div>
      </div>

      {/* Seats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {state.hands.map((hand, seat) => {
          const reaching = state.reaching[seat] && state.phase === "playing";
          const away = state.away[seat];
          return (
            <div
              key={seat}
              className={`relative flex items-center gap-2 rounded-xl border px-2.5 py-2 transition duration-200 ${
                reaching ? "tlp-reach z-10 scale-[1.04] border-yellow-300 bg-yellow-400/15 light:bg-yellow-50" : seat === mySeat ? "border-white/10 bg-white/[0.07] light:border-slate-200 light:bg-indigo-50" : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white"
              }`}
            >
              {reaching && <span className="tlp-hand pointer-events-none absolute -left-2 -top-4 text-3xl drop-shadow-[0_0_8px_rgba(250,204,21,0.9)]">✋</span>}
              {lastPlay?.seat === seat && state.phase === "playing" && (
                <span key={`flash-${state.pile.length}`} className="tlp-seatflash pointer-events-none absolute inset-0 rounded-xl" style={{ boxShadow: `inset 0 0 0 2px ${seatColor(seat)}, 0 0 24px ${seatColor(seat)}` }} />
              )}
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seatColor(seat) }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-white light:text-slate-800">
                  {names[seat]}
                  {seat === mySeat && <span className="ml-1 text-indigo-300 light:text-indigo-500">(나)</span>}
                  {botSeats.has(seat) && !names[seat]?.startsWith("🤖") && <span className="ml-1">🤖</span>}
                </p>
                <p className="text-[11px] text-white/50 light:text-slate-500">
                  {away ? (
                    <span className="text-amber-300 light:text-amber-600">📡 연결 대기 중</span>
                  ) : state.phase === "sync" ? (
                    state.holds[seat] ? <span className="text-emerald-300 light:text-emerald-600">🖐 준비</span> : "…"
                  ) : state.phase === "break" ? (
                    state.readies[seat] ? <span className="text-emerald-300 light:text-emerald-600">✓ 준비</span> : "쉬는 중"
                  ) : reaching ? (
                    <span className="text-xs font-black text-yellow-300 light:text-amber-600">✋ 내려는 중!</span>
                  ) : (
                    <>낸 카드 {playedBy[seat]}장</>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-center leading-none" aria-label={`남은 카드 ${hand.length}장`}>
                <span className="relative flex h-9 w-7 items-center justify-center rounded-md border border-indigo-200/50 bg-gradient-to-br from-indigo-500 to-violet-700 shadow-md">
                  {hand.length > 1 && <span className="absolute -right-1 -top-1 -z-10 h-9 w-7 rounded-md border border-indigo-200/30 bg-violet-800" />}
                  <span className={`text-lg font-black tabular-nums ${hand.length === 0 ? "text-white/40" : "text-white"}`}>{hand.length}</span>
                </span>
                <span className="mt-0.5 text-[9px] text-white/50 light:text-slate-500">남음</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Center stage */}
      <div className="relative flex min-h-[18rem] flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl border border-indigo-400/20 bg-[radial-gradient(circle_at_50%_40%,rgba(99,102,241,0.25),rgba(15,23,42,0.6)_70%)] p-4 light:border-indigo-200 light:bg-[radial-gradient(circle_at_50%_40%,rgba(199,210,254,0.9),rgba(248,250,252,1)_70%)]">
        {state.phase === "sync" && (
          <div className="flex flex-col items-center gap-3 text-center">
            {countdownNumber !== null && countdownNumber > 0 ? (
              <span key={countdownNumber} className="tlp-pop text-7xl font-black text-white light:text-indigo-700">
                {countdownNumber}
              </span>
            ) : (
              <>
                <p className="text-sm font-semibold text-indigo-100 light:text-indigo-700">
                  {state.level > 0 && state.pile.length === 0 && state.levelStartedAt === null ? `레벨 ${state.level} — 1인당 ${state.level}장` : "다시 마음을 맞춰요"}
                </p>
                <p className="max-w-xs text-xs text-white/60 light:text-slate-500">모두가 🖐를 켜면 3초 뒤 시작해요. 숫자는 말하지 않기!</p>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                sound.unlock();
                onAction({ type: "hold", seat: mySeat, on: !myHolding });
              }}
              disabled={state.away[mySeat]}
              className={`flex h-24 w-24 flex-col items-center justify-center rounded-full border-2 text-3xl transition ${
                myHolding
                  ? "border-emerald-300 bg-emerald-500/30 shadow-[0_0_30px_rgba(52,211,153,0.5)]"
                  : "border-white/30 bg-white/10 hover:border-white/60 light:border-indigo-300 light:bg-white"
              }`}
            >
              🖐
              <span className="text-[11px] font-semibold text-white/80 light:text-slate-700">{myHolding ? "준비 완료" : "준비"}</span>
            </button>
            <p className="text-xs text-white/50 light:text-slate-500">
              {holdsCount} / {state.playerCount}명 준비
            </p>
          </div>
        )}

        {(state.phase === "playing" || state.phase === "starVote" || state.phase === "resume") && (
          <>
            <div className="flex w-full items-center justify-between gap-2 text-[11px] text-white/60 light:text-slate-500">
              <span>
                이번 레벨 <b className="tabular-nums text-white light:text-slate-900">{levelOut}</b> / {levelTotal}장 나옴
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
                <span className="block h-full rounded-full bg-gradient-to-r from-indigo-400 to-fuchsia-400 transition-all duration-500" style={{ width: `${levelTotal > 0 ? (levelOut / levelTotal) * 100 : 0}%` }} />
              </span>
            </div>
            <div className="flex min-h-9 flex-wrap items-center justify-center gap-1.5">
              {reachingOthers.map((seat) => (
                <span key={seat} className="tlp-banner flex items-center gap-1 rounded-full border-2 border-yellow-300 bg-yellow-400/25 px-3 py-1 text-sm font-black text-yellow-100 shadow-[0_0_24px_rgba(250,204,21,0.55)] light:bg-yellow-100 light:text-amber-800">
                  <span className="tlp-hand">✋</span> {names[seat]} 내려는 중!
                </span>
              ))}
            </div>
            <div className="relative flex h-40 w-40 items-center justify-center">
              {lastPlay && state.phase === "playing" && (
                <div key={`burst-${state.pile.length}`} className="pointer-events-none absolute inset-0" aria-hidden>
                  <span className="tlp-shock absolute inset-6 rounded-full border-4" style={{ borderColor: seatColor(lastPlay.seat) }} />
                  <span className="tlp-shock absolute inset-10 rounded-full border-2 border-white" style={{ animationDelay: "0.12s" }} />
                  {Array.from({ length: 14 }, (_, i) => {
                    const a = (i / 14) * Math.PI * 2 + (state.pile.length % 3) * 0.4;
                    const d = 70 + (i % 3) * 18;
                    return (
                      <span
                        key={i}
                        className="tlp-spark absolute left-1/2 top-1/2 h-2 w-2 rounded-full"
                        style={{ background: i % 2 ? "#fde68a" : seatColor(lastPlay.seat), boxShadow: `0 0 8px ${seatColor(lastPlay.seat)}`, ["--dx" as string]: `${Math.cos(a) * d}px`, ["--dy" as string]: `${Math.sin(a) * d}px` }}
                      />
                    );
                  })}
                  <span className="tlp-tag absolute left-1/2 -bottom-2 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-black text-slate-900 shadow-lg" style={{ background: seatColor(lastPlay.seat) }}>
                    {names[lastPlay.seat]} ▶ {lastPlay.card}
                  </span>
                </div>
              )}
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 120 120" aria-hidden>
                <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="5" className="text-white/10 light:text-indigo-100" />
                <circle
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={ring}
                  strokeDashoffset={ring * (1 - ringFrac)}
                  className="text-indigo-300 light:text-indigo-500"
                />
              </svg>
              <div
                key={`pile-${state.pile.length}`}
                className="tlp-land relative flex h-24 w-[4.5rem] flex-col items-center justify-center rounded-xl border-2 border-white/80 bg-gradient-to-br from-slate-50 to-indigo-100 shadow-xl"
                style={lastPlay ? { boxShadow: `0 0 28px ${seatColor(lastPlay.seat)}, 0 10px 25px rgba(0,0,0,.4)` } : undefined}
              >
                {top > 0 ? (
                  <>
                    <span className="text-3xl font-black tabular-nums text-indigo-900">{top}</span>
                    <span className="text-[9px]" style={{ color: seatColor(state.pile[state.pile.length - 1].seat) }}>
                      {names[state.pile[state.pile.length - 1].seat]}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-indigo-400">비어 있음</span>
                )}
              </div>
            </div>
            <p className="text-sm font-semibold tabular-nums text-indigo-100 light:text-indigo-700">
              ⏱ {(flowElapsed / 1000).toFixed(1)}초{state.pausedAt !== null && <span className="ml-1 text-xs text-amber-300 light:text-amber-600">(멈춤)</span>}
            </p>
            {recent.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-white/50 light:text-slate-500">
                이전:
                {recent.map((p, i) => (
                  <span key={i} className="rounded border px-1.5 tabular-nums" style={{ borderColor: seatColor(p.seat) }} title={names[p.seat]}>
                    {p.card}
                  </span>
                ))}
              </div>
            )}
            {state.phase === "resume" && <p className="text-xs text-amber-200 light:text-amber-700">⚡ 취소 — 곧 이어서 진행해요</p>}
          </>
        )}

        {state.phase === "mistake" && state.lastMistake && (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="tlp-pop text-5xl">💔</span>
            <p className="text-sm font-bold text-rose-200 light:text-rose-700">
              {state.lastMistake.trigger.card}이(가) 놓였는데 더 낮은 카드가 남아 있었어요
            </p>
            <RevealChips revealed={state.lastMistake.revealed} names={names} tone="rose" />
            <p className="text-xs text-white/50 light:text-slate-500">{state.practice ? "연습 모드라 하트는 그대로예요" : `하트 −1 · 남은 하트 ${state.lives}개`}</p>
          </div>
        )}

        {state.phase === "starReveal" && state.lastStar && (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="tlp-pop text-5xl">⚡</span>
            <p className="text-sm font-bold text-amber-200 light:text-amber-700">번뜩임! 모두 가장 낮은 카드를 공개했어요</p>
            <RevealChips revealed={state.lastStar.revealed} names={names} tone="amber" />
            <p className="max-w-xs text-xs text-white/60 light:text-slate-500">이 카드들은 버려졌어요 (하트는 그대로). 공개된 숫자로 서로 남은 카드가 어느 쯤인지 짐작해 보세요.</p>
          </div>
        )}

        {state.phase === "break" && (
          <div className="flex w-full flex-col items-center gap-3 text-center">
            <span className="tlp-pop text-4xl">✨</span>
            <p className="text-lg font-black text-white light:text-slate-900">레벨 {state.level} 통과!</p>
            {levelLog && levelLog.mistakes === 0 && <p className="text-xs font-semibold text-emerald-300 light:text-emerald-600">실수 없이 통과 +50점</p>}
            {state.lastReward && (
              <p className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white light:bg-indigo-100 light:text-indigo-800">
                보상: {state.lastReward.kind === "life" ? "❤️ 하트 +1" : "⚡ 번뜩임 +1 (막혔을 때 모두 가장 낮은 카드 1장씩 공개)"}
                {!state.lastReward.granted && " (이미 최대라 사라짐)"}
              </p>
            )}
            {levelLog && <Timeline log={levelLog} names={names} />}
            <button
              type="button"
              onClick={() => onAction({ type: "ready", seat: mySeat })}
              disabled={state.readies[mySeat]}
              className="rounded-full bg-indigo-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-50"
            >
              {state.readies[mySeat] ? "다른 사람 기다리는 중…" : `다음 레벨 준비 (${state.level + 1}레벨 · ${state.level + 1}장)`}
            </button>
            {breakLeft !== null && <p className="text-[11px] text-white/40 light:text-slate-400">{breakLeft}초 뒤 자동으로 시작</p>}
          </div>
        )}

        {/* ⚡ vote overlay */}
        {state.phase === "starVote" && vote && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm light:bg-white/80">
            <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border border-amber-300/40 bg-slate-900 p-4 text-center light:border-amber-300 light:bg-white">
              <p className="text-sm font-bold text-amber-200 light:text-amber-700">⚡ {names[vote.proposer]}님이 번뜩임을 제안했어요</p>
              <div className="w-full rounded-lg bg-amber-400/10 px-3 py-2 text-left text-xs leading-relaxed text-white/80 light:bg-amber-50 light:text-slate-700">
                전원 찬성하면 <b>모두 가장 낮은 카드 1장씩</b> 공개하고 버려요. 실수가 아니라서 <b>하트는 안 잃고</b>, ⚡ 1개를 써요.
                {myHand[0] !== undefined && (
                  <span className="mt-1 block">
                    내 카드 <b className="tabular-nums text-amber-200 light:text-amber-700">{myHand[0]}</b>가 버려져요.
                  </span>
                )}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
                <div className="h-full bg-amber-300" style={{ width: `${Math.max(0, Math.min(100, ((vote.deadline - hostNow) / 8000) * 100))}%` }} />
              </div>
              <div className="flex w-full flex-col gap-0.5 text-left text-[11px]">
                {vote.yes.map((v, seat) => (
                  <span key={seat} className="flex items-center justify-between gap-2 text-white/70 light:text-slate-600">
                    <span className="truncate">{names[seat]}</span>
                    <span className={v === true ? "shrink-0 text-emerald-300 light:text-emerald-600" : "shrink-0 text-white/40 light:text-slate-400"}>{v === true ? "✅ 찬성" : "⏳ 고민 중"}</span>
                  </span>
                ))}
              </div>
              {myVote === null ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => onAction({ type: "starVote", seat: mySeat, yes: false })} className="rounded-full border border-white/20 px-4 py-1.5 text-sm text-white/80 light:border-slate-300 light:text-slate-700">
                    반대
                  </button>
                  <button type="button" onClick={() => onAction({ type: "starVote", seat: mySeat, yes: true })} className="rounded-full bg-amber-400 px-4 py-1.5 text-sm font-semibold text-slate-900">
                    찬성
                  </button>
                </div>
              ) : (
                <p className="text-xs text-white/60 light:text-slate-500">다른 사람 기다리는 중…</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Cards that left hands without reaching the pile (this level) */}
      {(starDiscards.length > 0 || mistakeDiscards.length > 0) && state.phase !== "break" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {starDiscards.length > 0 && (
            <div className="rounded-xl border-2 border-dashed border-amber-300/60 bg-amber-400/[0.08] p-2.5 light:border-amber-300 light:bg-amber-50">
              <p className="mb-1.5 text-xs font-bold text-amber-200 light:text-amber-800">⚡ 번뜩임으로 나온 카드 ({starDiscards.length}장)</p>
              <div className="flex flex-wrap gap-1.5">
                {[...starDiscards]
                  .sort((a, b) => a.card - b.card)
                  .map((d) => (
                    <span key={`s-${d.card}`} className="flex flex-col items-center rounded-lg border border-amber-300/50 bg-black/20 px-2 py-1 light:bg-white">
                      <span className="text-base font-black tabular-nums text-white light:text-slate-900">{d.card}</span>
                      <span className="max-w-[5rem] truncate text-[9px]" style={{ color: seatColor(d.seat) }}>
                        {names[d.seat]}
                      </span>
                    </span>
                  ))}
              </div>
            </div>
          )}
          {mistakeDiscards.length > 0 && (
            <div className="rounded-xl border border-rose-300/40 bg-rose-500/[0.08] p-2.5 light:border-rose-200 light:bg-rose-50">
              <p className="mb-1.5 text-xs font-bold text-rose-200 light:text-rose-700">💔 실수로 버려진 카드 ({mistakeDiscards.length}장)</p>
              <div className="flex flex-wrap gap-1.5">
                {[...mistakeDiscards]
                  .sort((a, b) => a.card - b.card)
                  .map((d) => (
                    <span key={`m-${d.card}`} className="flex flex-col items-center rounded-lg border border-rose-300/40 bg-black/20 px-2 py-1 light:bg-white">
                      <span className="text-base font-black tabular-nums text-white/80 light:text-slate-700">{d.card}</span>
                      <span className="max-w-[5rem] truncate text-[9px]" style={{ color: seatColor(d.seat) }}>
                        {names[d.seat]}
                      </span>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* My hand */}
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 light:border-slate-200 light:bg-white">
        <div className="flex flex-wrap justify-center gap-1.5">
          {visibleHand.length === 0 ? (
            <p className="text-xs text-white/50 light:text-slate-500">{sentCard !== null ? "보내는 중…" : "손에 카드가 없어요 — 다른 사람을 기다려요"}</p>
          ) : (
            visibleHand.map((c, i) => (
              <span
                key={c}
                className={`rounded-md border px-2 py-0.5 text-sm font-bold tabular-nums ${
                  i === 0 ? "border-indigo-300 bg-indigo-500/20 text-white light:text-indigo-800" : "border-white/15 text-white/60 light:border-slate-300 light:text-slate-500"
                }`}
              >
                {c}
              </span>
            ))
          )}
        </div>

        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            startHold();
          }}
          onPointerUp={() => endHold(true)}
          onPointerCancel={() => endHold(false)}
          onContextMenu={(e) => e.preventDefault()}
          disabled={!canPlay && hold === null}
          aria-label={nextCard !== undefined ? `${nextCard} 카드를 꾹 눌러서 내기` : "낼 카드 없음"}
          className="relative flex h-36 w-28 touch-none select-none flex-col items-center justify-center rounded-2xl border-2 border-white/80 bg-gradient-to-br from-slate-50 to-indigo-100 shadow-2xl transition active:scale-95 disabled:opacity-40"
          style={{ WebkitTouchCallout: "none" }}
        >
          {holdProgress > 0 && (
            <span
              className="pointer-events-none absolute -inset-1.5 rounded-[1.1rem]"
              style={{ background: `conic-gradient(#facc15 ${holdProgress * 360}deg, transparent 0)`, mask: "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 0)", WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 0)" }}
            />
          )}
          <span className="text-4xl font-black tabular-nums text-indigo-900">{nextCard ?? "—"}</span>
          <span className="mt-1 text-[10px] font-semibold text-indigo-500">{locked ? "잠깐! 곧 다시" : "꾹 눌러서 내기"}</span>
        </button>
        <p className="text-[11px] text-white/40 light:text-slate-400">
          0.6초 누르면 나가요 · 누르는 동안 다른 사람에게 ✋가 보여요 · 스페이스바도 돼요
          {cancels.count > 0 && ` · 취소 ${Math.min(cancels.count, FREE_CANCELS)}/${FREE_CANCELS}`}
        </p>

        <div className="flex w-full max-w-md flex-col gap-2 rounded-xl border-2 border-amber-300/40 bg-amber-400/[0.08] p-3 text-left light:border-amber-300 light:bg-amber-50">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-amber-200 light:text-amber-800">
              ⚡ 번뜩임 <span className="tabular-nums">{state.practice ? "∞" : `${state.stars}개`}</span>
            </p>
            <button type="button" onClick={() => setRulebook("star")} className="text-[11px] font-semibold text-amber-200/80 underline-offset-2 hover:underline light:text-amber-700">
              ⓘ 자세히
            </button>
          </div>
          <p className="text-xs leading-relaxed text-white/80 light:text-slate-700">
            막혔을 때 쓰는 <b>팀 능력</b>: <b>모두가 가장 낮은 카드 1장씩</b> 공개하고 버려요. <b className="text-emerald-300 light:text-emerald-700">실수 아님 · 하트 안 잃음</b> · 전원 찬성해야 발동
          </p>
          {nextCard !== undefined && (
            <p className="flex flex-wrap items-center gap-1 text-[11px] text-white/60 light:text-slate-500">
              지금 쓰면 내 카드
              <span className="rounded border border-dashed border-amber-300/70 px-1.5 font-bold tabular-nums text-amber-100 light:text-amber-800">{nextCard}</span>
              가 공개되고 버려져요
            </p>
          )}
          <button
            type="button"
            onClick={() => onAction({ type: "starPropose", seat: mySeat })}
            disabled={!canStar}
            className="rounded-lg bg-amber-400 py-2 text-sm font-bold text-slate-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-amber-400/25 disabled:text-white/50 light:disabled:text-slate-500"
          >
            {canStar
              ? "⚡ 번뜩임 쓰기 (모두에게 투표 요청)"
              : state.stars <= 0
                ? "⚡ 번뜩임이 없어요"
                : starCooldown > 0 && state.phase === "playing"
                  ? `⚡ ${Math.ceil(starCooldown / 1000)}초 뒤 다시 제안 가능`
                  : "⚡ 카드를 내는 중에만 쓸 수 있어요"}
          </button>
          {state.stars <= 0 && !state.practice && <p className="text-[11px] text-white/50 light:text-slate-500">2·5·8레벨을 통과하면 1개씩 받아요</p>}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => onAction({ type: "resync", seat: mySeat })}
            disabled={state.phase !== "playing" || resyncLeft <= 0}
            className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-40 light:border-slate-300 light:text-slate-600"
          >
            🖐 다시 맞추기 ({resyncLeft})
          </button>
        </div>
      </div>
      {rulebook && <RulebookModal focus={rulebook === "star" ? "star" : undefined} onClose={() => setRulebook(null)} />}
    </div>
  );
}
