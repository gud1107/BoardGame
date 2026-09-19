"use client";

import { useEffect, useState, type ReactNode } from "react";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import RulebookModal from "./RulebookModal";
import RectBidTrack, { OverflowBadge, stripLength } from "./PerudoBidTrack";
import { DiceRollTray } from "./dice/PerudoDie";
import { PLAYER_COLORWAYS, playerColorwayForSeat, type DiceColorway } from "./dice/colorways";
import { DiceCountStrip, faceLabel, FacePicker, LostDiceTray, TABLE_PANEL, TableTexture } from "./PerudoSharedUI";
import {
  STARTING_DICE,
  totalDiceInPlay,
  type EngineAction,
  type Face,
  type PerudoState,
  type PlayerState,
  type SeatIndex,
  type TrackCell,
} from "./engine";

/**
 * The "playing"-phase mobile layout. All game state and handlers
 * (bid-composer draft, colorway picker, action dispatch) live in the parent
 * `PerudoBoard` — this component is pure presentation, mounted instead of
 * (never alongside) the desktop tree via `useIsMobile`.
 *
 * **2026-09-20 세로 스크롤 롤백 세션** (user report: the 2026-09-09 zero-scroll
 * rebuild below felt cramped — asked to go back to the original layout where
 * the page scrolls naturally top-to-bottom, "널찍하게 스와이프하며 플레이"). The
 * root no longer measures/clamps itself to `calc(100dvh - offset)`, and no
 * longer locks gestures (`touch-none`/`overscroll-none`/`select-none`) —
 * this component is now a plain block that grows to its natural content
 * height and lets the document scroll over it like any other page section,
 * same as every other game's board. Every OTHER decision from the
 * zero-scroll sessions below (header/footer/dock composition, what content
 * lives where, the portrait lock) is left untouched — only the
 * fixed-viewport/no-scroll MECHANISM is reverted, not the layout it produces.
 *
 * That original pre-zero-scroll version (natural page scroll) is also the
 * version a real bug report traced a "board breaks/jitters while scrolling"
 * symptom back to — the physical board (`RectBidTrack`) has always had its
 * OWN nested scroll region for its hollow center cell
 * (`.perudo-center-scroll`, `PerudoBidTrack.tsx`), predating the mobile
 * split entirely. A nested scroller sitting inside a page that ALSO scrolls
 * is a well-known mobile jank source (the browser has to arbitrate which
 * scroller owns an in-progress touch gesture, and an unbounded rubber-band
 * on the inner one can chain into the outer page mid-swipe). Restoring page
 * scroll without addressing that would just reopen the same bug, so this
 * session also hardens the two real jitter sources instead of just deleting
 * the zero-scroll code:
 * 1. `overscroll-contain` on `.perudo-center-scroll` itself
 *    (`PerudoBidTrack.tsx`) — contains that cell's own bounce instead of
 *    letting it chain into the page scroll.
 * 2. `[contain:layout_paint]` on the board's grid root
 *    (`.perudo-rect-track`, `PerudoBidTrack.tsx`) — this 30-cell grid's size
 *    is already fully deterministic from `--perudo-cell` alone, so isolating
 *    its layout/paint means the page's own scroll-driven reflow never has to
 *    re-measure it.
 * 3. `aspectRatio` reserved on the board's own wrapper below (based on the
 *    frame's known 9-wide × 8-tall cell grid) — a defensive CLS guard so the
 *    space this element occupies is claimed up front rather than potentially
 *    resizing after paint.
 * The document-level `overscroll-behavior` (`PerudoBoard.tsx`'s mount
 * effect) also moved from `"none"` to `"contain"` for the same reason —
 * there's a real page top/bottom to bounce at again now.
 *
 * Below this point, the surviving doc history from the zero-scroll sessions
 * (2026-09-09/09-10) is kept as-is — it still explains why the header/dock
 * content is shaped the way it is, just not why the ROOT no longer measures
 * a fixed viewport height.
 *
 * ---
 *
 * Rewritten 2026-09-09 (데스크톱 동등 단일 뷰포트 전면 재구축 세션, AskUserQuestion
 * 4문항 확인 후 진행). Replaced the same-day-earlier "Section 1 zero-scroll
 * arena + Section 2 scroll-down player roster" 2-section structure outright
 * with a single screen (superseded by the 2026-09-20 rollback above, but the
 * CONTENT decisions below still stand).
 *
 * **Why Section 2 is gone rather than squeezed in** (AskUserQuestion-confirmed):
 * the request's own mockup only accounts for a header player-strip + central
 * arena + bottom dock — nothing that maps to the old Section 2's per-row
 * detail (connection dot, full name, elimination skull). Rather than guess
 * at cramming that detail into the header strip, the confirmed scope keeps
 * ONLY the existing `PlayerDiceSummaryBar` (colorway + truncated name + dice
 * count) as the sole player-status surface and drops the rest — same for the
 * desktop-only "📊 통계 현황판" (`MyDiceStatsPanel`, `PerudoBoard.tsx`) and the
 * desktop scoreboard grid: neither was ever part of this file to begin with
 * (mobile already substitutes `ExpectationBar` for the general table-wide
 * expected-value figure) and both stay out of the new single-screen budget.
 *
 * **Sizing technique — SUPERSEDED 2026-09-20**: this file used to measure how
 * far its root sat below the page chrome above it
 * (`arenaRef.getBoundingClientRect().top`) and clamp itself to exactly
 * `calc(100dvh - thatOffset)`, specifically to keep a fixed-canvas
 * `transform: scale()` rewrite from having to re-measure on every
 * conditional-height toggle (`OverflowBadge`s, the raise composer, etc.).
 * That reasoning only mattered because the root was trying to fit inside one
 * screen at all — now that the root is plain natural-flow content (see the
 * 2026-09-20 section at the top of this file), there's no viewport budget to
 * fit into, so the measurement/clamp is gone outright rather than reworked;
 * conditional-height content just grows the page like it would anywhere
 * else.
 *
 * **Zero-scroll lock — SUPERSEDED 2026-09-20**: this root used to combine a
 * firm `height` (not `minHeight`) with `overflow-hidden`,
 * `touch-action: none`, `overscroll-behavior: none`, and `user-select: none`
 * (Tailwind `touch-none overscroll-none select-none`) so no gesture could
 * shift a pixel of the screen. All of that is removed — the root is a plain
 * block again. See the 2026-09-20 section at the top of this file for what
 * replaced it (`overscroll-contain` + `[contain:layout_paint]` on the
 * physical board itself, `PerudoBidTrack.tsx`).
 *
 * **Portrait lock** (AskUserQuestion-confirmed: portrait-only, landscape
 * shows a notice rather than a second bespoke layout): `useIsLandscape`
 * below swaps the entire arena for a full-viewport "세로 모드로 이용해주세요"
 * notice whenever the device is rotated, rather than attempting a second
 * from-scratch landscape composition.
 *
 * No avatar imagery: the request's mockup mentions a `/user.png` fallback
 * profile photo, but no Perudo surface (desktop board included) has ever
 * rendered player avatars — survival status here reuses the same colored
 * colorway-dot + name convention the desktop roster already uses, rather
 * than introducing new avatar plumbing nothing else in this game has
 * (another instance of the request-premise-mismatch pattern this project
 * keeps running into — this decision itself isn't new this session, just
 * reconfirmed by staying consistent with every prior Perudo mobile session).
 *
 * **2026-09-10 헤더 높이-크리프(Height Creep) 제거 세션** — real bug report:
 * with 4~6+ players the header's `PlayerDiceSummaryBar` (`flex-wrap`, see
 * that function's own doc history) could spill onto a 2nd/3rd row, growing
 * the `shrink-0` header and eating into the `flex-1 min-h-0` space the board
 * + action dock + footer share, clipping the bottom controls on small
 * phones. Fix (3 `AskUserQuestion` rounds this session):
 * 1) **Header hard-capped to one `h-8` row, unconditionally** — every
 *    per-seat detail (player strip, round/player-count text, table-wide
 *    expectation figure) is OUT of the header now; it holds only the 🎲
 *    logo, a truncating one-line summary string, mute/rulebook buttons, and
 *    a compact turn-state pill. Nothing left in it can wrap, so this is a
 *    structural fix, not a size tweak.
 * 2) **`PlayerDiceSummaryBar` moved into the bottom control dock** as its
 *    own dedicated horizontal-scroll row (`overflow-x-auto`) — reintroducing
 *    a scroll gesture the previous day's session had explicitly removed
 *    project-wide on this screen (AskUserQuestion-confirmed this session:
 *    that removal's rationale — "scrolling could resize the rest of the
 *    arena" — doesn't apply once the strip is its own shrink-0 row rather
 *    than a header that shares space with everything else).
 * 3) **`LostDiceTray` (graveyard) demoted to conditional** — only mounts
 *    when a die has actually been lost (`totalLost > 0`), so the common
 *    early/mid-round case costs zero vertical budget; previously it
 *    always rendered (with an explicit "no losses yet" empty state).
 * 4) **`<main>` now owns the flexible space directly** (`flex-1 min-h-0
 *    items-center justify-center`, was the outer wrapper doing this via
 *    `justify-end`) so the board visually centers in whatever room is left
 *    once the (now-fixed) header/graveyard/action-dock/footer take their
 *    share, instead of just hugging the bottom controls. (2026-09-20: with
 *    the root no longer fixed-height, `flex-1 min-h-0` has nothing to
 *    flex-share against anymore and was dropped from `<main>` — the header
 *    stays `shrink-0`/`h-8` for the same "never wraps" readability reason,
 *    just without the fixed-viewport budget that originally motivated it.)
 * The board's own `--perudo-cell` sizing formula (`PerudoBidTrack.tsx`,
 * tuned per-breakpoint against real viewport width) was INTENTIONALLY left
 * untouched by this 2026-09-09 session — an earlier request draft that day
 * asked for a literal `min(80vw, 34dvh)` fixed-square board, which would
 * have silently reopened the cell-size/no-overflow tuning bug that formula
 * was specifically built to avoid — so this file only wrapped the existing
 * board in a centering container instead of forcing its size. (The other
 * half of that sentence — the root's own `calc(100dvh - offset)`
 * measurement — no longer exists; see the 2026-09-20 section at the top of
 * this file.)
 *
 * Reuses the exact same `TABLE_PANEL`/`TableTexture` chrome as the desktop
 * board (`PerudoSharedUI.tsx`) — this matters beyond visual consistency:
 * `RectBidTrack`'s own `--perudo-cell` width formula (`PerudoBidTrack.tsx`'s
 * `BOARD_CELL_SIZE_CSS`) is baked in assuming this exact panel's `p-3 sm:p-4`
 * padding stacked under the page template's own `px-4 sm:px-6` — a different
 * wrapper here would silently throw that formula off and reopen the
 * horizontal-fit bug the 2026-09-07 session fixed.
 */
export interface PerudoMobileBoardProps {
  state: PerudoState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  colorways: Record<SeatIndex, DiceColorway>;
  myColorway: DiceColorway;
  onColorwayChange: (colorwayId: string) => void;
  onAction: (action: EngineAction) => void;
  isMyTurn: boolean;
  iAmAlive: boolean;
  me: PlayerState;
  pendingFace: Face;
  pendingQuantity: number;
  pendingFloor: number;
  canConfirmBet: boolean;
  isIdenticalToCurrentBid: boolean;
  pickFace: (face: Face) => void;
  stepQuantity: (delta: number) => void;
  /** Physical-track props — identical contract to `PerudoBoard.tsx`'s own `<RectBidTrack>` call site; see `PerudoBidTrack.tsx`. */
  currentCell: TrackCell | null;
  pendingCell: TrackCell;
  laneOffset: number;
  cellEnabled: (cell: TrackCell) => boolean;
  onCellClick: (cell: TrackCell) => void;
  showBettingMarker: boolean;
  currentOverflows: boolean;
  pendingOverflows: boolean;
  muteButton: ReactNode;
  rulebookButton: ReactNode;
  rulebookOpen: boolean;
  onCloseRulebook: () => void;
}

/**
 * The player-status strip — every seat's own colorway `DiceCountStrip` in
 * turn order. Relocated from the header into the bottom control dock
 * (2026-09-10 헤더 높이-크리프 제거 세션 — see file header) specifically to fix
 * a real bug: with `flex-wrap` in the header, 4~6+ players could push it onto
 * a 2nd/3rd row, growing the header's `shrink-0` height and squeezing the
 * board/controls below it off-screen. Now a dedicated `overflow-x-auto`
 * horizontal-scroll row of its own — a previous 2026-09-09 session had
 * explicitly swapped an earlier version of this same scroll for `flex-wrap`
 * project-wide on this screen ("no gesture scrolls anything, sideways
 * included"), but this session's `AskUserQuestion` explicitly reintroduced it
 * here: that removal's rationale doesn't hold once this strip is its own
 * shrink-0 row rather than sharing space with (and resizing) the rest of the
 * arena — scrolling this row can never itself push the board or action
 * buttons around. Scrollbar hidden via inline arbitrary Tailwind variants (no
 * project-wide `.no-scrollbar` utility exists yet, unlike `PerudoBidTrack.tsx`'s
 * `.perudo-center-scroll`, which deliberately keeps a VISIBLE thin scrollbar
 * since that one scrolls actual bid controls, not just a status readout).
 * Deliberately compact (`xs`-size dice = 14px, truncated 4-glyph name,
 * AskUserQuestion-confirmed: same as the header strip's own prior
 * convention) — no avatar/profile imagery (AskUserQuestion-reconfirmed: this
 * game has never rendered player avatars anywhere, colorway dot only).
 */
function PlayerDiceSummaryBar({
  state,
  names,
  colorways,
  viewerSeat,
}: {
  state: PerudoState;
  names: Record<SeatIndex, string>;
  colorways: Record<SeatIndex, DiceColorway>;
  viewerSeat: SeatIndex;
}) {
  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => i);
  return (
    <div className="relative z-10 flex w-full items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {seatOrder.map((seat) => {
        const player = state.players.find((p) => p.seat === seat)!;
        const isActive = state.activeSeat === seat && state.phase === "playing";
        const eliminated = player.diceCount <= 0;
        const seatColorway = colorways[seat] ?? playerColorwayForSeat(seat);
        return (
          <div
            key={seat}
            className={`flex shrink-0 items-center gap-1 rounded-lg border px-1.5 py-0.5 ${
              isActive ? "border-amber-300/50 bg-amber-400/10 light:border-amber-400 light:bg-amber-50" : "border-white/10 bg-black/20 light:border-slate-200 light:bg-white/60"
            } ${eliminated ? "opacity-40" : ""}`}
            title={`${names[seat]}${seat === viewerSeat ? " (나)" : ""} · ${eliminated ? "탈락" : `${player.diceCount}개`}`}
          >
            {isActive && <span className="text-[9px]">👉</span>}
            <span className="max-w-[36px] truncate break-keep text-[9px] font-semibold text-white/70 light:text-slate-600">{names[seat]}</span>
            {eliminated ? (
              <span className="text-[9px]">💀</span>
            ) : (
              <DiceCountStrip colorway={seatColorway} diceCount={player.diceCount} size="xs" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Portrait-lock detector (AskUserQuestion-confirmed: portrait-only, no
 * bespoke landscape layout). SSR-safe lazy initializer reading `window`
 * directly — safe here for the same reason `useIsMobile.ts` documents:
 * `PerudoGame` mounts via `dynamic(..., { ssr: false })`, so there's never
 * server-rendered markup for this to mismatch against.
 */
function useIsLandscape(): boolean {
  const QUERY = "(orientation: landscape)";
  const [isLandscape, setIsLandscape] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isLandscape;
}

/** Full-viewport notice swapped in for the entire arena while the device is in landscape (AskUserQuestion-confirmed scope: portrait-only, this notice instead of a second bespoke layout). `fixed inset-0` so it always covers the real viewport regardless of page chrome above this component — unlike the arena itself, it doesn't need the `calc(100dvh - offset)` measurement below. */
function LandscapeNotice() {
  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center select-none light:bg-white">
      <span className="text-4xl">📱↕️</span>
      <p className="text-sm font-bold break-keep text-amber-100 light:text-amber-700">세로 모드로 이용해주세요</p>
      <p className="max-w-[240px] text-xs break-keep text-white/50 light:text-slate-500">페루도는 휴대폰을 세로로 들었을 때 최적화된 화면으로 표시됩니다.</p>
    </div>
  );
}

export default function PerudoMobileBoard({
  state,
  viewerSeat,
  names,
  colorways,
  myColorway,
  onColorwayChange,
  onAction,
  isMyTurn,
  iAmAlive,
  me,
  pendingFace,
  pendingQuantity,
  pendingFloor,
  canConfirmBet,
  isIdenticalToCurrentBid,
  pickFace,
  stepQuantity,
  currentCell,
  pendingCell,
  laneOffset,
  cellEnabled,
  onCellClick,
  showBettingMarker,
  currentOverflows,
  pendingOverflows,
  muteButton,
  rulebookButton,
  rulebookOpen,
  onCloseRulebook,
}: PerudoMobileBoardProps) {
  const isLandscape = useIsLandscape();

  // Same "누구 주사위 색상 이미 사용 중" lookup as the desktop picker
  // (`PerudoBoard.tsx`) — duplicated rather than threaded through props
  // since it's derived purely from `colorways`/`viewerSeat`, already
  // available here.
  const takenColorwaySeat = (colorwayId: string): SeatIndex | undefined => {
    const entry = Object.entries(colorways).find(([seat, cw]) => Number(seat) !== viewerSeat && cw.id === colorwayId);
    return entry ? (Number(entry[0]) as SeatIndex) : undefined;
  };

  if (isLandscape) return <LandscapeNotice />;

  const totalActiveDice = totalDiceInPlay(state);
  const totalLost = state.players.reduce((sum, p) => sum + Math.max(0, STARTING_DICE - p.diceCount), 0);
  const activeName = names[state.activeSeat] ?? "";

  return (
    // 2026-09-20 세로 스크롤 롤백: no more `ref`/measured `height` — this is
    // a plain block that grows to its natural content height, and the
    // document scrolls over it (`overscroll-contain` here is a second,
    // panel-scoped line of defense on top of `PerudoBoard.tsx`'s
    // document-level `overscroll-behavior: contain`, not a replacement for
    // it — this panel itself never scrolls internally). `touch-none`/
    // `overscroll-none`/`select-none` (gesture lockdown for the old
    // fixed-viewport screen) are gone — a normal scrollable page needs none
    // of them.
    <div
      className={`${TABLE_PANEL} flex w-full max-w-[100vw] flex-col gap-3 overscroll-contain p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:p-4 sm:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]`}
    >
      <MyTurnOverlay isMyTurn={isMyTurn && iAmAlive} />
      <TableTexture />

      {/* 초슬림 고정 헤더 (h-8, shrink-0) — 인원수와 무관하게 절대 줄바꿈되지
          않는 단일 행. 플레이어별 상세(스트립/무덤/기대값)는 전부 이 밖으로
          이전됨 — 2026-09-10 헤더 높이-크리프 제거 세션 (파일 상단 doc 참고). */}
      <header className="relative z-10 flex h-8 shrink-0 items-center justify-between gap-1.5 rounded-lg border border-amber-500/15 bg-black/25 px-2 light:border-amber-300/50 light:bg-white/70">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-[11px] font-bold text-amber-300 light:text-amber-700">
          <span className="shrink-0">🎲 페루도</span>
          <span className="shrink-0 text-white/20 light:text-slate-300">|</span>
          <span className="min-w-0 truncate font-normal text-white/55 light:text-slate-500">
            {state.playerCount}인 · {state.roundNumber}R · 잔여 {totalActiveDice}개 (기대값 {(totalActiveDice / 3).toFixed(1)})
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {muteButton}
          {rulebookButton}
          <span
            className={`flex h-5 shrink-0 items-center rounded-full px-2 text-[10px] font-bold break-keep ${
              isMyTurn ? "bg-amber-400/20 text-amber-200 light:bg-amber-100 light:text-amber-700" : "bg-white/5 text-white/40 light:bg-slate-100 light:text-slate-400"
            }`}
          >
            {isMyTurn ? "🫵 내 차례" : `${activeName.slice(0, 4)} 차례`}
          </span>
        </div>
      </header>

      {/* 무덤(잃은 주사위) — 실제로 손실이 발생했을 때만 마운트, 그 전까지는
          세로 공간을 전혀 차지하지 않는다(이전엔 "아직 없음" 빈 상태로도
          항상 렌더됐음). */}
      {totalLost > 0 && (
        <div className="relative z-10 shrink-0">
          <LostDiceTray state={state} colorways={colorways} />
        </div>
      )}

        {/* 보드+내 주사위를 한 블록으로 묶음. 2026-09-20 세로 스크롤 롤백: 더 이상
            고정 높이 부모의 남는 공간을 흡수할 필요가 없어 `flex-1 min-h-0`를
            제거 — 이 블록은 그냥 자기 콘텐츠 높이만큼 자라고, 넘치는 만큼은
            페이지 자체가 스크롤된다(클립 없음). */}
        <div className="relative flex flex-col items-center gap-3">
        <main className="relative z-10 flex w-full flex-col items-center justify-center">
          <RectBidTrack
            currentCell={currentCell}
            pendingCell={pendingCell}
            pendingFace={pendingFace}
            showMarker={showBettingMarker}
            laneOffset={laneOffset}
            cellEnabled={cellEnabled}
            onCellClick={onCellClick}
          >
            <div className="flex w-full flex-col items-center gap-2 p-1.5 sm:p-2.5" style={{ maxWidth: stripLength(7) }}>
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

              <div className="flex w-full flex-col items-center justify-center gap-2 rounded-[1.25rem] border-4 border-amber-800 bg-amber-100/90 p-2 text-neutral-900 shadow-[inset_0_2px_10px_rgba(0,0,0,0.18)]">
                {state.currentBid ? (
                  <div className="flex flex-col items-center gap-0.5 text-center">
                    <span className="text-[10px] text-amber-900/70">{names[state.currentBid.seat]}님의 선언</span>
                    <span className="text-2xl font-black text-red-900 drop-shadow-[0_1px_0_rgba(255,255,255,0.4)]">
                      {faceLabel(state.currentBid.face)} × {state.currentBid.quantity}개↑
                    </span>
                  </div>
                ) : (
                  <p className="px-2 text-center text-xs text-amber-900/70">
                    {names[state.activeSeat]}님이 이번 라운드를 엽니다 — 첫 선언 대기 중
                  </p>
                )}

                {isMyTurn && iAmAlive && (
                  <div className="flex flex-col items-center gap-1.5 rounded-xl border border-violet-900/25 bg-violet-950/5 px-1.5 py-2">
                    <p className="text-center text-[10px] font-semibold text-violet-900/70">
                      🟣 눈금을 고르고 개수를 정하거나, 트랙 칸을 눌러 이동하세요
                    </p>
                    <FacePicker selected={pendingFace} onSelect={pickFace} />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => stepQuantity(-1)}
                        disabled={pendingQuantity <= pendingFloor}
                        title="개수 줄이기"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border-2 border-violet-900/30 bg-white/60 text-sm font-bold text-violet-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        −
                      </button>
                      <span className="min-w-[3ch] text-center text-lg font-black text-violet-950">{pendingQuantity}개</span>
                      <button
                        type="button"
                        onClick={() => stepQuantity(1)}
                        title="개수 늘리기"
                        className="flex h-7 w-7 items-center justify-center rounded-lg border-2 border-violet-900/30 bg-white/60 text-sm font-bold text-violet-900 transition hover:bg-white"
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
                    {isIdenticalToCurrentBid && (
                      <p className="max-w-[220px] text-center text-[10px] font-medium text-rose-700">
                        ⚠️ 동일한 배팅은 할 수 없습니다. 눈금을 올리거나 수량을 올려주세요.
                      </p>
                    )}
                  </div>
                )}

              </div>
            </div>
          </RectBidTrack>
        </main>

        {/*
         * 🚨페루도!/🎯맞아! 액션 바 — 물리 보드(RectBidTrack) 내부의 고정-높이
         * 스크롤 칸(`perudo-center-scroll`, PerudoBidTrack.tsx) 밖으로 완전히
         * 빼낸 위치 (2026-09-09 후속 세션, "맞아 버튼을 보려면 스크롤을 내려야
         * 한다"는 실사용 리포트 — AskUserQuestion 확인: 버튼을 보드 밖으로 이동,
         * 보드 내부 콘텐츠 압축이나 잠긴 높이 해제 대신). 그 칸은 서/동쪽 변을
         * 코너에 붙이기 위해 stripLength(6)로 높이가 잠겨 있어 늘릴 수 없는데,
         * 선언 텍스트+베팅 조작(눈금/수량/확정)까지 채운 상태에서 이 버튼들까지
         * 같이 들어있으면 잠긴 높이를 넘겨 내부 스크롤을 유발했음 — 그 칸에서
         * 이 버튼들만 빼내는 것만으로 남은 콘텐츠(선언+조작부)가 잠긴 높이
         * 안에 들어와 내부 스크롤 자체가 없어짐. 이 바는 `shrink-0`이라 화면이
         * 좁아져도 압축 대상에서 제외되고(필요하면 물리 보드 쪽이 대신
         * 줄어듦), footer보다 먼저 배치해 "내 주사위" 바로 위, 물리 보드 바로
         * 아래에 항상 고정 노출된다 — 페루도는 내 턴에만, 맞아는 "차례와
         * 상관없이" 언제든 눌러야 하므로 턴 전환 시에만 도와주는 자동
         * 스크롤(예전 desktop의 bidActionZoneRef 방식)로는 불충분해 애초에
         * 스크롤할 필요 자체를 없앴다.
         */}
        {iAmAlive && (
          <div className="relative z-10 flex shrink-0 gap-2">
            <button
              disabled={!isMyTurn || !state.currentBid}
              onClick={() => onAction({ type: "dudo", seat: viewerSeat })}
              className="flex h-9 items-center justify-center rounded-lg bg-rose-700 px-4 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30"
            >
              🚨 페루도!
            </button>
            <button
              disabled={!state.currentBid}
              onClick={() => onAction({ type: "calza", seat: viewerSeat })}
              title="차례와 상관없이 외칠 수 있어요"
              className="flex h-9 items-center justify-center rounded-lg bg-emerald-700 px-4 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30"
            >
              🎯 맞아!
            </button>
          </div>
        )}

        {/* 최하단 컨트롤 독: [플레이어 현황 가로 스크롤 스트립] → [내 주사위
            상시 표시 바 + 색상 변경 팔레트]. */}
        <footer className="relative z-10 flex shrink-0 flex-col items-center gap-1.5">
          <div className="flex h-9 w-full items-center gap-2 rounded-xl border border-amber-900/30 bg-black/20 px-2 light:border-amber-200 light:bg-white/70">
            <span className="shrink-0 text-[10px] font-semibold text-amber-200/50 light:text-amber-700">인원</span>
            <PlayerDiceSummaryBar state={state} names={names} colorways={colorways} viewerSeat={viewerSeat} />
          </div>

          <div className="flex w-full flex-col items-center gap-1 rounded-2xl border-2 border-amber-900/40 bg-gradient-to-b from-black/25 to-black/35 p-2.5 shadow-[inset_0_2px_10px_rgba(0,0,0,0.35)] light:border-amber-300 light:from-amber-50 light:to-white">
            <span className="text-[11px] font-semibold text-amber-100/70 light:text-amber-700">🎲 내 주사위 ({me.diceCount}개)</span>
            {!iAmAlive ? (
              <p className="text-xs text-rose-300/70 light:text-rose-600">탈락했습니다 — 관전 중</p>
            ) : (
              <DiceRollTray
                dice={me.dice}
                colorway={myColorway}
                rollToken={state.roundNumber}
                size="md"
                ringForIndex={(i) => {
                  const d = me.dice[i];
                  const matchesBid = state.currentBid ? d === state.currentBid.face : false;
                  if (matchesBid) return "match";
                  if (state.currentBid && state.currentBid.face !== 1 && d === 1) return "wild";
                  return undefined;
                }}
                onRollStart={() => {
                  const engine = getSoundEngine();
                  engine.unlock();
                  engine.playDiceRattle(600);
                }}
                onSettled={() => getSoundEngine().playCupThud()}
              />
            )}
            {/* 색상 변경 팔레트 — 내 주사위 트레이 바로 아래 한 줄(라벨+원형 칩)로
                압축 배치. 예전 스크롤-다운 섹션은 이번 세션에서 완전히
                사라졌으므로 이게 유일한 색상 변경 UI다. */}
            <div className="flex w-full flex-wrap items-center justify-center gap-1.5">
              <span className="text-[10px] text-slate-400">🎨 색상:</span>
              {PLAYER_COLORWAYS.map((c) => {
                const heldBySeat = takenColorwaySeat(c.id);
                const isMine = myColorway.id === c.id;
                const isTaken = heldBySeat !== undefined && !isMine;
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={isTaken}
                    onClick={() => onColorwayChange(c.id)}
                    title={isTaken ? `${names[heldBySeat]}님이 사용 중` : `내 주사위 색상: ${c.label}`}
                    aria-label={`주사위 색상: ${c.label}`}
                    className={`h-5 w-5 rounded-full border-2 transition ${
                      isMine
                        ? "scale-110 border-white"
                        : isTaken
                          ? "cursor-not-allowed border-white/10 opacity-35"
                          : "border-white/25 hover:border-white/60"
                    }`}
                    style={{ backgroundColor: c.body }}
                  />
                );
              })}
            </div>
          </div>
        </footer>
        </div>

      {rulebookOpen && <RulebookModal onClose={onCloseRulebook} />}
    </div>
  );
}
