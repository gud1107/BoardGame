"use client";

/**
 * The physical rectangular bid track (2026-08-20/08-21/09-07/09-08 sessions —
 * see engine.ts's module doc for the full 30-slot sequence history). Pulled
 * out of `PerudoBoard.tsx` into its own file (2026-09-08 모바일 물리 보드 복원
 * 세션) so `PerudoMobileBoard.tsx` can render the SAME physical board instead
 * of a simplified substitute — an earlier pass of this session's mobile
 * redesign dropped the track entirely in favor of a plain "current bid" card,
 * which the user reported back as "the board disappeared" and asked to have
 * restored (AskUserQuestion-confirmed: put the physical track back into the
 * new mobile layout, not just a bid-summary card).
 *
 * Purely a rendering module — `trackCellAt`/`trackCellForBid`/`validateRaise`
 * (engine.ts) remain the only source of truth for track content and bid
 * legality; nothing here decides game rules.
 */

import PerudoFaceIcon from "./PerudoFaceIcon";
import { PerudoDie } from "./dice/PerudoDie";
import { BETTING_COLORWAY } from "./dice/colorways";
import { faceLabel } from "./PerudoSharedUI";
import { trackCellAt, type Face, type TrackCell } from "./engine";

/**
 * The single source of truth for every tile's size on the board — one CSS
 * custom property, `--perudo-cell`, set once on `RectBidTrack`'s own grid
 * root (`.perudo-rect-track`, styled by `BOARD_CELL_SIZE_CSS` below) and
 * consumed via `var(--perudo-cell)` by every corner/strip cell and by the
 * strips' own `calc()` lengths below. Every cell being driven by this ONE
 * variable is what keeps them all IDENTICAL in size — no separate
 * corner/row/col sizing to drift apart, and no gap between cells to
 * accumulate error (see `TrackCellButton`'s marker overlay, which sizes
 * itself to 80% of the cell's own box either way).
 *
 * 2026-08-21 무여백 대칭 트랙 세션 (요구사항 1/2, AskUserQuestion-confirmed):
 * replaced the old two-breakpoint fixed `36px`/`44px sm:` sizing plus the
 * `gap-1`/`sm:gap-1.5` that used to sit BETWEEN every pair of cells with a
 * single `vw`-based `clamp()` floored at 50px (확장 규모 — 모바일 ~50px, sm
 * ~62px) and capped at 78px. Individual tiles keep their own rounded
 * corners (다른 AskUserQuestion 확인 — 낱개 타일 둥근 모서리 유지) rather than
 * squaring off into a literal edge-to-edge grid, so two adjacent tiles'
 * corners can still peek a sliver of the wooden frame behind them at each
 * seam — same as the physical board's slightly-torn tile art
 * (`boardGameRule/페루도/변경후이미지.jpg`) — while the flat sides between
 * them touch with zero gap and just a 1px divider border.
 *
 * 2026-09-07 모바일 가로 스크롤 제거 세션 (사용자 확인: 기존 사각형 트랙 유지 +
 * 축소, 세로는 그대로 둠): that 50px floor is exactly why 9 cells across a
 * row (2 shared corners + the 7-cell north/south strip) stopped fitting
 * inside a real phone viewport — on a 360-390px phone the board's own
 * content width (9×50px + this track's border/padding) plus this page's
 * own outer chrome (`GamePlayPage`'s `px-4`, `TABLE_PANEL`'s `p-3`) added
 * up to more than the viewport, which is what the pre-existing
 * `overflow-x-auto` on the board wrapper was silently papering over as a
 * horizontal swipe instead of a real fit. `BOARD_CELL_SIZE_CSS` below
 * replaces the single vw-based clamp with two real `@media` rules, each
 * formula built from THIS page's actual combined horizontal padding/border
 * chrome at that breakpoint — see that constant's own comment for the exact
 * math — floored at 30px (still a usable tap target; the narrowest phones
 * in current real-world use are ~360px+, comfortably above where this floor
 * would even engage) so the board now fits with zero horizontal scroll on
 * every phone in practical use; only a genuinely obsolete ~320px device
 * still falls back to the scroll escape hatch. The 78px cap
 * (desktop/tablet sizing) is unchanged. This formula assumes the SAME
 * `GamePlayPage`(`px-4`/`px-6`) + panel(`p-3`/`p-4`) chrome at every call
 * site — `PerudoMobileBoard.tsx` reuses the exact same panel padding for
 * this reason (see its own doc comment).
 */
const CELL_VAR = "var(--perudo-cell)";
const CELL_STYLE: React.CSSProperties = { width: CELL_VAR, height: CELL_VAR };

/**
 * Real per-breakpoint `@media` rules for `--perudo-cell` (2026-09-07 모바일
 * 가로 스크롤 제거 세션) — a plain inline `clamp()` can't express two
 * different formulas on either side of a breakpoint, which is exactly what
 * this needs: the page's own horizontal chrome around the board changes at
 * Tailwind's `sm` breakpoint (640px), so "how much of 100vw is actually
 * left for the board" has to change there too, or the two drift apart
 * right at that boundary. Overhead below `sm`: `GamePlayPage`'s `px-4`
 * (32px) + panel's `p-3` (24px) + this track's own `border-4` (8px) +
 * `p-1` (8px) = 72px. At/above `sm`: `px-6` (48px) + `p-4` (32px) +
 * `border-4` (8px, unchanged) + `p-1.5` (12px) = 100px. Both divide the
 * remainder by 9 (the 2 shared corners + the 7-cell north/south strip that
 * spans a full row), matching `buildRectFrame`'s own row layout. Injected
 * as a real `<style>` tag on `RectBidTrack`'s own root below — only one
 * board is ever mounted at a time (desktop XOR mobile), so there's no risk
 * of two conflicting copies fighting each other.
 */
const BOARD_CELL_SIZE_CSS = `
.perudo-rect-track {
  --perudo-cell: clamp(30px, calc((100vw - 72px) / 9), 78px);
}
@media (min-width: 640px) {
  .perudo-rect-track {
    --perudo-cell: clamp(30px, calc((100vw - 100px) / 9), 78px);
  }
}

/* 2026-09-08 4변 밀착 세션: the hollow center's height is now locked to
   the west/east strip's own height (see \`RectBidTrack\`'s grid-root
   comment), so overflowing content (routine on mobile) scrolls inside
   this one cell instead of stretching the board and detaching the
   corners. A default browser scrollbar is easy to miss here, so give it
   real presence — a slim amber thumb matching the board's own palette —
   instead of leaving it invisible-by-default the way \`overflow-x-auto\`
   elsewhere on this page already isn't (that one has room to just look
   like a horizontal swipe; this cell doesn't). */
.perudo-center-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(217, 119, 6, 0.85) rgba(0, 0, 0, 0.25);
}
.perudo-center-scroll::-webkit-scrollbar {
  width: 6px;
}
.perudo-center-scroll::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.25);
  border-radius: 999px;
}
.perudo-center-scroll::-webkit-scrollbar-thumb {
  background: rgba(217, 119, 6, 0.85);
  border-radius: 999px;
}
`;

/** A strip's exact content length — `cellCount * var(--perudo-cell)`, zero gap between cells (north/south hold 7 cells, west/east hold 6 — see `buildRectFrame`). Exported so callers (`PerudoBoard.tsx`/`PerudoMobileBoard.tsx`) can cap their `children`'s own width/maxWidth to match. */
export function stripLength(cellCount: number): string {
  return `calc(${CELL_VAR} * ${cellCount})`;
}

/** One track cell — a plain quantity/조커 cell, no click-eligibility baked in (the caller decides `enabled` from `validateRaise`, not from track position). Sized purely off `--perudo-cell` (`CELL_STYLE`) — see that constant's doc comment for why every cell, corner or side, shares the exact same box. */
function TrackCellButton({
  cell,
  isCurrent,
  isPending,
  pendingFace,
  enabled,
  onClick,
}: {
  cell: TrackCell;
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
      style={CELL_STYLE}
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
      // 2026-08-21 무여백 대칭 트랙 세션: `border` (1px, was `border-2`) is the
      // "얇은 내부 구분선" requirement — every cell uses the SAME 1px weight
      // (요구사항 1) so no cell reads as visually "thicker" than its
      // neighbor; with the outer/inter-cell gap now zero (see `RectBidTrack`),
      // two adjacent cells' borders sit flush against each other and read as
      // one continuous divider line rather than a gap. Font/icon sizes are
      // now `clamp()`-based (via inline `style` below) instead of a fixed
      // `text-[10px] sm:text-xs` pair so they scale smoothly with
      // `--perudo-cell` instead of jumping at one breakpoint.
      className={`relative flex shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[8px] border p-0.5 leading-none font-bold [text-shadow:0_1px_2px_rgba(0,0,0,0.8)] transition ${
        isCurrent
          ? "border-amber-200 bg-gradient-to-b from-amber-300/85 to-amber-500/85 text-neutral-900 shadow-[0_0_0_2px_rgba(251,191,36,0.5)]"
          : enabled
            ? isPerudoCell
              ? "cursor-pointer border-rose-800/70 bg-gradient-to-b from-rose-700/55 to-rose-900/55 text-rose-100 hover:from-rose-600/70 hover:to-rose-800/70"
              : "cursor-pointer border-amber-950/70 bg-gradient-to-b from-amber-700/55 to-amber-900/55 text-amber-100 hover:from-amber-600/70 hover:to-amber-800/70"
            : "cursor-not-allowed border-black/40 bg-gradient-to-b from-neutral-900/55 to-neutral-950/55 text-white/40"
      }`}
    >
      {isPerudoCell && (
        <PerudoFaceIcon className="pointer-events-none w-[calc(var(--perudo-cell)*0.26)] h-[calc(var(--perudo-cell)*0.26)]" />
      )}
      <span className="relative z-10" style={{ fontSize: "calc(var(--perudo-cell) * 0.3)" }}>
        {cell.quantity}
      </span>
      {isPending && (
        // The purple "betting die" marker — a fixed 80%-of-cell overlay (see
        // 2026-08-20 visibility history in engine.ts) showing the draft's
        // actual selected face as its pips, always positioned via the exact
        // same `trackCellForBid` the confirm button validates against — no
        // separate "which cell is the marker on" bookkeeping to fall out of
        // sync. `pointer-events-none` so it never itself receives the click —
        // it sits on top of this same `<button>`, whose `onClick` already
        // special-cases "this is the marker's own cell" as a face-raise
        // gesture (2026-08-21 "버그3" 세션, see `PerudoBoard.tsx`'s `selectCell`),
        // so clicking anywhere on this cell (i.e. visually "clicking the
        // marker") does the right thing without the overlay needing its own
        // handler.
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
 * The physical board's fixed rectangular track (2026-08-21 "수정필요1" 30칸
 * 세션 — see engine.ts's module doc for the exact 30-slot sequence and its
 * index formula, `boardGameRule/페루도/수정필요1.png` for the reference
 * photo). Every `trackCellAt` index 0..29 (숫자1, [페루도1], 숫자2, 숫자3,
 * [페루도2], ..., [페루도10], 숫자20 — NOT a 1:1 normal/perudo pairing like
 * the old 40-slot layout; a [페루도] cell only opens after every *odd*
 * 숫자 cell) appears here exactly once, split across 4 sides with 4 shared
 * corner cells (숫자1/숫자6/숫자11/숫자16 — chosen to split the 30 slots as
 * evenly as the sequence allows: 4 corners + 7+6+7+6 cells per side).
 * 2026-08-21 세션의 핵심 변경은 legality 쪽(`validateRaise`가 이제 이 트랙의
 * 인덱스 순서 자체를 유일한 판정 근거로 삼는다 — engine.ts 참고)이지, 이
 * 함수는 여전히 순수 렌더링 배치일 뿐이다.
 */
export const BOARD_LAST_INDEX = 29;
/** How many track slots one "lap" of the physical board covers — see `buildRectFrame`'s `laneOffset` doc. Exported for callers' `laneOffset`/overflow calculations. */
export const LAP_SIZE = BOARD_LAST_INDEX + 1;

/**
 * `laneOffset` (2026-09-04 "20 초과 시 트랙 이어붙이기" 세션, 사용자 요청 —
 * "20보다 더 커지는 경우에 1 대신 21, 페루도1 대신 페루도11... 이런식으로
 * 이어주세요") — the physical board only has 30 painted slots, but
 * `trackCellAt`/`trackCellForBid` (engine.ts) were always unbounded (dice
 * counts have no cap, see that file's module doc). The same 30 physical
 * button POSITIONS are reused for however many "laps" a round needs — the
 * board renders `trackCellAt(laneOffset + i)` instead of `trackCellAt(i)`,
 * so a bid at index 30 (quantity 21) lands on the exact same physical slot
 * quantity 1 sits on in lap 0, but the cell's own `quantity` field (already
 * unbounded/correct from `trackCellAt`'s closed form — see engine.ts) prints
 * "21" instead of "1", "페루도12" instead of "페루도2", etc. — no extra
 * relabeling math needed here, just shifting which slice of the infinite
 * sequence is on screen. Callers derive `laneOffset` from the CONFIRMED
 * bid's own lap (`Math.floor(currentCell.index / LAP_SIZE) * LAP_SIZE`, 0 if
 * no bid yet) — never the viewer's still-editable draft — because bids only
 * ever increase, so every legal raise from here is guaranteed to be in that
 * same lap or later; the confirmed bid itself is therefore always exactly
 * on-board. The one remaining edge case — a viewer drafting a raise that
 * pushes past the TOP of the currently-displayed lap (i.e. into a lap that
 * won't become "current" until they actually confirm it) — still falls back
 * to `OverflowBadge`.
 */
function buildRectFrame(laneOffset: number) {
  const at = (i: number) => trackCellAt(laneOffset + i);
  return {
    cornerTL: at(0), // 숫자 1 (이 lap의 시작 칸)
    north: Array.from({ length: 7 }, (_, i) => at(1 + i)), // 1..7: 페루도1, 숫자2~3, 페루도2, 숫자4~5, 페루도3
    cornerTR: at(8), // 숫자 6
    east: Array.from({ length: 6 }, (_, i) => at(9 + i)), // 9..14: 숫자7, 페루도4, 숫자8~9, 페루도5, 숫자10
    cornerBR: at(15), // 숫자 11
    south: Array.from({ length: 7 }, (_, i) => at(16 + i)), // 16..22: 페루도6, 숫자12~13, 페루도7, 숫자14~15, 페루도8
    cornerBL: at(23), // 숫자 16
    west: Array.from({ length: 6 }, (_, i) => at(24 + i)), // 24..29: 숫자17, 페루도9, 숫자18~19, 페루도10, 숫자20
  };
}

/** A compact pill for whichever of (confirmed bid / live draft) currently sits past quantity 20 — the fixed board has no cell for it, so this is the only place that bid is visible at all. */
export function OverflowBadge({ label, tone, quantity, face }: { label: string; tone: "amber" | "violet"; quantity: number; face: Face }) {
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
 * The board frame itself — a 3×3 CSS grid (4 corners, 2 horizontal strips, 2
 * vertical strips, and a hollow center), every cell sized off the one
 * `--perudo-cell` var (`CELL_VAR`/`CELL_STYLE`) with **zero gap** anywhere in
 * the grid — corner↔strip and cell↔cell alike — so the whole rectangle reads
 * as one continuous connected border track with only each tile's own 1px
 * divider border between neighbors. `children` renders inside the hollow
 * center — on desktop that's the dice graveyard + bid/액션 panel + the
 * viewer's own dice (see `PerudoBoard.tsx`); on mobile (2026-09-08 세션) it's
 * just the bid composer, since the graveyard/dice tray/color picker moved
 * elsewhere in that layout — so the whole board reads as one big
 * physical-board-sized panel instead of a thin strip with everything else
 * stacked below it.
 *
 * Sizing: `w-fit` (sized to its own content, not stretched) keeps it centered
 * on the fabric mat rather than force-stretched to fill an arbitrary parent
 * width; it's otherwise fully responsive via `--perudo-cell`'s own
 * `clamp()`. The center column's own content should be capped to
 * `stripLength(7)` (see call sites) so it can never force that grid column
 * wider than the north/south strips sitting right above/below it.
 */
export default function RectBidTrack({
  currentCell,
  pendingCell,
  pendingFace,
  showMarker,
  laneOffset,
  cellEnabled,
  onCellClick,
  children,
}: {
  currentCell: TrackCell | null;
  pendingCell: TrackCell | null;
  pendingFace: Face;
  /** Whether to render the purple betting-die overlay at all (true both while the viewer is actively drafting a raise AND whenever there's already a confirmed bid, to keep it visually reinforced during any other seat's turn). Distinct from `cellEnabled`, which independently gates click-ability per cell. */
  showMarker: boolean;
  /** Which 30-slot "lap" of the (conceptually unbounded) track to render — see `buildRectFrame`'s doc comment. */
  laneOffset: number;
  cellEnabled: (cell: TrackCell) => boolean;
  onCellClick: (cell: TrackCell) => void;
  children: React.ReactNode;
}) {
  const frame = buildRectFrame(laneOffset);

  function renderCell(cell: TrackCell) {
    return (
      <TrackCellButton
        key={cell.index}
        cell={cell}
        isCurrent={currentCell?.index === cell.index}
        isPending={showMarker && pendingCell?.index === cell.index}
        pendingFace={pendingFace}
        enabled={cellEnabled(cell)}
        onClick={() => onCellClick(cell)}
      />
    );
  }

  return (
    <div
      className="perudo-rect-track grid w-fit mx-auto gap-0 rounded-2xl border-4 border-neutral-700 bg-gradient-to-b from-neutral-800 via-neutral-900 to-black p-1 shadow-[inset_0_2px_8px_rgba(0,0,0,0.7)] sm:p-1.5"
      // 2026-09-08 4변 밀착 세션: the middle row (west strip / children / east
      // strip) used to be `auto`-sized, which let `children`'s real content
      // height inflate the row past `stripLength(6)`. West/east are
      // `self-center`, so they'd get centered inside that taller row —
      // visually detaching them from the TL/BL and TR/BR corners sitting in
      // the fixed-height rows above/below. Pinning the middle row to the
      // strip's own exact height (same fix pattern already used for the
      // middle COLUMN via `children`'s `maxWidth: stripLength(7)` below)
      // keeps the border a seamless rectangle regardless of how tall the
      // center content gets; the center cell scrolls internally instead.
      style={{ gridTemplateColumns: "auto auto auto", gridTemplateRows: `auto ${stripLength(6)} auto` }}
    >
      {/* `display:none` by default (the UA stylesheet), so this never becomes a grid item itself. */}
      <style>{BOARD_CELL_SIZE_CSS}</style>
      <div className="relative col-start-1 row-start-1">
        {renderCell(frame.cornerTL)}
        {/* "시작 칸" 표식은 lap 0(수량 1~20/페루도1~10)일 때만 의미가 있다 —
            lap>0에서는 같은 물리 칸이 21/41/... 같은 훨씬 큰 수량을 나타내므로
            "시작"이 아니다(2026-09-04 트랙 이어붙이기 세션). */}
        {laneOffset === 0 && (
          <span
            className="pointer-events-none absolute -top-1.5 -left-1.5 z-20 text-[10px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]"
            title="시작 칸"
          >
            💀
          </span>
        )}
      </div>
      <div className="col-start-2 row-start-1 flex shrink-0" style={{ width: stripLength(7) }}>
        {frame.north.map(renderCell)}
      </div>
      <div className="col-start-3 row-start-1">{renderCell(frame.cornerTR)}</div>

      <div className="col-start-1 row-start-2 flex shrink-0 flex-col self-center" style={{ height: stripLength(6) }}>
        {frame.west
          .slice()
          .reverse()
          .map(renderCell)}
      </div>
      {/* No padding of its own — this grid cell's `auto` column-track width
          is the max of every row sharing column 2, including the
          north/south strips, which have zero padding of their own. Padding
          HERE (outside `children`'s own `maxWidth: stripLength(7)` cap)
          would add straight onto that max, silently widening the whole
          center column — and therefore the whole board — past the strips'
          own width. Moved onto `children`'s own box instead, where
          `maxWidth` (a real cap on ITS OWN border-box) already accounts for
          it. */}
      {/* `overflow-y-auto` + `items-start` (2026-09-08 4변 밀착 세션): now that
          the middle row is height-locked to `stripLength(6)`, this cell no
          longer grows to fit `children` — content taller than 6 cells
          (routine on small phones) scrolls inside this box instead of
          re-inflating the row and re-detaching the west/east strips from
          the corners. The `sticky top-0`/`bottom-0` gradient slivers below
          are a scroll-more hint — `sticky` keeps each pinned to its edge of
          the scrollport as the content scrolls past, without needing a
          separate non-scrolling wrapper or JS scroll-position tracking.
          Harmless no-op when content doesn't actually overflow
          (desktop/tablet, bigger `--perudo-cell`). */}
      <div className="perudo-center-scroll col-start-2 row-start-2 flex flex-col items-center overflow-y-auto">
        <div className="pointer-events-none sticky top-0 z-10 -mb-2 h-2 w-full shrink-0 bg-gradient-to-b from-black/45 to-transparent" />
        {children}
        <div className="pointer-events-none sticky bottom-0 z-10 -mt-3 h-3 w-full shrink-0 bg-gradient-to-t from-black/60 to-transparent" />
      </div>
      <div className="col-start-3 row-start-2 flex shrink-0 flex-col self-center" style={{ height: stripLength(6) }}>
        {frame.east.map(renderCell)}
      </div>

      <div className="col-start-1 row-start-3">{renderCell(frame.cornerBL)}</div>
      <div className="col-start-2 row-start-3 flex shrink-0 flex-row-reverse" style={{ width: stripLength(7) }}>
        {frame.south.map(renderCell)}
      </div>
      <div className="col-start-3 row-start-3">{renderCell(frame.cornerBR)}</div>
    </div>
  );
}
