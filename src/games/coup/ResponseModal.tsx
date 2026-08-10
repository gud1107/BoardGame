"use client";

import { useEffect, useState } from "react";
import Overlay from "@/components/Overlay";
import { ACTION_NAMES, blockCharactersFor, CHARACTER_NAMES, type CoupState, type EngineAction, type SeatIndex } from "./engine";

/**
 * The task brief's "다른 플레이어들이 '의심' 또는 '방어'를 선택할 수 있는 팝업
 * 모달과 제한시간(타이머) 게이지" — the only decision-driving popup besides
 * `TargetModal`/`ExchangeModal`/`LoseInfluenceModal`. One component covers
 * all 3 response windows (actionChallengeWindow/blockWindow/
 * blockChallengeWindow) since they share the same shape: dispute a claim, or
 * do nothing.
 *
 * The countdown is a client-local UX affordance, not a rulebook mechanic —
 * the rulebook has no wall-clock timer, and "패스"/"막지 않기" is always a
 * fully legal choice at any point, so auto-firing it on timeout never
 * invents state the rules don't already allow. Same "자기 좌석 몫만 보낸다"
 * trust model as every other timer in this project (malDalliJa's turn
 * timer): each client only ever auto-submits *its own* seat's response.
 */

const RESPONSE_SECONDS = 15;

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/**
 * Owns the actual countdown. Kept as its own component, keyed by
 * `windowKey` from the parent, so a freshly-opened window gets a clean
 * `useState(RESPONSE_SECONDS)` for free via React's normal remount-resets-
 * state behavior — no imperative "reset the counter" call inside an effect
 * (which `react-hooks/set-state-in-effect` correctly flags as a smell).
 */
function ResponseGauge({ onTimeout }: { onTimeout: () => void }) {
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
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-amber-400 transition-[width] duration-1000 ease-linear"
        style={{ width: `${pct}%`, animation: pct <= 30 ? "coup-response-warn 0.6s ease-in-out infinite" : undefined }}
      />
    </div>
  );
}

export default function ResponseModal({
  state,
  viewerSeat,
  names,
  onAction,
}: {
  state: CoupState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  onAction: (action: EngineAction) => void;
}) {
  function sendPass() {
    onAction({ type: "pass", seat: viewerSeat, seed: randomSeed() });
  }

  // Identifies "which window this is" well enough to force a remount (and
  // therefore a fresh countdown) exactly when a genuinely new window opens —
  // see `ResponseGauge`'s doc. `state.phase` alone is enough: this modal is
  // only ever mounted while `viewerSeat` is an eligible responder, and every
  // real window-to-window transition changes `phase` (actionChallengeWindow
  // → blockWindow → blockChallengeWindow never repeats the same phase twice
  // in a row without the modal unmounting in between).
  const windowKey = state.phase;
  const gauge = <ResponseGauge key={windowKey} onTimeout={sendPass} />;

  if (state.phase === "actionChallengeWindow" && state.pendingAction) {
    const pending = state.pendingAction;
    return (
      <Overlay title="🕵️ 의심(Challenge)" onClose={sendPass}>
        <div className="flex flex-col gap-4 text-sm text-white/80">
          {gauge}
          <p>
            <b>{names[pending.actorSeat] ?? "상대"}</b>님이 <b>{CHARACTER_NAMES[pending.claimedCharacter!]}</b>({ACTION_NAMES[pending.action]}) 능력을
            선언했습니다.
          </p>
          <p className="text-xs text-white/50">거짓말이라고 생각되면 의심을 외치세요. 의심이 틀리면 내 카드 1장을 잃습니다.</p>
          <div className="flex gap-2">
            <button onClick={sendPass} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30">
              패스
            </button>
            <button
              onClick={() => onAction({ type: "challenge", seat: viewerSeat })}
              className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white hover:bg-rose-500"
            >
              🕵️ 의심!
            </button>
          </div>
        </div>
      </Overlay>
    );
  }

  if (state.phase === "blockWindow" && state.pendingAction) {
    const pending = state.pendingAction;
    const options = blockCharactersFor(pending.action);
    return (
      <Overlay title="🛡️ 방어(Counter)" onClose={sendPass}>
        <div className="flex flex-col gap-4 text-sm text-white/80">
          {gauge}
          <p>
            <b>{names[pending.actorSeat] ?? "상대"}</b>님이 <b>{ACTION_NAMES[pending.action]}</b>을 시도했습니다.
          </p>
          <p className="text-xs text-white/50">막을 캐릭터를 주장하거나, 그냥 넘기세요.</p>
          <div className="flex flex-wrap gap-2">
            {options.map((character) => (
              <button
                key={character}
                onClick={() => onAction({ type: "declareBlock", seat: viewerSeat, character })}
                className="rounded-xl border border-emerald-300/40 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-400/10"
              >
                🛡️ {CHARACTER_NAMES[character]}로 방어
              </button>
            ))}
          </div>
          <button onClick={sendPass} className="rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30">
            막지 않기
          </button>
        </div>
      </Overlay>
    );
  }

  if (state.phase === "blockChallengeWindow" && state.pendingBlock) {
    const block = state.pendingBlock;
    return (
      <Overlay title="🕵️ 방어 의심" onClose={sendPass}>
        <div className="flex flex-col gap-4 text-sm text-white/80">
          {gauge}
          <p>
            <b>{names[block.blockerSeat] ?? "상대"}</b>님이 <b>{CHARACTER_NAMES[block.claimedCharacter]}</b>(으)로 방어를 선언했습니다.
          </p>
          <p className="text-xs text-white/50">거짓말이라고 생각되면 의심을 외치세요. 의심이 틀리면 내 카드 1장을 잃습니다.</p>
          <div className="flex gap-2">
            <button onClick={sendPass} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30">
              패스
            </button>
            <button
              onClick={() => onAction({ type: "challenge", seat: viewerSeat })}
              className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white hover:bg-rose-500"
            >
              🕵️ 의심!
            </button>
          </div>
        </div>
      </Overlay>
    );
  }

  return null;
}
