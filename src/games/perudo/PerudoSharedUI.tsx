"use client";

/**
 * Small presentational pieces shared between `PerudoBoard.tsx` (desktop/
 * tablet layout) and `PerudoMobileBoard.tsx` (2026-09-08 모바일 화이트
 * 오버스크롤 차단 세션, extended the same day by a 물리 보드 복원 세션 once the
 * mobile board's first draft dropped the physical `RectBidTrack` and the
 * user reported the board itself as "missing") — pulled out of
 * `PerudoBoard.tsx`, where they used to live as unexported local functions,
 * specifically so both board variants can render the exact same
 * graveyard/face-picker/table-chrome markup instead of drifting into two
 * slightly different copies. Living in their own file (rather than just
 * exporting them from `PerudoBoard.tsx`) also avoids a circular import
 * between the two board components. See also `PerudoBidTrack.tsx`, which
 * holds the (larger) physical rectangular bid-track component both boards
 * render identically.
 */

import PerudoFaceIcon from "./PerudoFaceIcon";
import { DIE_SIZE_PX, PerudoDie, type DieSize } from "./dice/PerudoDie";
import type { DiceColorway } from "./dice/colorways";
import { STARTING_DICE, type Face, type PerudoState, type SeatIndex } from "./engine";

export function faceLabel(face: Face): string {
  return face === 1 ? "페루도" : `${face}`;
}

// A warm, woven fabric mat — a deep terracotta/umber gradient (cloth, not
// cold grey stone like an earlier version) and `TableTexture` below layers a
// woven crosshatch + Andean-stripe trim bands on top of it, standing in for
// the textile mat the real board sits on. Shared by both `PerudoBoard.tsx`
// (desktop) and `PerudoMobileBoard.tsx` (2026-09-08 물리 보드 복원 세션) so the
// mobile board's chrome padding — and therefore `PerudoBidTrack.tsx`'s own
// `BOARD_CELL_SIZE_CSS` width formula, which is baked in assuming this exact
// panel padding — stays identical between the two layouts.
export const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-black/60 bg-gradient-to-b from-[#2a1c14] via-[#1d130d] to-[#0d0805] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)]";

/** Andean-textile stripe band (terracotta/mustard/teal/cream/maroon) — used as the mat's top/bottom trim in `TableTexture`. */
const FABRIC_TRIM_GRADIENT =
  "repeating-linear-gradient(90deg, #b5482f 0 14px, #d9a441 14px 28px, #1f6f6f 28px 42px, #e8d9b5 42px 56px, #7a1f2b 56px 70px)";

/** The fabric mat's texture layer: a woven crosshatch across the whole panel plus a colorful trim band along the top/bottom edges, standing in for a real South American textile mat under the board. The real board itself renders as `RectBidTrack` (`PerudoBidTrack.tsx`) rather than here — this layer is just the mat *under* the board. */
export function TableTexture() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-2 opacity-90 sm:h-2.5"
        style={{ backgroundImage: FABRIC_TRIM_GRADIENT }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-2 opacity-90 sm:h-2.5"
        style={{ backgroundImage: FABRIC_TRIM_GRADIENT }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(255,255,255,0.15) 0px, rgba(255,255,255,0.15) 1px, transparent 1px, transparent 10px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 1px, transparent 1px, transparent 10px)",
        }}
      />
    </>
  );
}

/** One face-up die — thin wrapper over the shared `PerudoDie` primitive with this game's own title tooltip convention. Always renders in the passed-in `colorway` — including the face-1 페루도 mark, which is engraved in that same die's own ink color rather than a fixed universal red (see `dice/colorways.ts`'s file header). */
export function DieFace({ value, size = "md", ring, colorway, tilt }: { value: number; size?: DieSize; ring?: "match" | "wild"; colorway: DiceColorway; tilt?: number }) {
  return (
    <PerudoDie value={value} size={size} ring={ring} colorway={colorway} tilt={tilt} title={value === 1 ? "페루도 (조커)" : `${value}`} />
  );
}

/** A hidden die — a blank, pip-free die in its owner's own colorway (no icon at all, so it reads as a true silhouette rather than a generic dice emoji). Tinted with the owning seat's own player colorway so whose stash is whose reads at a glance even before anyone's dice count is checked. */
export function DieBack({ size = "sm", colorway }: { size?: DieSize; colorway: DiceColorway }) {
  return <PerudoDie size={size} colorway={colorway} blank glossy={false} title="비공개 주사위" />;
}

/**
 * A fixed `maxSlots`-wide row of `DieBack`s in a seat's own colorway — `diceCount`
 * of them filled, the rest rendered as empty dashed placeholders — so a
 * seat's current dice count reads as "how full is this seat's dice rack"
 * rather than a bare number, and every other seat's rack is visually
 * comparable at a glance regardless of how many each has actually lost
 * (2026-09-09 모바일 색상 다이스 카운터 세션, AskUserQuestion-confirmed: fixed
 * `STARTING_DICE`-slot bar with dashed empty slots for lost dice, rather than
 * the desktop scoreboard's older "just render however many are left, no
 * empty slots" pattern — the two are allowed to diverge since this session's
 * request scoped the change to mobile only).
 *
 * `maxSlots` only sets the FLOOR on how many slots render — a successful
 * "맞아!(calza)" grants a bonus die with no upper cap (see `engine.ts`'s
 * `calza`), so `diceCount` can exceed `STARTING_DICE`. Widening the slot
 * count to fit `diceCount` in that case (rather than clamping the array to
 * `maxSlots`) keeps every die actually owned visible instead of silently
 * under-representing a seat that grew past the starting count.
 */
export function DiceCountStrip({
  colorway,
  diceCount,
  maxSlots = STARTING_DICE,
  size = "sm",
}: {
  colorway: DiceColorway;
  diceCount: number;
  maxSlots?: number;
  size?: DieSize;
}) {
  const w = DIE_SIZE_PX[size];
  const slots = Math.max(maxSlots, diceCount);
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {Array.from({ length: slots }, (_, i) =>
        i < diceCount ? (
          <DieBack key={i} size={size} colorway={colorway} />
        ) : (
          <div
            key={i}
            className="shrink-0 rounded-[24%] border border-dashed border-white/15 bg-white/[0.03]"
            style={{ width: w, height: w }}
            title="잃은 주사위"
          />
        ),
      )}
    </div>
  );
}

/**
 * 2026-09-07 모바일 가로 스크롤 제거 세션: shrunk from fixed `h-9 w-9`/`gap-1.5`
 * (6×36px + 5×6px gap ≈ 246px) to `h-6 w-6`/`gap-1` (6×24px + 5×4px gap =
 * 164px) — this row's 6 buttons don't scale with `--perudo-cell` at all, so
 * at the board's smaller floor the old fixed size no longer fit inside the
 * composer panel nested in `PerudoBoard`'s desktop board. Reused as-is by
 * `PerudoMobileBoard`'s action dock (2026-09-08 세션) — the same compact
 * size already fits a thumb-friendly dock without a further resize.
 */
export function FacePicker({ selected, onSelect }: { selected: Face; onSelect: (face: Face) => void }) {
  const faces: Face[] = [1, 2, 3, 4, 5, 6];
  return (
    <div className="flex gap-1">
      {faces.map((face) => (
        <button
          key={face}
          type="button"
          onClick={() => onSelect(face)}
          className={`flex h-6 w-6 items-center justify-center rounded-lg border-2 text-xs font-bold transition ${
            selected === face
              ? "border-amber-200 bg-gradient-to-b from-amber-300 to-amber-500 text-neutral-900 shadow-[0_0_0_2px_rgba(251,191,36,0.35)]"
              : "border-white/15 bg-black/20 text-white/60 hover:border-white/30"
          }`}
          title={face === 1 ? "페루도 (조커)" : `숫자 ${face}`}
        >
          {face === 1 ? <PerudoFaceIcon className="mx-auto h-3.5 w-3.5" /> : face}
        </button>
      ))}
    </div>
  );
}

/**
 * The center "잃은 주사위 무덤" tray: every die any player has ever lost this
 * game collects here instead of just vanishing from the roster count, so the
 * whole table can see at a glance how depleted the overall dice pool is.
 * Purely derived from `state.players` (`STARTING_DICE - diceCount` per seat)
 * — nothing new is tracked. Since a successful "맞아!" no longer caps a
 * seat's `diceCount` at `STARTING_DICE`, that subtraction can go negative
 * for a seat sitting on more dice than it started with; the
 * `.filter((x) => x.lost > 0)` below simply excludes such seats rather than
 * showing a negative loss. Grouped per seat so the pile also reads as "who's
 * been bleeding dice": each seat's losses render as an overlapping stack of
 * THAT seat's own dice colorway, dimmed/desaturated so a graveyard die reads
 * as spent and out of play. Rendered on the desktop board directly under
 * `TotalDiceBanner`, and as the mobile board's own "tier 2" (2026-09-08
 * 세션) right under the turn banner.
 */
export function LostDiceTray({
  state,
  colorways,
}: {
  state: PerudoState;
  colorways: Record<SeatIndex, DiceColorway>;
}) {
  const bySeat = state.players.map((p) => ({ seat: p.seat, lost: STARTING_DICE - p.diceCount })).filter((x) => x.lost > 0);
  const totalLost = bySeat.reduce((sum, x) => sum + x.lost, 0);
  return (
    <div className="relative z-10 flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-amber-800/40 bg-black/15 px-3 py-2">
      <p className="text-[10px] font-semibold tracking-wide text-amber-200/60">
        💀 잃은 주사위 무덤{totalLost > 0 ? ` · 총 ${totalLost}개` : ""}
      </p>
      {totalLost === 0 ? (
        <p className="text-[10px] text-amber-100/30">아직 잃은 주사위가 없습니다</p>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
          {bySeat.map(({ seat, lost }) => (
            <div key={seat} className="flex items-center opacity-60 grayscale-[0.4]" title={`${lost}개 상실`}>
              {Array.from({ length: lost }, (_, i) => (
                <div key={i} style={i === 0 ? undefined : { marginLeft: -10 }}>
                  <DieBack size="sm" colorway={colorways[seat]} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Always-visible face-expectation summary (rulebook UX request, 2026-09-08
 * 모바일 개편 세션 요구사항 #2 3단): the classic Perudo doubt/call math — a
 * specific non-조커 face's expected count across every die still in play is
 * `total / 3` (its own `total/6` share plus the wild 조커's own `total/6`
 * share), while 조커(face 1) itself has no wild backing it up, so its own
 * expectation is just `total / 6`. Desktop already surfaces the general
 * figure inline (`MyDiceStatsPanel` in `PerudoBoard.tsx`, scoped to the
 * viewer's own hand); this bar is the mobile board's compact top-level
 * equivalent, scoped to the whole table's remaining dice instead.
 */
export function ExpectationBar({ totalActiveDice }: { totalActiveDice: number }) {
  const general = totalActiveDice / 3;
  const jokerOnly = totalActiveDice / 6;
  return (
    <div className="relative z-10 flex items-center justify-center gap-1.5 rounded-xl border border-amber-300/25 bg-amber-400/10 px-2.5 py-1 text-center text-[11px] font-semibold text-amber-100">
      <span>📊</span>
      <span className="break-keep">
        전체 {totalActiveDice}개 · 일반 기대값 {general.toFixed(1)}개 (1 눈금은 {jokerOnly.toFixed(1)}개)
      </span>
    </div>
  );
}
