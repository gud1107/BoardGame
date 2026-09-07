"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/common/Avatar";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import RulebookModal from "./RulebookModal";
import { CasinoTile, money } from "./CasinoTile";
import { CompactCasinoBoard } from "./CompactCasinoBoard";
import { useIsMobile } from "./useIsMobile";
import { DiceFace, diceColorForSeat, NEUTRAL_DICE_COLOR } from "./DiceIcon";
import { detectPlacementEvent, FlyingDicePlacement, PayoutMoneyFly, type PlacementEvent } from "./DiceEffects";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import {
  computeRankings,
  NEUTRAL_OWNER,
  tallyDiceGroups,
  type CasinoNumber,
  type EngineAction,
  type Face,
  type LasVegasState,
  type RolledDie,
  type SeatIndex,
} from "./engine";

/**
 * Pure game UI + rules driver — same controlled-component contract as every
 * other `<Game>Board.tsx` in this project (state via props only, intent out
 * via `onAction`). Unlike five-cucumbers/splendor, there is no hidden
 * information here at all (every die and bill is public the instant it's
 * placed/dealt, per the physical rules) — so, unusually for this project,
 * `LasVegasBoard` doesn't need any "hide the other seats' X" logic.
 */
export interface LasVegasBoardProps {
  state: LasVegasState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/**
 * 2026-08-23 요청: shared roll-result viewer, sitting between the casino
 * grid and the scoreboard ("플레이어와 배팅카드 가운데로 배치") — shows
 * whichever seat just rolled, mine or an opponent's, with the exact same
 * full face-by-face breakdown either way, since the rulebook has no hidden
 * information here (every rolled die is public the instant it's rolled).
 * Replaces the previous "내 주사위" tray's `currentRoll` rendering, which
 * displayed the active roll under a fixed "내 주사위" label even during an
 * opponent's turn — this panel labels itself dynamically per `activeSeat`
 * instead. The "선택 후 배치" buttons live here too, since they only ever
 * make sense right next to the actual rolled dice. Always mounted (even
 * with `roll === null`, showing an idle placeholder) so `panelRef` stays a
 * stable `FlyingDicePlacement` source across the very state transition that
 * clears `currentRoll` on placement.
 *
 * 2026-08-23 요청 (2차): the old roll-cup 🎲 flourish that used to shake
 * here on every roll (`lasvegas-cup-shake`) never actually left the DOM
 * once `rollFlashId` ticked past 0 — it just sat parked over this panel's
 * heading for the rest of the game, exactly the "매번 흔들리며... 시야를
 * 방해하던 흰색 주사위" the user flagged. Removed outright (confirmed with
 * the user before removal) — `rollFlashId` is kept only as the `key` that
 * remounts the roll display below so `dice-roll-tumble`'s per-die stagger
 * replays on every fresh roll, same as before.
 *
 * Same request also added two new at-a-glance counters, both scoped to
 * `isMyTurn` since the rulebook phrasing ("내가 굴린") is first-person:
 *  - a compact icon+"×N" summary of this roll's own face tally, right under
 *    the heading, so "how many of each face did I get" reads instantly
 *    without counting the individual dice below it.
 *  - each placement button's subtitle showing "기존 A개 + 신규 B개 → 총
 *    C개" whenever this seat already has `A` of their own dice sitting at
 *    that face's casino (via `existingOwnCounts`, read from
 *    `casino.diceCounts[viewerSeat]` — same source `scoreMove`'s bot logic
 *    already reads as `myExisting` in engine.ts) — falls back to the plain
 *    "(N개)" label when there's nothing there yet, so the common case stays
 *    uncluttered.
 */
function RollViewerPanel({
  roll,
  activeSeat,
  isMyTurn,
  names,
  rollGroups,
  existingOwnCounts,
  onPlace,
  rollFlashId,
  panelRef,
}: {
  roll: RolledDie[] | null;
  activeSeat: SeatIndex;
  isMyTurn: boolean;
  names: Record<SeatIndex, string>;
  rollGroups: { face: Face; ownCount: number; neutralCount: number }[];
  existingOwnCounts: Partial<Record<Face, number>>;
  onPlace: (face: Face) => void;
  rollFlashId: number;
  panelRef: (el: HTMLDivElement | null) => void;
}) {
  const rollerColor = diceColorForSeat(activeSeat);
  return (
    <section
      ref={panelRef}
      className="relative flex min-h-[64px] flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-amber-300/20 p-2.5 sm:p-3"
      style={{ background: "linear-gradient(160deg,#332008 0%,#1c1204 55%,#0a0601 100%)" }}
    >
      {roll ? (
        <div key={rollFlashId} className="flex w-full flex-col items-center gap-2">
          <h3 className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: rollerColor }}>
            {isMyTurn ? "🫵 당신이 굴린 주사위" : `🎲 ${names[activeSeat]}님이 굴린 주사위`} ({roll.length}개)
          </h3>
          {/* Roll summary (2026-08-23 요청 4): icon+"×N" per face, at a glance
              before scanning the individual dice below. Mine only ("내가
              굴린" is first-person in the request). */}
          {isMyTurn && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {rollGroups.map((g) => (
                <span key={g.face} className="flex items-center gap-1 rounded-full border border-amber-300/25 bg-black/25 px-1.5 py-0.5">
                  <DiceFace face={g.face} color={rollerColor} size="h-4 w-4" />
                  <span className="text-[10px] font-bold text-amber-100">×{g.ownCount + g.neutralCount}개</span>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-1.5">
            {roll.map((d, i) => (
              <div key={i} style={{ animation: `dice-roll-tumble 0.5s ease-out ${(i % 12) * 25}ms both` }}>
                <DiceFace face={d.face} color={d.owner === "own" ? rollerColor : NEUTRAL_DICE_COLOR} size="h-8 w-8" />
              </div>
            ))}
          </div>
          {isMyTurn && (
            <div className="flex flex-wrap justify-center gap-2">
              {rollGroups.map((g) => {
                const existing = existingOwnCounts[g.face] ?? 0;
                const incoming = g.ownCount + g.neutralCount;
                return (
                  <button
                    key={g.face}
                    onClick={() => onPlace(g.face)}
                    className="flex items-center gap-1.5 rounded-xl border border-amber-300/50 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/20"
                  >
                    <DiceFace face={g.face} color="#f4f4f5" size="h-5 w-5" />
                    <span className="flex flex-col items-start leading-tight">
                      <span>눈금 {g.face} 전체 배치</span>
                      <span className="text-[10px] font-normal text-amber-200/70">
                        {existing > 0 ? `기존 ${existing}개 + 신규 ${incoming}개 → 총 ${existing + incoming}개` : `${incoming}개`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-white/25">🎲 다음 굴림을 기다리는 중...</p>
      )}
    </section>
  );
}

export default function LasVegasBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: LasVegasBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  // Mobile-only compact zero-scroll dashboard branch (2026-09-07 요청) — see
  // useIsMobile.ts's doc for why only one of the two layout trees below is
  // ever mounted at a time (ref-callback collisions with the flying-dice FX).
  const isMobile = useIsMobile();

  // Diff consecutive lockstep snapshots to drive the dice-placement flight
  // FX — same technique as five-cucumbers/CardEffects.tsx, see DiceEffects.tsx.
  const [trackedState, setTrackedState] = useState(state);
  const [placementEvents, setPlacementEvents] = useState<PlacementEvent[]>([]);
  const [rollFlashId, setRollFlashId] = useState(0);
  // Per-casino key-remount counters (0 = "never played yet") driving the
  // placement-impact ring/shake and the tie-just-happened X-clash flourish
  // in `CasinoTile` — bumping the relevant casino's counter replays its CSS
  // animation with no timers needed, same idiom as `rollFlashId` above.
  const [impactKeys, setImpactKeys] = useState<Partial<Record<CasinoNumber, number>>>({});
  const [clashKeys, setClashKeys] = useState<Partial<Record<CasinoNumber, number>>>({});
  if (trackedState !== state) {
    const placement = detectPlacementEvent(trackedState, state);
    const justRolled = trackedState.currentRoll === null && state.currentRoll !== null;
    // Tie-clash detection: for each casino, did a dice owner newly become
    // "tied" this tick (per the live `tallyDiceGroups` read, not
    // `state.settlement` — that's only ever set once at game end)?
    const newlyClashedCasinos = state.casinos.filter((casino) => {
      const before = trackedState.casinos.find((c) => c.number === casino.number);
      const prevTied = new Set(tallyDiceGroups(before?.diceCounts ?? {}).filter((g) => g.tied).map((g) => g.owner));
      const nowTied = tallyDiceGroups(casino.diceCounts).filter((g) => g.tied);
      return nowTied.some((g) => !prevTied.has(g.owner));
    });
    setTrackedState(state);
    if (placement) setPlacementEvents((prev) => [...prev, { ...placement, id: (prev.at(-1)?.id ?? 0) + 1 }]);
    if (justRolled) {
      setRollFlashId((n) => n + 1);
      getSoundEngine().playCasinoDiceRoll();
    }
    if (newlyClashedCasinos.length > 0) {
      setClashKeys((prev) => {
        const next = { ...prev };
        for (const c of newlyClashedCasinos) next[c.number] = (next[c.number] ?? 0) + 1;
        return next;
      });
      getSoundEngine().playTieSpark();
    }
  }
  const handlePlacementDone = useCallback(
    (id: number) => {
      const landed = placementEvents.find((e) => e.id === id);
      if (landed) {
        setImpactKeys((prev) => ({ ...prev, [landed.casino]: (prev[landed.casino] ?? 0) + 1 }));
        getSoundEngine().playChipSettle();
      }
      setPlacementEvents((prev) => prev.filter((e) => e.id !== id));
    },
    [placementEvents],
  );

  const casinoTileRefs = useRef(new Map<CasinoNumber, HTMLDivElement>());
  // 2026-08-23 요청: the roll viewer is now a single shared panel (see
  // `RollViewerPanel` below) that shows whichever seat just rolled, mine or
  // an opponent's — so every placement's flight now starts from this one
  // ref regardless of who placed, instead of the old per-seat scoreboard-row
  // source. Always mounted (see its own doc) so this ref stays valid across
  // the very state transition that clears `currentRoll`.
  const rollPanelRef = useRef<HTMLDivElement | null>(null);
  function setCasinoTileRef(n: CasinoNumber) {
    return (el: HTMLDivElement | null) => {
      if (el) casinoTileRefs.current.set(n, el);
      else casinoTileRefs.current.delete(n);
    };
  }

  // Payout FX (game-over screen only): once per game-over, fly the #1
  // seat(s)' own won bills from the trophy header into their ranking row's
  // money badge (see `PayoutMoneyFly` in DiceEffects.tsx). A ref-guarded
  // one-shot rather than a state diff, since there's no further mid-game
  // state to diff once `phase === "gameOver"` — this only ever fires once.
  const trophyRef = useRef<HTMLSpanElement | null>(null);
  const winnerMoneyRefs = useRef(new Map<SeatIndex, HTMLElement>());
  const [payoutQueue, setPayoutQueue] = useState<SeatIndex[]>([]);
  const payoutStartedRef = useRef(false);
  useEffect(() => {
    if (state.phase === "gameOver" && state.settlement && !payoutStartedRef.current) {
      payoutStartedRef.current = true;
      setPayoutQueue(computeRankings(state).filter((r) => r.rank === 1).map((r) => r.seat));
      // 지폐 세는 소리(MONEY_COLLECT 매핑 — AskUserQuestion으로 확정, 2026-08-27 세션 오후) — 트로피에서 지폐가 날아가기 시작하는 순간 1회.
      getSoundEngine().playBillCount();
    }
  }, [state]);
  function setWinnerMoneyRef(seat: SeatIndex) {
    return (el: HTMLElement | null) => {
      if (el) winnerMoneyRefs.current.set(seat, el);
      else winnerMoneyRefs.current.delete(seat);
    };
  }

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 라스베가스 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver" && state.settlement) {
    const rankings = computeRankings(state);
    const winners = rankings.filter((r) => r.rank === 1);
    const tied = winners.length > 1;
    return (
      <div
        className="relative flex flex-col items-center gap-5 rounded-[28px] border border-black/60 p-6 text-center shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-8"
        style={{ background: "linear-gradient(160deg,#241405 0%,#170d02 55%,#0a0601 100%)" }}
      >
        <span ref={trophyRef} className="text-5xl">
          {tied ? "🎰" : "🏆"}
        </span>
        <h2 className="text-2xl font-bold text-amber-100">
          {tied ? "공동 우승!" : `${names[winners[0].seat]}님 최고 상금 획득 승리!`}
        </h2>
        <p className="text-xs text-white/50">6개 카지노 정산이 모두 끝났습니다. 총상금이 가장 많은 사람이 승리합니다.</p>

        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">총상금</th>
                <th className="border-b border-white/10 px-2 py-2 text-right">지폐 장수</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank, total, billCount }) => (
                <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                  <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200">{rank === 1 ? "🏆 1" : rank}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                    <span className="flex items-center gap-1.5">
                      <Avatar size={20} />
                      {names[seat]}
                      {seat === viewerSeat && <span className="text-amber-200">(나)</span>}
                    </span>
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right">
                    <span
                      ref={rank === 1 ? setWinnerMoneyRef(seat) : undefined}
                      className={`inline-block rounded-full px-2 py-0.5 font-semibold text-emerald-200 ${
                        rank === 1 ? "bg-amber-400/10" : ""
                      }`}
                      style={rank === 1 ? { animation: "lasvegas-gold-burst-pulse 1.8s ease-in-out infinite" } : undefined}
                    >
                      {money(total)}
                    </span>
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right text-white/60">{billCount}장</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Payout FX: winner(s)' own bills fly from the trophy above into their money badge, once. */}
        {payoutQueue.map((seat) => (
          <PayoutMoneyFly
            key={seat}
            bills={state.players.find((p) => p.seat === seat)?.money ?? []}
            getSourceEl={() => trophyRef.current}
            getTargetEl={() => winnerMoneyRefs.current.get(seat) ?? null}
            onDone={() => setPayoutQueue((prev) => prev.filter((s) => s !== seat))}
          />
        ))}

        <details className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left text-[11px] text-white/60">
          <summary className="cursor-pointer text-white/80">카지노별 정산 내역 보기</summary>
          <div className="mt-2 flex flex-col gap-2">
            {state.settlement.map((s) => (
              <div key={s.casino} className="rounded-lg border border-white/10 p-2">
                <p className="font-semibold text-white/80">카지노 {s.casino}</p>
                {s.cancelledOwners.length > 0 && (
                  <p className="text-rose-300">
                    ⚔️ 동률 상쇄:{" "}
                    {s.cancelledOwners.map((o) => (o === NEUTRAL_OWNER ? "중립" : names[o as SeatIndex])).join(", ")}
                  </p>
                )}
                {s.awards.length === 0 ? (
                  <p className="text-white/40">획득자 없음</p>
                ) : (
                  s.awards.map((a, i) => (
                    <p key={i} className="text-white/70">
                      {a.owner === NEUTRAL_OWNER ? "중립" : names[a.owner as SeatIndex]} (주사위 {a.diceCount}개) →{" "}
                      {a.bill === null ? "지폐 없음" : a.owner === NEUTRAL_OWNER ? `${money(a.bill)} (버려짐)` : money(a.bill)}
                    </p>
                  ))
                )}
              </div>
            ))}
          </div>
        </details>

        <button onClick={onGameEnd} className="rounded-full bg-amber-500 px-8 py-3 font-medium text-black transition hover:bg-amber-400">
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Playing
  // ---------------------------------------------------------------------
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const isMyTurn = state.activeSeat === viewerSeat;
  const myDiceInHand = me.ownDiceInHand + me.neutralDiceInHand;
  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => i);

  const rollGroups: { face: Face; ownCount: number; neutralCount: number }[] = [];
  if (state.currentRoll) {
    for (let face = 1 as Face; face <= 6; face++) {
      const dice = state.currentRoll.filter((d) => d.face === face);
      if (dice.length === 0) continue;
      rollGroups.push({
        face,
        ownCount: dice.filter((d) => d.owner === "own").length,
        neutralCount: dice.filter((d) => d.owner === "neutral").length,
      });
    }
  }
  // 2026-08-23 요청 5: this seat's own dice already committed at each
  // casino, keyed by face (== casino number) — same read as `scoreMove`'s
  // `myExisting` in engine.ts — so `RollViewerPanel` can show "기존 A개 +
  // 신규 B개 → 총 C개" per placement button.
  const existingOwnCounts: Partial<Record<Face, number>> = {};
  for (const casino of state.casinos) existingOwnCounts[casino.number] = casino.diceCounts[viewerSeat] ?? 0;

  function roll() {
    if (!isMyTurn || state.currentRoll || myDiceInHand === 0) return;
    getSoundEngine().unlock();
    onAction({ type: "rollDice", seat: viewerSeat, seed: randomSeed() });
  }
  function place(face: Face) {
    if (!isMyTurn || !state.currentRoll) return;
    onAction({ type: "placeDice", seat: viewerSeat, face });
  }

  // Shared across both layout trees — FX portals to document.body regardless
  // of where their JSX sits, and the rulebook modal is a fixed overlay too,
  // so both stay identical between the mobile and desktop branches below.
  const sharedOverlays = (
    <>
      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
      {placementEvents.map((event) => (
        <FlyingDicePlacement
          key={event.id}
          event={event}
          getSourceEl={() => rollPanelRef.current}
          getTargetEl={() => casinoTileRefs.current.get(event.casino) ?? null}
          onDone={handlePlacementDone}
        />
      ))}
    </>
  );

  if (isMobile) {
    return (
      <>
        <MyTurnOverlay isMyTurn={isMyTurn} />
        <CompactCasinoBoard
          state={state}
          viewerSeat={viewerSeat}
          names={names}
          connectedSeats={connectedSeats}
          isMyTurn={isMyTurn}
          myDiceInHand={myDiceInHand}
          seatOrder={seatOrder}
          rollGroups={rollGroups}
          existingOwnCounts={existingOwnCounts}
          rollFlashId={rollFlashId}
          impactKeys={impactKeys}
          clashKeys={clashKeys}
          onRoll={roll}
          onPlace={place}
          setCasinoTileRef={setCasinoTileRef}
          setRollPanelRef={(el) => {
            rollPanelRef.current = el;
          }}
          onOpenRulebook={() => setRulebookOpen(true)}
        />
        {sharedOverlays}
      </>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
      style={{ background: "linear-gradient(160deg,#1b1004 0%,#120b03 45%,#080502 100%)" }}
    >
      <MyTurnOverlay isMyTurn={isMyTurn} />
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-amber-100/70">
        <span>🎰 {state.playerCount}인 · 단판 승부 · 모든 주사위를 카지노에 배치하면 정산됩니다</span>
        <div className="flex gap-1.5">{rulebookButton}</div>
      </div>

      <p className={`text-center text-xs font-medium ${isMyTurn ? "text-amber-200" : "text-white/50"}`}>
        {isMyTurn
          ? state.currentRoll
            ? "🫵 당신 차례입니다! 배치할 눈금을 선택하세요."
            : "🫵 당신 차례입니다! 주사위를 굴리세요."
          : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
      </p>

      {/* Casino boards — table-mat tiles, full theme art with dice/money laid on top. */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {state.casinos.map((casino) => (
          <CasinoTile
            key={casino.number}
            casino={casino}
            viewerSeat={viewerSeat}
            names={names}
            isRollDestination={isMyTurn && rollGroups.some((g) => g.face === casino.number)}
            impactKey={impactKeys[casino.number] ?? 0}
            clashKey={clashKeys[casino.number] ?? 0}
            tileRef={setCasinoTileRef(casino.number)}
          />
        ))}
      </section>

      {/* Roll viewer — shared panel between the betting cards and the player list (2026-08-23 요청 "플레이어와 배팅카드 가운데로 배치"), shows whoever just rolled. */}
      <RollViewerPanel
        roll={state.currentRoll}
        activeSeat={state.activeSeat}
        isMyTurn={isMyTurn}
        names={names}
        rollGroups={rollGroups}
        existingOwnCounts={existingOwnCounts}
        onPlace={place}
        rollFlashId={rollFlashId}
        panelRef={(el) => {
          rollPanelRef.current = el;
        }}
      />

      {/* Scoreboard — each seat's own dice color is now a bold neon border/badge (2026-08-23 요청), not just a small dot, so "whose color is this" reads at a glance. */}
      <section className="flex flex-col gap-1.5">
        {seatOrder.map((seat) => {
          const p = state.players.find((pl) => pl.seat === seat)!;
          const isActive = state.activeSeat === seat;
          const isSelf = seat === viewerSeat;
          const total = p.money.reduce((s, v) => s + v, 0);
          const seatColor = diceColorForSeat(seat);
          return (
            <div
              key={seat}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 bg-black/20 p-2 text-xs transition"
              style={{
                borderColor: seatColor,
                boxShadow: `0 0 0 1px ${seatColor}55, 0 0 14px -2px ${seatColor}aa${isActive ? ", 0 0 22px 2px rgba(252,211,77,0.4)" : ""}`,
                background: isActive
                  ? `linear-gradient(90deg, ${seatColor}22 0%, rgba(0,0,0,0.2) 60%)`
                  : `linear-gradient(90deg, ${seatColor}14 0%, rgba(0,0,0,0.2) 45%)`,
              }}
            >
              <span className="flex items-center gap-2 font-semibold text-white/90">
                <Avatar size={20} />
                <span
                  className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-black text-black shadow-[0_0_8px_2px_rgba(255,255,255,0.25)]"
                  style={{ background: seatColor }}
                  title={`${names[seat]}의 주사위 색상`}
                >
                  {seat + 1}
                </span>
                <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                {isActive && <span title="차례">👉</span>}
                {names[seat]}
                {isSelf && <span className="text-amber-200">(나)</span>}
              </span>
              <div className="flex items-center gap-3 text-white/70">
                <span title="남은 주사위">🎲 {p.ownDiceInHand + p.neutralDiceInHand}개</span>
                <span className="flex items-center gap-1 rounded-full border border-emerald-300/30 px-2 py-0.5 font-bold text-emerald-200">
                  {money(total)} · {p.money.length}장
                </span>
              </div>
            </div>
          );
        })}
      </section>

      {/* My dice tray — personal hand reserve + roll trigger only now; the actual rolled dice and placement choice moved into the shared RollViewerPanel above (2026-08-23 요청). */}
      <section
        className="relative overflow-hidden rounded-2xl border border-amber-300/20 p-2.5 sm:p-3"
        style={{ background: "linear-gradient(160deg,#332008 0%,#1c1204 55%,#0a0601 100%)" }}
      >
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-amber-200/90 uppercase">
          🎲 내 주사위 ({me.ownDiceInHand}개 + 중립 {me.neutralDiceInHand}개)
        </h3>

        {state.currentRoll ? (
          <p className="text-xs text-white/30">
            {isMyTurn ? "☝️ 위 롤 뷰어에서 배치할 눈금을 선택하세요." : "☝️ 위 롤 뷰어에서 결과를 확인할 수 있습니다."}
          </p>
        ) : myDiceInHand === 0 ? (
          <p className="text-xs text-white/30">배치할 주사위가 남지 않았습니다 — 자동 패스됩니다.</p>
        ) : isMyTurn ? (
          <button
            onClick={roll}
            className="rounded-full bg-amber-500 px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-amber-400"
          >
            🎲 주사위 굴리기 ({myDiceInHand}개)
          </button>
        ) : (
          <p className="text-xs text-white/30">차례를 기다리는 중...</p>
        )}
      </section>

      {sharedOverlays}
    </div>
  );
}
