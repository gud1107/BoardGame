"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RulebookModal from "./RulebookModal";
import SummonersRiftGuideSidebar from "./SummonersRiftGuideSidebar";
import { CardPileStack, HeroCard, HiddenEquipmentStack, ItemSlot, MonsterFace } from "./CardArt";
import { detectRiftPushEvent, FlyingRiftCard, type RiftPushEvent } from "./SummonersRiftEffects";
import {
  computeRankings,
  computeTotalHp,
  ITEM_CATALOG,
  MONSTER_CATALOG,
  SUCCESS_TOKENS_TO_WIN,
  FAILURE_TOKENS_TO_ELIMINATE,
  type EngineAction,
  type ItemId,
  type RoundResult,
  type SeatIndex,
  type SummonersRiftState,
} from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Every client holds the FULL state (including the exact
 * identity of `pendingDraw` and every card in the deck/Rift pile) per this
 * project's lockstep trust model, but a card's identity is meant to stay
 * secret from *opponents* by the physical rules — enforced here only: only
 * `pendingDraw.seat === viewerSeat` ever reveals the drawn monster's face,
 * and the Rift pile always renders as `DeckBack`s (see engine.ts's module
 * doc, and bang!/avalon/five-cucumbers for the same UI-only-hiding pattern).
 */
export interface SummonersRiftBoardProps {
  state: SummonersRiftState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

function combatBadge(entry: RoundResult["combatLog"][number]) {
  return entry.killedBy ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/50 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200">
      ✅ 처치
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/50 bg-rose-400/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-200">
      🩸 -{entry.damageTaken}
    </span>
  );
}

export default function SummonersRiftBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: SummonersRiftBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);

  // Diff consecutive lockstep snapshots to notice a freshly-resolved round
  // (flash banner) and freshly-pushed Rift cards (fly-in FX) — same pattern
  // as every other `<Game>Board.tsx` here (see FiveCucumbersBoard.tsx).
  const [trackedState, setTrackedState] = useState(state);
  const [roundFlash, setRoundFlash] = useState<RoundResult | null>(null);
  const [pushEvents, setPushEvents] = useState<RiftPushEvent[]>([]);
  if (trackedState !== state) {
    const newRound = state.lastRoundResult !== trackedState.lastRoundResult ? state.lastRoundResult : null;
    const push = detectRiftPushEvent(trackedState, state);
    setTrackedState(state);
    if (newRound) setRoundFlash(newRound);
    if (push) setPushEvents((prev) => [...prev, { ...push, id: (prev.at(-1)?.id ?? 0) + 1 }]);
  }
  useEffect(() => {
    if (!roundFlash) return;
    const t = setTimeout(() => setRoundFlash(null), 5200);
    return () => clearTimeout(t);
  }, [roundFlash]);
  const handlePushDone = useCallback((id: number) => {
    setPushEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const seatRowRefs = useRef(new Map<SeatIndex, HTMLElement>());
  const riftStackRef = useRef<HTMLDivElement | null>(null);
  function setSeatRowRef(seat: SeatIndex) {
    return (el: HTMLElement | null) => {
      if (el) seatRowRefs.current.set(seat, el);
      else seatRowRefs.current.delete(seat);
    };
  }

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 소환사의 협곡 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    const winner = rankings.find((r) => r.rank === 1)!;
    return (
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ borderColor: "rgba(200,170,110,0.4)", background: "linear-gradient(160deg,#1b1408 0%,#120d05 55%,#080502 100%)" }}
      >
        <span className="text-5xl">🏆</span>
        <h2 className="text-2xl font-bold" style={{ color: "#e8c77a" }}>
          {names[winner.seat]}님, 협곡의 최종 승자!
        </h2>
        <p className="max-w-sm text-xs text-white/50">
          {winner.successTokens >= SUCCESS_TOKENS_TO_WIN
            ? `성공 토큰 ${SUCCESS_TOKENS_TO_WIN}개를 가장 먼저 모아 승리했습니다.`
            : "다른 모든 소환사가 탈락해 최후의 생존자로 승리했습니다."}
        </p>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">소환사</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">성공</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">실패</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank, successTokens, failureTokens, eliminated }) => (
                <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                  <td className="border-b border-white/5 px-2 py-2 text-left font-bold" style={{ color: rank === 1 ? "#e8c77a" : undefined }}>
                    {rank === 1 ? "🏆 1" : rank}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                    {names[seat]}
                    {seat === viewerSeat && <span className="ml-1" style={{ color: "#e8c77a" }}>(나)</span>}
                    {eliminated && <span className="ml-1 text-rose-300">💀</span>}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right text-emerald-200">
                    {"🏆".repeat(successTokens) || "—"}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right text-rose-200">{"💀".repeat(failureTokens) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          onClick={onGameEnd}
          className="rounded-full px-8 py-3 font-medium text-black transition hover:brightness-110"
          style={{ background: "linear-gradient(135deg,#f0d48a,#c8933e)" }}
        >
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing
  // ---------------------------------------------------------------------
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => i);
  const isChallenger = state.challengerSeat === viewerSeat;
  const liveTotalHp = state.phase === "bidding" ? computeTotalHp(state.equippedItemIds) : state.totalHp;

  return (
    // Board card + the always-visible player-aid sidebar (task brief §4) side
    // by side on wide screens, stacked below the board on narrow ones — the
    // `[gameId]` page widens its container specifically for this game id so
    // the sidebar has room to sit beside the board instead of squeezing it.
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
      <div
        className="flex min-w-0 flex-1 flex-col gap-3 rounded-[28px] border p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
        style={{ borderColor: "rgba(200,170,110,0.3)", background: "linear-gradient(160deg,#151b28 0%,#0d121c 45%,#06090f 100%)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs" style={{ color: "#c8aa6e" }}>
          <span className="flex items-center gap-1.5">
            {state.playerCount}인 · 라운드 {state.roundNumber}
            <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50">
              🃏 덱 {state.deck.length}장
            </span>
            <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50">
              🗡️ 협곡 더미 {state.riftPile.length}장
            </span>
          </span>
          <div className="flex gap-1.5">{rulebookButton}</div>
        </div>

        {roundFlash && (
          <div className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "rgba(200,170,110,0.4)", background: "rgba(200,170,110,0.08)" }}>
            <p className={`text-center font-semibold ${roundFlash.outcome === "success" ? "text-emerald-200" : "text-rose-200"}`}>
              {roundFlash.outcome === "success"
                ? `✅ ${names[roundFlash.challengerSeat]}님이 협곡 공략 성공! (총 HP ${roundFlash.totalHp})`
                : `💀 ${names[roundFlash.challengerSeat]}님이 협곡 공략 실패...${roundFlash.newlyEliminated ? " (탈락!)" : ""}`}
            </p>
            {roundFlash.combatLog.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                {roundFlash.combatLog.map((entry, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-black/25 px-1.5 py-0.5 text-[10px] text-white/70">
                    {entry.monster.threat}
                    {combatBadge(entry)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Shared champion + item HUD */}
        <section
          className="flex flex-col gap-2 rounded-2xl border p-2.5 sm:p-3"
          style={{ borderColor: "rgba(200,170,110,0.25)", background: "linear-gradient(160deg,#1c2434 0%,#131a26 55%,#0a0e15 100%)" }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: "#c8aa6e" }}>
              ⚔️ 공유 챔피언
            </h3>
            {liveTotalHp !== null && (
              <span className="flex items-center gap-1 text-xs font-bold text-white">
                ❤️ {state.phase === "resolvingRift" || state.phase === "declaringSpatula" ? `${state.currentHp} / ${liveTotalHp}` : liveTotalHp}
              </span>
            )}
          </div>
          {/* Task brief §3: the base HP-3 champion tile, physically-set-up-style — the hero card centered above the items equipped onto it. */}
          <div className="flex justify-center">
            <HeroCard />
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {ITEM_CATALOG.map((item) => (
              <ItemSlot key={item.id} itemId={item.id} equipped={state.equippedItemIds.includes(item.id)} />
            ))}
          </div>
        </section>

        {/* Card piles: the monster draw deck (task brief §1) beside the Rift accumulation pile — both face-down, remaining count badged on top. */}
        <section className="flex flex-wrap items-start justify-center gap-4 rounded-2xl border border-white/10 bg-black/25 p-3">
          <div className="flex flex-col items-center gap-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-white/50 uppercase">🃏 던전 입장 카드더미</h3>
            <CardPileStack count={state.deck.length} emptyHint="덱 소진" />
          </div>
          <div ref={riftStackRef} className="flex flex-col items-center gap-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-white/50 uppercase">🗡️ 협곡 더미</h3>
            {state.riftPile.length === 0 && state.phase === "bidding" ? (
              <div className="flex h-16 w-12 items-center justify-center">
                <p className="text-center text-[9px] leading-tight text-white/30">아직 없음</p>
              </div>
            ) : (
              <CardPileStack count={state.riftPile.length} />
            )}

            {/* Dungeon phase: current reveal slot — keyed remount replays the flip/resolve animation each new combatLog entry (task brief §2 "카드 제거 애니메이션"). */}
            {state.phase === "resolvingRift" && state.combatLog.length > 0 && (
              <div
                key={state.combatLog.length}
                className="flex flex-col items-center gap-1"
                style={{
                  animation: state.combatLog.at(-1)!.killedBy
                    ? "rift-monster-flip 0.4s ease-out, rift-monster-slay 0.5s ease-in 1.1s forwards"
                    : "rift-monster-flip 0.4s ease-out, rift-monster-strike 0.6s ease-in 1.1s forwards",
                }}
              >
                <MonsterFace threat={state.combatLog.at(-1)!.monster.threat} size="md" />
                {combatBadge(state.combatLog.at(-1)!)}
              </div>
            )}
          </div>
        </section>

        <TurnPanel state={state} viewerSeat={viewerSeat} me={me} isChallenger={isChallenger} onAction={onAction} />

        {/* Scoreboard */}
        <section className="flex flex-col gap-1.5">
          {seatOrder.map((seat) => {
            const p = state.players.find((pl) => pl.seat === seat)!;
            const isActive = state.activeSeat === seat && !p.eliminated;
            const isSelf = seat === viewerSeat;
            return (
              <div
                key={seat}
                ref={setSeatRowRef(seat)}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-xs transition ${
                  p.eliminated ? "border-white/5 bg-black/10 opacity-50" : isActive ? "bg-amber-400/10" : "border-white/10 bg-black/20"
                }`}
                style={isActive ? { borderColor: "rgba(200,170,110,0.6)" } : undefined}
              >
                <span className="flex items-center gap-1.5 font-semibold text-white/90">
                  <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                  {isActive && <span title="차례">👉</span>}
                  {state.challengerSeat === seat && (state.phase === "declaringSpatula" || state.phase === "resolvingRift") && <span title="도전자">🛡️</span>}
                  {names[seat]}
                  {isSelf && <span style={{ color: "#e8c77a" }}>(나)</span>}
                  {p.passed && state.phase === "bidding" && <span className="text-white/40">(패스)</span>}
                  {p.eliminated && <span className="text-rose-300">💀 탈락</span>}
                </span>
                {/* Task brief §2: who pulled which item off the champion this round — a face-down hidden-monster marker with every item they've removed fanned on top, right beside their row. */}
                <HiddenEquipmentStack removedItemIds={p.removedItemIds} />
                <div className="flex items-center gap-2 text-white/70">
                  <span title={`성공 ${p.successTokens}/${SUCCESS_TOKENS_TO_WIN}`}>{"🏆".repeat(p.successTokens)}{"·".repeat(Math.max(0, SUCCESS_TOKENS_TO_WIN - p.successTokens))}</span>
                  <span title={`실패 ${p.failureTokens}/${FAILURE_TOKENS_TO_ELIMINATE}`}>{"💀".repeat(p.failureTokens)}{"·".repeat(Math.max(0, FAILURE_TOKENS_TO_ELIMINATE - p.failureTokens))}</span>
                </div>
              </div>
            );
          })}
        </section>

        {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

        {/* Rift-pile accumulation FX (task brief §2): pushing seat's row -> the pile stack. */}
        {pushEvents.map((event) => (
          <FlyingRiftCard
            key={event.id}
            event={event}
            getSourceEl={() => seatRowRefs.current.get(event.seat) ?? null}
            getTargetEl={() => riftStackRef.current}
            onDone={handlePushDone}
          />
        ))}
      </div>

      <SummonersRiftGuideSidebar />
    </div>
  );
}

/** The current-turn action panel — what it shows/allows depends entirely on `state.phase` + whether the viewer is the active/challenger seat. */
function TurnPanel({
  state,
  viewerSeat,
  me,
  isChallenger,
  onAction,
}: {
  state: SummonersRiftState;
  viewerSeat: SeatIndex;
  me: SummonersRiftState["players"][number];
  isChallenger: boolean;
  onAction: (action: EngineAction) => void;
}) {
  const panelStyle = { borderColor: "rgba(200,170,110,0.25)", background: "linear-gradient(160deg,#20180a 0%,#150f06 55%,#0a0603 100%)" };

  if (state.phase === "bidding") {
    const isMyTurn = state.activeSeat === viewerSeat && !me.eliminated;
    if (state.pendingDraw && state.pendingDraw.seat === viewerSeat) {
      const card = state.pendingDraw.card;
      return (
        <section className="flex flex-col items-center gap-3 rounded-2xl border p-3" style={panelStyle}>
          <p className="text-xs font-medium" style={{ color: "#e8c77a" }}>
            🫵 방금 뽑은 몬스터입니다 — 나만 볼 수 있어요. 협곡에 넣거나, 아이템 하나를 해제해 숨기세요.
          </p>
          <MonsterFace threat={card.threat} size="lg" />
          <div className="flex flex-wrap justify-center gap-1.5">
            <button
              onClick={() => onAction({ type: "pushToRift", seat: viewerSeat })}
              className="rounded-full px-4 py-2 text-xs font-semibold text-black transition hover:brightness-110"
              style={{ background: "linear-gradient(135deg,#e05a5a,#a12f2f)" }}
            >
              🗡️ 협곡에 집어넣기
            </button>
          </div>
          <p className="text-[10px] text-white/40">또는 아래 아이템 중 하나를 눌러 해제하고 이 카드를 숨기세요:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {ITEM_CATALOG.filter((i) => state.equippedItemIds.includes(i.id)).map((item) => (
              <button key={item.id} onClick={() => onAction({ type: "removeItem", seat: viewerSeat, itemId: item.id as ItemId })}>
                <ItemSlot itemId={item.id} equipped size="sm" />
              </button>
            ))}
          </div>
        </section>
      );
    }
    if (state.pendingDraw) {
      return (
        <section className="rounded-2xl border p-3 text-center" style={panelStyle}>
          <p className="text-xs text-white/60">{`${state.pendingDraw.seat + 1}번 소환사가 방금 뽑은 카드를 확인하는 중...`}</p>
        </section>
      );
    }
    if (isMyTurn) {
      return (
        <section className="flex flex-col items-center gap-2 rounded-2xl border p-3" style={panelStyle}>
          <p className="text-xs font-medium" style={{ color: "#e8c77a" }}>
            🫵 당신 차례입니다!
          </p>
          <div className="flex gap-2">
            <button
              disabled={state.deck.length === 0}
              onClick={() => onAction({ type: "drawCard", seat: viewerSeat })}
              className="rounded-full px-5 py-2.5 text-xs font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
              style={{ background: "linear-gradient(135deg,#f0d48a,#c8933e)" }}
            >
              🃏 카드 뽑기
            </button>
            <button
              onClick={() => onAction({ type: "pass", seat: viewerSeat })}
              className="rounded-full border border-white/20 px-5 py-2.5 text-xs font-semibold text-white/80 transition hover:border-white/40"
            >
              🏳️ 패스
            </button>
          </div>
          {state.deck.length === 0 && <p className="text-[10px] text-rose-300">몬스터 덱이 모두 떨어져 패스만 할 수 있습니다.</p>}
        </section>
      );
    }
    return (
      <section className="rounded-2xl border p-3 text-center" style={panelStyle}>
        <p className="text-xs text-white/50">
          {me.eliminated ? "탈락했습니다 — 이번 게임을 구경하는 중..." : me.passed ? "이번 라운드는 패스했습니다 — 결과를 기다리는 중..." : `소환사 차례를 기다리는 중...`}
        </p>
      </section>
    );
  }

  if (state.phase === "declaringSpatula") {
    if (!isChallenger) {
      return (
        <section className="rounded-2xl border p-3 text-center" style={panelStyle}>
          <p className="text-xs text-white/60">🛡️ 도전자가 황금 뒤집개로 지정할 몬스터를 고르는 중...</p>
        </section>
      );
    }
    return (
      <section className="flex flex-col items-center gap-2 rounded-2xl border p-3" style={panelStyle}>
        <p className="text-xs font-medium" style={{ color: "#e8c77a" }}>
          🥄 황금 뒤집개로 협곡 진입 전 무력화할 몬스터 1종류를 지정하세요.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {MONSTER_CATALOG.map((m) => (
            <button key={m.threat} onClick={() => onAction({ type: "declareSpatula", seat: viewerSeat, monsterThreat: m.threat })}>
              <MonsterFace threat={m.threat} size="sm" />
            </button>
          ))}
        </div>
      </section>
    );
  }

  // resolvingRift
  if (!isChallenger) {
    return (
      <section className="rounded-2xl border p-3 text-center" style={panelStyle}>
        <p className="text-xs text-white/60">🛡️ {`도전자가 협곡을 공략하는 중... (남은 몬스터 ${state.riftPile.length}마리)`}</p>
      </section>
    );
  }
  return (
    <section className="flex flex-col items-center gap-2 rounded-2xl border p-3" style={panelStyle}>
      <p className="text-xs font-medium" style={{ color: "#e8c77a" }}>
        🛡️ 당신이 협곡 최종 도전자입니다! HP {state.currentHp} / {state.totalHp} · 남은 몬스터 {state.riftPile.length}마리
      </p>
      {state.spatulaDeclaredThreat !== null && (
        <p className="text-[10px] text-white/40">🥄 지정한 몬스터: 위협도 {state.spatulaDeclaredThreat}</p>
      )}
      <button
        onClick={() => onAction({ type: "revealNextMonster", seat: viewerSeat })}
        className="rounded-full px-6 py-2.5 text-xs font-semibold text-black transition hover:brightness-110"
        style={{ background: "linear-gradient(135deg,#e05a5a,#a12f2f)" }}
      >
        ⚔️ 다음 몬스터 공개
      </button>
    </section>
  );
}
