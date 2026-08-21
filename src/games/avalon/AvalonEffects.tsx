"use client";

/**
 * Visual-effects layer for AvalonBoard.tsx — session-confirmed scope
 * (2026-08-22 hero-ability/vote/reveal effects request):
 *   1. Role-reveal aura (RoleAuraBackdrop) — decorative, team-tinted, loops
 *      for as long as RoleModal stays open. "Lady of the Lake" was dropped
 *      from scope entirely: engine.ts has no such role/mechanic to hang an
 *      effect on (see HANDOFF.md).
 *   2. Assassin phase (AssassinSpotlightOverlay/AssassinCrosshair/
 *      AssassinSlash) — screen dim + zoom, a hover crosshair, and a slash
 *      impact that briefly delays the real `assassinate` dispatch so the
 *      hit lands before the game-over screen appears.
 *   3. Vote/quest submission feedback (SubmittedPulseBadge) plus the snap
 *      animation applied inline on the submit buttons themselves in
 *      AvalonBoard.tsx (no dedicated component needed for that one — it's
 *      just an `animation` style on the existing button).
 *   4. Reveal overlays (VoteRevealOverlay/QuestRevealOverlay) — driven by
 *      `useAvalonReveals`, which diffs consecutive `AvalonState` snapshots
 *      the same way WormCanvas.tsx's `detectWormEvents` does, because
 *      engine.ts resolves voting/quest phases synchronously on the last
 *      vote/card with no dedicated "reveal" phase of its own to render off of.
 *
 * No new dependency: every animation here is a `@keyframes avalon-*` rule in
 * globals.css, played via an inline `animation` style — same convention as
 * DestinyWar39Effects.tsx. No audio anywhere (session-confirmed: the project
 * has no audio asset/playback infra at all).
 */

import { useEffect, useRef, useState } from "react";
import type { AvalonState, QuestResult, SeatIndex, Team, Vote } from "./engine";

// ---------------------------------------------------------------------------
// Reveal event detection — pure diff, no React
// ---------------------------------------------------------------------------

export type AvalonRevealEvent =
  | {
      id: number;
      type: "vote-reveal";
      proposedTeam: SeatIndex[];
      votes: Partial<Record<SeatIndex, Vote>>;
      playerCount: number;
      approved: boolean;
      consecutiveRejects: number;
    }
  | { id: number; type: "quest-reveal"; result: QuestResult };

/** `prev`/`next` are two consecutive `AvalonState` snapshots (same contract
 * as WormCanvas's `detectWormEvents`). Both transitions below happen
 * synchronously inside engine.ts's reducer on the single action that
 * completes voting/questing. `proposedTeam` has to come from `prev` (a
 * rejected proposal clears it in the same step), but the actual vote tally
 * has to come from `next` — `resolveVotes` deliberately leaves `votes`
 * populated with the just-resolved tally rather than clearing it (see its
 * doc), specifically so the very last vote's real value — otherwise only
 * ever visible transiently inside `castVote`'s own local merge — reaches
 * this diff at all. */
function detectAvalonRevealEvents(prev: AvalonState, next: AvalonState, nextId: () => number): AvalonRevealEvent[] {
  const events: AvalonRevealEvent[] = [];
  if (prev.phase === "voting" && next.phase !== "voting") {
    events.push({
      id: nextId(),
      type: "vote-reveal",
      proposedTeam: prev.proposedTeam,
      votes: next.votes,
      playerCount: prev.playerCount,
      approved: next.phase === "quest",
      consecutiveRejects: next.consecutiveRejects,
    });
  }
  if (prev.phase === "quest" && next.phase !== "quest") {
    const result = next.questResults[next.questResults.length - 1];
    if (result) events.push({ id: nextId(), type: "quest-reveal", result });
  }
  return events;
}

/** Queues reveal events detected across state updates and hands back only
 * the front of the queue — a vote-reveal and quest-reveal can never fire
 * from the same diff (they're disjoint phase transitions), but a fast
 * sequence of rounds could in principle queue up faster than the ~2s
 * overlays play, so this plays them one at a time rather than clobbering. */
export function useAvalonReveals(state: AvalonState) {
  const lastDiffedRef = useRef(state);
  const idRef = useRef(0);
  const [queue, setQueue] = useState<AvalonRevealEvent[]>([]);

  useEffect(() => {
    const prev = lastDiffedRef.current;
    if (prev !== state) {
      const events = detectAvalonRevealEvents(prev, state, () => ++idRef.current);
      if (events.length > 0) setQueue((q) => [...q, ...events]);
      lastDiffedRef.current = state;
    }
  }, [state]);

  const current = queue[0] ?? null;
  function dismissCurrent() {
    setQueue((q) => q.slice(1));
  }
  return { current, dismissCurrent };
}

// ---------------------------------------------------------------------------
// 1. Role reveal aura (RoleModal backdrop)
// ---------------------------------------------------------------------------

/** Mystical hologram magic-circle + team-tinted aura pulse behind RoleModal's
 * role icon. Good: blue/violet, Evil: rose/crimson (session-confirmed:
 * team-tinted rather than role-specific, so it also gives Merlin/Percival's
 * info-reveal moment the requested blue/violet mysticism). Purely decorative
 * — loops for as long as the modal stays mounted. */
export function RoleAuraBackdrop({ team }: { team: Team }) {
  const auraColor = team === "good" ? "rgba(56,189,248,0.35)" : "rgba(244,63,94,0.35)";
  const ringColor = team === "good" ? "rgba(129,140,248,0.55)" : "rgba(190,18,60,0.55)";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-2xl">
      <div
        className="absolute h-48 w-48 rounded-full blur-2xl"
        style={{ backgroundColor: auraColor, animation: "avalon-aura-pulse 1.2s ease-in-out infinite" }}
      />
      <svg className="absolute h-40 w-40" style={{ animation: "avalon-magic-circle-spin 6s linear infinite" }} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" fill="none" stroke={ringColor} strokeWidth="1" strokeDasharray="4 6" />
        <circle cx="50" cy="50" r="34" fill="none" stroke={ringColor} strokeWidth="1" strokeDasharray="2 8" />
        {Array.from({ length: 8 }, (_, i) => {
          const angle = (i / 8) * 2 * Math.PI;
          const x1 = 50 + 34 * Math.cos(angle);
          const y1 = 50 + 34 * Math.sin(angle);
          const x2 = 50 + 46 * Math.cos(angle);
          const y2 = 50 + 46 * Math.sin(angle);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={ringColor} strokeWidth="1" />;
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Assassin phase
// ---------------------------------------------------------------------------

/** Screen dim + slight table zoom-in while the assassination phase is live —
 * shown to every seat (not just the Assassin) so the whole table feels the
 * tension of the moment, per the request's "화면이 살짝 어두워지는 스포트라이트
 * 줌인 연출". */
export function AssassinSpotlightOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-30 bg-black/45"
      style={{ animation: "avalon-spotlight-in 0.6s ease-out both" }}
    />
  );
}

/** Red crosshair ring drawn over whichever target button the Assassin is
 * currently hovering/focused on. */
export function AssassinCrosshair() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      style={{ animation: "avalon-crosshair-pulse 0.7s ease-in-out infinite" }}
    >
      <span className="absolute h-9 w-9 rounded-full border-2 border-rose-500" />
      <span className="absolute h-9 w-[2px] bg-rose-500/80" />
      <span className="absolute h-[2px] w-9 bg-rose-500/80" />
    </span>
  );
}

/** Dagger slash impact swiping across the confirmed target — played for
 * ~0.4s before AvalonBoard.tsx actually dispatches the `assassinate` action,
 * so the hit visually lands before the game-over screen can appear. */
export function AssassinSlash() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
      <span
        className="absolute left-1/2 top-1/2 h-1.5 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-rose-300 to-transparent shadow-[0_0_12px_2px_rgba(244,63,94,0.9)]"
        style={{ animation: "avalon-slash-impact 0.4s ease-in both" }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// 3. Vote/quest submission feedback
// ---------------------------------------------------------------------------

/** [투표 완료 / Voted] checkmark + green/gold particle pulse on the viewer's
 * own seat chip, shown for as long as they've submitted and are waiting on
 * the rest of the table. */
export function SubmittedPulseBadge() {
  return (
    <span
      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-emerald-300 bg-emerald-500 text-[10px] text-white"
      style={{ animation: "avalon-badge-pulse 1.4s ease-out infinite" }}
      title="투표/제출 완료"
    >
      ✓
    </span>
  );
}

// ---------------------------------------------------------------------------
// 4. Reveal overlays
// ---------------------------------------------------------------------------

const SEAL_MS = 800;
const FLIP_BASE_MS = 600;
const FLIP_STAGGER_MS = 80;
const APPROVE_OUTCOME_MS = 1000;
const REJECT_OUTCOME_MS = 900;

type VoteRevealStep = "seal" | "flip" | "outcome";

export function VoteRevealOverlay({
  event,
  names,
  onDone,
}: {
  event: Extract<AvalonRevealEvent, { type: "vote-reveal" }>;
  names: Record<SeatIndex, string>;
  onDone: () => void;
}) {
  const [step, setStep] = useState<VoteRevealStep>("seal");
  const seats = Array.from({ length: event.playerCount }, (_, i) => i);
  const flipDurationMs = FLIP_BASE_MS + (seats.length - 1) * FLIP_STAGGER_MS;

  useEffect(() => {
    const t1 = setTimeout(() => setStep("flip"), SEAL_MS);
    const t2 = setTimeout(() => setStep("outcome"), SEAL_MS + flipDurationMs);
    const t3 = setTimeout(onDone, SEAL_MS + flipDurationMs + (event.approved ? APPROVE_OUTCOME_MS : REJECT_OUTCOME_MS));
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div
        className="relative flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-amber-400/30 bg-[#1a1128] p-6 text-center shadow-2xl"
        style={step === "outcome" && !event.approved ? { animation: "avalon-reject-shake 0.4s ease-in-out" } : undefined}
      >
        {step === "seal" && (
          <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-amber-300/70 bg-amber-950/40 text-4xl" style={{ animation: "avalon-seal-lock 0.6s ease-out both" }}>
            🔒
          </div>
        )}

        {step !== "seal" && (
          <>
            <p className="text-xs text-white/50">원정대 투표 결과</p>
            <div className="flex flex-wrap justify-center gap-2">
              {seats.map((seat, i) => {
                const vote = event.votes[seat];
                const onTeam = event.proposedTeam.includes(seat);
                return (
                  <div key={seat} className="flex flex-col items-center gap-1" style={{ perspective: "300px" }}>
                    <div
                      className="flex h-12 w-9 items-center justify-center rounded-md border text-lg font-bold"
                      style={{
                        animation: `avalon-vote-flip 0.6s ease-out ${i * FLIP_STAGGER_MS}ms both`,
                        transformStyle: "preserve-3d",
                        borderColor: vote === "approve" ? "rgba(52,211,153,0.6)" : "rgba(244,63,94,0.6)",
                        backgroundColor: vote === "approve" ? "rgba(52,211,153,0.15)" : "rgba(244,63,94,0.15)",
                        color: vote === "approve" ? "#6ee7b7" : "#fda4af",
                      }}
                    >
                      {vote === "approve" ? "👍" : "👎"}
                    </div>
                    <span className={`text-[10px] ${onTeam ? "text-sky-300" : "text-white/40"}`}>{names[seat]}</span>
                  </div>
                );
              })}
            </div>

            {step === "outcome" && (
              <div className="relative mt-1 w-full">
                {event.approved && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-b from-amber-300/60 to-transparent"
                    style={{ animation: "avalon-approve-flash 1s ease-out both" }}
                  />
                )}
                <div
                  className={`relative rounded-xl border px-4 py-3 text-sm font-bold ${
                    event.approved ? "border-amber-300/60 bg-amber-400/10 text-amber-100" : "border-rose-400/60 bg-rose-500/10 text-rose-100"
                  }`}
                  style={{ animation: "avalon-banner-pop 0.5s ease-out both" }}
                >
                  {event.approved ? (
                    "⛵ 원정대 출발 승인!"
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <span style={{ animation: "avalon-stamp-slam 0.5s ease-out both" }}>❌ 원정대 기각</span>
                      <span className="rounded-full bg-rose-600/60 px-2 py-0.5 text-[11px] font-semibold text-white">
                        연속 부결 {event.consecutiveRejects}회
                      </span>
                    </span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const SHUFFLE_MS = 500;
const CARD_FLIP_BASE_MS = 700;
const CARD_FLIP_STAGGER_MS = 300;
const SUCCESS_OUTCOME_MS = 1500;
const FAIL_OUTCOME_MS = 1200;

type QuestRevealStep = "shuffle" | "flip" | "outcome";

/** `result.teamSize` anonymous cards — `result.failCount` of them "fail" —
 * in a deterministic (not random) display order. Engine.ts intentionally
 * never records *which* seat played which card (that anonymity is the whole
 * point of a secret-ballot quest), so this is the most the reveal can
 * honestly show; only the aggregate failCount/success outcome is real state.
 * A pure function of `result` (no Math.random/useRef) so it can be computed
 * directly during render — the rotate-by-round-number just keeps a repeat
 * failCount from always drawing its fails into the same leading slots. */
function buildQuestCards(result: QuestResult): ("success" | "fail")[] {
  const base = Array.from({ length: result.teamSize }, (_, i) => (i < result.failCount ? "fail" : "success") as "success" | "fail");
  const rotate = base.length > 0 ? result.round % base.length : 0;
  return [...base.slice(rotate), ...base.slice(0, rotate)];
}

/** Fixed confetti-piece offsets (position/delay/hue) — deterministic, same
 * "hardcoded offset list" convention as DestinyWar39Effects.tsx's
 * DEATH_SMOKE_OFFSETS/RESULT_PARTICLE_OFFSETS, since this project's particle
 * bursts never actually need true randomness. */
const CONFETTI_OFFSETS: { leftPct: number; delayMs: number; hue: string }[] = [
  { leftPct: 4, delayMs: 0, hue: "rgba(250,204,21,0.9)" }, { leftPct: 12, delayMs: 60, hue: "rgba(56,189,248,0.9)" },
  { leftPct: 20, delayMs: 120, hue: "rgba(250,204,21,0.9)" }, { leftPct: 28, delayMs: 30, hue: "rgba(56,189,248,0.9)" },
  { leftPct: 36, delayMs: 150, hue: "rgba(250,204,21,0.9)" }, { leftPct: 44, delayMs: 90, hue: "rgba(56,189,248,0.9)" },
  { leftPct: 52, delayMs: 0, hue: "rgba(250,204,21,0.9)" }, { leftPct: 60, delayMs: 180, hue: "rgba(56,189,248,0.9)" },
  { leftPct: 68, delayMs: 45, hue: "rgba(250,204,21,0.9)" }, { leftPct: 76, delayMs: 135, hue: "rgba(56,189,248,0.9)" },
  { leftPct: 84, delayMs: 75, hue: "rgba(250,204,21,0.9)" }, { leftPct: 92, delayMs: 15, hue: "rgba(56,189,248,0.9)" },
  { leftPct: 8, delayMs: 210, hue: "rgba(56,189,248,0.9)" }, { leftPct: 16, delayMs: 165, hue: "rgba(250,204,21,0.9)" },
  { leftPct: 24, delayMs: 105, hue: "rgba(56,189,248,0.9)" }, { leftPct: 32, delayMs: 195, hue: "rgba(250,204,21,0.9)" },
  { leftPct: 40, delayMs: 240, hue: "rgba(56,189,248,0.9)" }, { leftPct: 48, delayMs: 255, hue: "rgba(250,204,21,0.9)" },
  { leftPct: 56, delayMs: 225, hue: "rgba(56,189,248,0.9)" }, { leftPct: 64, delayMs: 270, hue: "rgba(250,204,21,0.9)" },
  { leftPct: 72, delayMs: 285, hue: "rgba(56,189,248,0.9)" }, { leftPct: 80, delayMs: 300, hue: "rgba(250,204,21,0.9)" },
  { leftPct: 88, delayMs: 20, hue: "rgba(56,189,248,0.9)" }, { leftPct: 96, delayMs: 110, hue: "rgba(250,204,21,0.9)" },
];

export function QuestRevealOverlay({
  event,
  onDone,
}: {
  event: Extract<AvalonRevealEvent, { type: "quest-reveal" }>;
  onDone: () => void;
}) {
  const { result } = event;
  const [step, setStep] = useState<QuestRevealStep>("shuffle");
  const cards = buildQuestCards(result);
  const flipDurationMs = CARD_FLIP_BASE_MS + (cards.length - 1) * CARD_FLIP_STAGGER_MS;

  useEffect(() => {
    const t1 = setTimeout(() => setStep("flip"), SHUFFLE_MS);
    const t2 = setTimeout(() => setStep("outcome"), SHUFFLE_MS + flipDurationMs);
    const t3 = setTimeout(onDone, SHUFFLE_MS + flipDurationMs + (result.success ? SUCCESS_OUTCOME_MS : FAIL_OUTCOME_MS));
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="relative flex w-full max-w-md flex-col items-center gap-4 overflow-hidden rounded-2xl border border-amber-400/30 bg-[#1a1128] p-6 text-center shadow-2xl">
        {step === "outcome" && !result.success && (
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ animation: "avalon-mist-drift 1.2s ease-out both", background: "radial-gradient(circle at 50% 40%, rgba(120,10,20,0.55), transparent 70%)" }} />
        )}
        {step === "outcome" && !result.success && (
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-rose-600/40" style={{ animation: "avalon-crack-flash 0.6s ease-out both" }} />
        )}
        {step === "outcome" && result.success && (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            {CONFETTI_OFFSETS.map((p, i) => (
              <span
                key={i}
                className="absolute top-0 h-2 w-2 rounded-sm"
                style={{ left: `${p.leftPct}%`, backgroundColor: p.hue, animation: `avalon-confetti-fall 1.4s ease-in ${p.delayMs}ms both` }}
              />
            ))}
          </div>
        )}

        <p className="relative z-10 text-xs text-white/50">
          {result.round}라운드 원정 결과 · 실패 카드 {result.failCount}장
        </p>

        {step === "shuffle" && (
          <div className="relative z-10 flex h-16 w-12 items-center justify-center rounded-md border border-white/20 bg-black/40 text-2xl" style={{ animation: "avalon-quest-shuffle 0.5s ease-in-out both" }}>
            🂠
          </div>
        )}

        {step !== "shuffle" && (
          <div className="relative z-10 flex flex-wrap justify-center gap-2">
            {cards.map((card, i) => (
              <div
                key={i}
                className={`flex h-16 w-12 items-center justify-center rounded-md border text-xl font-bold ${
                  card === "success" ? "border-sky-300/60 bg-sky-400/10 text-sky-200" : "border-rose-400/60 bg-rose-500/10 text-rose-200"
                }`}
                style={{ animation: `avalon-quest-card-flip 0.7s ease-out ${i * CARD_FLIP_STAGGER_MS}ms both` }}
              >
                {card === "success" ? "✅" : "❌"}
              </div>
            ))}
          </div>
        )}

        {step === "outcome" && (
          <div className="relative z-10 flex flex-col items-center gap-1">
            {result.success ? (
              <span className="text-4xl" style={{ animation: "avalon-grail-glow 1s ease-out both" }}>
                🏆
              </span>
            ) : (
              <span className="text-3xl" style={{ animation: "avalon-banner-pop 0.5s ease-out both" }}>
                ⚡🩸
              </span>
            )}
            <p className={`text-sm font-bold ${result.success ? "text-sky-200" : "text-rose-200"}`}>
              {result.success ? "원정 성공!" : "원정 실패!"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
