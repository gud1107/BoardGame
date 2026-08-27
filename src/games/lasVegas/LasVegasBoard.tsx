"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RulebookModal from "./RulebookModal";
import { CasinoMatArt } from "./CasinoPhotoArt";
import { MoneyBillArt } from "./MoneyBillArt";
import { DiceFace, diceColorForSeat, NEUTRAL_DICE_COLOR } from "./DiceIcon";
import { detectPlacementEvent, FlyingDicePlacement, PayoutMoneyFly, type PlacementEvent } from "./DiceEffects";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import {
  computeRankings,
  NEUTRAL_OWNER,
  tallyDiceGroups,
  type CasinoNumber,
  type CasinoState,
  type DiceOwner,
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

function money(v: number): string {
  return `$${v.toLocaleString("en-US")}`;
}

/** `#rrggbb` -> `rgba(r,g,b,alpha)`, for the live leader aura glow below (each seat color needs two alpha variants for the pulse keyframe's CSS custom properties). */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

/**
 * One owner's dice pile at a casino, rendered as that many individual dice
 * (not a "×N" text badge — 2026-08-23 요청) each showing this casino's own
 * face value, since that's physically what's sitting there: every die here
 * got placed *because* it rolled this casino's number. `tied` dims the
 * whole group to grayscale with a hairline crack overlay — rulebook §4
 * 규칙 1's cancellation, shown live/provisionally per `tallyDiceGroups`
 * (see engine.ts) rather than only once the game actually ends.
 */
function DiceGroupRow({
  owner,
  count,
  seat,
  face,
  tied,
}: {
  owner: DiceOwner;
  count: number;
  seat?: SeatIndex;
  face: Face;
  tied: boolean;
}) {
  const color = owner === NEUTRAL_OWNER ? NEUTRAL_DICE_COLOR : diceColorForSeat(seat!);
  return (
    <div
      className={`relative flex items-center gap-[3px] rounded-md px-1 py-0.5 transition-all duration-300 ${
        tied ? "opacity-45 grayscale" : ""
      }`}
      style={tied ? { filter: "grayscale(0.85)" } : undefined}
    >
      {Array.from({ length: count }, (_, i) => (
        <DiceFace key={i} face={face} color={color} size="h-3.5 w-3.5" />
      ))}
      {tied && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ animation: "lasvegas-crack-flicker 1.8s ease-in-out infinite" }}
          viewBox="0 0 100 24"
          preserveAspectRatio="none"
        >
          <path
            d="M4 2 L28 12 L18 8 L40 22 L34 10 L58 14 L48 4 L74 18 L64 9 L96 15"
            fill="none"
            stroke="#f87171"
            strokeWidth="1.4"
            opacity="0.85"
          />
        </svg>
      )}
    </div>
  );
}

/**
 * Non-overlapping money row/list — every bill on the casino gets its own
 * fully visible card, never covered by another card (per 2026-08-24 재요청:
 * the previous staircase-cascade layout, where each later card overlapped
 * the one above it by ~11px, hid the covered bills' values/counts — see
 * `boardGameRule/라스베가스/주사위가 가리는 현상.png`). Setup can deal up to ~5
 * bills onto one casino before the $50k floor is met (`MIN_CASINO_TOTAL` in
 * `engine.ts`), so the arrangement switches by count (per user decision):
 *   - **1-2 bills:** one horizontal row (`flex`), each card sharing the
 *     tile's width equally — plenty of room for 2 side by side.
 *   - **3-5 bills:** a vertical list (`flex-col`), one full-width card per
 *     row, so a busy casino grows *taller* instead of squeezing 3+ cards
 *     into one cramped row (the mobile tile grid itself, `grid-cols-2` at
 *     `LasVegasBoard.tsx`'s casino `<section>`, stays fixed regardless of
 *     bill count — confirmed with the user rather than widening busy tiles).
 * Lives in its own zone *outside* the theme art (see `CasinoTile`) so a
 * casino with several bills never grows on top of the illustration.
 *
 * 2026-08-23 실시간 상금 수령자 표시(2026-08-24 재구성): `leaders[0]`/`leaders[1]`
 * are this casino's current (provisional, live) rank-1/rank-2 dice owners —
 * the exact same non-tied, count-descending order `settleCasino` would award
 * bills in (see `CasinoTile`, which derives them from `tallyDiceGroups`).
 * Since `settleCasino` hands out bills top-of-stack-first in that same
 * order, bill index 0 IS what rank-1 would currently win, and index 1 is
 * rank-2's. A neutral-owned rank gets a muted "폐기 예정" tag instead of a
 * colored aura/crown, since it has no player color and the rulebook
 * discards that bill rather than paying anyone (§4 규칙 2 "중립 주사위가 상금을
 * 받게 되는 경우"). Now that cards no longer overlap, the aura ring + badge
 * live directly on each bill's own wrapper (no separate stack-wide overlay
 * layer needed — that was only there to stay above whichever card the
 * cascade z-index happened to bury a badge under).
 *
 * 2026-08-24 재요청: each card also carries its own small rank corner tag
 * ("1등"/"2등"/...) so the rank↔value mapping reads off the card itself,
 * *in addition to* (not replacing) the "1등 $80,000" pill list underneath —
 * user explicitly asked to keep both rather than drop one for the other.
 */
function MoneyStack({
  bills,
  leaders,
  names,
}: {
  bills: number[];
  leaders: (DiceOwner | undefined)[];
  names: Record<SeatIndex, string>;
}) {
  if (bills.length === 0) {
    return (
      <div className="flex h-14 w-full items-center justify-center rounded-lg border border-dashed border-white/20 bg-black/20 text-[9px] text-white/40">
        지폐 없음
      </div>
    );
  }
  const isRow = bills.length <= 2;
  return (
    <div className="flex w-full flex-col items-center gap-1">
      <div className={isRow ? "flex w-full gap-1.5" : "flex w-full flex-col gap-1.5"}>
        {bills.map((bill, i) => {
          const leader = leaders[i];
          const hasLeader = leader !== undefined;
          const isNeutralLeader = leader === NEUTRAL_OWNER;
          const seatColor = hasLeader && !isNeutralLeader ? diceColorForSeat(leader as SeatIndex) : null;
          return (
            <div key={i} className={`relative h-10 ${isRow ? "min-w-0 flex-1" : "w-full"}`}>
              <div
                className="relative h-10 w-full overflow-hidden rounded-md shadow-[0_3px_8px_-3px_rgba(0,0,0,0.85)]"
                style={
                  hasLeader
                    ? seatColor
                      ? {
                          animation: "lasvegas-leader-aura-pulse 1.8s ease-in-out infinite",
                          ["--aura-soft" as string]: hexToRgba(seatColor, 0.4),
                          ["--aura-strong" as string]: hexToRgba(seatColor, 0.9),
                        }
                      : { boxShadow: "0 0 0 1.5px rgba(148,163,184,0.55)" }
                    : undefined
                }
              >
                <MoneyBillArt value={bill} />
                <span className="absolute top-0.5 left-0.5 rounded-full bg-black/65 px-1 py-px text-[7px] leading-tight font-bold whitespace-nowrap text-white">
                  {i + 1}등
                </span>
              </div>
              {hasLeader &&
                (seatColor ? (
                  <span
                    className="pointer-events-none absolute -right-1 -bottom-1.5 z-10 rounded-full border px-1.5 py-0.5 text-[8px] font-bold whitespace-nowrap text-white shadow-[0_2px_4px_rgba(0,0,0,0.7)]"
                    style={{ borderColor: seatColor, background: "rgba(0,0,0,0.78)" }}
                  >
                    {i === 0 ? "👑 1st" : "🥈 2nd"} {names[leader as SeatIndex]}
                  </span>
                ) : (
                  <span className="pointer-events-none absolute -right-1 -bottom-1.5 z-10 rounded-full border border-slate-400/60 bg-black/78 px-1.5 py-0.5 text-[8px] font-semibold whitespace-nowrap text-slate-300 shadow-[0_2px_4px_rgba(0,0,0,0.7)]">
                    🚫 중립 · 폐기 예정
                  </span>
                ))}
            </div>
          );
        })}
      </div>
      <div className="flex w-full flex-col items-center gap-0.5">
        {bills.map((bill, i) => (
          <span
            key={i}
            className="w-full rounded-full border border-white/20 bg-black/50 px-2 py-0.5 text-center text-[9px] font-semibold whitespace-nowrap text-emerald-200"
          >
            {i + 1}등 {money(bill)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Three-tier casino block — per HANDOFF.md's Las Vegas section, each of the
 * 6 casinos is a *stack of three non-overlapping zones* instead of a single
 * art tile with money/dice laid on top:
 *   1. Theme mat (top) — `CasinoMatArt` at its native 3:4 ratio: a real
 *      synced photo for 5 of the 6 casinos, the original SVG scene for the
 *      6th (see `CasinoPhotoArt.tsx`'s doc for why). A number-only badge
 *      (enlarged die-pip icon + bold numeral, no theme name — 2026-08-23
 *      요청) stays pinned to its top-left corner, since the rulebook
 *      identifies casinos by their 1-6 face value, not a name.
 *   2. Dice betting mat (middle) — one `DiceGroupRow` per owner, each
 *      individual die drawn (not a "×N" badge), dimmed+cracked live the
 *      instant that owner's count ties another's (rulebook §4 규칙 1,
 *      computed provisionally every render via `tallyDiceGroups`).
 *   3. Money stack (bottom, moved down from the top per 2026-08-23 재요청)
 *      — `MoneyStack`, cascading illustrated bill notes with its own
 *      per-bill leader aura/badge (unchanged — user explicitly asked to
 *      leave that part as-is; only its position moved).
 * `isRollDestination` drives the gold glow-pulse ring on the whole block.
 * `impactKey`/`clashKey` are bumped by the parent (see `LasVegasBoard`) to
 * replay, respectively, the placement-landing impact ring/tile-shake and
 * the tie-just-happened X-mark flourish — both plain key-remount CSS
 * animations, no timers, same idiom as this file's existing `rollFlashId`.
 *
 * 2026-08-23 재요청: the tile's own border now live-syncs to the seat color
 * of whoever currently holds rank-1 here (`liveLeaders[0]`, the same
 * non-tied count-descending read `MoneyStack`'s aura already uses) —
 * confirmed with the user to *replace* the fixed per-casino `CASINO_ACCENTS`
 * color, not sit alongside it, and to fall back to that fixed accent
 * whenever there's no clear single-seat leader yet (casino empty, or the
 * rank-1 spot is a tie / the neutral bucket, which has no seat color).
 */
function CasinoTile({
  casino,
  viewerSeat,
  names,
  isRollDestination,
  impactKey,
  clashKey,
  tileRef,
}: {
  casino: CasinoState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  isRollDestination: boolean;
  impactKey: number;
  clashKey: number;
  tileRef: (el: HTMLDivElement | null) => void;
}) {
  const accent = CASINO_ACCENTS[casino.number];
  const groups = tallyDiceGroups(casino.diceCounts).sort((a, b) => b.count - a.count);
  const iHaveDiceHere = groups.some((g) => g.owner !== NEUTRAL_OWNER && g.owner === viewerSeat);
  const anyTiedNow = groups.some((g) => g.tied);
  // Live rank-1/rank-2 for the money-stack aura badges below — same
  // non-tied, count-descending order `settleCasino` awards bills in.
  const liveSurvivors = groups.filter((g) => !g.tied);
  const liveLeaders: (DiceOwner | undefined)[] = [liveSurvivors[0]?.owner, liveSurvivors[1]?.owner];
  // Border-color sync: only a real seat in sole possession of rank-1 gets a
  // color (neutral has none, and a tie leaves no rank-1 survivor at all).
  const leaderSeat = liveLeaders[0];
  const leaderColor = typeof leaderSeat === "number" ? diceColorForSeat(leaderSeat) : null;

  return (
    <div
      ref={tileRef}
      className={`relative flex w-full flex-col gap-1.5 rounded-2xl border-2 ${leaderColor ? "" : accent.border} p-1.5 shadow-[inset_0_0_0_1px_rgba(252,211,77,0.4)] transition-[border-color,box-shadow] duration-300 hover:shadow-[inset_0_0_0_1px_rgba(252,211,77,0.4),0_0_20px_-6px_rgba(252,211,77,0.65)]`}
      style={{
        ...(isRollDestination ? { animation: "lasvegas-mat-glow-pulse 1.6s ease-in-out infinite" } : {}),
        ...(leaderColor
          ? {
              borderColor: leaderColor,
              boxShadow: `inset 0 0 0 1px rgba(252,211,77,0.4), 0 0 16px -3px ${hexToRgba(leaderColor, 0.85)}, 0 0 0 1px ${hexToRgba(leaderColor, 0.5)}`,
            }
          : {}),
      }}
    >
      {/* Placement-landing impact: gold ring burst + tiny local shake, key-remounted per landing so it always replays. */}
      {impactKey > 0 && (
        <div
          key={impactKey}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-2xl"
          style={{ animation: "lasvegas-tile-shake 0.32s ease-out" }}
        >
          <div
            className="absolute left-1/2 top-1/2 h-16 w-16 rounded-full border-amber-300"
            style={{ animation: "lasvegas-impact-ring 0.55s ease-out forwards" }}
          />
        </div>
      )}

      {/* Tie-just-happened flourish: red X + sparks over the whole tile. */}
      {clashKey > 0 && (
        <div key={clashKey} aria-hidden className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
          <span
            className="text-4xl font-black text-rose-500 drop-shadow-[0_0_10px_rgba(244,63,94,0.9)]"
            style={{ animation: "lasvegas-tie-clash-x 0.9s ease-out forwards" }}
          >
            ✕
          </span>
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <span
              key={angle}
              className="absolute h-1.5 w-1.5 rounded-full bg-amber-300"
              style={{ ["--spark-angle" as string]: `${angle}deg`, animation: "lasvegas-tie-spark 0.7s ease-out forwards" }}
            />
          ))}
        </div>
      )}

      {/* Zone 1: theme mat — real photo (5/6 casinos) or original SVG scene. */}
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl">
        <CasinoMatArt casino={casino.number} className="absolute inset-0 h-full w-full" />
        {/* Light top-corner scrim, just enough to keep the badge legible over any part of the art. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(60% 40% at 8% 8%, rgba(0,0,0,0.55) 0%, transparent 70%)" }}
        />
        {/* Casino identity badge — 2026-08-23 요청: theme name text dropped
            entirely, the die-pip icon enlarged and paired with a bold plain
            numeral so "which of the 6 casinos is this" reads instantly from
            its actual 1-6 face value (per rulebook §1, casinos are
            identified by number, not name) rather than a small caption. */}
        <div className="absolute left-1.5 top-1.5 flex items-center gap-1.5 rounded-full border-2 border-white/45 bg-black/65 py-1 pr-2.5 pl-1 shadow-[0_0_10px_rgba(0,0,0,0.6)] backdrop-blur-sm">
          <DiceFace face={casino.number} color="#f4f4f5" size="h-6 w-6" />
          <span className="text-base leading-none font-black text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
            {casino.number}
          </span>
        </div>
      </div>

      {/* Zone 2: dice betting mat — individual dice per owner, its own bar below the art. */}
      <div className="flex min-h-[44px] w-full flex-col items-center justify-center gap-1 rounded-lg border border-white/10 bg-black/25 p-1.5">
        <div className="flex w-full flex-wrap items-center justify-center gap-1">
          {groups.length === 0 ? (
            <span className="text-[9px] text-white/45">주사위 없음</span>
          ) : (
            groups.map((g) => (
              <DiceGroupRow
                key={g.owner}
                owner={g.owner}
                count={g.count}
                face={casino.number}
                tied={g.tied}
                seat={g.owner === NEUTRAL_OWNER ? undefined : (g.owner as SeatIndex)}
              />
            ))
          )}
        </div>
        {iHaveDiceHere && <span className="text-[9px] font-semibold text-amber-200">내 주사위 있음</span>}
        {anyTiedNow && (
          <span className="text-[9px] font-semibold text-rose-300">⚔️ 동수 상쇄 잠정 — 정산 시 확정</span>
        )}
      </div>

      {/* Zone 3: money stack, entirely outside the illustration above — moved
          to the bottom per 2026-08-23 재요청 (previously zone 1/top). Live
          rank-1/2 aura+badges attached per-bill, unchanged (see MoneyStack
          doc) — the user asked to leave that part exactly as-is. */}
      <MoneyStack bills={casino.bills} leaders={liveLeaders} names={names} />
    </div>
  );
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
                    {names[seat]}
                    {seat === viewerSeat && <span className="ml-1 text-amber-200">(나)</span>}
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

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}

      {/* Dice-placement flight FX — the shared roll viewer panel -> the chosen casino tile, for mine and every opponent's placement alike (2026-08-23 요청, Q2 "전원 동일 적용"). */}
      {placementEvents.map((event) => (
        <FlyingDicePlacement
          key={event.id}
          event={event}
          getSourceEl={() => rollPanelRef.current}
          getTargetEl={() => casinoTileRefs.current.get(event.casino) ?? null}
          onDone={handlePlacementDone}
        />
      ))}
    </div>
  );
}
