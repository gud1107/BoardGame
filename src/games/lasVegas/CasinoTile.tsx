import { MoneyBillArt } from "./MoneyBillArt";
import { CasinoMatArt } from "./CasinoPhotoArt";
import { DiceFace, diceColorForSeat, NEUTRAL_DICE_COLOR } from "./DiceIcon";
import { tallyDiceGroups, NEUTRAL_OWNER, type CasinoNumber, type CasinoState, type DiceOwner, type SeatIndex } from "./engine";

/**
 * The full-detail casino-tile rendering (theme art + dice-owner rows +
 * per-bill money stack) — split out of `LasVegasBoard.tsx` (2026-09-07
 * mobile compact dashboard request) so `CompactCasinoBoard.tsx`'s tap-to-open
 * detail sheet can reuse the exact same desktop-fidelity rendering for one
 * casino, instead of re-implementing a second reduced view of the same data.
 * `LasVegasBoard.tsx`'s desktop 6-tile grid still renders this directly too —
 * nothing about its own behavior changed, only its file location.
 */

export function money(v: number): string {
  return `$${v.toLocaleString("en-US")}`;
}

/** `#rrggbb` -> `rgba(r,g,b,alpha)`, for the live leader aura glow below (each seat color needs two alpha variants for the pulse keyframe's CSS custom properties). */
export function hexToRgba(hex: string, alpha: number): string {
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
export const CASINO_ACCENTS: Record<CasinoNumber, { border: string }> = {
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
export function DiceGroupRow({
  owner,
  count,
  seat,
  face,
  tied,
}: {
  owner: DiceOwner;
  count: number;
  seat?: SeatIndex;
  face: number;
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
export function MoneyStack({
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
export function CasinoTile({
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
      <CasinoArtZone casinoNumber={casino.number} />

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

/** Zone 1's art + badge, split out only so `CasinoTile` can skip it cleanly for `hideArt`. */
function CasinoArtZone({ casinoNumber }: { casinoNumber: CasinoNumber }) {
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl">
      <CasinoMatArt casino={casinoNumber} className="absolute inset-0 h-full w-full" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(60% 40% at 8% 8%, rgba(0,0,0,0.55) 0%, transparent 70%)" }}
      />
      <div className="absolute left-1.5 top-1.5 flex items-center gap-1.5 rounded-full border-2 border-white/45 bg-black/65 py-1 pr-2.5 pl-1 shadow-[0_0_10px_rgba(0,0,0,0.6)] backdrop-blur-sm">
        <DiceFace face={casinoNumber} color="#f4f4f5" size="h-6 w-6" />
        <span className="text-base leading-none font-black text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
          {casinoNumber}
        </span>
      </div>
    </div>
  );
}
