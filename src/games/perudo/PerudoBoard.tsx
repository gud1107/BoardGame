"use client";

import { useEffect, useRef, useState } from "react";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import { useAudioSettingsStore } from "@/lib/audio/audioSettings";
import MyTurnOverlay from "@/components/common/MyTurnOverlay";
import RulebookModal from "./RulebookModal";
import PerudoMobileBoard from "./PerudoMobileBoard";
import { useIsMobile } from "./useIsMobile";
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
    <div className="relative z-10 flex items-center justify-center gap-2 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-1.5 text-center">
      <span className="text-base">🎲</span>
      <span className="text-sm font-bold text-amber-100">
        현재 전체 주사위: {totalDiceInPlay(state)}개
      </span>
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

  // 2026-09-08 모바일 화이트 오버스크롤 차단 세션: which of the two layout
  // trees below actually mounts (`PerudoMobileBoard`'s right-sidebar/
  // zero-scroll redesign vs. this file's own existing rect-track layout,
  // AskUserQuestion-confirmed: 모바일 전용, 데스크톱은 기존 유지).
  const isMobile = useIsMobile();

  // White-overscroll-bounce lockdown (요구사항 1) — scoped to this
  // component's mount, restored on unmount, same pattern as
  // `WormCanvas.tsx`'s own gesture lock (see that file's doc comment).
  // Applied regardless of phase/layout branch below (game-over and reveal
  // screens can bounce just as easily as the playing screen can), not
  // gated on `isMobile` either — harmless on desktop, and `matchMedia`
  // already only ever fires the *visual* mobile layout switch above.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverscroll = html.style.overscrollBehavior;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    const prevBodyBackground = body.style.backgroundColor;
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
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
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
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
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
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

  // Mobile: entirely different layout tree — 2026-09-09 세션: Section 1
  // (measured-height zero-scroll betting arena) + Section 2 (scroll-down
  // player roster/color picker, replacing the prior toggle drawer) — see
  // `PerudoMobileBoard.tsx`'s own file header for the full rationale.
  // Desktop/tablet keeps the existing rect-track board below, unchanged
  // (AskUserQuestion-confirmed scope). All state/handlers stay owned by
  // THIS component either way — `PerudoMobileBoard` is presentation-only.
  if (isMobile) {
    return (
      <PerudoMobileBoard
        state={state}
        viewerSeat={viewerSeat}
        names={names}
        connectedSeats={connectedSeats}
        colorways={colorways}
        myColorway={myColorway}
        onColorwayChange={onColorwayChange}
        onAction={onAction}
        isMyTurn={isMyTurn}
        iAmAlive={iAmAlive}
        me={me}
        pendingFace={pendingFace}
        pendingQuantity={pendingQuantity}
        pendingFloor={pendingFloor}
        canConfirmBet={canConfirmBet}
        isIdenticalToCurrentBid={isIdenticalToCurrentBid}
        pickFace={pickFace}
        stepQuantity={stepQuantity}
        currentCell={currentCell}
        pendingCell={pendingCell}
        laneOffset={laneOffset}
        cellEnabled={cellEnabled}
        onCellClick={selectCell}
        showBettingMarker={showBettingMarker}
        currentOverflows={currentOverflows}
        pendingOverflows={pendingOverflows}
        muteButton={muteButton}
        rulebookButton={rulebookButton}
        rulebookOpen={rulebookOpen}
        onCloseRulebook={() => setRulebookOpen(false)}
      />
    );
  }

  return (
    <div className={`${TABLE_PANEL} flex flex-col gap-3 p-3 sm:p-4`}>
      <MyTurnOverlay isMyTurn={isMyTurn && iAmAlive} />
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

      {/* 턴 배너 — 하단 상태 텍스트는 이제 조용한 안내문 고정(한 번 튀는
          애니메이션은 위 <MyTurnOverlay>의 중앙 팝업이 전담, 2026-09-05
          세션). */}
      <p className={`relative z-10 text-center text-sm font-bold break-keep ${isMyTurn ? "text-amber-200" : "text-xs font-medium text-white/50"}`}>
        {isMyTurn ? "🫵 당신 차례입니다!" : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
      </p>

      {/* The rectangular board itself (2026-08-20 사각형 트랙 세션) — quantities
          1-20 around 4 sides (see `RectBidTrack`'s doc comment), sized to
          hold the dice graveyard, the bid/액션 panel, and the viewer's own
          dice all inside its hollow center per user request, so the whole
          thing reads as one big physical-board-sized panel rather than a
          thin strip with everything else stacked below it.

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
          {/* `p-1.5 sm:p-2.5` moved here from `RectBidTrack`'s center grid
              cell (2026-09-07 모바일 가로 스크롤 제거 세션) — this div's own
              `maxWidth` is a real cap on ITS box (border-box), so padding
              added here shrinks its usable inner width instead of adding
              onto the outer size the way padding on the ungapped grid cell
              outside it did. See `RectBidTrack`'s call site comment. */}
          <div className="flex w-full flex-col items-center gap-2.5 p-1.5 sm:p-2.5" style={{ maxWidth: stripLength(7) }}>
          {/* Capped to the exact same width as the north/south strips
              (2026-08-21 간격 정돈 세션) — otherwise this panel's natural
              width could force the board's center grid column wider than
              the strips sitting right above/below it, reopening the same
              gap-inflation bug this session fixed. `DiceRollTray` already
              `flex-wrap`s, so an unusually large dice hand just wraps to an
              extra row here instead. */}
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

          <LostDiceTray state={state} colorways={colorways} />

          {/* Bid-declaration controls — the confirmed bid, plus (on my turn) the
              FacePicker + quantity stepper composer. Both the composer's
              "확정" button and every track cell around this panel ultimately
              gate on the same `validateRaise` call, so a same-quantity face
              raise (예: "2가 1개" → "3이 1개") is never blocked by one path
              while allowed by the other. */}
          <div
            ref={bidActionZoneRef}
            className="relative z-10 flex w-full flex-col items-center justify-center gap-2 rounded-[1.25rem] border-4 border-amber-800 bg-amber-100/90 p-2 text-neutral-900 shadow-[inset_0_2px_10px_rgba(0,0,0,0.18)]"
          >
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
              // 2026-09-07 모바일 가로 스크롤 제거 세션: `px-2.5` → `px-1.5` and the
              // stepper's `h-8 w-8`/`gap-2.5` → `h-7 w-7`/`gap-1.5` — same reason
              // as `FacePicker`'s own comment, just with a smaller margin needed
              // (this row was never as tight as the 6-button face row).
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
      </div>

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
            const seatColorway = colorways[seat] ?? playerColorwayForSeat(seat);
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
