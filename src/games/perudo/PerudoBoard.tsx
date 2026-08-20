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
  validateRaise,
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
// that used to sit dimmed behind the (now-removed, see below) rectangular
// `BidTrack` as a backdrop texture was removed on user request (readability
// + "clean solid/theme background" ask) — the warm gold/jungle palette it
// inspired still lives on in this panel's own gradient.
const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-black/60 bg-gradient-to-b from-[#2a1c14] via-[#1d130d] to-[#0d0805] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)]";

/** Andean-textile stripe band (terracotta/mustard/teal/cream/maroon) — used as the mat's top/bottom trim in `TableTexture`. */
const FABRIC_TRIM_GRADIENT =
  "repeating-linear-gradient(90deg, #b5482f 0 14px, #d9a441 14px 28px, #1f6f6f 28px 42px, #e8d9b5 42px 56px, #7a1f2b 56px 70px)";

/** The fabric mat's texture layer: a woven crosshatch across the whole panel plus a colorful trim band along the top/bottom edges, standing in for a real South American textile mat under the board. */
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
// Bid composer (2026-08-20 보드 트랙 하우스룰 폐지 세션) — the 2026-08-19
// clickable rectangular board-track UI (`BidTrack`/`TrackCellButton`/
// `DirectionArrow`/the 37-cell `BOARD_TRACK_SEQUENCE` layout) has been
// removed entirely along with the house-rule track index it was built on
// (see engine.ts's own module doc for why). It's replaced by a plain
// quantity-stepper + face-picker composer, driven directly by the engine's
// restored official-rulebook `validateRaise`/`minValidQuantityForFace`
// formulas — no board-position concept left to keep in sync with the
// declared bid text, which is what caused the mismatch reported in
// `boardGameRule/페루도/버그.png`/`버그결과.png` in the first place.
// ---------------------------------------------------------------------------

/**
 * The purple "betting die" preview — a small non-interactive glyph showing
 * the face currently selected in the composer below, echoing the game's own
 * "move a purple piece" visual language without being tied to any board
 * cell (there's no board track anymore — see the module note above). Always
 * the fixed purple colorway, unrelated to any one player.
 */
function BettingDiePreview({ face }: { face: Face }) {
  return <PerudoDie value={face} size="md" colorway={BETTING_COLORWAY} title={`선택된 눈금: ${faceLabel(face)}`} />;
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
  // `state.currentBid` every time it actually changes (new round, or
  // anyone's opening bid/raise) using a render-time "adjust state when a
  // prop changes" pattern (same idea `syncedBidKey` uses on itself), rather
  // than an effect that would flash a stale draft for a frame. 2026-08-20
  // board-track house-rule removal (see engine.ts's module doc): there is no
  // board position to sit the draft on anymore — the draft is just a plain
  // `{ pendingQuantity, pendingFace }` pair, validated straight against the
  // engine's restored official-rulebook `validateRaise` formulas. Default
  // draft on a fresh bid: same face as the current bid (if any) at the
  // smallest quantity that's actually a legal raise over it — i.e. the
  // cheapest possible next bid, which the player can then adjust upward.
  // -------------------------------------------------------------------------
  const bidKey = `${state.roundNumber}:${state.currentBid ? `${state.currentBid.seat}-${state.currentBid.quantity}-${state.currentBid.face}` : "none"}`;
  const [syncedBidKey, setSyncedBidKey] = useState<string | null>(null);
  const [pendingFace, setPendingFace] = useState<Face>(2);
  const [pendingQuantity, setPendingQuantity] = useState<number>(1);
  if (syncedBidKey !== bidKey) {
    setSyncedBidKey(bidKey);
    const defaultFace = state.currentBid?.face ?? 2;
    setPendingFace(defaultFace);
    setPendingQuantity(minValidQuantityForFace(state.currentBid, defaultFace) ?? 1);
  }
  /** The smallest quantity that's still a legal raise for `pendingFace` right now — the stepper's floor. */
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

  const canConfirmBet = isMyTurn && iAmAlive && validateRaise(state.currentBid, { quantity: pendingQuantity, face: pendingFace });

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

      <LostDiceTray state={state} viewerSeat={viewerSeat} myColorway={myColorway} />

      {/* Bid-declaration card (2026-08-20 보드 트랙 폐지 세션: the old
          rectangular `BidTrack` used to live here — see engine.ts's module
          doc for why it was removed entirely). Shows the actual committed
          bid exactly as the engine holds it (no board position to fall out
          of sync with anymore), plus a plain quantity-stepper + face-picker
          composer for the viewer's own turn. */}
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
              🟣 눈금을 고르고 개수를 정해 새 선언을 만드세요
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
              <BettingDiePreview face={pendingFace} />
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
