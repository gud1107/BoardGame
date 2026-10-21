"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CharacterCardFace } from "./CardArt";
import { ACTION_NAMES, blockCharactersFor, CHARACTER_NAMES, type Card, type CoupState, type EngineAction, type SeatIndex } from "./engine";

/**
 * The 의심(Challenge)/방어(Counter) response window, docked to the bottom of
 * the screen instead of a centered popup — the old modal covered the board
 * and, worse, hid the viewer's own cards and coins at exactly the moment
 * they're needed to judge a bluff. No backdrop, so the table above stays
 * visible; the dock itself repeats "내 카드 · 코인" next to the choices.
 *
 * One component covers all 3 response windows (actionChallengeWindow/
 * blockWindow/blockChallengeWindow) since they share the same shape: dispute
 * a claim, or do nothing.
 *
 * The countdown is a client-local UX affordance, not a rulebook mechanic —
 * the rulebook has no wall-clock timer, and "패스"/"막지 않기" is always a
 * fully legal choice at any point, so auto-firing it on timeout never
 * invents state the rules don't already allow. Same "자기 좌석 몫만 보낸다"
 * trust model as every other timer in this project (malDalliJa's turn
 * timer): each client only ever auto-submits *its own* seat's response.
 */

const RESPONSE_SECONDS = 10;

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/**
 * Owns the actual countdown. Keyed by `windowKey` from the parent, so a
 * freshly-opened window gets a clean `useState(RESPONSE_SECONDS)` for free
 * via React's normal remount-resets-state behavior — no imperative "reset
 * the counter" call inside an effect (which `react-hooks/set-state-in-effect`
 * correctly flags as a smell).
 */
function ResponseTimer({ onTimeout }: { onTimeout: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(RESPONSE_SECONDS);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          onTimeout();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onTimeout is recreated every render but always calls the same "pass my own seat" action; re-subscribing wouldn't change behavior, only reset the interval's phase.
  }, []);

  const pct = (secondsLeft / RESPONSE_SECONDS) * 100;
  const urgent = secondsLeft <= 3;
  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex h-8 min-w-8 items-center justify-center rounded-full border px-1.5 text-sm font-black tabular-nums ${
          urgent
            ? "border-rose-400/70 bg-rose-500/20 text-rose-200 light:border-rose-400 light:bg-rose-50 light:text-rose-600"
            : "border-amber-300/50 bg-amber-400/10 text-amber-100 light:border-amber-400 light:bg-amber-50 light:text-amber-700"
        }`}
        style={{ animation: urgent ? "coup-response-warn 0.6s ease-in-out infinite" : undefined }}
        aria-label={`남은 시간 ${secondsLeft}초`}
      >
        {secondsLeft}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
        <div
          className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${urgent ? "bg-rose-400" : "bg-amber-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function ResponseDock({
  state,
  viewerSeat,
  names,
  myCards,
  myRevealed,
  myCoins,
  onAction,
}: {
  state: CoupState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  myCards: Card[];
  myRevealed: Card[];
  myCoins: number;
  onAction: (action: EngineAction) => void;
}) {
  function sendPass() {
    onAction({ type: "pass", seat: viewerSeat, seed: randomSeed() });
  }

  // A genuinely new window always changes phase or turn, so this forces a
  // remount (fresh countdown) exactly then — see `ResponseTimer`'s doc.
  const windowKey = `${state.turnNumber}-${state.phase}`;

  let title: string;
  let message: ReactNode;
  let hint: string;
  let choices: ReactNode;

  const passButton = (label: string) => (
    <button
      onClick={sendPass}
      className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30 light:border-slate-200 light:text-slate-600"
    >
      {label}
    </button>
  );
  const challengeButton = (
    <button
      onClick={() => onAction({ type: "challenge", seat: viewerSeat })}
      className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white hover:bg-rose-500"
    >
      🕵️ 의심!
    </button>
  );

  if (state.phase === "actionChallengeWindow" && state.pendingAction) {
    const pending = state.pendingAction;
    title = "🕵️ 의심(Challenge)";
    message = (
      <>
        <b>{names[pending.actorSeat] ?? "상대"}</b>님이 <b>{CHARACTER_NAMES[pending.claimedCharacter!]}</b>({ACTION_NAMES[pending.action]}) 능력을 선언했습니다.
      </>
    );
    hint = "거짓말이라고 생각되면 의심! 틀리면 내 카드 1장을 잃습니다.";
    choices = (
      <>
        {passButton("패스")}
        {challengeButton}
      </>
    );
  } else if (state.phase === "blockWindow" && state.pendingAction) {
    const pending = state.pendingAction;
    title = "🛡️ 방어(Counter)";
    message = (
      <>
        <b>{names[pending.actorSeat] ?? "상대"}</b>님이 <b>{ACTION_NAMES[pending.action]}</b>을 시도했습니다.
      </>
    );
    hint = "막을 캐릭터를 주장하거나, 그냥 넘기세요.";
    choices = (
      <>
        {blockCharactersFor(pending.action).map((character) => (
          <button
            key={character}
            onClick={() => onAction({ type: "declareBlock", seat: viewerSeat, character })}
            className="flex-1 rounded-xl border border-emerald-300/40 px-3 py-2.5 text-sm font-medium whitespace-nowrap text-emerald-100 hover:bg-emerald-400/10 light:bg-emerald-50 light:text-emerald-700"
          >
            🛡️ {CHARACTER_NAMES[character]}로 방어
          </button>
        ))}
        {passButton("막지 않기")}
      </>
    );
  } else if (state.phase === "blockChallengeWindow" && state.pendingBlock) {
    const block = state.pendingBlock;
    title = "🕵️ 방어 의심";
    message = (
      <>
        <b>{names[block.blockerSeat] ?? "상대"}</b>님이 <b>{CHARACTER_NAMES[block.claimedCharacter]}</b>(으)로 방어를 선언했습니다.
      </>
    );
    hint = "거짓말이라고 생각되면 의심! 틀리면 내 카드 1장을 잃습니다.";
    choices = (
      <>
        {passButton("패스")}
        {challengeButton}
      </>
    );
  } else {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[45] flex justify-center px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex w-full max-w-2xl flex-col gap-2 rounded-2xl border border-amber-300/40 bg-[#1c1206]/95 p-3 text-sm text-white/80 shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.9)] backdrop-blur-md light:border-amber-300 light:bg-white/95 light:text-slate-700">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-amber-100 light:text-amber-800">{title}</span>
          <div className="w-1/2 max-w-56">
            <ResponseTimer key={windowKey} onTimeout={sendPass} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* 내 카드 · 코인 — 블러핑 판단에 바로 필요한 정보 */}
          <div className="flex shrink-0 flex-col items-center gap-1">
            <div className="flex gap-1">
              {myCards.map((c) => (
                <CharacterCardFace key={c.id} card={c} size="sm" />
              ))}
              {myRevealed.map((c) => (
                <CharacterCardFace key={c.id} card={c} size="sm" dead />
              ))}
            </div>
            <span className="text-[11px] font-bold text-amber-200 light:text-amber-700">🪙 {myCoins}코인</span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="leading-snug">{message}</p>
            <p className="text-[11px] text-white/50 light:text-slate-500">{hint}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">{choices}</div>
      </div>
    </div>
  );
}
