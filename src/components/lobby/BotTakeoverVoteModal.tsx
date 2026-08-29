"use client";

import Overlay from "@/components/Overlay";
import type { TakeoverReason } from "@/games/shared/bot/botTakeover";

const REASON_LABEL: Record<TakeoverReason, string> = {
  disconnected: "연결이 끊겼어요",
  idle: "응답이 없어요",
};

/**
 * Shown to every OTHER remaining real player while a bot-takeover vote is
 * running for some seat (see `botTakeover.ts` for the vote state machine —
 * this is a pure presentational shell around it). Majority of the *other*
 * remaining real players (not the target, not existing bot seats) passes
 * the vote — the live tally text makes that threshold visible as votes come
 * in from other clients' broadcasts.
 */
export function BotTakeoverVoteModal({
  targetName,
  reason,
  yesCount,
  eligibleVoterCount,
  hasVoted,
  onVoteYes,
  onDismiss,
}: {
  targetName: string;
  reason: TakeoverReason;
  yesCount: number;
  eligibleVoterCount: number;
  hasVoted: boolean;
  onVoteYes: () => void;
  onDismiss: () => void;
}) {
  const needed = Math.floor(eligibleVoterCount / 2) + 1;
  return (
    <Overlay title="AI 봇 전환 투표" onClose={onDismiss}>
      <div className="flex flex-col gap-4 text-sm text-white/80">
        <p>
          <span className="font-semibold text-white">{targetName}</span>님이 {REASON_LABEL[reason]}. 남은
          플레이어 과반수가 찬성하면 이 자리를 AI 봇이 대신 플레이합니다.
        </p>
        <p className="text-xs text-white/50">
          {yesCount}/{eligibleVoterCount}명 찬성 · 과반수({needed}명)가 되면 즉시 전환됩니다
        </p>
        <div className="flex gap-2">
          <button
            onClick={onDismiss}
            className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm font-semibold text-white/80 hover:border-white/30"
          >
            나중에
          </button>
          <button
            onClick={onVoteYes}
            disabled={hasVoted}
            className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {hasVoted ? "찬성함 ✓" : "찬성"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/**
 * The unified "yes" affordance from both sides of a takeover (decision: one
 * button/logic path for both):
 *  - `mode: "prove-presence"` — this client IS the vote target and is still
 *    actually connected; pressing it cancels the pending vote outright
 *    ("저 있어요").
 *  - `mode: "reclaim"` — this client's seat has ALREADY converted to a bot
 *    (they reconnected after the fact); pressing it hands manual control
 *    back ("다시 플레이").
 * Rendered as a persistent small banner rather than a blocking modal, since
 * in both cases the player is actively looking at their own board already —
 * nothing should stop them from just continuing to watch if they don't
 * press it right away.
 */
export function BotTakeoverSelfBanner({
  mode,
  onConfirm,
}: {
  mode: "prove-presence" | "reclaim";
  onConfirm: () => void;
}) {
  const copy =
    mode === "prove-presence"
      ? { text: "다른 플레이어들이 이 자리를 봇으로 전환할지 투표 중이에요.", button: "저 여기 있어요" }
      : { text: "이 자리는 현재 AI 봇이 대신 플레이하고 있어요.", button: "다시 플레이하기" };
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-2.5 text-sm text-sky-100">
      <span>{copy.text}</span>
      <button
        onClick={onConfirm}
        className="shrink-0 rounded-full bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-500"
      >
        {copy.button}
      </button>
    </div>
  );
}
