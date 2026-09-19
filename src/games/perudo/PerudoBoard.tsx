"use client";

import { useEffect, useRef, useState } from "react";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import { useAudioSettingsStore } from "@/lib/audio/audioSettings";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import RulebookModal from "./RulebookModal";
import PerudoFaceIcon from "./PerudoFaceIcon";
import RectBidTrack, { BOARD_LAST_INDEX, LAP_SIZE, OverflowBadge, stripLength } from "./PerudoBidTrack";
import { DieBack, DieFace, faceLabel, FacePicker, LostDiceTray, TABLE_PANEL, TableTexture } from "./PerudoSharedUI";
import {
  computeRankings,
  minValidQuantityForFace,
  totalDiceInPlay,
  trackCellForBid,
  validateRaise,
  type EngineAction,
  type Face,
  type PerudoState,
  type SeatIndex,
  type TrackCell,
} from "./engine";
import { DiceRollTray, tiltFor } from "./dice/PerudoDie";
import {
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
  /**
   * Room-synced dice colorway per seat (2026-09-04 색상 확장/중복 방지 세션) —
   * computed by `PerudoGame.tsx`, covers every seat including the viewer's
   * own (`colorways[viewerSeat]`). Replaces the old purely-local
   * `colorwayOverride` state this component used to keep — every seat's
   * color is now something every OTHER client renders identically too, so
   * it has to come from the caller like `names`/`connectedSeats` already do.
   */
  colorways: Record<SeatIndex, DiceColorway>;
  /** Request a change to the viewer's own colorway (swatch picker click) — the caller re-broadcasts it room-wide. */
  onColorwayChange: (colorwayId: string) => void;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** Always-visible stat bar (rulebook UX request #4, top area) — the one number every player needs at a glance regardless of phase. */
function TotalDiceBanner({ state }: { state: PerudoState }) {
  return (
    <div className="relative z-10 flex items-center justify-center gap-2 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-1.5 text-center light:border-amber-400 light:bg-amber-50">
      <span className="text-base">🎲</span>
      <span className="text-sm font-bold text-amber-100 light:text-amber-700">
        현재 전체 주사위: {totalDiceInPlay(state)}개
      </span>
    </div>
  );
}

/**
 * Stats dashboard (rulebook UX request #4): my own cup's dice counts by
 * face, plus the "전체 주사위 ÷ 3" expected-value guide that drives Perudo
 * doubt/call strategy — the two numbers a player checks before deciding
 * whether to bid or challenge. 2026-09-20 세션: moved from right below the
 * board (after the "페루도!"/"맞아!" action buttons) to the very top, above
 * the "당신의 차례입니다!" turn banner — see this file's call site — so the
 * numbers a player needs are visible before they even reach the board.
 */
function MyDiceStatsPanel({ state, myDice }: { state: PerudoState; myDice: number[] }) {
  const faces: Face[] = [1, 2, 3, 4, 5, 6];
  const counts = faces.map((face) => ({ face, count: myDice.filter((d) => d === face).length }));
  const total = totalDiceInPlay(state);
  const expected = total / 3;

  return (
    <div className="relative z-10 flex flex-col gap-2 rounded-xl border border-white/10 bg-black/25 p-2.5 light:border-slate-200 light:bg-white/70">
      <p className="text-[11px] font-semibold tracking-wide text-white/50 uppercase light:text-slate-500">📊 통계 현황판</p>
      <div className="flex flex-wrap gap-1.5">
        {counts.map(({ face, count }) => (
          <span
            key={face}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
              count > 0
                ? "border-amber-300/40 bg-amber-400/10 text-amber-100 light:border-amber-400 light:bg-amber-50 light:text-amber-700"
                : "border-white/10 text-white/30 light:border-slate-200 light:text-slate-400"
            }`}
          >
            {face === 1 ? <PerudoFaceIcon className="h-3 w-3" /> : <span className="font-bold">{face}</span>}
            {face === 1 ? "페루도(1)" : `숫자 ${face}`}: {count}개
          </span>
        ))}
      </div>
      <p className="text-[11px] text-white/50 light:text-slate-500">
        전체 주사위: <span className="text-white/80 light:text-slate-700">{total}개</span> · 1/3 기대값:{" "}
        <span className="text-amber-200 light:text-amber-700">{expected.toFixed(1)}개</span>
      </p>
    </div>
  );
}

export default function PerudoBoard({
  state,
  viewerSeat,
  names,
  connectedSeats,
  colorways,
  onColorwayChange,
  onAction,
  onGameEnd,
}: PerudoBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const isMyTurn = state.activeSeat === viewerSeat && state.phase === "playing";
  const iAmAlive = me.diceCount > 0;

  // "내 턴이 되었을 때" 알림 (2026-09-04 도입, 2026-09-05 세션에서 허브 공용
  // <MyTurnOverlay>/playMyTurnChime() 중앙 팝업으로 승격 — 예전엔 이 파일
  // 안에서 turnFxToken/wasMyTurnRef로 직접 엣지를 감지해 하단 상태 텍스트에
  // perudo-turn-pulse만 재생했지만, 이제 그 엣지 감지+사운드+배너 전부를
  // <MyTurnOverlay>가 내부적으로 처리한다. 여기서는 "죽은 상태면 내 턴으로
  // 치지 않는다"는 페루도 전용 조건(iAmAlive)만 얹어 넘겨준다.

  // My own dice's colorway — room-synced (2026-09-04 색상 확장/중복 방지 세션,
  // see `PerudoBoardProps.colorways`'s doc comment). Falls back to the
  // deterministic seat default only for the brief window before the caller's
  // own presence-track resolves a real pick.
  const myColorway = colorways[viewerSeat] ?? playerColorwayForSeat(viewerSeat);

  // Overscroll-bounce containment (요구사항 1) — scoped to this component's
  // mount, restored on unmount, same pattern as `WormCanvas.tsx`'s own
  // gesture lock (see that file's doc comment). Applied regardless of
  // phase (game-over and reveal screens can bounce just as easily as the
  // playing screen can).
  //
  // 2026-09-20 세션: was `"none"` (fully disables the native rubber-band
  // bounce at the document's own scroll boundaries) while mobile briefly had
  // its own fixed zero-scroll viewport (removed the same session — mobile
  // now renders this exact same tree via plain responsive CSS again, like it
  // did before 2026-09-08, see the removed `if (isMobile)` branch's history
  // below). `"contain"` is the correct value now that there's a real "top of
  // page"/"bottom of page" edge to bounce at on every viewport: it still
  // stops the bounce from CHAINING past this page (pull-to-refresh/navigating
  // away mid-swipe), but lets the browser's own native bounce feedback play
  // out at the edge instead of just hard-stopping, which reads as smoother.
  // The `backgroundColor` override below was always here for exactly this
  // case (a bounce revealing dark instead of white).
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverscroll = html.style.overscrollBehavior;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    const prevBodyBackground = body.style.backgroundColor;
    html.style.overscrollBehavior = "contain";
    body.style.overscrollBehavior = "contain";
    body.style.backgroundColor = "#020617"; // slate-950 — matches TABLE_PANEL's own darkest stop, so a rubber-band bounce reveals this instead of the page's default white
    return () => {
      html.style.overscrollBehavior = prevHtmlOverscroll;
      body.style.overscrollBehavior = prevBodyOverscroll;
      body.style.backgroundColor = prevBodyBackground;
    };
  }, []);

  // 2026-09-08 4변 밀착 세션: `RectBidTrack`'s hollow center is now
  // height-locked to `stripLength(6)` (see that component's own doc
  // comment) so the physical border stays a seamless rectangle on mobile —
  // but that means the bid-declare box (선언/확정 버튼, 🚨페루도!/🎯맞아!)
  // routinely sits below the fold of that small internally-scrolling cell.
  // Rather than leave the player to discover the nested scroll on their
  // own, jump it into view the moment it's actually their turn (or the
  // moment they gain the ability to act at all) — `scrollIntoView` walks up
  // to the nearest scrollable ancestor regardless of which component
  // rendered it, so this ref doesn't need to be threaded through
  // `RectBidTrack` at all. AskUserQuestion-confirmed: keep the internal
  // scroll (not a bigger layout redesign), just make it more discoverable —
  // see this ref's call site for the matching scrollbar/fade styling.
  const bidActionZoneRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isMyTurn && iAmAlive) {
      bidActionZoneRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isMyTurn, iAmAlive]);

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

  // The fixed rectangular board (`RectBidTrack`) only has 30 physical slots
  // per lap — a bid whose index falls outside the currently-displayed lap
  // has no on-board cell to land on, so it's flagged here and surfaced as an
  // `OverflowBadge` inside the board's center instead of being forced onto a
  // cell that doesn't exist. Since `laneOffset` (2026-09-04 트랙 이어붙이기
  // 세션) always follows the CONFIRMED bid's own lap, `currentOverflows`
  // below is provably always false in practice — the confirmed bid is always
  // on-board now — but it's kept as a real (not hardcoded-false) check for
  // robustness. Only the viewer's own still-editable draft can still
  // overflow (pushing past the top of the currently-displayed lap before
  // that raise is confirmed) — see `buildRectFrame`'s doc comment.
  const currentCell = state.currentBid ? trackCellForBid(state.currentBid) : null;
  const pendingCell = trackCellForBid({ quantity: pendingQuantity, face: pendingFace });
  const laneOffset = currentCell !== null ? Math.floor(currentCell.index / LAP_SIZE) * LAP_SIZE : 0;
  const currentOverflows =
    currentCell !== null && (currentCell.index < laneOffset || currentCell.index > laneOffset + BOARD_LAST_INDEX);
  const pendingOverflows = pendingCell.index < laneOffset || pendingCell.index > laneOffset + BOARD_LAST_INDEX;
  /**
   * Whether the purple betting-die marker should render at all (2026-09-04
   * 픽스 — 버그 리포트: "상대 턴일 때 보라색 배팅 주사위가 안 보임"). Previously this
   * was just `isMyTurn && iAmAlive`, so the marker vanished the instant the
   * turn passed to anyone else — leaving only the plain amber "현재 확정된
   * 베팅 칸" highlight with no die/pip icon. `pendingCell`/`pendingFace` stay
   * exactly in sync with `state.currentBid` whenever it isn't the viewer's
   * turn (see the bid-composer sync block above — the composer controls
   * that could otherwise diverge the draft are only rendered on my own
   * turn), so showing the marker there too is always accurate: it now stays
   * lit on whichever cell the CURRENT confirmed bid sits on for as long as
   * one exists, not just while the viewer is actively drafting a raise.
   */
  const showBettingMarker = (isMyTurn && iAmAlive) || state.currentBid !== null;

  // Roll sound cue: `DiceRollTray`'s `onRollStart`/`onSettled` callbacks
  // (wired up below, "My dice" section) fire the rattle/thud SFX beat timed
  // to the actual shake-then-settle animation, every time a new round's
  // dice are rolled (roundNumber changes, including the very first mount).
  // A player's own dice are ALWAYS visible the instant they render — no cup
  // or timer ever hides them (2026-08 페루도 UI 개편, 사용자 요청).

  // Reads the site-wide `audioSettings` store directly (2026-08-26 세션)
  // instead of a local copy of `soundEngine.isMuted()`, so this button stays
  // in sync with the header's global toggle and the settings modal.
  const muted = useAudioSettingsStore((s) => s.masterMuted);
  const toggleMuted = useAudioSettingsStore((s) => s.toggleMasterMuted);

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white light:border-slate-300 light:text-slate-600 light:hover:border-slate-400 light:hover:text-slate-900"
    >
      📖 페루도 룰북
    </button>
  );

  const muteButton = (
    <button
      onClick={() => {
        toggleMuted();
        getSoundEngine().unlock();
      }}
      title={muted ? "효과음 켜기" : "효과음 끄기"}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white light:border-slate-300 light:text-slate-600 light:hover:border-slate-400 light:hover:text-slate-900"
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );

  // In-game color swatch picker (2026-09-04 색상 확장/중복 방지 세션) — "taken" is
  // derived straight from `colorways` (every seat is guaranteed filled once
  // the game has started, unlike the waiting room's own picker in
  // `PerudoGame.tsx`, which can't assume that). Picking a swatch calls
  // `onColorwayChange`, which re-broadcasts to the whole room — this is no
  // longer a purely-local preference.
  const takenColorwaySeat = (colorwayId: string): SeatIndex | undefined => {
    const entry = Object.entries(colorways).find(([seat, cw]) => Number(seat) !== viewerSeat && cw.id === colorwayId);
    return entry ? (Number(entry[0]) as SeatIndex) : undefined;
  };
  const colorwayPicker = (
    <div className="flex items-center gap-1">
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
            className={`h-4 w-4 rounded-full border-2 transition ${
              isMine
                ? "scale-110 border-white light:border-slate-900"
                : isTaken
                  ? "cursor-not-allowed border-white/10 opacity-35 light:border-slate-300"
                  : "border-white/25 hover:border-white/60 light:border-slate-300 light:hover:border-slate-500"
            }`}
            style={{ backgroundColor: c.body }}
          />
        );
      })}
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
        <LostDiceTray state={state} colorways={colorways} />
        <span className="relative z-10 text-5xl">🏆</span>
        <h2 className="relative z-10 text-2xl font-bold text-amber-100 light:text-amber-700">{names[rankings[0]?.seat]}님 승리!</h2>
        <p className="relative z-10 text-xs text-white/50 light:text-slate-500">마지막까지 주사위를 지킨 사람이 이기는 게임입니다.</p>

        <div className="relative z-10 w-full overflow-x-auto">
          <table className="w-full min-w-[320px] border-collapse text-xs">
            <thead>
              <tr className="text-white/50 light:text-slate-500">
                <th className="border-b border-white/10 px-2 py-2 text-left light:border-slate-200">순위</th>
                <th className="border-b border-white/10 px-2 py-2 text-left light:border-slate-200">플레이어</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map(({ seat, rank }) => (
                <tr key={seat} className={rank === 1 ? "bg-amber-400/10 light:bg-amber-50" : ""}>
                  <td className="border-b border-white/5 px-2 py-2 text-left font-bold text-amber-200 light:border-slate-100 light:text-amber-700">
                    {rank === 1 ? "🏆 1" : rank}
                  </td>
                  <td className="border-b border-white/5 px-2 py-2 text-left text-white light:border-slate-100 light:text-slate-900">
                    {names[seat]}
                    {seat === viewerSeat && <span className="ml-1 text-amber-200 light:text-amber-700">(나)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {state.lastResolution && <RevealPanel state={state} names={names} viewerSeat={viewerSeat} colorways={colorways} />}

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
        <LostDiceTray state={state} colorways={colorways} />
        <div className="relative z-10 flex items-center justify-between text-xs text-rose-100/60 light:text-slate-500">
          <span>
            {state.playerCount}인 · {state.roundNumber}라운드 결과
          </span>
          <div className="flex gap-1.5">
            {muteButton}
            {rulebookButton}
          </div>
        </div>
        <div className="relative z-10 rounded-2xl border border-white/10 bg-black/30 p-4 text-center light:border-slate-200 light:bg-white/70">
          <p className="text-sm font-semibold text-amber-100 light:text-amber-700">
            {names[res.actorSeat]}님이 {res.kind === "dudo" ? "🚨 페루도!" : "🎯 맞아!"}를 외쳤습니다
          </p>
          <p className="mt-1 text-xs text-white/60 light:text-slate-500">
            선언: {faceLabel(res.bid.face)} {res.bid.quantity}개 이상 · 실제: {res.actualCount}개
          </p>
          <p className={`mt-2 text-sm font-bold ${success ? "text-emerald-300 light:text-emerald-600" : "text-rose-300 light:text-rose-600"}`}>
            {res.kind === "dudo"
              ? res.affectedSeat === res.bid.seat
                ? `📉 선언이 틀렸습니다 — ${names[res.bid.seat]}님이 주사위 ${lossAmount}개를 잃었습니다.`
                : `📈 선언이 맞았습니다 — ${names[res.actorSeat]}님이 주사위 ${lossAmount}개를 잃었습니다.`
              : res.diceDelta > 0
                ? `🎉 정확히 맞췄습니다! ${names[res.actorSeat]}님이 주사위 1개를 되찾았습니다.`
                : `❌ 틀렸습니다 — ${names[res.actorSeat]}님이 주사위 ${lossAmount}개를 잃었습니다.`}
          </p>
        </div>

        <RevealPanel state={state} names={names} viewerSeat={viewerSeat} colorways={colorways} />

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

  // 2026-09-20 세션: this used to fork into a completely separate
  // `PerudoMobileBoard` tree below `max-width: 767px` (a 2026-09-08~09-10
  // series of sessions built a bespoke fixed-viewport zero-scroll mobile
  // layout, `useIsMobile.ts`). Removed per user request, back to how this
  // game worked through 2026-09-06: ONE tree, rendered identically on every
  // viewport via the plain responsive (`sm:`/`light:`) classes already
  // throughout this file — mobile gets a normal scrolling page like every
  // other board in this project, not a special-cased second layout. Every
  // fix that landed on this shared tree since then (the 09-07 horizontal-
  // overflow fix and 09-08 border-detachment fix in `PerudoBidTrack.tsx`,
  // the bot-takeover/light-theme/lockstep work in this file and
  // `PerudoGame.tsx`) was never mobile-UI-specific, so none of it needed to
  // be un-done to remove the split — only the fork itself and the
  // mobile-only presentation components it fed (`PerudoMobileBoard.tsx`,
  // `useIsMobile.ts`, and the `DiceCountStrip`/`ExpectationBar` helpers in
  // `PerudoSharedUI.tsx` that only that tree consumed) were deleted.

  return (
    <div className={`${TABLE_PANEL} flex flex-col gap-3 p-3 sm:p-4`}>
      <MyTurnOverlay isMyTurn={isMyTurn && iAmAlive} />
      <TableTexture />
      <TotalDiceBanner state={state} />

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-1.5 text-xs text-rose-100/60 light:text-slate-500">
        <span className="flex items-center gap-1.5">
          {state.playerCount}인 · {state.roundNumber}라운드
        </span>
        <div className="flex gap-1.5">
          {muteButton}
          {rulebookButton}
        </div>
      </div>

      {/* 2026-09-20 세션: 통계 현황판을 보드 아래(원래 자리)에서 여기로 이동 —
          "당신의 차례입니다!" 배너보다 위, 라운드 판단에 필요한 숫자를 먼저
          보고 베팅을 결정하도록. 원래 이 자리엔 아무것도 없었음(바로 턴
          배너로 이어졌음). */}
      <MyDiceStatsPanel state={state} myDice={me.dice} />

      {/* 턴 배너 — 하단 상태 텍스트는 이제 조용한 안내문 고정(한 번 튀는
          애니메이션은 위 <MyTurnOverlay>의 중앙 팝업이 전담, 2026-09-05
          세션). */}
      <p className={`relative z-10 text-center text-sm font-bold break-keep ${isMyTurn ? "text-amber-200 light:text-amber-700" : "text-xs font-medium text-white/50 light:text-slate-500"}`}>
        {isMyTurn ? "🫵 당신 차례입니다!" : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
      </p>

      {/* 잃은 주사위 무덤 — 2026-09-20 세션: 보드의 hollow center 안(넘침 배지
          바로 아래)에서 여기(턴 배너 바로 아래, 보드 바로 위)로 이동. 이 이동
          자체가 목적이기도 하고, 이 자리로 빼내는 게 center 칸의 고정 높이
          예산에서 한 블록을 통째로 덜어내 바로 아래 `RectBidTrack`의 배팅
          패널이 스크롤 없이 들어차기 쉬워지는 데도 도움이 된다(같은 세션의
          다음 변경과 함께 봄). */}
      <LostDiceTray state={state} colorways={colorways} />

      {/* The rectangular board itself (2026-08-20 사각형 트랙 세션) — quantities
          1-20 around 4 sides (see `RectBidTrack`'s doc comment), sized to
          hold the bid/액션 panel inside its hollow center, so the whole
          thing reads as one big physical-board-sized panel rather than a
          thin strip with everything else stacked below it. (2026-09-20
          세션: the dice graveyard moved OUT to right above this board, and
          the viewer's own dice tray + colorway picker moved OUT to its own
          panel right below it — see each one's own doc comment — so this
          center now holds only the bid declaration + action-button panel.)

          2026-08-21 무여백 대칭 트랙 세션: the board's `--perudo-cell` now
          scales up to ~78px (요구사항 2 확장 규모) via `clamp()`, which on the
          narrowest phone viewports (~360-400px) makes the board's own content
          width wider than the space `TABLE_PANEL`'s padding leaves — and
          `TABLE_PANEL` itself is `overflow-hidden` (needed to clip
          `TableTexture`'s decorative layers to the panel's rounded corners),
          so without this wrapper the board's edge would be silently clipped
          instead of scrollable (Playwright-caught at 390px before this was
          added — see HANDOFF.md). `overflow-x-auto` here (same pattern
          already used for the game-over ranking table below) turns that into
          a horizontal scroll/pan on narrow phones rather than lost content;
          `RectBidTrack`'s own `mx-auto` still centers it whenever it's
          narrower than the scroll area, i.e. on every viewport past mobile. */}
      <div className="relative z-10 w-full overflow-x-auto">
        <RectBidTrack
          currentCell={currentCell}
          pendingCell={pendingCell}
          pendingFace={pendingFace}
          showMarker={showBettingMarker}
          laneOffset={laneOffset}
          cellEnabled={cellEnabled}
          onCellClick={selectCell}
        >
          {/* `p-1 sm:p-2.5` moved here from `RectBidTrack`'s center grid
              cell (2026-09-07 모바일 가로 스크롤 제거 세션) — this div's own
              `maxWidth` is a real cap on ITS box (border-box), so padding
              added here shrinks its usable inner width instead of adding
              onto the outer size the way padding on the ungapped grid cell
              outside it did. See `RectBidTrack`'s call site comment.
              2026-09-20 세션: `gap-2.5` → `gap-1 sm:gap-2.5` and outer
              padding tightened on mobile — see the bid panel's own comment
              below for why (스크롤 없이 가득 채우기 세션). */}
          <div className="flex w-full flex-col items-center gap-0.5 p-1 sm:gap-2.5 sm:p-2.5" style={{ maxWidth: stripLength(7) }}>
          {/* Capped to the exact same width as the north/south strips
              (2026-08-21 간격 정돈 세션) — otherwise this panel's natural
              width could force the board's center grid column wider than
              the strips sitting right above/below it, reopening the same
              gap-inflation bug this session fixed. */}
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

          {/* Bid-declaration controls — the confirmed bid, plus (on my turn) the
              FacePicker + quantity stepper composer. Both the composer's
              "확정" button and every track cell around this panel ultimately
              gate on the same `validateRaise` call, so a same-quantity face
              raise (예: "2가 1개" → "3이 1개") is never blocked by one path
              while allowed by the other.

              2026-09-20 스크롤 없이 가득 채우기 세션 (사용자 요청: "배팅판과
              페루도, 맞아버튼을 스크롤 없이 가득차게 반응형으로"): this whole
              panel sits inside `RectBidTrack`'s hollow center, which is
              height-LOCKED to `stripLength(6)` — the physical board's own
              west/east strip height (see `RectBidTrack`'s doc comment for
              why that lock can't just be dropped: content taller than it
              detaches the west/east strip from the corners). On the
              narrowest real phones `stripLength(6)` bottoms out around
              ~190-210px, so the only lever left is shrinking THIS panel's
              own padding/gaps/font sizes on mobile until it reliably fits
              inside that budget without needing `.perudo-center-scroll`'s
              internal scroll to engage — every size below is mobile-first
              (smallest at the base class, `sm:` restores the previous
              roomier desktop/tablet sizing). Moving the dice graveyard out
              of this same center (see the call site above) and the "잃은
              주사위" tray's conditional mount already free real budget too.
              The internal scroll itself is intentionally NOT removed —
              kept as a silent fallback for genuinely extreme cases (a very
              old ~320px device, or every conditional badge/hint stacking at
              once), not something a normal phone should ever actually
              trigger. */}
          <div
            ref={bidActionZoneRef}
            className="relative z-10 flex w-full flex-col items-center justify-center gap-0.5 rounded-[1.25rem] border-2 border-amber-800 bg-amber-100/90 p-0.5 text-neutral-900 shadow-[inset_0_2px_10px_rgba(0,0,0,0.18)] sm:border-4 sm:gap-2 sm:p-2"
          >
            {state.currentBid ? (
              <div className="flex flex-col items-center gap-0.5 text-center">
                <span className="text-[9px] leading-none text-amber-900/70 sm:text-[10px] sm:leading-normal">{names[state.currentBid.seat]}님의 선언</span>
                <span className="text-base leading-none font-black text-red-900 drop-shadow-[0_1px_0_rgba(255,255,255,0.4)] sm:text-3xl sm:leading-normal">
                  {faceLabel(state.currentBid.face)} × {state.currentBid.quantity}개↑
                </span>
              </div>
            ) : (
              <p className="px-2 text-center text-[11px] text-amber-900/70 sm:text-xs">
                {names[state.activeSeat]}님이 이번 라운드를 엽니다 — 첫 선언 대기 중
              </p>
            )}

            {isMyTurn && iAmAlive && (
              // 2026-09-07 모바일 가로 스크롤 제거 세션: `px-2.5` → `px-1.5` and the
              // stepper's `h-8 w-8`/`gap-2.5` → `h-7 w-7`/`gap-1.5` — same reason
              // as `FacePicker`'s own comment, just with a smaller margin needed
              // (this row was never as tight as the 6-button face row).
              // 2026-09-20: stepper/confirm shrunk further still, mobile-first —
              // see this block's own parent comment.
              <div className="flex flex-col items-center gap-0.5 rounded-xl border border-violet-900/25 bg-violet-950/5 px-1.5 py-0 sm:gap-1.5 sm:py-2">
                {/* 2026-09-20 버튼 탭 영역 확대 세션: 모바일에서는 숨김(`hidden
                    sm:block`) — 아래 확정/페루도!/맞아! 버튼을 누르기 편하게
                    키운 만큼 이 안내문(비대화형 텍스트)에서 그 높이를
                    되찾아옴. 데스크톱/태블릿(`sm:`)은 여유가 있어 그대로
                    유지. */}
                <p className="hidden text-center text-[10px] leading-tight font-semibold text-violet-900/70 sm:block">
                  🟣 눈금을 고르고 개수를 정하거나, 트랙 칸을 눌러 이동하세요
                </p>
                <FacePicker selected={pendingFace} onSelect={pickFace} />
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <button
                    type="button"
                    onClick={() => stepQuantity(-1)}
                    disabled={pendingQuantity <= pendingFloor}
                    title="개수 줄이기"
                    className="flex h-6 w-6 items-center justify-center rounded-lg border-2 border-violet-900/30 bg-white/60 text-sm font-bold text-violet-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-30 sm:h-7 sm:w-7"
                  >
                    −
                  </button>
                  <span className="min-w-[3ch] text-center text-base font-black text-violet-950 sm:text-lg">{pendingQuantity}개</span>
                  <button
                    type="button"
                    onClick={() => stepQuantity(1)}
                    title="개수 늘리기"
                    className="flex h-6 w-6 items-center justify-center rounded-lg border-2 border-violet-900/30 bg-white/60 text-sm font-bold text-violet-900 transition hover:bg-white sm:h-7 sm:w-7"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!canConfirmBet}
                  onClick={() => onAction({ type: "raise", seat: viewerSeat, quantity: pendingQuantity, face: pendingFace })}
                  // 2026-09-20 버튼 탭 영역 확대 세션 (사용자 확인: 스마트폰에서 누르기
                  // 작음): `py-0.5 text-[11px]` → `py-1.5 text-xs` + `min-h-[36px]`
                  // (36px — 콘텐츠+패딩만으로는 아직 못 미쳐서 명시적으로 바닥을
                  // 깔아줌, `flex items-center justify-center`로 실제 중앙 정렬
                  // 보장) — 아래 페루도!/맞아! 버튼과 함께, 이 셋만 지목해 키운 것.
                  // 늘어난 높이는 바로 아래 힌트 문구(비대화형 텍스트)를 그만큼 더
                  // 줄여서 상쇄 — 그 문단 자체의 주석 참고.
                  className="flex min-h-[36px] items-center justify-center rounded-full bg-violet-700 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white shadow-[0_0_0_2px_rgba(168,85,247,0.3)] transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30 disabled:shadow-none sm:min-h-0 sm:px-4"
                >
                  ✅ {faceLabel(pendingFace)} × {pendingQuantity}개로 베팅 확정
                </button>
                {/* Always-visible hint (not just a disabled button — 2026-08-21
                    "버그3" 세션, AskUserQuestion-confirmed: 비활성화 + 상시 안내
                    문구) for the one way this composer's confirm can be
                    disabled while it's actually my turn: the untouched draft
                    still matches the current bid verbatim. */}
                {isIdenticalToCurrentBid && (
                  // 2026-09-20 버튼 탭 영역 확대 세션: 문구를 짧게 줄임(원래 "동일한
                  // 배팅은 할 수 없습니다. 눈금을 올리거나 수량을 올려주세요." — 확정
                  // 버튼이 비활성화된 이유는 이미 회색으로 드러나므로, 좁은 화면에서
                  // 한 줄에 들어가는 짧은 버전으로도 의미 전달에 지장 없음) —
                  // 위에서 키운 버튼들 몫의 높이를 여기서 되찾아옴.
                  <p className="max-w-[220px] text-center text-[9px] leading-none font-medium text-rose-700 sm:text-[10px] sm:leading-tight">
                    ⚠️ 눈금이나 수량을 올려야 확정할 수 있어요
                  </p>
                )}
              </div>
            )}

            {iAmAlive && (
              // 2026-09-20 버튼 탭 영역 확대 세션 — 바로 위 확정 버튼과 같은 이유,
              // 같은 기법(`min-h-[36px]` + `flex items-center justify-center`).
              <div className="flex gap-1.5 sm:gap-2">
                <button
                  disabled={!isMyTurn || !state.currentBid}
                  onClick={() => onAction({ type: "dudo", seat: viewerSeat })}
                  className="flex min-h-[36px] flex-1 items-center justify-center rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white transition disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30 sm:min-h-0 sm:flex-none sm:px-4 sm:py-2"
                >
                  🚨 페루도!
                </button>
                <button
                  disabled={!state.currentBid}
                  onClick={() => onAction({ type: "calza", seat: viewerSeat })}
                  title="차례와 상관없이 외칠 수 있어요"
                  className="flex min-h-[36px] flex-1 items-center justify-center rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white transition disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30 sm:min-h-0 sm:flex-none sm:px-4 sm:py-2"
                >
                  🎯 맞아!
                </button>
              </div>
            )}
          </div>
        </div>
        </RectBidTrack>
      </div>

      {/* My dice + 색상 변경 — 2026-09-20 세션: 통계 현황판이 있던 이 자리로
          보드 중앙(2026-08-20 사각형 트랙 세션 이후 자리)에서 옮겨옴. 항상
          완전히 공개(컵/뚜껑으로 가리지 않음, 2026-08 페루도 UI 개편) —
          `DiceRollTray`가 매 라운드 짧은 흔들기→정지 애니메이션을 재생한다
          (WebGL 물리 트레이를 대체한 이유는 `dice/PerudoDie.tsx` 파일 헤더
          참고). */}
      <div className="relative z-10 flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 border-amber-900/40 bg-gradient-to-b from-black/25 to-black/35 p-3 shadow-[inset_0_2px_10px_rgba(0,0,0,0.35),0_4px_14px_-6px_rgba(0,0,0,0.6)] light:border-amber-300 light:from-amber-50 light:to-white">
        <div className="flex w-full items-center justify-between px-1">
          <p className="text-[11px] font-semibold text-amber-100/70 light:text-amber-700">🎲 내 주사위 ({me.diceCount}개)</p>
          {colorwayPicker}
        </div>
        {!iAmAlive ? (
          <p className="text-xs text-rose-300/70 light:text-rose-600">탈락했습니다 — 관전 중</p>
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
        <p className="px-1 text-[10px] font-semibold tracking-[0.15em] text-amber-200/50 uppercase light:text-amber-600">🏆 스코어보드</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {seatOrder.map((seat) => {
            const player = state.players.find((p) => p.seat === seat)!;
            const isSelf = seat === viewerSeat;
            const isActive = state.activeSeat === seat && state.phase === "playing";
            const eliminated = player.diceCount <= 0;
            const seatColorway = colorways[seat] ?? playerColorwayForSeat(seat);
            return (
              <div
                key={seat}
                className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 transition ${
                  isActive
                    ? "border-amber-300/60 bg-amber-400/10 light:border-amber-400 light:bg-amber-50"
                    : "border-white/10 bg-black/20 light:border-slate-200 light:bg-white/60"
                } ${eliminated ? "opacity-40" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-white/90 light:text-slate-800">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/30 light:border-slate-300"
                    style={{ backgroundColor: seatColorway.body }}
                    title={`${seatColorway.label} 주사위`}
                  />
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20 light:bg-slate-300"}`}
                  />
                  {isActive && <span title="차례">👉</span>}
                  {eliminated && <span title="탈락">💀</span>}
                  <span className="truncate">{names[seat]}</span>
                  {isSelf && <span className="shrink-0 text-amber-200 light:text-amber-700">(나)</span>}
                </span>
                <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1">
                  {eliminated ? (
                    <span className="text-[11px] text-white/30 light:text-slate-400">탈락</span>
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
  colorways,
}: {
  state: PerudoState;
  names: Record<SeatIndex, string>;
  viewerSeat: SeatIndex;
  colorways: Record<SeatIndex, DiceColorway>;
}) {
  const res = state.lastResolution;
  if (!res) return null;
  return (
    <div className="relative z-10 flex w-full flex-col gap-2">
      {Object.entries(res.revealedDice).map(([seatStr, dice]) => {
        const seat = Number(seatStr);
        return (
          <div key={seat} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2 light:border-slate-200 light:bg-white/70">
            <span className="w-20 shrink-0 truncate text-[11px] text-white/60 light:text-slate-500">
              {names[seat]}
              {seat === viewerSeat && " (나)"}
            </span>
            <div className="flex flex-wrap gap-1">
              {dice.length === 0 ? (
                <span className="text-[11px] text-white/25 light:text-slate-400">주사위 없음</span>
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
                      colorway={colorways[seat] ?? playerColorwayForSeat(seat)}
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
