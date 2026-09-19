"use client";

/**
 * Small presentational pieces used by `PerudoBoard.tsx` — pulled out of it,
 * where they used to live as unexported local functions, into their own
 * file mainly so `PerudoBidTrack.tsx` (the physical rectangular bid-track
 * component, also its own file) can import `faceLabel` without a circular
 * import back to `PerudoBoard.tsx`.
 *
 * 2026-09-08~09-10 sessions briefly split mobile into a second, bespoke
 * `PerudoMobileBoard.tsx` tree and grew this file to be shared between the
 * two (that's why `DiceCountStrip`/`ExpectationBar` existed here). Removed
 * 2026-09-20 per user request — mobile renders the exact same
 * `PerudoBoard.tsx` tree as desktop again, like it did through 2026-09-06 —
 * so this file went back to having a single consumer.
 */

import PerudoFaceIcon from "./PerudoFaceIcon";
import { PerudoDie, type DieSize } from "./dice/PerudoDie";
import type { DiceColorway } from "./dice/colorways";
import { STARTING_DICE, type Face, type PerudoState, type SeatIndex } from "./engine";

export function faceLabel(face: Face): string {
  return face === 1 ? "페루도" : `${face}`;
}

// A warm, woven fabric mat — a deep terracotta/umber gradient (cloth, not
// cold grey stone like an earlier version) and `TableTexture` below layers a
// woven crosshatch + Andean-stripe trim bands on top of it, standing in for
// the textile mat the real board sits on. `PerudoBidTrack.tsx`'s own
// `BOARD_CELL_SIZE_CSS` width formula is baked in assuming this exact panel
// padding, so keep them in sync if this ever changes.
export const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-black/60 bg-gradient-to-b from-[#2a1c14] via-[#1d130d] to-[#0d0805] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)] light:border-slate-200 light:from-white light:via-amber-50/50 light:to-white light:shadow-md";

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
 * 2026-09-07 모바일 가로 스크롤 제거 세션: shrunk from fixed `h-9 w-9`/`gap-1.5`
 * (6×36px + 5×6px gap ≈ 246px) to `h-6 w-6`/`gap-1` (6×24px + 5×4px gap =
 * 164px) — this row's 6 buttons don't scale with `--perudo-cell` at all, so
 * at the board's smaller floor the old fixed size no longer fit inside the
 * composer panel nested in `PerudoBoard`'s board.
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
              : "border-white/15 bg-black/20 text-white/60 hover:border-white/30 light:border-slate-300 light:bg-white light:text-slate-600 light:hover:border-slate-400"
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
 * as spent and out of play. Rendered directly under `TotalDiceBanner`.
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
    <div className="relative z-10 flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-amber-800/40 bg-black/15 px-3 py-2 light:border-amber-400 light:bg-amber-50/60">
      <p className="text-[10px] font-semibold tracking-wide text-amber-200/60 light:text-amber-700">
        💀 잃은 주사위 무덤{totalLost > 0 ? ` · 총 ${totalLost}개` : ""}
      </p>
      {totalLost === 0 ? (
        <p className="text-[10px] text-amber-100/30 light:text-amber-500">아직 잃은 주사위가 없습니다</p>
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
