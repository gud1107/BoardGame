"use client";

import { useState, type ReactNode } from "react";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import RulebookModal from "./RulebookModal";
import PerudoFaceIcon from "./PerudoFaceIcon";
import {
  BOARD_TRACK_SEQUENCE,
  computeRankings,
  STARTING_DICE,
  totalDiceInPlay,
  trackIndexForBid,
  type BoardTrackNode,
  type EngineAction,
  type Face,
  type PerudoState,
  type SeatIndex,
} from "./engine";
import { DiceRollTray, PerudoDie, tiltFor, type DieSize } from "./dice/PerudoDie";
import {
  BETTING_COLORWAY,
  PLAYER_COLORWAYS,
  playerColorwayForSeat,
  type DiceColorway,
} from "./dice/colorways";

/**
 * Pure game UI + rules driver — mirrors every other board in this project
 * (No Thanks/Avalon/Bang/Grid Poker): state is fully controlled by the
 * caller (PerudoGame, which owns the Supabase Realtime sync); this
 * component only ever emits intent via `onAction`, never mutates state
 * itself. Every client holds the FULL state (every seat's hidden dice) in
 * memory — this component only ever *renders* the viewer's own dice for
 * real and every other seat's as face-down backs until "reveal"/"gameOver".
 * See engine.ts and README for the accepted trust trade-off.
 *
 * Terminology note: the die value 1 is called "페루도" throughout this file
 * (never "파코") per the rulebook's current wording — not to be confused
 * with the "페루도!" doubt call, which is a different action entirely.
 */
export interface PerudoBoardProps {
  state: PerudoState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

// A warm, woven fabric mat — a deep terracotta/umber gradient (cloth, not
// cold grey stone like the earlier version) and `TableTexture` below layers
// a woven crosshatch + Andean-stripe trim bands on top of it, standing in
// for the textile mat the real board sits on. 2026-08-20: the board photo
// (boardGameRule/페루도/변경후이미지.jpg, public/assets/games/perudo/board.jpg)
// that used to sit dimmed behind `BidTrack` as a backdrop texture was removed
// on user request (readability + "clean solid/theme background" ask) — the
// warm gold/jungle palette it inspired still lives on in BidTrack's own
// wood-tile cell gradients and translucent interior plaque, just without the
// literal photo layer underneath.
const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-black/60 bg-gradient-to-b from-[#2a1c14] via-[#1d130d] to-[#0d0805] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)]";

/** Andean-textile stripe band (terracotta/mustard/teal/cream/maroon) — used as the mat's top/bottom trim in `TableTexture`. */
const FABRIC_TRIM_GRADIENT =
  "repeating-linear-gradient(90deg, #b5482f 0 14px, #d9a441 14px 28px, #1f6f6f 28px 42px, #e8d9b5 42px 56px, #7a1f2b 56px 70px)";

/** The fabric mat's texture layer: a woven crosshatch across the whole panel plus a colorful trim band along the top/bottom edges, standing in for a real South American textile mat under the board. The real board photo itself now renders inside `BidTrack` (see its own doc comment) rather than here — this layer is just the mat *under* the board. */
function TableTexture() {
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

function faceLabel(face: Face): string {
  return face === 1 ? "페루도" : `${face}`;
}

/** Always-visible stat bar (rulebook UX request #4, top area) — the one number every player needs at a glance regardless of phase. */
function TotalDiceBanner({ state }: { state: PerudoState }) {
  return (
    <div className="relative z-10 flex items-center justify-center gap-2 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-1.5 text-center">
      <span className="text-base">🎲</span>
      <span className="text-sm font-bold text-amber-100">
        현재 전체 주사위: {totalDiceInPlay(state)}개
      </span>
    </div>
  );
}

/**
 * The center "잃은 주사위 무덤" tray (requirement #3): every die any player
 * has ever lost this game collects here instead of just vanishing from the
 * roster count, so the whole table can see at a glance how depleted the
 * overall dice pool is. Purely derived from `state.players`
 * (`STARTING_DICE - diceCount` per seat) — nothing new is tracked, consistent
 * with this project's "파생 상태 금지" principle. Since a successful "맞아!"
 * no longer caps a seat's `diceCount` at `STARTING_DICE` (2026-08-17 룰북
 * 정리 — 상한 제거), that subtraction can go negative for a seat sitting on
 * more dice than it started with; the `.filter((x) => x.lost > 0)` below
 * simply excludes such seats from the tray rather than showing a negative
 * loss (see docs/architecture.md §1.4). Grouped per seat so the pile also reads as
 * "who's been bleeding dice": each seat's losses render as an overlapping
 * stack of THAT seat's own dice colorway (reinforcing requirement #2's
 * color-matching), dimmed/desaturated so a graveyard die reads as spent and
 * out of play rather than just another concealed hand die (see `DieBack`'s
 * own doc comment for why the shape/colorway underneath is otherwise
 * identical). Rendered right under `TotalDiceBanner` in every phase (not
 * just "playing") so it's a permanent, always-visible fixture of the board
 * rather than something that only shows up mid-round.
 */
function LostDiceTray({
  state,
  viewerSeat,
  myColorway,
}: {
  state: PerudoState;
  viewerSeat: SeatIndex;
  myColorway: DiceColorway;
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
                  <DieBack size="sm" colorway={seat === viewerSeat ? myColorway : playerColorwayForSeat(seat)} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One face-up die — thin wrapper over the shared `PerudoDie` primitive (see `dice/PerudoDie.tsx`) with this file's own title tooltip convention. Always renders in the passed-in `colorway` — including the face-1 페루도 mark, which is engraved in that same die's own ink color rather than a fixed universal red (see `dice/colorways.ts`'s file header). */
function DieFace({ value, size = "md", ring, colorway, tilt }: { value: number; size?: DieSize; ring?: "match" | "wild"; colorway: DiceColorway; tilt?: number }) {
  return (
    <PerudoDie value={value} size={size} ring={ring} colorway={colorway} tilt={tilt} title={value === 1 ? "페루도 (조커)" : `${value}`} />
  );
}

/** A hidden die — a blank, pip-free die in its owner's own colorway (no icon at all, so it reads as a true silhouette rather than a generic dice emoji). Tinted with the owning seat's own player colorway (see `PerudoBoard`'s roster strip and `LostDiceTray`) so whose stash is whose reads at a glance even before anyone's dice count is checked. */
function DieBack({ size = "sm", colorway }: { size?: DieSize; colorway: DiceColorway }) {
  return <PerudoDie size={size} colorway={colorway} blank glossy={false} title="비공개 주사위" />;
}

function FacePicker({ selected, onSelect }: { selected: Face; onSelect: (face: Face) => void }) {
  const faces: Face[] = [1, 2, 3, 4, 5, 6];
  return (
    <div className="flex gap-1.5">
      {faces.map((face) => (
        <button
          key={face}
          type="button"
          onClick={() => onSelect(face)}
          className={`flex h-9 w-9 items-center justify-center rounded-lg border-2 text-sm font-bold transition ${
            selected === face
              ? "border-amber-200 bg-gradient-to-b from-amber-300 to-amber-500 text-neutral-900 shadow-[0_0_0_2px_rgba(251,191,36,0.35)]"
              : "border-white/15 bg-black/20 text-white/60 hover:border-white/30"
          }`}
          title={face === 1 ? "페루도 (조커)" : `숫자 ${face}`}
        >
          {face === 1 ? <PerudoFaceIcon className="mx-auto h-5 w-5" /> : face}
        </button>
      ))}
    </div>
  );
}

/**
 * The purple "betting die" — a dedicated piece (distinct from the ivory/red
 * dice used for actual rolls) that physically represents *where the current
 * bid sits on the track*, echoing the rulebook UX request to bet like moving
 * a board piece rather than picking from an abstract stepper. Rendered on
 * top of whichever `BidTrack` cell matches the live bid quantity. Interactive
 * (bigger hover/press feedback, a little "✋" hint badge) only while it's the
 * viewer's turn and there's a legal face to spin to; otherwise it's a plain
 * read-only marker every seat sees sitting on the actual committed bid.
 *
 * Unrelated to any one player — stays the fixed purple colorway, never a
 * per-seat player colorway.
 *
 * 2026-08-20 visibility pass: the die used to render at one fixed pixel size
 * ("sm", 24px) regardless of the cell it sat in — small on the tight
 * interior cells, but noticeably *tiny and lost* on the roomier corner cells
 * (24px in a 44px corner). It now fills a fixed 80% of whichever cell it's
 * actually placed in (via the `<span>` sized in %, resolved against this
 * button's own `h-full w-full` box — see the call site's doc comment for why
 * both wrapper layers need an explicit size for that % chain to resolve at
 * all), so it both scales up automatically wherever there's room *and* can
 * never spill past its own cell's border — user-confirmed direction: enlarge
 * the marker, but strictly within its cell, never overlapping a neighbor.
 * `size` is passed through to `PerudoDie` only as its base-pixel fallback;
 * the actual rendered size always comes from the 100%-of-80% style chain.
 */
function BettingDie({
  face,
  interactive,
  onClick,
  size = "md",
}: {
  face: Face;
  interactive: boolean;
  onClick?: () => void;
  size?: DieSize;
}) {
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onClick}
      title={interactive ? "클릭해서 베팅 눈금 바꾸기" : "현재 선언된 베팅 위치"}
      className={`relative flex h-full w-full items-center justify-center ${interactive ? "cursor-pointer" : "cursor-default"}`}
    >
      <span className="relative inline-flex" style={{ width: "80%", height: "80%" }}>
        <PerudoDie
          value={face}
          size={size}
          colorway={BETTING_COLORWAY}
          className={`transition ${interactive ? "hover:scale-110 active:scale-95" : ""}`}
          style={{ width: "100%", height: "100%" }}
        />
        {interactive && <span className="pointer-events-none absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] leading-none">✋</span>}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bid track — 2026-08-19 rectangular 4-side redesign (this same session,
// replacing the earlier snake grid from *earlier today*). The 37-cell
// `BOARD_TRACK_SEQUENCE` data itself is completely unchanged (user
// confirmed: "그 칸 데이터/로직은 유지한 채 배치 모양만 사각형으로") — only
// how those 37 cells are laid out visually changed, from a boustrophedon
// zig-zag to a hollow rectangle border echoing the physical board photo
// (boardGameRule/페루도/변경후이미지.jpg). The sequence splits into four
// sides sharing exactly one cell at each of the four corners (user-verified
// 1:1 against the existing array, index-for-index — see PR/commit message):
//   - 북(top,    →): index  0 (코너, quantity 1)  ~ index  9 (코너, quantity 7)
//   - 동(right,  ↓): index  9 (코너, quantity 7)  ~ index 17 (코너, quantity 11)
//   - 남(bottom, ←): index 17 (코너, quantity 11) ~ index 29 (코너, quantity 17)
//   - 서(left,   ↑): index 29 (코너, quantity 17) ~ index 36, wrapping back to
//     index 0's corner cell to close the loop
// Each corner index renders as exactly ONE shared cell (feature request:
// "모서리는 1칸으로 처리" — never duplicated between its two adjacent sides).
// Opposite sides don't have equal cell counts (top has 8 interior cells,
// bottom has 11 — a real asymmetry in the user-confirmed sequence, not a
// layout bug), so this can't be one uniform CSS grid the way a Monopoly-style
// rectangle would be; instead each side is its own independently-divided
// strip (own cell count, evenly dividing that side's available length) that
// only lines up with its neighbors at the four shared corner cells. Top/
// bottom are each their own small CSS grid of `minmax(0,1fr)` tracks (see
// `interiorRow` in `BidTrack`, 2026-08-20); left/right stay flex columns,
// since a column's height was never the thing overflowing the viewport.
// ---------------------------------------------------------------------------
const TOP_INTERIOR = [1, 2, 3, 4, 5, 6, 7, 8];
const RIGHT_INTERIOR = [10, 11, 12, 13, 14, 15, 16];
const BOTTOM_INTERIOR = [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28];
const LEFT_INTERIOR = [30, 31, 32, 33, 34, 35, 36];
const CORNER_TL = 0;
const CORNER_TR = 9;
const CORNER_BR = 17;
const CORNER_BL = 29;

/** One track cell (corner or interior) — shared rendering for every side so the enable/disable + current/perudo styling logic lives in exactly one place. */
function TrackCellButton({
  node,
  fixedWidth,
  isMyTurn,
  currentTrackIndex,
  pendingTrackIndex,
  pendingFace,
  dieInteractive,
  onCellClick,
  onDieClick,
}: {
  node: BoardTrackNode;
  /** True for the 4 corner cells AND the left/right side columns — cells that sit in a fixed-width flex column rather than one of the flexible `minmax(0,1fr)` top/bottom rows, and so need their own explicit (viewport-clamped) width instead of stretching to fill a grid track. See the sizing comment below. */
  fixedWidth?: boolean;
  isMyTurn: boolean;
  currentTrackIndex: number;
  pendingTrackIndex: number | null;
  pendingFace: Face | null;
  dieInteractive: boolean;
  onCellClick: (node: BoardTrackNode) => void;
  onDieClick: () => void;
}) {
  const enabled = isMyTurn && node.index > currentTrackIndex;
  const isCurrentCell = currentTrackIndex === node.index;
  const isPerudoCell = node.kind === "perudo";
  const showDie = pendingTrackIndex === node.index && pendingFace !== null;
  return (
    // A `<div role="button">`, not a real `<button>` — while the pending
    // draft sits on this exact cell (`showDie`), it needs to host
    // `BettingDie`'s own, separately-clickable `<button>` on top of it (cell
    // click moves the draft to this quantity; die click cycles the face —
    // two different actions on two different targets). Nesting a real
    // `<button>` inside a `<button>` is invalid HTML and was already
    // triggering a React hydration warning before this pass touched
    // anything (spotted during this session's required browser
    // verification, see HANDOFF.md) — `role="button"` + manual
    // tabIndex/keydown restores the same semantics/keyboard operability
    // without the nesting violation.
    <div
      role="button"
      tabIndex={enabled ? 0 : -1}
      aria-disabled={!enabled}
      onClick={() => {
        if (enabled) onCellClick(node);
      }}
      onKeyDown={(e) => {
        if (!enabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onCellClick(node);
        }
      }}
      // Sizing (2026-08-20 responsive redesign, replacing the fixed
      // `min-w-[1.7rem]`/`min-w-[34rem]`-floor approach that forced a
      // horizontal scrollbar on any viewport narrower than ~34rem — the
      // right side's quantity-7~11 column would then sit past the visible
      // edge until a viewer discovered they had to scroll, read by the user
      // as the track getting "clipped"/pushed off-screen). `fixedWidth`
      // cells (corners + the left/right side columns) use a `clamp()` width
      // that scales with the viewport between a legible floor and the old
      // fixed size as a ceiling. Interior top/bottom cells instead take NO
      // width of their own at all — their side's wrapper is now a CSS grid
      // of `minmax(0,1fr)` tracks (see `BidTrack`), so the 8- or 11-cell row
      // always divides exactly however much width its parent actually has,
      // with zero risk of forcing the row (and everything after it) wider
      // than the viewport. `min-w-0` strips this button's own implicit
      // content-based minimum (the classic grid/flex-item "min-width: auto"
      // trap — without it, the quantity digits' own intrinsic width could
      // still force the track wider despite the `minmax(0, ...)` template).
      className={`relative z-10 flex min-w-0 shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[4px] border-2 text-[9px] leading-none font-bold [text-shadow:0_1px_2px_rgba(0,0,0,0.8)] transition sm:text-xs ${
        fixedWidth ? "aspect-square w-[clamp(1.6rem,8vw,2.75rem)]" : "aspect-square w-full"
      } ${
        isCurrentCell
          ? "border-amber-200 bg-gradient-to-b from-amber-300/85 to-amber-500/85 text-neutral-900 shadow-[0_0_0_2px_rgba(251,191,36,0.5)]"
          : enabled
            ? isPerudoCell
              ? "cursor-pointer border-rose-800/70 bg-gradient-to-b from-rose-700/55 to-rose-900/55 text-rose-100 hover:from-rose-600/70 hover:to-rose-800/70"
              : "cursor-pointer border-amber-950/70 bg-gradient-to-b from-amber-700/55 to-amber-900/55 text-amber-100 hover:from-amber-600/70 hover:to-amber-800/70"
            : "cursor-not-allowed border-black/40 bg-gradient-to-b from-neutral-900/55 to-neutral-950/55 text-white/40"
      }`}
      title={
        !isMyTurn
          ? "지금은 당신의 차례가 아니에요"
          : enabled
            ? `${isPerudoCell ? `[페루도 ${node.quantity}]` : `${node.quantity}`} 칸으로 베팅 이동`
            : "현재 베팅 칸과 같거나 이전인 칸으로는 이동할 수 없어요 (역행 불가)"
      }
    >
      {isPerudoCell && <PerudoFaceIcon className="pointer-events-none h-3 w-3 sm:h-3.5 sm:w-3.5" />}
      <span className="relative z-10">{node.quantity}</span>
      {node.index === 0 && <span className="absolute -top-0.5 -right-0.5 text-[8px] leading-none">🎲</span>}
      {showDie && (
        // 2026-08-20: `BettingDie` now sizes itself as a percentage of
        // whatever this cell actually renders at (see its own doc comment)
        // rather than a fixed pixel size — so both wrapper divs need an
        // explicit `h-full w-full` all the way down for that percentage
        // chain to resolve against the real cell box, not an auto-sized
        // shrink-to-fit ancestor.
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="pointer-events-auto h-full w-full">
            <BettingDie face={pendingFace!} interactive={dieInteractive} onClick={onDieClick} size="sm" />
          </div>
        </div>
      )}
    </div>
  );
}

/** Small non-interactive arrow badge marking a side's bidding direction (feature request: "진행방향에 대한 화살표 표시") — floats just outside the frame at that side's midpoint, purely decorative/orientational, never intercepts clicks on the cells beneath it. */
function DirectionArrow({ side }: { side: "top" | "right" | "bottom" | "left" }) {
  const glyph = { top: "→", right: "↓", bottom: "←", left: "↑" }[side];
  const position = {
    top: "-top-2.5 left-1/2 -translate-x-1/2",
    right: "top-1/2 -right-2.5 -translate-y-1/2",
    bottom: "-bottom-2.5 left-1/2 -translate-x-1/2",
    left: "top-1/2 -left-2.5 -translate-y-1/2",
  }[side];
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute ${position} z-30 flex h-5 w-5 items-center justify-center rounded-full border border-amber-300/50 bg-neutral-900 text-[11px] font-bold text-amber-200 shadow-[0_0_0_2px_rgba(0,0,0,0.6)]`}
    >
      {glyph}
    </span>
  );
}

/**
 * The perimeter rectangle track (2026-08-19 redesign, replacing this same
 * session's earlier snake grid): a hollow 4-side border built from
 * `BOARD_TRACK_SEQUENCE`'s existing 37 cells (unchanged data — see the
 * module doc above), around a `centerContent` slot now dedicated to the dice
 * graveyard (feature request: "무덤 전용 + 조작 UI 바깥 이동" — the
 * bid-declaration controls that used to live in this component's center
 * plaque now render as their own card below the whole track, in
 * `PerudoBoard`). `currentTrackIndex`/`pendingTrackIndex`/`pendingFace` and
 * the enable/disable + purple-die-marker semantics are all unchanged from
 * the snake version, just re-laid-out — the purple die now renders as an
 * overlay inside whichever single cell it belongs to (via
 * `TrackCellButton`'s own `showDie` check) instead of a separately
 * grid-coordinate-positioned sibling, since cells are no longer all siblings
 * on one shared grid.
 */
function BidTrack({
  isMyTurn,
  currentTrackIndex,
  pendingTrackIndex,
  pendingFace,
  dieInteractive,
  onCellClick,
  onDieClick,
  centerContent,
}: {
  isMyTurn: boolean;
  currentTrackIndex: number;
  pendingTrackIndex: number | null;
  pendingFace: Face | null;
  dieInteractive: boolean;
  onCellClick: (node: BoardTrackNode) => void;
  onDieClick: () => void;
  centerContent: ReactNode;
}) {
  const cell = (index: number, fixedWidth = false) => (
    <TrackCellButton
      key={index}
      node={BOARD_TRACK_SEQUENCE[index]}
      fixedWidth={fixedWidth}
      isMyTurn={isMyTurn}
      currentTrackIndex={currentTrackIndex}
      pendingTrackIndex={pendingTrackIndex}
      pendingFace={pendingFace}
      dieInteractive={dieInteractive}
      onCellClick={onCellClick}
      onDieClick={onDieClick}
    />
  );
  // Top/bottom interior rows (2026-08-20 responsive redesign): a CSS grid of
  // `minmax(0, 1fr)` tracks, not a flexbox — a `flex-1` row can still be
  // forced wider than its parent by its children's summed `min-width`
  // floors (that's exactly what the old fixed `min-w-[1.7rem]` cells did),
  // but a `minmax(0, 1fr)` grid track has no such floor: the row always
  // divides however much width its parent actually has, full stop. This is
  // what makes the whole rectangle immune to overflowing the viewport (see
  // this component's own doc comment) — the crowded 11-cell south side is
  // exactly where that used to bite hardest.
  const interiorRow = (indices: number[]) => (
    <div className="relative grid gap-[2px] sm:gap-[3px]" style={{ gridTemplateColumns: `repeat(${indices.length}, minmax(0, 1fr))` }}>
      {indices.map((i) => cell(i))}
    </div>
  );
  return (
    // Outer "stone bezel" frame, echoing the physical mat's grey-stone
    // border around the wood tile track. Just `w-full` now (2026-08-20) —
    // no more fixed `min-w-[34rem]` floor forcing a scrollbar on narrower
    // viewports (see `interiorRow`'s doc comment just above and
    // `TrackCellButton`'s own doc comment for the full mechanism). The
    // physical board photo that used to sit dimmed behind this whole
    // rectangle was also removed here per user request (2026-08-20 UI pass —
    // "배경 이미지 제거") in favor of the plain gradient bezel below.
    <div className="relative w-full rounded-[1.5rem] border-4 border-neutral-700 bg-gradient-to-b from-neutral-800 via-neutral-900 to-black p-1.5 shadow-[inset_0_2px_8px_rgba(0,0,0,0.7)] sm:p-2">
      <div
        className="relative z-10 grid gap-[3px]"
        style={{ gridTemplateColumns: "auto 1fr auto", gridTemplateRows: "auto minmax(6rem, 1fr) auto" }}
      >
        <div className="relative">{cell(CORNER_TL, true)}</div>
        <div className="relative">
          {interiorRow(TOP_INTERIOR)}
          <DirectionArrow side="top" />
        </div>
        <div className="relative">{cell(CORNER_TR, true)}</div>

        <div className="relative flex flex-col gap-[2px] sm:gap-[3px]">
          {[...LEFT_INTERIOR].reverse().map((i) => cell(i, true))}
          <DirectionArrow side="left" />
        </div>
        <div className="relative z-10 flex min-h-0 flex-col items-center justify-center gap-2 overflow-y-auto rounded-[1rem] border-2 border-dashed border-amber-800/40 bg-black/25 p-2">
          {centerContent}
        </div>
        <div className="relative flex flex-col gap-[2px] sm:gap-[3px]">
          {RIGHT_INTERIOR.map((i) => cell(i, true))}
          <DirectionArrow side="right" />
        </div>

        <div className="relative">{cell(CORNER_BL, true)}</div>
        <div className="relative">
          {/* Bottom side walks 코너BR(17)→...→코너BL(29) — i.e. index 18 (right
              after BR) sits nearest the RIGHT edge and 28 (right before BL)
              sits nearest the LEFT edge, so the ascending index array is
              reversed before rendering in normal (non-reversed) row order,
              same technique as the LEFT strip above. */}
          {interiorRow([...BOTTOM_INTERIOR].reverse())}
          <DirectionArrow side="bottom" />
        </div>
        <div className="relative">{cell(CORNER_BR, true)}</div>
      </div>
    </div>
  );
}

/**
 * Stats dashboard placed directly below the "페루도!"/"맞아!" action buttons
 * (rulebook UX request #4): my own cup's dice counts by face, plus the
 * "전체 주사위 ÷ 3" expected-value guide that drives Perudo doubt/call
 * strategy — the two numbers a player checks right after deciding whether
 * to challenge the current bid.
 */
function MyDiceStatsPanel({ state, myDice }: { state: PerudoState; myDice: number[] }) {
  const faces: Face[] = [1, 2, 3, 4, 5, 6];
  const counts = faces.map((face) => ({ face, count: myDice.filter((d) => d === face).length }));
  const total = totalDiceInPlay(state);
  const expected = total / 3;

  return (
    <div className="relative z-10 flex flex-col gap-2 rounded-xl border border-white/10 bg-black/25 p-2.5">
      <p className="text-[11px] font-semibold tracking-wide text-white/50 uppercase">📊 통계 현황판</p>
      <div className="flex flex-wrap gap-1.5">
        {counts.map(({ face, count }) => (
          <span
            key={face}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
              count > 0 ? "border-amber-300/40 bg-amber-400/10 text-amber-100" : "border-white/10 text-white/30"
            }`}
          >
            {face === 1 ? <PerudoFaceIcon className="h-3 w-3" /> : <span className="font-bold">{face}</span>}
            {face === 1 ? "페루도(1)" : `숫자 ${face}`}: {count}개
          </span>
        ))}
      </div>
      <p className="text-[11px] text-white/50">
        전체 주사위: <span className="text-white/80">{total}개</span> · 1/3 기대값:{" "}
        <span className="text-amber-200">{expected.toFixed(1)}개</span>
      </p>
    </div>
  );
}

export default function PerudoBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: PerudoBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const isMyTurn = state.activeSeat === viewerSeat && state.phase === "playing";
  const iAmAlive = me.diceCount > 0;

  // My own dice's colorway: defaults to a seat-derived pick (see
  // `playerColorwareForSeat`) so every player looks different out of the
  // box, but is purely a local cosmetic preference the viewer can override
  // via the swatch picker — never synced, same trust tier as `muted` below.
  const [colorwayOverride, setColorwayOverride] = useState<DiceColorway | null>(null);
  const myColorway = colorwayOverride ?? playerColorwayForSeat(viewerSeat);

  // -------------------------------------------------------------------------
  // Purple betting die draft — local to this client, re-synced from
  // `state.currentBid` every time it actually changes (new round, or anyone's
  // opening bid/raise) using a render-time "adjust state when a prop
  // changes" pattern (same idea as `syncedBidKey` just below it uses on
  // itself), rather than an effect that would flash a stale draft for a
  // frame. 2026-08-19 board track redesign: the draft is now just one
  // `pendingTrackIndex` into `BOARD_TRACK_SEQUENCE` (quantity/kind read
  // straight off that cell) plus a remembered `pendingNormalFace` (2-6) for
  // whichever specific non-joker face to bid once landed on a "normal" cell
  // — the track itself never distinguishes faces 2-6 from each other, only
  // joker vs. non-joker (see engine.ts's `trackIndexForBid` doc). While it's
  // my turn the purple die on the track shows this draft (movable/
  // spinnable); the rest of the time it shows the actual committed
  // `state.currentBid` position instead, so every seat always sees exactly
  // where the bid currently sits.
  // -------------------------------------------------------------------------
  const currentTrackIndex = state.currentBid?.trackIndex ?? -1;
  const bidKey = `${state.roundNumber}:${state.currentBid ? `${state.currentBid.seat}-${state.currentBid.trackIndex}` : "none"}`;
  const [syncedBidKey, setSyncedBidKey] = useState<string | null>(null);
  const [pendingTrackIndex, setPendingTrackIndex] = useState<number>(0);
  const [pendingNormalFace, setPendingNormalFace] = useState<Face>(2);
  if (syncedBidKey !== bidKey) {
    setSyncedBidKey(bidKey);
    // Default draft: the very next cell on the track — always strictly
    // ahead of `currentTrackIndex`, except once the track itself is
    // exhausted (currentTrackIndex already the last cell), where it just
    // pins to that same last cell and `canConfirmBet` below goes false.
    setPendingTrackIndex(Math.min(currentTrackIndex + 1, BOARD_TRACK_SEQUENCE.length - 1));
  }
  const pendingNode = BOARD_TRACK_SEQUENCE[pendingTrackIndex];
  const pendingQuantity = pendingNode.quantity;
  const pendingFace: Face = pendingNode.kind === "perudo" ? 1 : pendingNormalFace;

  /**
   * Move the draft to the nearest still-legal (strictly-ahead) cell matching
   * `face` — 1 always means the nearest "perudo" cell ahead (preferring one
   * that keeps the current draft quantity, if such a cell still exists
   * ahead), 2-6 means the nearest "normal" cell ahead. No-op if no such cell
   * remains ahead of `currentTrackIndex` at all (board track exhausted for
   * that kind).
   */
  function pickFace(face: Face) {
    if (face === 1) {
      const sameQty = trackIndexForBid(currentTrackIndex, pendingQuantity, 1);
      const nextIdx = sameQty ?? BOARD_TRACK_SEQUENCE.findIndex((n) => n.index > currentTrackIndex && n.kind === "perudo");
      if (nextIdx !== null && nextIdx !== -1) setPendingTrackIndex(nextIdx);
      return;
    }
    setPendingNormalFace(face);
    const sameQty = trackIndexForBid(currentTrackIndex, pendingQuantity, face);
    const nextIdx = sameQty ?? BOARD_TRACK_SEQUENCE.findIndex((n) => n.index > currentTrackIndex && n.kind === "normal");
    if (nextIdx !== null && nextIdx !== -1) setPendingTrackIndex(nextIdx);
  }

  /** Clicking the purple die itself cycles to the next face — the "touch the die directly" interaction requested alongside the FacePicker controller. */
  function cycleFace() {
    const order: Face[] = [1, 2, 3, 4, 5, 6];
    const startIdx = order.indexOf(pendingFace);
    pickFace(order[(startIdx + 1) % order.length]);
  }

  /** A board-track cell was clicked directly — moves the draft to exactly that cell (the one the viewer can see and clicked), never re-derived from quantity alone (duplicate-labelled cells like the two "4"s would otherwise be ambiguous — see engine.ts's module doc). */
  function selectCell(node: BoardTrackNode) {
    if (node.index <= currentTrackIndex) return; // guarded again here even though the UI also disables it
    setPendingTrackIndex(node.index);
  }

  const canConfirmBet = isMyTurn && iAmAlive && pendingTrackIndex > currentTrackIndex;

  // Roll sound cue: `DiceRollTray`'s `onRollStart`/`onSettled` callbacks
  // (wired up below, "My dice" section) fire the rattle/thud SFX beat timed
  // to the actual shake-then-settle animation, every time a new round's
  // dice are rolled (roundNumber changes, including the very first mount).
  // A player's own dice are ALWAYS visible the instant they render — no cup
  // or timer ever hides them (2026-08 페루도 UI 개편, 사용자 요청).

  const [muted, setMuted] = useState(() => getSoundEngine().isMuted());
  function toggleMuted() {
    const next = !muted;
    getSoundEngine().setMuted(next);
    setMuted(next);
  }

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 페루도 룰북
    </button>
  );

  const muteButton = (
    <button
      onClick={toggleMuted}
      title={muted ? "효과음 켜기" : "효과음 끄기"}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );

  const colorwayPicker = (
    <div className="flex items-center gap-1" title="내 주사위 색상 선택">
      {PLAYER_COLORWAYS.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => setColorwayOverride(c)}
          title={c.label}
          aria-label={`주사위 색상: ${c.label}`}
          className={`h-4 w-4 rounded-full border-2 transition ${
            myColorway.id === c.id ? "scale-110 border-white" : "border-white/25 hover:border-white/60"
          }`}
          style={{ backgroundColor: c.body }}
        />
      ))}
    </div>
  );

  // -------------------------------------------------------------------------
  // Game over
  // -------------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    return (
      <div className={`${TABLE_PANEL} flex flex-col items-center gap-4 p-4 text-center sm:p-8`}>
        <TableTexture />
        <TotalDiceBanner state={state} />
        <LostDiceTray state={state} viewerSeat={viewerSeat} myColorway={myColorway} />
        <span className="relative z-10 text-5xl">🏆</span>
        <h2 className="relative z-10 text-2xl font-bold text-amber-100">{names[rankings[0]?.seat]}님 승리!</h2>
        <p className="relative z-10 text-xs text-white/50">마지막까지 주사위를 지킨 사람이 이기는 게임입니다.</p>

        <div className="relative z-10 w-full overflow-x-auto">
          <table className="w-full min-w-[320px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="border-b border-white/10 px-2 py-2 text-left">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left">플레이어</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank }) => (
                <tr key={seat} className={rank === 1 ? "bg-amber-400/10" : ""}>
                  <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200">
                    {rank === 1 ? "🏆 1" : rank}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-left text-white">
                    {names[seat]}
                    {seat === viewerSeat && <span className="ml-1 text-amber-200">(나)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {state.lastResolution && <RevealPanel state={state} names={names} viewerSeat={viewerSeat} myColorway={myColorway} />}

        <button
          onClick={onGameEnd}
          className="relative z-10 rounded-full bg-amber-500 px-8 py-3 font-medium text-black transition hover:bg-amber-400"
        >
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Reveal (between rounds)
  // -------------------------------------------------------------------------
  if (state.phase === "reveal" && state.lastResolution) {
    const res = state.lastResolution;
    const success = res.kind === "dudo" ? res.affectedSeat !== res.actorSeat : res.diceDelta > 0;
    const lossAmount = Math.abs(res.diceDelta);
    return (
      <div className={`${TABLE_PANEL} flex flex-col gap-3 p-3 sm:p-4`}>
        <TableTexture />
        <TotalDiceBanner state={state} />
        <LostDiceTray state={state} viewerSeat={viewerSeat} myColorway={myColorway} />
        <div className="relative z-10 flex items-center justify-between text-xs text-rose-100/60">
          <span>
            {state.playerCount}인 · {state.roundNumber}라운드 결과
          </span>
          <div className="flex gap-1.5">
            {muteButton}
            {rulebookButton}
          </div>
        </div>
        <div className="relative z-10 rounded-2xl border border-white/10 bg-black/30 p-4 text-center">
          <p className="text-sm font-semibold text-amber-100">
            {names[res.actorSeat]}님이 {res.kind === "dudo" ? "🚨 페루도!" : "🎯 맞아!"}를 외쳤습니다
          </p>
          <p className="mt-1 text-xs text-white/60">
            선언: {faceLabel(res.bid.face)} {res.bid.quantity}개 이상 · 실제: {res.actualCount}개
          </p>
          <p className={`mt-2 text-sm font-bold ${success ? "text-emerald-300" : "text-rose-300"}`}>
            {res.kind === "dudo"
              ? res.affectedSeat === res.bid.seat
                ? `📉 선언이 틀렸습니다 — ${names[res.bid.seat]}님이 주사위 ${lossAmount}개를 잃었습니다.`
                : `📈 선언이 맞았습니다 — ${names[res.actorSeat]}님이 주사위 ${lossAmount}개를 잃었습니다.`
              : res.diceDelta > 0
                ? `🎉 정확히 맞췄습니다! ${names[res.actorSeat]}님이 주사위 1개를 되찾았습니다.`
                : `❌ 틀렸습니다 — ${names[res.actorSeat]}님이 주사위 ${lossAmount}개를 잃었습니다.`}
          </p>
        </div>

        <RevealPanel state={state} names={names} viewerSeat={viewerSeat} myColorway={myColorway} />

        <button
          onClick={() => onAction({ type: "continue", seed: randomSeed() })}
          className="relative z-10 rounded-full bg-amber-500 py-3 text-sm font-semibold text-black transition hover:bg-amber-400"
        >
          ▶️ 다음 라운드
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Playing
  // -------------------------------------------------------------------------
  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => i);

  return (
    <div className={`${TABLE_PANEL} flex flex-col gap-3 p-3 sm:p-4`}>
      <TableTexture />
      <TotalDiceBanner state={state} />

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-1.5 text-xs text-rose-100/60">
        <span className="flex items-center gap-1.5">
          {state.playerCount}인 · {state.roundNumber}라운드
        </span>
        <div className="flex gap-1.5">
          {muteButton}
          {rulebookButton}
        </div>
      </div>

      <p className={`relative z-10 text-center text-xs font-medium ${isMyTurn ? "text-amber-200" : "text-white/50"}`}>
        {isMyTurn ? "🫵 당신 차례입니다!" : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
      </p>

      <div className="relative z-10">
        {/* Betting-zone label — a fabric-patch tag echoing the mat's own labeled zones (see boardGameRule/페루도's board photo). */}
        <div className="mb-1.5 flex items-center justify-center">
          <span className="rounded-full border border-dashed border-amber-700/50 bg-amber-950/30 px-3 py-1 text-[10px] font-semibold tracking-[0.15em] text-amber-200/70">
            🎯 배팅 구역 · BID TRACK
          </span>
        </div>
        {/* Rectangle track's hollow center is now dedicated to the dice
            graveyard (feature request: "무덤 전용 + 조작 UI 바깥 이동") — the
            bid-declaration controls that used to nest inside the track now
            render as their own card right below it instead. The south side
            alone needs 11 cells (vs. the north side's 8 — see `BidTrack`'s
            own doc comment on the confirmed side-length asymmetry). 2026-08-20:
            this used to be wrapped in `overflow-x-auto` alongside a fixed
            `min-w-[34rem]` floor on `BidTrack`'s outer frame, so the south
            row's cells never got crushed past legibility — but that also
            meant the whole rectangle (right side's quantity-7~11 column
            included) sat past the visible viewport edge, requiring a
            horizontal scroll a lot of players never discovered, which read
            as the track getting clipped/cut off. `BidTrack`'s cells are now
            responsive instead (see its own doc comment) — no scroll
            container needed, and `overflow: visible` (the default here)
            keeps the direction-arrow badges that intentionally poke slightly
            outside the frame from getting clipped either. */}
        <div className="pb-1">
          <BidTrack
            isMyTurn={isMyTurn}
            currentTrackIndex={currentTrackIndex}
            pendingTrackIndex={isMyTurn ? pendingTrackIndex : (state.currentBid?.trackIndex ?? null)}
            pendingFace={isMyTurn ? pendingFace : (state.currentBid?.face ?? null)}
            dieInteractive={isMyTurn && iAmAlive}
            onCellClick={selectCell}
            onDieClick={cycleFace}
            centerContent={<LostDiceTray state={state} viewerSeat={viewerSeat} myColorway={myColorway} />}
          />
        </div>
      </div>

      {/* Bid-declaration controls — moved out from the track's center (see
          `BidTrack`'s `centerContent` above) into their own card directly
          beneath the whole rectangle. */}
      <div className="relative z-10 flex flex-col items-center justify-center gap-2 rounded-[1.25rem] border-4 border-amber-800 bg-amber-100/90 p-2 text-neutral-900 shadow-[inset_0_2px_10px_rgba(0,0,0,0.18)]">
        {state.currentBid ? (
          <div className="flex flex-col items-center gap-0.5 text-center">
            <span className="text-[10px] text-amber-900/70">{names[state.currentBid.seat]}님의 선언</span>
            <span className="text-2xl font-black text-red-900 drop-shadow-[0_1px_0_rgba(255,255,255,0.4)] sm:text-3xl">
              {faceLabel(state.currentBid.face)} × {state.currentBid.quantity}개↑
            </span>
          </div>
        ) : (
          <p className="px-2 text-center text-xs text-amber-900/70">
            {names[state.activeSeat]}님이 이번 라운드를 엽니다 — 첫 선언 대기 중
          </p>
        )}

        {isMyTurn && iAmAlive && (
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-violet-900/25 bg-violet-950/5 px-2.5 py-2">
            <p className="text-center text-[10px] font-semibold text-violet-900/70">
              🟣 보라색 주사위를 클릭해 눈금 변경, 트랙 칸을 클릭해 개수 이동
            </p>
            <FacePicker selected={pendingFace} onSelect={pickFace} />
            <button
              type="button"
              disabled={!canConfirmBet}
              onClick={() => onAction({ type: "raise", seat: viewerSeat, quantity: pendingQuantity, face: pendingFace })}
              className="rounded-full bg-violet-700 px-4 py-1.5 text-xs font-semibold text-white shadow-[0_0_0_2px_rgba(168,85,247,0.3)] transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30 disabled:shadow-none"
            >
              ✅ {faceLabel(pendingFace)} × {pendingQuantity}개로 베팅 확정
            </button>
          </div>
        )}

        {iAmAlive && (
          <div className="flex gap-2">
            <button
              disabled={!isMyTurn || !state.currentBid}
              onClick={() => onAction({ type: "dudo", seat: viewerSeat })}
              className="rounded-lg bg-rose-700 px-3 py-1.5 text-[11px] font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30 sm:px-4 sm:py-2 sm:text-xs"
            >
              🚨 페루도!
            </button>
            <button
              disabled={!state.currentBid}
              onClick={() => onAction({ type: "calza", seat: viewerSeat })}
              title="차례와 상관없이 외칠 수 있어요"
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-[11px] font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30 sm:px-4 sm:py-2 sm:text-xs"
            >
              🎯 맞아!
            </button>
          </div>
        )}
      </div>

      {/* Stats dashboard — right below the 페루도!/맞아! action buttons above. */}
      <MyDiceStatsPanel state={state} myDice={me.dice} />

      {/* My dice — always fully visible, no cup or lid ever occludes them
          (2026-08 페루도 UI 개편, 사용자 요청). `DiceRollTray` replays a short
          CSS shake-then-settle every new round (see `dice/PerudoDie.tsx`'s
          file header for why this replaced the earlier WebGL physics tray),
          but never hides the settled values behind an extra "open me"
          interaction. */}
      <div className="relative z-10 flex flex-col items-center gap-1.5 rounded-2xl border-2 border-amber-900/40 bg-gradient-to-b from-black/25 to-black/35 p-3 shadow-[inset_0_2px_10px_rgba(0,0,0,0.35),0_4px_14px_-6px_rgba(0,0,0,0.6)]">
        <div className="flex w-full items-center justify-between px-1">
          <p className="text-[11px] font-semibold text-amber-100/70">🎲 내 주사위 ({me.diceCount}개)</p>
          {colorwayPicker}
        </div>
        {!iAmAlive ? (
          <p className="text-xs text-rose-300/70">탈락했습니다 — 관전 중</p>
        ) : (
          <DiceRollTray
            dice={me.dice}
            colorway={myColorway}
            rollToken={state.roundNumber}
            size="lg"
            ringForIndex={(i) => {
              const d = me.dice[i];
              const matchesBid = state.currentBid ? d === state.currentBid.face : false;
              if (matchesBid) return "match";
              if (state.currentBid && state.currentBid.face !== 1 && d === 1) return "wild";
              return undefined;
            }}
            onRollStart={() => {
              const engine = getSoundEngine();
              engine.unlock(); // best-effort — a user gesture already happened earlier in the room lobby
              engine.playDiceRattle(600);
            }}
            onSettled={() => getSoundEngine().playCupThud()}
          />
        )}
      </div>

      {/* Scoreboard — a responsive grid (not a single flex column) so it
          stays readable up to the full 8-player table instead of forcing a
          tall single-file scroll; wraps to 2 columns once there's room. Each
          row leads with a color swatch matching that seat's own dice
          colorway (requirement #2: name <-> dice color at a glance) before
          the name itself. */}
      <div className="relative z-10 flex flex-col gap-1.5">
        <p className="px-1 text-[10px] font-semibold tracking-[0.15em] text-amber-200/50 uppercase">🏆 스코어보드</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {seatOrder.map((seat) => {
            const player = state.players.find((p) => p.seat === seat)!;
            const isSelf = seat === viewerSeat;
            const isActive = state.activeSeat === seat && state.phase === "playing";
            const eliminated = player.diceCount <= 0;
            const seatColorway = seat === viewerSeat ? myColorway : playerColorwayForSeat(seat);
            return (
              <div
                key={seat}
                className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 transition ${
                  isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/20"
                } ${eliminated ? "opacity-40" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-white/90">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/30"
                    style={{ backgroundColor: seatColorway.body }}
                    title={`${seatColorway.label} 주사위`}
                  />
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`}
                  />
                  {isActive && <span title="차례">👉</span>}
                  {eliminated && <span title="탈락">💀</span>}
                  <span className="truncate">{names[seat]}</span>
                  {isSelf && <span className="shrink-0 text-amber-200">(나)</span>}
                </span>
                <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1">
                  {eliminated ? (
                    <span className="text-[11px] text-white/30">탈락</span>
                  ) : (
                    Array.from({ length: player.diceCount }, (_, i) => (
                      <DieBack key={i} colorway={seatColorway} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}

/** Full-table dice reveal shown during "reveal"/"gameOver", highlighting whichever dice counted toward the resolved bid. */
function RevealPanel({
  state,
  names,
  viewerSeat,
  myColorway,
}: {
  state: PerudoState;
  names: Record<SeatIndex, string>;
  viewerSeat: SeatIndex;
  myColorway: DiceColorway;
}) {
  const res = state.lastResolution;
  if (!res) return null;
  return (
    <div className="relative z-10 flex w-full flex-col gap-2">
      {Object.entries(res.revealedDice).map(([seatStr, dice]) => {
        const seat = Number(seatStr);
        return (
          <div key={seat} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
            <span className="w-20 shrink-0 truncate text-[11px] text-white/60">
              {names[seat]}
              {seat === viewerSeat && " (나)"}
            </span>
            <div className="flex flex-wrap gap-1">
              {dice.length === 0 ? (
                <span className="text-[11px] text-white/25">주사위 없음</span>
              ) : (
                dice.map((d, i) => {
                  const matches = d === res.bid.face;
                  const isWild = res.bid.face !== 1 && d === 1;
                  return (
                    <DieFace
                      key={i}
                      value={d}
                      size="sm"
                      ring={matches ? "match" : isWild ? "wild" : undefined}
                      colorway={seat === viewerSeat ? myColorway : playerColorwayForSeat(seat)}
                      tilt={tiltFor(seat * 31 + i * 7)}
                    />
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
