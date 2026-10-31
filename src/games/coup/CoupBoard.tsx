"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { preferLowDetail, useBoardView } from "@/games/shared/three/viewPref";
import type { CoupBeat } from "./three/CoupTable3D";
import SuiteSoundHud from "@/components/audio/SuiteSoundHud";
import { useSoundCues, useSuiteBgm } from "@/lib/audio/useProceduralSuite";
import { coupIntensity, coupSoundCues, getCoupSound } from "./coupSound";
import RulebookModal from "./RulebookModal";
import TargetModal from "./TargetModal";
import ResponseDock from "./ResponseDock";
import ExchangeModal from "./ExchangeModal";
import LoseInfluenceModal from "./LoseInfluenceModal";
import { AbilityCaption, CardBack, CharacterCardFace, CoinStack } from "./CardArt";
import { ActionBurst, burstOf, CardFlipWrapper, detectGameJustEnded, detectNewlyEliminated, EliminationToast, GameOverBanner, type BurstSpec } from "./CoupEffects";
import {
  ACTION_NAMES,
  aliveSeats,
  ASSASSINATE_COST,
  CHARACTER_NAMES,
  claimedCharacterFor,
  computeRankings,
  COUP_COST,
  currentResponders,
  getPlayerView,
  mustCoup,
  needsDeclareTarget,
  type ActionKind,
  type CoupState,
  type EngineAction,
  type LastEvent,
  type SeatIndex,
} from "./engine";

// three.js only loads when the 3D court is actually shown (🖼️ 2D otherwise / without WebGL).
const CoupTable3D = dynamic(() => import("./three/CoupTable3D"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-amber-100/50">3D 궁정 준비 중…</div>,
});

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state (every seat's actual
 * influence cards) per this project's lockstep trust model; hidden-hand
 * secrecy is enforced only here, at render time, via `getPlayerView`. The 5
 * decision-driving overlays (target/response dock/exchange/lose-influence, plus the
 * rulebook) each live in their own file per ARCHITECTURE.md's 3-layer split.
 */
export interface CoupBoardProps {
  state: CoupState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

const ACTION_EMOJI: Record<ActionKind, string> = {
  income: "💰",
  foreignAid: "💸",
  coup: "⚔️",
  tax: "👑",
  assassinate: "🗡️",
  steal: "⚓",
  exchange: "🕊️",
};

function describeLastEvent(event: LastEvent | null, names: Record<SeatIndex, string>): string | null {
  if (!event) return null;
  const who = (seat: SeatIndex) => names[seat] ?? "상대";
  switch (event.type) {
    case "declare":
      return `${who(event.seat)}님이 ${ACTION_NAMES[event.action]}${event.targetSeat !== null ? ` → ${who(event.targetSeat)}` : ""}을(를) 선언했습니다.`;
    case "challengeAction":
      return event.actorHadCard
        ? `${who(event.challengerSeat)}님의 의심 실패 — ${who(event.actorSeat)}님은 진짜 ${CHARACTER_NAMES[event.character]}를 갖고 있었습니다!`
        : `${who(event.challengerSeat)}님의 의심 적중! ${who(event.actorSeat)}님에게는 ${CHARACTER_NAMES[event.character]}가 없었습니다.`;
    case "block":
      return `${who(event.blockerSeat)}님이 ${CHARACTER_NAMES[event.character]}(으)로 방어를 선언했습니다.`;
    case "challengeBlock":
      return event.blockerHadCard
        ? `${who(event.challengerSeat)}님의 의심 실패 — ${who(event.blockerSeat)}님의 방어는 진짜였습니다!`
        : `${who(event.challengerSeat)}님의 의심 적중! ${who(event.blockerSeat)}님의 방어는 거짓이었습니다.`;
    case "actionResolved":
      if (event.blocked) return `${ACTION_NAMES[event.action]}이(가) 방어당해 무효화되었습니다.`;
      if (event.action === "steal") return `${who(event.actorSeat)}님이 ${who(event.targetSeat!)}님의 코인 ${event.amount}개를 갈취했습니다.`;
      if (event.action === "tax") return `${who(event.actorSeat)}님이 세금으로 3코인을 징수했습니다.`;
      if (event.action === "foreignAid") return `${who(event.actorSeat)}님이 외화 도입으로 2코인을 얻었습니다.`;
      return null;
    case "influenceLost":
      return `💀 ${who(event.seat)}님이 ${CHARACTER_NAMES[event.character]} 카드를 공개하며 잃었습니다.`;
    case "cardReplaced":
      return `${who(event.seat)}님이 증명한 카드를 새 카드로 교체했습니다.`;
    case "exchangeStarted":
      return `${who(event.seat)}님이 교환할 카드를 고르는 중입니다.`;
    case "exchangeResolved":
      return `${who(event.seat)}님이 카드 교환을 마쳤습니다.`;
    default:
      return null;
  }
}

/** The last public event as a "beat" the 3D table acts out (bubbles + poses). */
function beatOf(state: CoupState, names: Record<SeatIndex, string>): CoupBeat | null {
  const e = state.lastEvent;
  if (!e) return null;
  switch (e.type) {
    case "declare": {
      const claim = state.pendingAction?.actorSeat === e.seat ? state.pendingAction.claimedCharacter : null;
      const target = e.targetSeat !== null ? ` → ${names[e.targetSeat] ?? "상대"}` : "";
      return { kind: "declare", seat: e.seat, target: e.targetSeat, claim, label: `${ACTION_EMOJI[e.action]} ${ACTION_NAMES[e.action]}${target}${claim ? `
(${CHARACTER_NAMES[claim]} 주장)` : ""}` };
    }
    case "challengeAction":
      return { kind: "challenge", challenger: e.challengerSeat, accused: e.actorSeat, caught: !e.actorHadCard, character: e.character };
    case "challengeBlock":
      return { kind: "challenge", challenger: e.challengerSeat, accused: e.blockerSeat, caught: !e.blockerHadCard, character: e.character };
    case "block":
      return { kind: "block", seat: e.blockerSeat, actor: e.actorSeat, character: e.character };
    case "actionResolved": {
      const coins = e.action === "income" ? 1 : e.action === "foreignAid" ? 2 : e.action === "tax" ? 3 : e.action === "steal" ? (e.amount ?? 0) : 0;
      return { kind: "resolved", seat: e.actorSeat, target: e.targetSeat, label: ACTION_NAMES[e.action], blocked: e.blocked, coins };
    }
    case "influenceLost":
      return { kind: "lost", seat: e.seat, character: e.character };
    case "cardReplaced":
      return { kind: "other", seat: e.seat, label: "🔄 증명한 카드 교체" };
    case "exchangeStarted":
      return { kind: "other", seat: e.seat, label: "🕊️ 카드 교환 중…" };
    case "exchangeResolved":
      return { kind: "other", seat: e.seat, label: "🕊️ 교환 완료" };
    default:
      return null;
  }
}

const ATTACK_COLOR: Partial<Record<ActionKind, string>> = { coup: "#ef4444", assassinate: "#be123c", steal: "#38bdf8" };

export default function CoupBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: CoupBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const { view: boardView, setView: setBoardView, canToggle } = useBoardView("coup-view");
  const [lowDetail] = useState(preferLowDetail);
  const [pendingTargetAction, setPendingTargetAction] = useState<ActionKind | null>(null);
  /** Action button under the pointer/focus — lights up the hand card that backs it. */
  const [hoverAction, setHoverAction] = useState<ActionKind | null>(null);

  const [trackedState, setTrackedState] = useState(state);
  const [eliminationToast, setEliminationToast] = useState<{ id: number; names: string[] } | null>(null);
  const [gameOverBanner, setGameOverBanner] = useState(false);
  const [burst, setBurst] = useState<{ id: number; spec: BurstSpec } | null>(null);
  // Palace Intrigue sound suite (coupSound.ts) — cues from the engine's lastEvent, heard by every client.
  useSoundCues(state, getCoupSound, coupSoundCues);
  useSuiteBgm(getCoupSound, state.phase !== "gameOver", coupIntensity(state));
  if (trackedState !== state) {
    const newlyEliminated = detectNewlyEliminated(trackedState, state);
    const justEnded = detectGameJustEnded(trackedState, state);
    setTrackedState(state);
    const spec = state.lastEvent !== trackedState.lastEvent ? burstOf(state.lastEvent, names) : null;
    if (spec) setBurst((b) => ({ id: (b?.id ?? 0) + 1, spec }));
    if (newlyEliminated.length > 0) setEliminationToast({ id: state.eliminationOrder.length, names: newlyEliminated.map((s) => names[s] ?? "상대") });
    if (justEnded) setGameOverBanner(true);
  }

  const view = getPlayerView(state, viewerSeat);
  const narration = describeLastEvent(state.lastEvent, names);

  const fx = (
    <>
      {burst && <ActionBurst key={burst.id} spec={burst.spec} onDone={() => setBurst((b) => (b?.id === burst.id ? null : b))} />}
      {eliminationToast && <EliminationToast key={eliminationToast.id} names={eliminationToast.names} onDone={() => setEliminationToast(null)} />}
      {gameOverBanner && state.winnerSeat !== null && (
        <GameOverBanner winnerName={names[state.winnerSeat] ?? "상대"} onDone={() => setGameOverBanner(false)} />
      )}
    </>
  );

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white light:border-slate-300 light:bg-white/80 light:text-slate-600 light:shadow-sm light:hover:border-slate-400 light:hover:text-slate-900"
    >
      📖 쿠 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    return (
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8 light:border-slate-200 light:shadow-md"
        // TODO(theme): hardcoded dark gradient background — not trivial to branch via a CSS class variant, left dark in light mode for now.
        style={{ background: "linear-gradient(160deg,#2a1a08 0%,#180f04 55%,#0a0602 100%)" }}
      >
        <span className="text-5xl">👑</span>
        <h2 className="text-2xl font-bold text-amber-100">{names[state.winnerSeat!] ?? "상대"}님이 최후의 생존자로 승리했습니다!</h2>
        <p className="text-xs text-white/50">단판 승부 — 마지막까지 영향력을 지킨 단 1명이 즉시 최종 승자가 됩니다.</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {state.players.map((p) => {
            const revealedHand = view.players.find((v) => v.seat === p.seat)!.influence;
            return (
              <div key={p.seat} className="flex flex-col items-center gap-1">
                <div className="flex gap-1">
                  {revealedHand && revealedHand.length > 0 ? (
                    revealedHand.map((c) => (
                      <CardFlipWrapper key={c.id} flipKey={`${p.seat}-${c.id}-gameOver`} revealed>
                        <CharacterCardFace card={c} size="sm" />
                      </CardFlipWrapper>
                    ))
                  ) : (
                    <div className="flex h-16 w-12 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-lg opacity-50 light:border-slate-300 light:bg-slate-100">💀</div>
                  )}
                </div>
                <span className="text-[10px] text-white/60">{names[p.seat] ?? "상대"}</span>
              </div>
            );
          })}
        </div>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[320px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">코인</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank }) => {
                const p = state.players.find((pl) => pl.seat === seat)!;
                return (
                  <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                    <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200">{rank === 1 ? "👑 1" : rank}</td>
                    <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                      {names[seat] ?? "상대"}
                      {seat === viewerSeat && <span className="ml-1 text-amber-200">(나)</span>}
                    </td>
                    <td className="border-b border-white/5 px-2 py-2 text-left text-white/60">{p.coins}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button onClick={onGameEnd} className="rounded-full bg-amber-500 px-8 py-3 font-medium text-black transition hover:bg-amber-400">
          결과 확정하고 계속하기
        </button>
        {fx}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing
  // ---------------------------------------------------------------------
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const myView = view.players.find((v) => v.seat === viewerSeat)!;
  const isMyTurn = state.phase === "action" && state.activeSeat === viewerSeat;
  const forced = mustCoup(me.coins);
  const responders = currentResponders(state);
  const iAmResponding = responders.includes(viewerSeat) && state.phase !== "action" && state.phase !== "loseInfluence" && state.phase !== "exchange";
  const iAmLosingInfluence = state.phase === "loseInfluence" && state.pendingLoseInfluence?.seat === viewerSeat;
  const iAmExchanging = state.phase === "exchange" && view.pendingExchangeOptions !== null;
  const myCharacters = new Set((myView.influence ?? []).map((c) => c.character));
  /** 진실 행동 — the action's claimed character is actually in my hand (never a bluff). */
  const isTruthful = (action: ActionKind) => {
    const claim = claimedCharacterFor(action);
    return claim !== null && myCharacters.has(claim);
  };
  const hoverClaim = isMyTurn && hoverAction ? claimedCharacterFor(hoverAction) : null;

  function declare(action: ActionKind, targetSeat?: SeatIndex) {
    onAction({ type: "declareAction", seat: viewerSeat, action, targetSeat });
  }

  function handleActionClick(action: ActionKind) {
    if (needsDeclareTarget(action)) {
      setPendingTargetAction(action);
      return;
    }
    declare(action);
  }

  const availableTargets = pendingTargetAction ? aliveSeats(state).filter((s) => s !== viewerSeat) : [];

  const ACTIONS: ActionKind[] = ["income", "foreignAid", "coup", "tax", "assassinate", "steal", "exchange"];

  return (
    <div
      onPointerDownCapture={() => getCoupSound().unlock()}
      className={`flex flex-col gap-3 rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4 light:border-slate-200 light:shadow-md ${iAmResponding ? "pb-60" : ""}`}
      // TODO(theme): hardcoded dark gradient background — not trivial to branch via a CSS class variant, left dark in light mode for now.
      style={{ background: "linear-gradient(160deg,#201408 0%,#140c04 45%,#0a0602 100%)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-amber-100/70">
        <span>
          {state.playerCount}인 · 단판 승부 · 턴 {state.turnNumber}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {canToggle && (
            <button
              onClick={() => setBoardView(boardView === "3d" ? "2d" : "3d")}
              className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white light:border-slate-300 light:bg-white/80 light:text-slate-600"
            >
              {boardView === "3d" ? "🖼️ 2D로" : "🧊 3D로"}
            </button>
          )}
          <SuiteSoundHud suite={getCoupSound} icon="👑" label="Palace Intrigue" preview="coin3" />
          {rulebookButton}
        </div>
      </div>

      {/* 3D 궁정 — getPlayerView로 가린 정보만(남의 숨은 카드는 장수만). */}
      {boardView === "3d" && (
        <div className="relative h-[340px] w-full overflow-hidden rounded-2xl border border-black/50 sm:h-[440px]">
          <CoupTable3D
            playerCount={state.playerCount}
            viewerSeat={viewerSeat}
            seats={state.players.map((p) => {
              const v = view.players.find((x) => x.seat === p.seat)!;
              return {
                seat: p.seat,
                name: names[p.seat] ?? "상대",
                coins: p.coins,
                hiddenCount: v.influenceCount,
                myCards: p.seat === viewerSeat && v.influence ? v.influence.map((c) => c.character) : null,
                lost: v.revealed.map((c) => c.character),
                away: !connectedSeats.has(p.seat),
              };
            })}
            activeSeat={state.activeSeat}
            awaiting={state.phase === "action" ? [] : responders}
            attack={
              state.pendingAction && state.pendingAction.targetSeat !== null && ATTACK_COLOR[state.pendingAction.action]
                ? { from: state.pendingAction.actorSeat, to: state.pendingAction.targetSeat, color: ATTACK_COLOR[state.pendingAction.action]! }
                : null
            }
            beat={beatOf(state, names)}
            beatKey={`${state.turnNumber}-${JSON.stringify(state.lastEvent)}`}
            deckCount={state.deck.length}
            sign={
              state.phase === "action"
                ? `${names[state.activeSeat] ?? "상대"}님의 차례`
                : state.phase === "actionChallengeWindow"
                  ? "🤨 의심할 사람?"
                  : state.phase === "blockWindow"
                    ? "🛡️ 방어할 사람?"
                    : state.phase === "blockChallengeWindow"
                      ? "🤨 방어를 의심?"
                      : state.phase === "exchange"
                        ? "🕊️ 제상 교환 중"
                        : state.pendingLoseInfluence
                          ? `💀 ${names[state.pendingLoseInfluence.seat] ?? "상대"}님
잃을 카드 선택`
                          : ""
            }
            overview={false}
            lowDetail={lowDetail}
          />
          <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[11px] whitespace-nowrap text-amber-100/80">
            남의 카드는 뒷면만 보여요 🤫 · 드래그로 둘러보기
          </span>
        </div>
      )}

      {narration && (
        <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-center text-xs text-white/70 light:border-slate-200 light:bg-white/70 light:text-slate-600">
          💬 {narration}
        </div>
      )}

      {/* Seats (the 3D court shows the same thing around the table) */}
      {boardView === "2d" && (
      <section className="flex flex-col gap-1.5">
        {state.players.map((p) => {
          const v = view.players.find((x) => x.seat === p.seat)!;
          const isActive = state.activeSeat === p.seat;
          const isSelf = p.seat === viewerSeat;
          const isEliminated = v.influenceCount === 0;
          return (
            <div
              key={p.seat}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-xs transition ${
                isEliminated ? "border-white/5 bg-black/10 opacity-50" : isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/20"
              }`}
            >
              <span className="flex items-center gap-1.5 font-semibold text-white/90">
                <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(p.seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                {isActive && <span title="차례">👉</span>}
                {names[p.seat] ?? "상대"}
                {isSelf && <span className="text-amber-200">(나)</span>}
                {isEliminated && <span className="text-white/40">💀 탈락</span>}
                {!isEliminated && mustCoup(p.coins) && <span title="쿠데타 필수" className="text-rose-300">⚠️쿠필수</span>}
              </span>
              <span className="flex items-center gap-1.5">
                <CoinStack coins={p.coins} />
                <span className="flex gap-1">
                  {v.influence
                    ? v.influence.map((c) => <CharacterCardFace key={c.id} card={c} size="xs" />)
                    : Array.from({ length: v.influenceCount }, (_, i) => <CardBack key={i} size="xs" owner={names[p.seat]} />)}
                  {v.revealed.map((c) => (
                    <CharacterCardFace key={c.id} card={c} size="xs" dead />
                  ))}
                </span>
              </span>
            </div>
          );
        })}
      </section>
      )}

      {/* My hand */}
      <section
        className="rounded-2xl border border-amber-300/20 p-2.5 sm:p-3"
        style={{ background: "linear-gradient(160deg,#2a1a08 0%,#180f04 55%,#0a0602 100%)" }}
      >
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-amber-200/90 uppercase">
          내 영향력 ({myView.influenceCount}장) · 🪙 {me.coins}코인
        </h3>
        <div className="flex flex-wrap items-start gap-2">
          {myView.influence?.map((c) => (
            <div key={c.id} className="flex flex-col items-center gap-1">
              <CharacterCardFace card={c} size="md" highlight={hoverClaim === c.character} />
              <AbilityCaption character={c.character} active={hoverClaim === c.character} />
            </div>
          ))}
          {me.revealed.map((c) => (
            <CharacterCardFace key={c.id} card={c} size="md" dead />
          ))}
        </div>

        {isMyTurn && (
          <div className="mt-3 flex flex-col gap-2">
            {forced && <p className="rounded-lg bg-rose-500/10 px-2 py-1.5 text-center text-[11px] text-rose-300">⚠️ 코인 10개 이상 — 쿠데타만 사용할 수 있습니다.</p>}
            <div className="flex flex-wrap gap-1.5">
              {ACTIONS.map((action) => {
                const cost = action === "coup" ? COUP_COST : action === "assassinate" ? ASSASSINATE_COST : 0;
                const disabled = (forced && action !== "coup") || me.coins < cost || (needsDeclareTarget(action) && aliveSeats(state).filter((s) => s !== viewerSeat).length === 0);
                const truthful = !disabled && isTruthful(action);
                return (
                  <button
                    key={action}
                    disabled={disabled}
                    onClick={() => handleActionClick(action)}
                    onPointerEnter={() => setHoverAction(action)}
                    onPointerLeave={() => setHoverAction((a) => (a === action ? null : a))}
                    onFocus={() => setHoverAction(action)}
                    onBlur={() => setHoverAction((a) => (a === action ? null : a))}
                    title={truthful ? `${CHARACTER_NAMES[claimedCharacterFor(action)!]} 보유 — 의심받아도 안전한 진실 행동` : undefined}
                    className={`relative rounded-xl border px-3 py-2 text-xs font-medium transition ${
                      disabled
                        ? "cursor-not-allowed border-white/10 text-white/25"
                        : truthful
                          ? "border-emerald-300/80 bg-emerald-400/15 text-emerald-50 shadow-[0_0_14px_-2px_rgba(52,211,153,0.75)] hover:bg-emerald-400/25"
                          : "border-amber-300/30 text-amber-100 hover:bg-amber-400/10"
                    }`}
                  >
                    {ACTION_EMOJI[action]} {ACTION_NAMES[action]}
                    {cost > 0 && <span className="ml-1 opacity-60">({cost})</span>}
                    {truthful && (
                      <span className="ml-1.5 rounded-full bg-emerald-300 px-1.5 py-px text-[9px] font-bold text-emerald-950">
                        ✓ {CHARACTER_NAMES[claimedCharacterFor(action)!]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {!isMyTurn && state.phase === "action" && <p className="mt-2 text-center text-[11px] text-white/40">{names[state.activeSeat] ?? "상대"}님의 차례를 기다리는 중...</p>}
        {!isMyTurn && !iAmResponding && state.phase !== "action" && state.phase !== "loseInfluence" && state.phase !== "exchange" && (
          <p className="mt-2 text-center text-[11px] text-white/40">다른 플레이어의 판단을 기다리는 중...</p>
        )}
      </section>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {pendingTargetAction && (
        <TargetModal
          action={pendingTargetAction}
          targets={availableTargets}
          names={names}
          onConfirm={(targetSeat) => {
            declare(pendingTargetAction, targetSeat);
            setPendingTargetAction(null);
          }}
          onCancel={() => setPendingTargetAction(null)}
        />
      )}

      {iAmResponding && (
        <ResponseDock
          state={state}
          viewerSeat={viewerSeat}
          names={names}
          myCards={myView.influence ?? []}
          myRevealed={me.revealed}
          myCoins={me.coins}
          onAction={onAction}
        />
      )}

      {iAmLosingInfluence && myView.influence && (
        <LoseInfluenceModal
          options={myView.influence}
          reason={state.pendingLoseInfluence!.reason}
          onReveal={(cardId) => onAction({ type: "revealInfluence", seat: viewerSeat, cardId, seed: Math.floor(Math.random() * 1_000_000_000) })}
        />
      )}

      {iAmExchanging && view.pendingExchangeOptions && (
        <ExchangeModal
          options={view.pendingExchangeOptions}
          keepCount={view.pendingExchangeKeepCount!}
          onConfirm={(keepCardIds) => onAction({ type: "resolveExchange", seat: viewerSeat, keepCardIds })}
        />
      )}

      {fx}
    </div>
  );
}
