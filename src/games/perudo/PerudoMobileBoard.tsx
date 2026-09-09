"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import RulebookModal from "./RulebookModal";
import RectBidTrack, { OverflowBadge, stripLength } from "./PerudoBidTrack";
import { DiceRollTray } from "./dice/PerudoDie";
import { PLAYER_COLORWAYS, playerColorwayForSeat, type DiceColorway } from "./dice/colorways";
import { DiceCountStrip, ExpectationBar, faceLabel, FacePicker, LostDiceTray, TABLE_PANEL, TableTexture } from "./PerudoSharedUI";
import {
  totalDiceInPlay,
  type EngineAction,
  type Face,
  type PerudoState,
  type PlayerState,
  type SeatIndex,
  type TrackCell,
} from "./engine";

/**
 * The "playing"-phase mobile layout — rewritten 2026-09-09 (데스크톱 동등
 * 단일 뷰포트 전면 재구축 세션, AskUserQuestion 4문항 확인 후 진행). Replaces
 * the same-day-earlier "Section 1 zero-scroll arena + Section 2 scroll-down
 * player roster" 2-section structure outright — the whole board is now a
 * SINGLE `100dvh`-fit, zero-scroll screen with no page-level scroll section
 * at all. All game state and handlers (bid-composer draft, colorway picker,
 * action dispatch) live in the parent `PerudoBoard` — this component is pure
 * presentation, mounted instead of (never alongside) the desktop tree via
 * `useIsMobile`.
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
 * **Sizing technique** (AskUserQuestion-confirmed: keep, don't rewrite to a
 * fixed-canvas `transform: scale()`): the request's own mockup suggested a
 * fixed-size desktop-shaped canvas uniformly scaled down via CSS
 * `transform: scale()`. This file already had a battle-tested alternative
 * from three earlier 2026-09-09 sessions — measure how far this element's
 * top sits below whatever page chrome renders above it (site header + the
 * `/games/[gameId]` page's own title block) via
 * `arenaRef.getBoundingClientRect().top`, and size the root to exactly
 * `calc(100dvh - thatOffset)` — and this file has conditional-height content
 * (`OverflowBadge`s, the "동일한 배팅" hint, the raise composer only
 * appearing on my turn) that a *fixed-canvas* `transform: scale()` would
 * have to re-measure and re-apply on every single one of those toggles,
 * risking the whole board visibly growing/shrinking mid-game. The
 * `calc()`-based flex layout below reflows immediately with zero extra JS
 * whenever that conditional content changes, so it was kept as-is (now
 * governing the ENTIRE component instead of just a "Section 1").
 *
 * **Zero-scroll lock** (new requirement this session): previously this
 * root only clamped horizontal overflow (`overflow-x-hidden`) and relied on
 * `minHeight` + two internal `overflow-y-auto` safety valves (the physical
 * board's `<main>`, and the lost-dice tray) as a "better a nested scroll
 * than clipped content" fallback for extreme viewports. Both are gone now:
 * the root uses a firm `height` (not `minHeight`) plus `overflow-hidden`,
 * `touch-action: none`, `overscroll-behavior: none`, and `user-select: none`
 * (Tailwind `touch-none overscroll-none select-none`) so no gesture — up,
 * down, or sideways — can shift so much as a pixel of this screen or any
 * element nested inside it; the two internal safety valves became plain
 * `overflow-hidden` (clip rather than scroll) since dropping Section 2 frees
 * up enough vertical budget that this file's own content no longer needs
 * them to fit (see this session's HANDOFF entry for the actual measured
 * numbers). `html`/`body`'s own `overscroll-behavior: none` is still applied
 * globally by `PerudoBoard.tsx`'s mount effect regardless of which layout
 * branch renders — untouched here.
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
 * The header's "at a glance" player strip — every seat's own colorway
 * `DiceCountStrip` in turn order. Now the ONLY player-status surface in this
 * file (the old scroll-down Section 2 roster is gone this session — see the
 * file header) and, per this session's zero-scroll lock, no longer an
 * `overflow-x-auto` horizontal-scroll strip either (a previous 2026-09-09
 * session added the scroll specifically so this bar's height never grew past
 * one row for up to `MAX_PLAYERS = 8` seats — but "no gesture scrolls
 * anything, sideways included" is this session's own explicit, first-listed
 * requirement, so that specific tradeoff is reversed: `flex-wrap` now lets it
 * spill onto a second row instead of scrolling, and the rest of the arena
 * below sizes itself around however many rows that turns out to be via the
 * shared `calc(100dvh - offset)` measurement, same as any other header
 * content). Deliberately compact (`xs`-size dice, truncated 4-glyph name)
 * since the full-detail version — untruncated name, connection dot, "탈락"
 * text — no longer exists anywhere on mobile at all (AskUserQuestion-
 * confirmed: dropped, not relocated); this bar only needs to answer "who's on
 * what color and roughly how loaded".
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
    <div className="relative z-10 flex w-full flex-wrap items-center justify-center gap-1.5">
      {seatOrder.map((seat) => {
        const player = state.players.find((p) => p.seat === seat)!;
        const isActive = state.activeSeat === seat && state.phase === "playing";
        const eliminated = player.diceCount <= 0;
        const seatColorway = colorways[seat] ?? playerColorwayForSeat(seat);
        return (
          <div
            key={seat}
            className={`flex shrink-0 items-center gap-1 rounded-lg border px-1.5 py-0.5 ${
              isActive ? "border-amber-300/50 bg-amber-400/10" : "border-white/10 bg-black/20"
            } ${eliminated ? "opacity-40" : ""}`}
            title={`${names[seat]}${seat === viewerSeat ? " (나)" : ""} · ${eliminated ? "탈락" : `${player.diceCount}개`}`}
          >
            {isActive && <span className="text-[9px]">👉</span>}
            <span className="max-w-[36px] truncate break-keep text-[9px] font-semibold text-white/70">{names[seat]}</span>
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
    <div className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center select-none">
      <span className="text-4xl">📱↕️</span>
      <p className="text-sm font-bold break-keep text-amber-100">세로 모드로 이용해주세요</p>
      <p className="max-w-[240px] text-xs break-keep text-white/50">페루도는 휴대폰을 세로로 들었을 때 최적화된 화면으로 표시됩니다.</p>
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

  // Zero-scroll fit (요구사항 ①③, AskUserQuestion-confirmed "JS로 상단 여백
  // 측정 후 calc 핏", kept over a fixed-canvas `transform: scale()` rewrite —
  // see file header): measure how far this element's top sits from the real
  // viewport top (site header + page title block above it) and size the
  // WHOLE arena (there's no separate "Section 1" anymore — this component
  // has exactly one screen now) to exactly the remaining height, instead of
  // a literal `h-[100dvh]` that would double-count that chrome and overflow
  // past what's actually visible. Falls back to a bare `100dvh` for the very
  // first paint (before the effect has measured anything).
  //
  // Unlike the prior 2-section version, this is now a firm `height` (not
  // `minHeight`) paired with `overflow-hidden` on the same element — this
  // session's zero-scroll requirement means content that doesn't fit must
  // clip, never scroll, so there's no longer a reason to let the element
  // grow taller than the measured budget.
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const [arenaHeight, setArenaHeight] = useState<string>("100dvh");
  useEffect(() => {
    const measure = () => {
      const el = arenaRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setArenaHeight(`calc(100dvh - ${Math.max(top, 0)}px)`);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  if (isLandscape) return <LandscapeNotice />;

  return (
    <div
      ref={arenaRef}
      style={{ height: arenaHeight }}
      className={`${TABLE_PANEL} flex w-full max-w-[100vw] touch-none flex-col gap-2 overscroll-none p-3 select-none sm:p-4`}
    >
      <MyTurnOverlay isMyTurn={isMyTurn && iAmAlive} />
      <TableTexture />

      {/* 상단 정보 계층: 인원/라운드 정보 → 플레이어 요약바 → 턴 배너 → 무덤 → 기대값 바. */}
      <header className="relative z-10 flex shrink-0 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-1.5 text-xs text-rose-100/60">
          <span>
            {state.playerCount}인 · {state.roundNumber}라운드
          </span>
          <div className="flex gap-1.5">
            {muteButton}
            {rulebookButton}
          </div>
        </div>
        <PlayerDiceSummaryBar state={state} names={names} colorways={colorways} viewerSeat={viewerSeat} />
        <p className={`text-center text-sm font-bold break-keep ${isMyTurn ? "text-amber-200" : "text-xs font-medium text-white/50"}`}>
          {isMyTurn ? "🫵 당신 차례입니다!" : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
        </p>
        {/* 완전 고정 스크린이라 넘치는 만큼은 스크롤이 아니라 클립됨 (요구사항 ①) —
            섹션2 제거로 확보된 여유 예산 안에서 실측으로 확인됨(HANDOFF 참고). */}
        <div className="max-h-16 overflow-hidden">
          <LostDiceTray state={state} colorways={colorways} />
        </div>
        <ExpectationBar totalActiveDice={totalDiceInPlay(state)} />
        </header>

        {/* 보드+내 주사위를 한 블록으로 묶어 하단에 밀착 — 남는 세로 여백은
            전부 헤더 바로 아래(이 블록 위쪽)로만 가도록 flex-1 min-h-0 +
            justify-end를 사용. `<main>` 자신은 내용 크기만큼만 차지하고,
            혹시라도 넘치는 만큼은(이 세션부터는) 스크롤이 아니라 클립된다
            — `overflow-y-auto` 안전장치가 이번 세션의 "완전 고정" 요구사항과
            상충해 제거됨. */}
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-end gap-1.5">
        <main className="relative z-10 flex min-h-0 w-full flex-col items-center overflow-hidden">
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

                {iAmAlive && (
                  <div className="flex gap-2">
                    <button
                      disabled={!isMyTurn || !state.currentBid}
                      onClick={() => onAction({ type: "dudo", seat: viewerSeat })}
                      className="rounded-lg bg-rose-700 px-4 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30"
                    >
                      🚨 페루도!
                    </button>
                    <button
                      disabled={!state.currentBid}
                      onClick={() => onAction({ type: "calza", seat: viewerSeat })}
                      title="차례와 상관없이 외칠 수 있어요"
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30"
                    >
                      🎯 맞아!
                    </button>
                  </div>
                )}
              </div>
            </div>
          </RectBidTrack>
        </main>

        {/* 최하단: 내 주사위 상시 표시 바 + 색상 변경 팔레트. */}
        <footer className="relative z-10 flex shrink-0 flex-col items-center gap-1.5">
          <div className="flex w-full flex-col items-center gap-1 rounded-2xl border-2 border-amber-900/40 bg-gradient-to-b from-black/25 to-black/35 p-2.5 shadow-[inset_0_2px_10px_rgba(0,0,0,0.35)]">
            <span className="text-[11px] font-semibold text-amber-100/70">🎲 내 주사위 ({me.diceCount}개)</span>
            {!iAmAlive ? (
              <p className="text-xs text-rose-300/70">탈락했습니다 — 관전 중</p>
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
