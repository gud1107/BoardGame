"use client";

import { useCallback, useRef, useState } from "react";
import RulebookModal from "./RulebookModal";
import { CasinoTileArt, CASINO_THEME_NAMES } from "./CasinoEmblem";
import { DiceFace, diceColorForSeat, NEUTRAL_DICE_COLOR } from "./DiceIcon";
import { detectPlacementEvent, FlyingDicePlacement, type PlacementEvent } from "./DiceEffects";
import {
  computeRankings,
  NEUTRAL_OWNER,
  type CasinoNumber,
  type CasinoState,
  type EngineAction,
  type Face,
  type LasVegasState,
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

function money(v: number): string {
  return `$${v.toLocaleString("en-US")}`;
}

// Per-casino neon frame color — an inner gold hairline (via inset box-shadow,
// applied once in CasinoTile below) stays constant across all 6 for the
// "luxury casino frame" read, while this outer border carries each casino's
// own accent so the 6 tiles stay tell-apart-able at a glance even before you
// register the background art.
const CASINO_ACCENTS: Record<CasinoNumber, { border: string }> = {
  1: { border: "border-amber-300/70" },
  2: { border: "border-orange-300/70" },
  3: { border: "border-pink-300/70" },
  4: { border: "border-rose-400/70" },
  5: { border: "border-teal-300/70" },
  6: { border: "border-sky-300/70" },
};

function DiceBadge({ owner, count, seat }: { owner: string; count: number; seat?: SeatIndex }) {
  const color = owner === NEUTRAL_OWNER ? NEUTRAL_DICE_COLOR : diceColorForSeat(seat!);
  return (
    <span className="flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold text-white/80">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      ×{count}
    </span>
  );
}

/**
 * "Table mat" casino tile — the full 3:4 rectangle is the casino's theme art
 * (`CasinoTileArt`), with the number badge, money card and dice pool laid on
 * top of it as an overlay (see design decisions in HANDOFF.md's Las Vegas
 * section: full-bleed SVG art kept in the existing no-external-image style,
 * 3:4 portrait tiles, medium-tone vignette/glass for legibility, corner
 * badge). `isRollDestination` drives the gold glow-pulse ring: true while
 * the viewer has an active roll whose chosen-face buttons would send dice to
 * *this* casino — i.e. exactly the moment "betting on this casino" is live.
 */
function CasinoTile({
  casino,
  viewerSeat,
  isRollDestination,
  tileRef,
}: {
  casino: CasinoState;
  viewerSeat: SeatIndex;
  isRollDestination: boolean;
  tileRef: (el: HTMLDivElement | null) => void;
}) {
  const accent = CASINO_ACCENTS[casino.number];
  const groups = (Object.entries(casino.diceCounts) as [string, number][]).filter(([, c]) => c > 0);
  const topBill = casino.bills[0];
  const restCount = casino.bills.length - 1;
  const restTotal = casino.bills.slice(1).reduce((s, v) => s + v, 0);
  const iHaveDiceHere = groups.some(([owner]) => owner !== NEUTRAL_OWNER && Number(owner) === viewerSeat);

  return (
    <div
      ref={tileRef}
      className={`relative aspect-[3/4] w-full overflow-hidden rounded-2xl border-2 ${accent.border} shadow-[inset_0_0_0_1px_rgba(252,211,77,0.4)] transition-shadow duration-300 hover:shadow-[inset_0_0_0_1px_rgba(252,211,77,0.4),0_0_20px_-6px_rgba(252,211,77,0.65)]`}
      style={isRollDestination ? { animation: "lasvegas-mat-glow-pulse 1.6s ease-in-out infinite" } : undefined}
    >
      {/* Background layer: full-tile theme art, "cover"-filled (see CasinoTileArt). */}
      <CasinoTileArt casino={casino.number} className="absolute inset-0 h-full w-full" />

      {/* Medium-tone vignette + bottom-up glass wash so money/dice text stays readable over any part of the art. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-black/10 to-black/85" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 65% at 50% 6%, transparent 40%, rgba(0,0,0,0.4) 100%)" }}
      />

      {/* Top-left corner badge: die-pip number + theme name. */}
      <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full border border-white/25 bg-black/55 py-0.5 pl-0.5 pr-2 backdrop-blur-sm">
        <DiceFace face={casino.number} color="#f4f4f5" size="h-4 w-4" />
        <span className="text-[9px] font-bold whitespace-nowrap text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
          {CASINO_THEME_NAMES[casino.number].ko}
        </span>
      </div>

      {/* Money card + dice pool "sitting" on the mat, bottom-anchored. The
          top bill and the "+N more" badge are stacked (not overlaid) so a
          casino with several bills never garbles the headline amount —
          see HANDOFF.md's Las Vegas section for the overlap this replaced. */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 p-2">
        <div className="flex h-14 w-16 flex-col items-center justify-center">
          {topBill !== undefined ? (
            <div className="grid h-full w-full place-items-center rounded-lg border border-yellow-200/60 bg-gradient-to-b from-emerald-800 to-emerald-950 text-[11px] font-black text-yellow-100 shadow-[0_6px_14px_-4px_rgba(0,0,0,0.9)]">
              {money(topBill)}
            </div>
          ) : (
            <div className="grid h-full w-full place-items-center rounded-lg border border-dashed border-white/25 bg-black/35 text-[9px] text-white/55">
              지폐 없음
            </div>
          )}
        </div>
        {restCount > 0 && (
          <span className="rounded-full border border-white/30 bg-black/80 px-1.5 py-0.5 text-[9px] whitespace-nowrap text-white/85 [text-shadow:0_1px_1px_rgba(0,0,0,0.9)]">
            +{restCount}장 ({money(restTotal)})
          </span>
        )}

        <div className="flex min-h-[20px] w-full flex-wrap items-center justify-center gap-1">
          {groups.length === 0 ? (
            <span className="text-[9px] text-white/45 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">주사위 없음</span>
          ) : (
            groups
              .sort((a, b) => Number(b[1]) - Number(a[1]))
              .map(([owner, count]) => (
                <DiceBadge
                  key={owner}
                  owner={owner}
                  count={count}
                  seat={owner === NEUTRAL_OWNER ? undefined : Number(owner)}
                />
              ))
          )}
        </div>
        {iHaveDiceHere && (
          <span className="text-[9px] font-semibold text-amber-200 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">내 주사위 있음</span>
        )}
      </div>
    </div>
  );
}

export default function LasVegasBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: LasVegasBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);

  // Diff consecutive lockstep snapshots to drive the dice-placement flight
  // FX — same technique as five-cucumbers/CardEffects.tsx, see DiceEffects.tsx.
  const [trackedState, setTrackedState] = useState(state);
  const [placementEvents, setPlacementEvents] = useState<PlacementEvent[]>([]);
  const [rollFlashId, setRollFlashId] = useState(0);
  if (trackedState !== state) {
    const placement = detectPlacementEvent(trackedState, state);
    const justRolled = trackedState.currentRoll === null && state.currentRoll !== null;
    setTrackedState(state);
    if (placement) setPlacementEvents((prev) => [...prev, { ...placement, id: (prev.at(-1)?.id ?? 0) + 1 }]);
    if (justRolled) setRollFlashId((n) => n + 1);
  }
  const handlePlacementDone = useCallback((id: number) => {
    setPlacementEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const casinoTileRefs = useRef(new Map<CasinoNumber, HTMLDivElement>());
  const seatRowRefs = useRef(new Map<SeatIndex, HTMLElement>());
  const diceTrayRef = useRef<HTMLDivElement | null>(null);
  function setCasinoTileRef(n: CasinoNumber) {
    return (el: HTMLDivElement | null) => {
      if (el) casinoTileRefs.current.set(n, el);
      else casinoTileRefs.current.delete(n);
    };
  }
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
        <span className="text-5xl">{tied ? "🎰" : "🏆"}</span>
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
                    {names[seat]}
                    {seat === viewerSeat && <span className="ml-1 text-amber-200">(나)</span>}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-right font-semibold text-emerald-200">{money(total)}</td>
                  <td className="border-b border-white/5 px-2 py-2 text-right text-white/60">{billCount}장</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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

  function roll() {
    if (!isMyTurn || state.currentRoll || myDiceInHand === 0) return;
    onAction({ type: "rollDice", seat: viewerSeat, seed: randomSeed() });
  }
  function place(face: Face) {
    if (!isMyTurn || !state.currentRoll) return;
    onAction({ type: "placeDice", seat: viewerSeat, face });
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-[28px] border border-black/60 p-2.5 shadow-[0_25px_60px_-25px_rgba(0,0,0,0.95)] sm:p-4"
      style={{ background: "linear-gradient(160deg,#1b1004 0%,#120b03 45%,#080502 100%)" }}
    >
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
            isRollDestination={isMyTurn && rollGroups.some((g) => g.face === casino.number)}
            tileRef={setCasinoTileRef(casino.number)}
          />
        ))}
      </section>

      {/* Scoreboard */}
      <section className="flex flex-col gap-1.5">
        {seatOrder.map((seat) => {
          const p = state.players.find((pl) => pl.seat === seat)!;
          const isActive = state.activeSeat === seat;
          const isSelf = seat === viewerSeat;
          const total = p.money.reduce((s, v) => s + v, 0);
          return (
            <div
              key={seat}
              ref={setSeatRowRef(seat)}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-xs transition ${
                isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/20"
              }`}
            >
              <span className="flex items-center gap-1.5 font-semibold text-white/90">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: diceColorForSeat(seat) }} />
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

      {/* My dice tray */}
      <section
        ref={diceTrayRef}
        className="rounded-2xl border border-amber-300/20 p-2.5 sm:p-3"
        style={{ background: "linear-gradient(160deg,#332008 0%,#1c1204 55%,#0a0601 100%)" }}
      >
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-amber-200/90 uppercase">
          🎲 내 주사위 ({me.ownDiceInHand}개 + 중립 {me.neutralDiceInHand}개)
        </h3>

        {state.currentRoll ? (
          <div key={rollFlashId} className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {state.currentRoll.map((d, i) => (
                <div key={i} style={{ animation: `dice-roll-tumble 0.5s ease-out ${(i % 12) * 25}ms both` }}>
                  <DiceFace face={d.face} color={d.owner === "own" ? diceColorForSeat(viewerSeat) : NEUTRAL_DICE_COLOR} size="h-8 w-8" />
                </div>
              ))}
            </div>
            {isMyTurn && (
              <div className="flex flex-wrap gap-2">
                {rollGroups.map((g) => (
                  <button
                    key={g.face}
                    onClick={() => place(g.face)}
                    className="flex items-center gap-1.5 rounded-xl border border-amber-300/50 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/20"
                  >
                    <DiceFace face={g.face} color="#f4f4f5" size="h-5 w-5" />
                    눈금 {g.face} 전체 배치 ({g.ownCount + g.neutralCount}개)
                  </button>
                ))}
              </div>
            )}
          </div>
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

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {/* Dice-placement flight FX — dice tray/opponent seat row -> the chosen casino tile. */}
      {placementEvents.map((event) => (
        <FlyingDicePlacement
          key={event.id}
          event={event}
          getSourceEl={() => (event.seat === viewerSeat ? diceTrayRef.current : (seatRowRefs.current.get(event.seat) ?? null))}
          getTargetEl={() => casinoTileRefs.current.get(event.casino) ?? null}
          onDone={handlePlacementDone}
        />
      ))}
    </div>
  );
}
