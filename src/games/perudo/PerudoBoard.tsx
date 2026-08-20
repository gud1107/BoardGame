"use client";

import { useState } from "react";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import RulebookModal from "./RulebookModal";
import PerudoFaceIcon from "./PerudoFaceIcon";
import {
  computeRankings,
  minValidQuantityForFace,
  STARTING_DICE,
  totalDiceInPlay,
  trackCellAt,
  trackCellForBid,
  validateRaise,
  type EngineAction,
  type Face,
  type PerudoState,
  type SeatIndex,
  type TrackCell,
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
// that used to sit dimmed behind the bid track as a backdrop texture was
// removed on user request (readability + "clean solid/theme background"
// ask) — the warm gold/jungle palette it inspired still lives on in
// `RectBidTrack`'s own wood-tile cell gradients and translucent interior
// plaque, just without the literal photo layer underneath. 2026-08-20 사각형
// 트랙 세션: that photo's actual layout (4-side rectangle, quantities 1-20,
// shared corners at 7/11/17) is now the literal reference for `RectBidTrack`
// below, not just a mood-board inspiration.
const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-black/60 bg-gradient-to-b from-[#2a1c14] via-[#1d130d] to-[#0d0805] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)]";

/** Andean-textile stripe band (terracotta/mustard/teal/cream/maroon) — used as the mat's top/bottom trim in `TableTexture`. */
const FABRIC_TRIM_GRADIENT =
  "repeating-linear-gradient(90deg, #b5482f 0 14px, #d9a441 14px 28px, #1f6f6f 28px 42px, #e8d9b5 42px 56px, #7a1f2b 56px 70px)";

/** The fabric mat's texture layer: a woven crosshatch across the whole panel plus a colorful trim band along the top/bottom edges, standing in for a real South American textile mat under the board. The real board itself now renders as `RectBidTrack` (see its own doc comment) rather than here — this layer is just the mat *under* the board. */
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

// ---------------------------------------------------------------------------
// Bid track (2026-08-20 트랙/마커 재도입 세션 — see engine.ts's module doc for
// the full history). This is a purely visual, horizontally-scrolling strip
// of cells generated on demand by `trackCellAt`/`trackCellForBid` — there is
// no fixed array and no click-driven "advance to nearest cell" search (the
// old state-dependent search was the actual root cause of the marker landing
// on the wrong cell — see engine.ts). Clicking a cell just sets the composer's
// quantity/face directly, and the marker's position is always recomputed
// fresh from whatever (quantity, face) is currently selected — nothing here
// can drift out of sync with the confirmed or draft bid it's supposed to
// represent. Legality (which cells are clickable) is decided entirely by
// `validateRaise`, never by track position.
//
// 2026-08-21 "버그3" 세션: the draft now defaults to sitting EXACTLY on the
// current bid's own cell (see `PerudoBoard`'s bid-composer doc) rather than
// the next legal raise, so clicking THAT cell again — i.e. clicking the
// purple marker itself — is now its own gesture: raise the draft's face by
// one step (2→3→4→5→6) in place, rather than the generic "jump the draft to
// this cell's quantity" every other cell does. See `selectCell`.
// ---------------------------------------------------------------------------

/** How a track cell sizes itself: `"corner"` is fixed both ways (the 4 shared corner tiles at quantities 1/7/11/17), `"row"` has a fixed height but stretches to fill its side's width (north/south strips), `"col"` has a fixed width but stretches to fill its side's height (east/west strips). The fixed cross-axis size (h-9/w-9, sm:h-11/w-11) is intentionally identical across all three variants — that's what keeps the rectangle's corners flush against the strips instead of stair-stepping (see `RectBidTrack`). */
type CellSizing = "corner" | "row" | "col";

const CELL_SIZING_CLASS: Record<CellSizing, string> = {
  corner: "h-9 w-9 shrink-0 sm:h-11 sm:w-11",
  row: "h-9 min-w-0 flex-1 sm:h-11",
  col: "w-9 min-h-0 flex-1 sm:w-11",
};

/** One track cell — a plain quantity/조커 cell, no click-eligibility baked in (the caller decides `enabled` from `validateRaise`, not from track position). */
function TrackCellButton({
  cell,
  sizing = "corner",
  isCurrent,
  isPending,
  pendingFace,
  enabled,
  onClick,
}: {
  cell: TrackCell;
  sizing?: CellSizing;
  isCurrent: boolean;
  isPending: boolean;
  pendingFace: Face;
  enabled: boolean;
  onClick: () => void;
}) {
  const isPerudoCell = cell.kind === "perudo";
  return (
    <button
      type="button"
      data-track-index={cell.index}
      disabled={!enabled}
      onClick={onClick}
      title={
        enabled
          ? isPending && !isPerudoCell
            ? pendingFace < 6
              ? `🟣 마커 클릭 — 눈금 ${pendingFace} → ${pendingFace + 1}로 올리기`
              : "🟣 마커 — 눈금이 이미 최고치(6)입니다. 수량을 올려주세요"
            : `${isPerudoCell ? `[페루도 ${cell.quantity}]` : `${cell.quantity}`} 칸으로 베팅 이동`
          : isCurrent
            ? "현재 확정된 베팅 칸입니다"
            : "지금은 여기로 베팅할 수 없어요"
      }
      className={`relative flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[6px] border-2 text-[10px] leading-none font-bold [text-shadow:0_1px_2px_rgba(0,0,0,0.8)] transition sm:text-xs ${CELL_SIZING_CLASS[sizing]} ${
        isCurrent
          ? "border-amber-200 bg-gradient-to-b from-amber-300/85 to-amber-500/85 text-neutral-900 shadow-[0_0_0_2px_rgba(251,191,36,0.5)]"
          : enabled
            ? isPerudoCell
              ? "cursor-pointer border-rose-800/70 bg-gradient-to-b from-rose-700/55 to-rose-900/55 text-rose-100 hover:from-rose-600/70 hover:to-rose-800/70"
              : "cursor-pointer border-amber-950/70 bg-gradient-to-b from-amber-700/55 to-amber-900/55 text-amber-100 hover:from-amber-600/70 hover:to-amber-800/70"
            : "cursor-not-allowed border-black/40 bg-gradient-to-b from-neutral-900/55 to-neutral-950/55 text-white/40"
      }`}
    >
      {isPerudoCell && <PerudoFaceIcon className="pointer-events-none h-2.5 w-2.5 sm:h-3 sm:w-3" />}
      <span className="relative z-10">{cell.quantity}</span>
      {isPending && (
        // The purple "betting die" marker — a fixed 80%-of-cell overlay (see
        // 2026-08-20 visibility history in engine.ts) showing the draft's
        // actual selected face as its pips, always positioned via the exact
        // same `trackCellForBid` the confirm button validates against — no
        // separate "which cell is the marker on" bookkeeping to fall out of
        // sync. `pointer-events-none` so it never itself receives the click —
        // it sits on top of this same `<button>`, whose `onClick` already
        // special-cases "this is the marker's own cell" as a face-raise
        // gesture (2026-08-21 "버그3" 세션, see `selectCell`), so clicking
        // anywhere on this cell (i.e. visually "clicking the marker") does
        // the right thing without the overlay needing its own handler.
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <span className="relative inline-flex" style={{ width: "80%", height: "80%" }}>
            <PerudoDie value={pendingFace} size="sm" colorway={BETTING_COLORWAY} style={{ width: "100%", height: "100%" }} />
          </span>
        </div>
      )}
    </button>
  );
}

/**
 * The physical board's fixed rectangular track: quantities 1-20 running
 * clockwise around 4 sides — 북 1→7, 동 7→11, 남 11→17, 서 17→20 — with corners
 * 7/11/17 each a single cell shared by both adjoining sides (2026-08-20 사각형
 * 트랙 세션, 사용자 확인 완료: "모서리 칸 1개를 공유"). Every `trackCellAt` index
 * from the old scrolling strip (0..39 — quantities 1-20, normal+perudo paired
 * 1:1 exactly as before) still appears here exactly once; this only changes
 * *where* each cell renders, never what cells exist. Quantity 1's own perudo
 * cell (index 1) opens the north strip, and so on around each corner — see
 * the index comments below for the full walk.
 */
const BOARD_MAX_QUANTITY = 20;
/** Last valid `trackCellAt` index that still fits on the fixed board — anything past this (quantity > 20, legal since dice counts are uncapped) falls off the physical rectangle and is surfaced via a badge instead (사용자 확인: "트랙을 20에서 고정하고 초과분은 배지로 표시"). */
const BOARD_LAST_INDEX = BOARD_MAX_QUANTITY * 2 - 1;

function buildRectFrame() {
  const at = trackCellAt;
  return {
    cornerTL: at(0), // quantity 1
    north: Array.from({ length: 11 }, (_, i) => at(1 + i)), // 1..11: perudo1..normal6,perudo6
    cornerTR: at(12), // quantity 7
    east: Array.from({ length: 7 }, (_, i) => at(13 + i)), // 13..19: perudo7..normal10,perudo10
    cornerBR: at(20), // quantity 11
    south: Array.from({ length: 11 }, (_, i) => at(21 + i)), // 21..31: perudo11..normal16,perudo16
    cornerBL: at(32), // quantity 17
    west: Array.from({ length: 7 }, (_, i) => at(33 + i)), // 33..39: perudo17..normal20,perudo20
  };
}

/** A compact pill for whichever of (confirmed bid / live draft) currently sits past quantity 20 — the fixed board has no cell for it, so this is the only place that bid is visible at all. */
function OverflowBadge({ label, tone, quantity, face }: { label: string; tone: "amber" | "violet"; quantity: number; face: Face }) {
  const toneClass = tone === "amber" ? "border-amber-300/50 bg-amber-950/70 text-amber-100" : "border-violet-300/50 bg-violet-950/70 text-violet-100";
  return (
    <div className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${toneClass}`}>
      <span>{label}</span>
      <span>
        {faceLabel(face)} × {quantity}개
      </span>
      <span className="opacity-60">· 트랙 범위 밖</span>
    </div>
  );
}

/**
 * The board frame itself — a 3×3 CSS grid (4 fixed-size corners, 2 flexible
 * horizontal strips, 2 flexible vertical strips, and a hollow flexible
 * center) so the corner tiles stay flush against the strips at any viewport
 * width instead of stair-stepping (see `CELL_SIZING_CLASS`'s doc comment).
 * `children` renders inside the hollow center — per user request (2026-08-20)
 * that now holds the dice graveyard, the bid/액션 panel, and the viewer's own
 * dice, so the whole board reads as one big physical-board-sized panel
 * instead of a thin strip with everything else stacked below it.
 */
function RectBidTrack({
  currentCell,
  pendingCell,
  pendingFace,
  showPending,
  cellEnabled,
  onCellClick,
  children,
}: {
  currentCell: TrackCell | null;
  pendingCell: TrackCell | null;
  pendingFace: Face;
  showPending: boolean;
  cellEnabled: (cell: TrackCell) => boolean;
  onCellClick: (cell: TrackCell) => void;
  children: React.ReactNode;
}) {
  const frame = buildRectFrame();

  function renderCell(cell: TrackCell, sizing: CellSizing) {
    return (
      <TrackCellButton
        key={cell.index}
        cell={cell}
        sizing={sizing}
        isCurrent={currentCell?.index === cell.index}
        isPending={showPending && pendingCell?.index === cell.index}
        pendingFace={pendingFace}
        enabled={cellEnabled(cell)}
        onClick={() => onCellClick(cell)}
      />
    );
  }

  return (
    <div
      className="grid w-full gap-1 rounded-2xl border-4 border-neutral-700 bg-gradient-to-b from-neutral-800 via-neutral-900 to-black p-1.5 shadow-[inset_0_2px_8px_rgba(0,0,0,0.7)] sm:gap-1.5 sm:p-2"
      style={{ gridTemplateColumns: "auto 1fr auto", gridTemplateRows: "auto 1fr auto" }}
    >
      <div className="relative col-start-1 row-start-1">
        {renderCell(frame.cornerTL, "corner")}
        <span
          className="pointer-events-none absolute -top-1.5 -left-1.5 z-20 text-[10px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]"
          title="시작 칸"
        >
          💀
        </span>
      </div>
      <div className="col-start-2 row-start-1 flex min-w-0 gap-0.5 sm:gap-1">{frame.north.map((c) => renderCell(c, "row"))}</div>
      <div className="col-start-3 row-start-1">{renderCell(frame.cornerTR, "corner")}</div>

      <div className="col-start-1 row-start-2 flex min-h-0 flex-col gap-0.5 sm:gap-1">
        {frame.west
          .slice()
          .reverse()
          .map((c) => renderCell(c, "col"))}
      </div>
      <div className="col-start-2 row-start-2 flex min-w-0 items-center justify-center p-1.5 sm:p-2.5">{children}</div>
      <div className="col-start-3 row-start-2 flex min-h-0 flex-col gap-0.5 sm:gap-1">{frame.east.map((c) => renderCell(c, "col"))}</div>

      <div className="col-start-1 row-start-3">{renderCell(frame.cornerBL, "corner")}</div>
      <div className="col-start-2 row-start-3 flex min-w-0 flex-row-reverse gap-0.5 sm:gap-1">{frame.south.map((c) => renderCell(c, "row"))}</div>
      <div className="col-start-3 row-start-3">{renderCell(frame.cornerBR, "corner")}</div>
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
  // Bid composer draft — local to this client, re-synced from
  // `state.currentBid` every time it actually changes (new round, or anyone's
  // opening bid/raise) using a render-time "adjust state when a prop
  // changes" pattern (same idea `syncedBidKey` uses on itself), rather than
  // an effect that would flash a stale draft for a frame. 2026-08-20
  // 트랙/마커 재도입 세션 (see engine.ts's module doc): the draft is a plain
  // `{ pendingQuantity, pendingFace }` pair — legality is decided solely by
  // `validateRaise`, and the track's marker cell is *derived* from this pair
  // via `trackCellForBid` wherever it's rendered, never stored separately.
  //
  // 2026-08-21 "버그3" 세션: default draft on a fresh bid used to be the
  // *cheapest legal raise* over the current bid (same face, quantity+1),
  // which put the purple marker one cell past whatever the opponent had
  // actually just bid on — reading as "the marker is wrong" even though the
  // underlying `trackCellForBid` math was correct. Anchoring the default to
  // the current bid's EXACT `{ quantity, face }` instead makes the marker
  // land precisely where the opponent's bid sits, and — for free, via the
  // same `validateRaise` the confirm button already gates on — starts the
  // confirm button disabled (an untouched draft is by definition identical
  // to the current bid, which is never a legal raise) until the player
  // raises the face (FacePicker, or clicking the marker itself — see
  // `selectCell`) or the quantity (steppers/a different cell). Round openers
  // (`state.currentBid === null`) keep the old cheapest-opening default —
  // there's no prior bid to anchor to. (AskUserQuestion-confirmed scope.)
  // -------------------------------------------------------------------------
  const bidKey = `${state.roundNumber}:${state.currentBid ? `${state.currentBid.seat}-${state.currentBid.quantity}-${state.currentBid.face}` : "none"}`;
  const [syncedBidKey, setSyncedBidKey] = useState<string | null>(null);
  const [pendingFace, setPendingFace] = useState<Face>(2);
  const [pendingQuantity, setPendingQuantity] = useState<number>(1);
  if (syncedBidKey !== bidKey) {
    setSyncedBidKey(bidKey);
    if (state.currentBid) {
      setPendingFace(state.currentBid.face);
      setPendingQuantity(state.currentBid.quantity);
    } else {
      setPendingFace(2);
      setPendingQuantity(1);
    }
  }
  /** The smallest quantity that's still a legal raise for `pendingFace` right now — the stepper's floor. Can be ABOVE the freshly-synced `pendingQuantity` right after landing on the current bid's own cell (see sync block above) — that's intentional, it's exactly what keeps "−" disabled and the confirm button off until the player actually raises something. */
  const pendingFloor = minValidQuantityForFace(state.currentBid, pendingFace) ?? 1;

  /** Switch the draft's face, bumping quantity up to whatever that face's own minimum legal raise requires (never down — a manually-raised quantity survives a face change as long as it's still legal, since a higher quantity is always at least as legal as the floor). */
  function pickFace(face: Face) {
    setPendingFace(face);
    const floor = minValidQuantityForFace(state.currentBid, face) ?? 1;
    setPendingQuantity((q) => Math.max(q, floor));
  }

  function stepQuantity(delta: number) {
    setPendingQuantity((q) => Math.max(pendingFloor, q + delta));
  }

  /**
   * A board-track cell was clicked. Two distinct behaviors depending on
   * which cell (2026-08-21 "버그3" 세션, AskUserQuestion-confirmed scope):
   * - The cell the draft/purple marker is ALREADY sitting on (whatever
   *   quantity that happens to be — not just the freshly-synced default)
   *   reads as "clicking the marker itself": bumps the draft's face up by
   *   one step (2→3→4→5→6), quantity unchanged. A no-op once face is
   *   already 6, or on a [페루도] cell (조커/face 1 has no "next face" to
   *   step to — raising from there means raising the quantity instead,
   *   still available via the steppers or a different cell).
   * - Any other enabled cell → jumps the draft straight to that cell's
   *   quantity (unchanged from before), with face 1 for a [페루도] cell or
   *   (keeping the current face if it's already non-joker) the smallest
   *   legal non-joker face otherwise.
   * Only ever called for a cell `cellEnabled` already reported legal, but
   * re-validated here too.
   */
  /** The cell the draft/purple marker is currently sitting on — computed once and shared by `selectCell` and `cellEnabled` so "is this the marker's own cell" is asked (and answered) exactly one way. */
  const markerCell = trackCellForBid({ quantity: pendingQuantity, face: pendingFace });
  /**
   * Whether clicking the marker's own cell right now would legally bump its
   * face by one step. Deliberately NOT the same question `validateRaise`
   * answers for an arbitrary cell click below — a plain identical-bid check
   * would always read the marker's own cell as illegal the moment it's
   * synced to the current bid (an untouched draft literally IS the current
   * bid — see the bid-composer doc above), which would leave the marker
   * permanently disabled/unclickable right when a player most needs to
   * click it (2026-08-21 "버그3" 세션 — caught live via a Playwright check
   * before this was ever committed). `false` at face 6 (no next face to
   * step to) or on any [페루도] cell (no face-stepping lane at all).
   */
  function markerCanBumpFace(): boolean {
    if (pendingFace >= 6) return false;
    return validateRaise(state.currentBid, { quantity: pendingQuantity, face: (pendingFace + 1) as Face });
  }

  function selectCell(cell: TrackCell) {
    if (cell.index === markerCell.index && cell.kind === "normal") {
      if (!markerCanBumpFace()) return;
      setPendingFace((pendingFace + 1) as Face);
      return;
    }
    const face: Face = cell.kind === "perudo" ? 1 : pendingFace === 1 ? 2 : pendingFace;
    if (!validateRaise(state.currentBid, { quantity: cell.quantity, face })) return;
    setPendingFace(face);
    setPendingQuantity(cell.quantity);
  }

  /** Whether `cell` is currently choosable. The marker's own cell (see `markerCanBumpFace`) is a special case — clicking it steps the face, not the quantity, so its legality is judged by "can the face still go up", not by whether the (already-selected) exact quantity+face combo is itself a legal raise. Every other cell asks the original question: whether *some* face for that cell's kind (1 for [페루도], the viewer's current pick or the smallest legal non-joker face otherwise) is a legal raise right now. Purely `validateRaise`-driven, never track position. */
  function cellEnabled(cell: TrackCell): boolean {
    if (!isMyTurn || !iAmAlive) return false;
    if (cell.index === markerCell.index && cell.kind === "normal") return markerCanBumpFace();
    const face: Face = cell.kind === "perudo" ? 1 : pendingFace === 1 ? 2 : pendingFace;
    return validateRaise(state.currentBid, { quantity: cell.quantity, face });
  }

  const canConfirmBet = isMyTurn && iAmAlive && validateRaise(state.currentBid, { quantity: pendingQuantity, face: pendingFace });
  /** True exactly when the confirm button is disabled *because* the untouched draft still matches the current bid verbatim — the only way `canConfirmBet` can be false while it's actually my turn (2026-08-21 "버그3" 세션: surfaced as an always-visible hint rather than a silent disable, per user request + AskUserQuestion confirmation). */
  const isIdenticalToCurrentBid =
    state.currentBid !== null && pendingQuantity === state.currentBid.quantity && pendingFace === state.currentBid.face;

  // The fixed rectangular board (`RectBidTrack`) only has cells for
  // quantities 1-20 — a bid past that (legal; dice counts are uncapped, see
  // engine.ts module doc) has no cell to land on, so it's flagged here and
  // surfaced as an `OverflowBadge` inside the board's center instead of
  // being forced onto a cell that doesn't exist.
  const currentCell = state.currentBid ? trackCellForBid(state.currentBid) : null;
  const pendingCell = trackCellForBid({ quantity: pendingQuantity, face: pendingFace });
  const currentOverflows = currentCell !== null && currentCell.index > BOARD_LAST_INDEX;
  const pendingOverflows = pendingCell.index > BOARD_LAST_INDEX;

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

      {/* The rectangular board itself (2026-08-20 사각형 트랙 세션) — quantities
          1-20 around 4 sides (see `RectBidTrack`'s doc comment), sized to
          hold the dice graveyard, the bid/액션 panel, and the viewer's own
          dice all inside its hollow center per user request, so the whole
          thing reads as one big physical-board-sized panel rather than a
          thin strip with everything else stacked below it. */}
      <RectBidTrack
        currentCell={currentCell}
        pendingCell={pendingCell}
        pendingFace={pendingFace}
        showPending={isMyTurn && iAmAlive}
        cellEnabled={cellEnabled}
        onCellClick={selectCell}
      >
        <div className="flex w-full max-w-md flex-col items-center gap-2.5">
          {/* Bids past quantity 20 (legal — dice counts are uncapped) have no
              cell on the fixed board, so they show up here instead (사용자
              확인: "트랙을 20에서 고정하고 초과분은 배지로 표시"). */}
          {(currentOverflows || (isMyTurn && iAmAlive && pendingOverflows)) && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {currentOverflows && state.currentBid && (
                <OverflowBadge label="확정" tone="amber" quantity={state.currentBid.quantity} face={state.currentBid.face} />
              )}
              {isMyTurn && iAmAlive && pendingOverflows && (
                <OverflowBadge label="내 초안" tone="violet" quantity={pendingQuantity} face={pendingFace} />
              )}
            </div>
          )}

          <LostDiceTray state={state} viewerSeat={viewerSeat} myColorway={myColorway} />

          {/* Bid-declaration controls — the confirmed bid, plus (on my turn) the
              FacePicker + quantity stepper composer. Both the composer's
              "확정" button and every track cell around this panel ultimately
              gate on the same `validateRaise` call, so a same-quantity face
              raise (예: "2가 1개" → "3이 1개") is never blocked by one path
              while allowed by the other. */}
          <div className="relative z-10 flex w-full flex-col items-center justify-center gap-2 rounded-[1.25rem] border-4 border-amber-800 bg-amber-100/90 p-2 text-neutral-900 shadow-[inset_0_2px_10px_rgba(0,0,0,0.18)]">
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
                  🟣 눈금을 고르고 개수를 정하거나, 트랙 칸을 눌러 이동하세요
                </p>
                <FacePicker selected={pendingFace} onSelect={pickFace} />
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => stepQuantity(-1)}
                    disabled={pendingQuantity <= pendingFloor}
                    title="개수 줄이기"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-violet-900/30 bg-white/60 text-sm font-bold text-violet-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="min-w-[3ch] text-center text-lg font-black text-violet-950">{pendingQuantity}개</span>
                  <button
                    type="button"
                    onClick={() => stepQuantity(1)}
                    title="개수 늘리기"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-violet-900/30 bg-white/60 text-sm font-bold text-violet-900 transition hover:bg-white"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!canConfirmBet}
                  onClick={() => onAction({ type: "raise", seat: viewerSeat, quantity: pendingQuantity, face: pendingFace })}
                  className="rounded-full bg-violet-700 px-4 py-1.5 text-xs font-semibold text-white shadow-[0_0_0_2px_rgba(168,85,247,0.3)] transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30 disabled:shadow-none"
                >
                  ✅ {faceLabel(pendingFace)} × {pendingQuantity}개로 베팅 확정
                </button>
                {/* Always-visible hint (not just a disabled button — 2026-08-21
                    "버그3" 세션, AskUserQuestion-confirmed: 비활성화 + 상시 안내
                    문구) for the one way this composer's confirm can be
                    disabled while it's actually my turn: the untouched draft
                    still matches the current bid verbatim. */}
                {isIdenticalToCurrentBid && (
                  <p className="max-w-[220px] text-center text-[10px] font-medium text-rose-700">
                    ⚠️ 동일한 배팅은 할 수 없습니다. 눈금을 올리거나 수량을 올려주세요.
                  </p>
                )}
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

          {/* My dice — always fully visible, no cup or lid ever occludes them
              (2026-08 페루도 UI 개편, 사용자 요청). `DiceRollTray` replays a short
              CSS shake-then-settle every new round (see `dice/PerudoDie.tsx`'s
              file header for why this replaced the earlier WebGL physics tray),
              but never hides the settled values behind an extra "open me"
              interaction. Moved inside the board's center (2026-08-20 사각형
              트랙 세션, 사용자 요청: "보드판 사이즈를 좀 더 키워서 내 주사위까지
              보이게 해주세요"). */}
          <div className="relative z-10 flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 border-amber-900/40 bg-gradient-to-b from-black/25 to-black/35 p-3 shadow-[inset_0_2px_10px_rgba(0,0,0,0.35),0_4px_14px_-6px_rgba(0,0,0,0.6)]">
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
        </div>
      </RectBidTrack>

      {/* Stats dashboard — right below the board panel above. */}
      <MyDiceStatsPanel state={state} myDice={me.dice} />

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
