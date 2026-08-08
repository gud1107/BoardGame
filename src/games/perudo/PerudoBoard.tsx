"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import RulebookModal from "./RulebookModal";
import PerudoFaceIcon from "./PerudoFaceIcon";
import {
  computeRankings,
  isPalafico,
  MAX_PLAYERS,
  minValidQuantityForFace,
  STARTING_DICE,
  totalDiceInPlay,
  type EngineAction,
  type Face,
  type PerudoState,
  type SeatIndex,
} from "./engine";

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

// A dark stone/gunmetal "temple ruins" panel — echoes the physical board
// mat's grey-stone outer bezel (see boardGameRule/Perudo.md's box photo),
// distinct from the other games' navy / wood / purple / felt-green boards.
// The warm gold/jungle palette from that same photo lives inside — see
// BidTrack's wood-tile cells and golden interior plaque below.
const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-black/60 bg-gradient-to-b from-[#2b2f37] via-[#1b1e24] to-[#0c0d10] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)]";

function TableTexture() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.05]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(255,255,255,0.15) 0px, rgba(255,255,255,0.15) 1px, transparent 1px, transparent 10px)",
      }}
    />
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

const SIZE_CLASS = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-9 w-9 text-sm",
  lg: "h-12 w-12 text-base",
} as const;

const PIP_LAYOUT: Record<number, number[]> = {
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/**
 * One face-up die — a rounded, lacquered "physical cube" look modeled on
 * the reference photo: a chunky rounded-square body, a bright top-left
 * gloss highlight streak, and a layered inset shadow for real edge bevel
 * (not a flat color fill). Ivory dice for values 2-6, and the signature
 * red-on-white 페루도 die (gold rim, white skull-mask crest) for face 1.
 */
function DieFace({ value, size = "md", ring }: { value: number; size?: keyof typeof SIZE_CLASS; ring?: "match" | "wild" }) {
  const ringClass =
    ring === "match"
      ? "ring-[3px] ring-amber-300 ring-offset-2 ring-offset-black/30"
      : ring === "wild"
        ? "ring-[3px] ring-violet-300 ring-offset-2 ring-offset-black/30"
        : "ring-1 ring-black/50";
  const isPerudo = value === 1;
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-[10px] border-[3px] font-black ${SIZE_CLASS[size]} ${ringClass} ${
        isPerudo
          ? "border-red-950 bg-gradient-to-br from-red-400 via-red-600 to-red-800 text-white shadow-[inset_0_3px_4px_rgba(255,255,255,0.5),inset_0_-4px_6px_rgba(0,0,0,0.45),0_2px_4px_rgba(0,0,0,0.4)]"
          : "border-neutral-400 bg-gradient-to-br from-white via-neutral-50 to-neutral-200 text-neutral-950 shadow-[inset_0_3px_4px_rgba(255,255,255,0.95),inset_0_-4px_6px_rgba(0,0,0,0.25),0_2px_4px_rgba(0,0,0,0.4)]"
      }`}
      title={isPerudo ? "페루도 (조커)" : `${value}`}
    >
      {/* gloss highlight streak — top-left sheen for a rounded-cube look */}
      <div className="pointer-events-none absolute -top-1/3 -left-1/3 h-2/3 w-2/3 rotate-12 rounded-full bg-white/35 blur-[2px]" />
      {isPerudo ? (
        <PerudoFaceIcon className="relative h-[68%] w-[68%] drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.6)]" />
      ) : (
        <div className="relative grid h-full w-full grid-cols-3 grid-rows-3 gap-[1px] p-1">
          {Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              className={`m-auto h-[26%] w-[26%] rounded-full ${
                PIP_LAYOUT[value]?.includes(i)
                  ? "bg-neutral-950 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),0_1px_1px_rgba(0,0,0,0.35)]"
                  : "bg-transparent"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A hidden opponent die — no pips, just a themed wood/bronze back matching the board's carved-medallion palette. */
function DieBack({ size = "sm" }: { size?: keyof typeof SIZE_CLASS }) {
  return (
    <div
      className={`flex items-center justify-center rounded-md border-2 border-amber-950 bg-gradient-to-br from-amber-700 to-amber-950 text-amber-200/50 shadow-[inset_0_-2px_3px_rgba(0,0,0,0.5)] ${SIZE_CLASS[size]}`}
    >
      🎲
    </div>
  );
}

/** Cup-shake connect: a wooden dice cup jitters (CSS keyframe, see globals.css) while `soundEngine.playDiceRattle` clatters, shown in place of the real dice until the reveal timer in PerudoBoard elapses. */
function ShakingCup() {
  return (
    <div className="flex flex-col items-center gap-1.5 py-1">
      <div className="relative h-16 w-14">
        <div
          className="absolute inset-x-0 bottom-0 h-16 w-full origin-bottom animate-[cup-shake_0.13s_ease-in-out_infinite] rounded-b-xl rounded-t-md border-2 border-black/50 bg-gradient-to-b from-amber-700 to-amber-950 shadow-lg"
          style={{ clipPath: "polygon(12% 0%, 88% 0%, 100% 100%, 0% 100%)" }}
        />
      </div>
      <p className="animate-pulse text-[11px] text-amber-200/70">🥃 컵을 흔드는 중...</p>
    </div>
  );
}

function FacePicker({
  selected,
  onSelect,
  disabledFaces,
}: {
  selected: Face;
  onSelect: (face: Face) => void;
  disabledFaces: Set<Face>;
}) {
  const faces: Face[] = [1, 2, 3, 4, 5, 6];
  return (
    <div className="flex gap-1.5">
      {faces.map((face) => {
        const disabled = disabledFaces.has(face);
        return (
          <button
            key={face}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(face)}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border-2 text-sm font-bold transition ${
              selected === face
                ? "border-amber-200 bg-gradient-to-b from-amber-300 to-amber-500 text-neutral-900 shadow-[0_0_0_2px_rgba(251,191,36,0.35)]"
                : "border-white/15 bg-black/20 text-white/60 hover:border-white/30"
            } ${disabled ? "cursor-not-allowed opacity-30" : ""}`}
            title={face === 1 ? "페루도 (조커)" : `숫자 ${face}`}
          >
            {face === 1 ? <PerudoFaceIcon className="mx-auto h-5 w-5" /> : face}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bid track — a perimeter loop of clickable quantity cells wrapping the
// central play area, echoing the physical board's numbered outer track (see
// boardGameRule/Perudo.md's box photo). TRACK_LENGTH = MAX_PLAYERS *
// STARTING_DICE, the highest a bid quantity could ever meaningfully reach
// (every die that could ever be in play at once). The grid dimensions are
// *derived* from that length (not hand-solved magic numbers) so the track
// never silently mismatches again if MAX_PLAYERS/STARTING_DICE change —
// exactly the kind of drift that bit the earlier hardcoded 9x8/30 version
// the moment MAX_PLAYERS grew from 6 to 8.
// ---------------------------------------------------------------------------
const TRACK_LENGTH = MAX_PLAYERS * STARTING_DICE;

/**
 * A rectangular grid's border cell count is `2*cols + 2*rows - 4`, so
 * `cols + rows = length/2 + 2`. Splits that sum as evenly as possible for a
 * roughly square/landscape track. `length` must be even (border counts
 * always are) — true for every MAX_PLAYERS this project has ever shipped
 * (MAX_PLAYERS * STARTING_DICE with STARTING_DICE=5 is even iff MAX_PLAYERS
 * is even, which it has always been).
 */
function computeTrackDimensions(length: number): { cols: number; rows: number } {
  if (length % 2 !== 0 || length < 8) {
    throw new Error(`Perudo bid track length must be an even number >= 8, got ${length}`);
  }
  const sum = length / 2 + 2;
  const rows = Math.floor(sum / 2);
  const cols = sum - rows;
  return { cols, rows };
}
const { cols: TRACK_COLS, rows: TRACK_ROWS } = computeTrackDimensions(TRACK_LENGTH);

interface TrackCell {
  quantity: number;
  col: number;
  row: number;
}

function buildTrackCells(): TrackCell[] {
  const cells: TrackCell[] = [];
  let q = 1;
  for (let col = 1; col <= TRACK_COLS; col++) cells.push({ quantity: q++, col, row: 1 }); // top, left->right
  for (let row = 2; row <= TRACK_ROWS; row++) cells.push({ quantity: q++, col: TRACK_COLS, row }); // right, top->bottom
  for (let col = TRACK_COLS - 1; col >= 1; col--) cells.push({ quantity: q++, col, row: TRACK_ROWS }); // bottom, right->left
  for (let row = TRACK_ROWS - 1; row >= 2; row--) cells.push({ quantity: q++, col: 1, row }); // left, bottom->top
  return cells;
}
const TRACK_CELLS: TrackCell[] = buildTrackCells();
if (TRACK_CELLS.length !== TRACK_LENGTH) {
  // Backstop only — computeTrackDimensions derives TRACK_COLS/TRACK_ROWS
  // from TRACK_LENGTH by construction, so this should never actually trip.
  throw new Error(`Perudo bid track expected ${TRACK_LENGTH} cells, got ${TRACK_CELLS.length}`);
}

/**
 * Direct-click betting surface (rulebook UX request #2): clicking a
 * quantity cell immediately raises to `{ quantity: cell, face: selectedFace }`.
 * Cells that wouldn't be a legal raise over the current bid (per
 * `minValidQuantityForFace`) render disabled — "이전 베팅 이하의 칸은 클릭 불가".
 * The interior of the loop hosts the rest of the round UI via `children`.
 */
function BidTrack({
  state,
  isMyTurn,
  selectedFace,
  palafico,
  onPick,
  children,
}: {
  state: PerudoState;
  isMyTurn: boolean;
  selectedFace: Face;
  palafico: boolean;
  onPick: (quantity: number) => void;
  children: ReactNode;
}) {
  const minQty = minValidQuantityForFace(state.currentBid, selectedFace, palafico);
  return (
    // Outer "stone bezel" frame, echoing the physical mat's grey-stone
    // border around the wood tile track.
    <div className="relative rounded-[1.5rem] border-4 border-neutral-700 bg-gradient-to-b from-neutral-800 via-neutral-900 to-black p-1.5 shadow-[inset_0_2px_8px_rgba(0,0,0,0.7)] sm:p-2">
      <div
        className="relative mx-auto grid w-full max-w-xl gap-[3px]"
        style={{
          gridTemplateColumns: `repeat(${TRACK_COLS}, 1fr)`,
          gridTemplateRows: `repeat(${TRACK_ROWS}, minmax(1.85rem, 1fr))`,
          aspectRatio: `${TRACK_COLS} / ${TRACK_ROWS}`,
        }}
      >
        {TRACK_CELLS.map((cell) => {
          const enabled = isMyTurn && minQty !== null && cell.quantity >= minQty;
          const isCurrentBidCell = state.currentBid?.quantity === cell.quantity && state.currentBid.face === selectedFace;
          const isStart = cell.quantity === 1;
          // Every 4th wood tile gets a faint carved sun-mask watermark,
          // echoing the board mat's alternating number/medallion tiles
          // without sacrificing any of the 1..TRACK_LENGTH clickable range.
          const showMedallion = cell.quantity % 4 === 0;
          return (
            <button
              key={cell.quantity}
              type="button"
              disabled={!enabled}
              onClick={() => onPick(cell.quantity)}
              style={{ gridColumn: `${cell.col}`, gridRow: `${cell.row}` }}
              className={`relative flex items-center justify-center overflow-hidden rounded-[4px] border-2 text-[10px] font-bold transition sm:text-xs ${
                isCurrentBidCell
                  ? "border-amber-200 bg-gradient-to-b from-amber-300 to-amber-500 text-neutral-900 shadow-[0_0_0_2px_rgba(251,191,36,0.5)]"
                  : enabled
                    ? "cursor-pointer border-amber-950/70 bg-gradient-to-b from-amber-700 to-amber-900 text-amber-100 hover:from-amber-600 hover:to-amber-800"
                    : "cursor-not-allowed border-black/40 bg-gradient-to-b from-neutral-800 to-neutral-900 text-white/25"
              }`}
              title={
                !isMyTurn
                  ? "지금은 당신의 차례가 아니에요"
                  : enabled
                    ? `${faceLabel(selectedFace)} ${cell.quantity}개 이상 선언하기`
                    : "지금 선택한 눈금으로는 여기를 선언할 수 없어요"
              }
            >
              {showMedallion && <PerudoFaceIcon className="pointer-events-none absolute inset-0 m-auto h-2/3 w-2/3 text-black/25" />}
              <span className="relative z-10">{cell.quantity}</span>
              {isStart && <span className="absolute -top-0.5 -right-0.5 text-[8px] leading-none">🎲</span>}
            </button>
          );
        })}
        {/* Golden interior plaque — echoes the mat's central "PERUDO" plaque. */}
        <div
          style={{ gridColumn: `2 / ${TRACK_COLS}`, gridRow: `2 / ${TRACK_ROWS}` }}
          className="flex flex-col items-center justify-center gap-2 rounded-[1.25rem] border-4 border-amber-800 bg-gradient-to-br from-amber-100 via-yellow-200 to-amber-300 p-2 text-neutral-900 shadow-[inset_0_2px_10px_rgba(0,0,0,0.18)]"
        >
          {children}
        </div>
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
  const palafico = isPalafico(state);
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const isMyTurn = state.activeSeat === viewerSeat && state.phase === "playing";
  const iAmAlive = me.diceCount > 0;

  const [selectedFace, setSelectedFace] = useState<Face>(state.currentBid?.face ?? 2);
  const effectiveFace: Face = palafico && state.currentBid ? state.currentBid.face : selectedFace;
  function pickFace(face: Face) {
    setSelectedFace(face);
  }

  const disabledFaces = new Set<Face>();
  if (palafico && state.currentBid) {
    for (const f of [1, 2, 3, 4, 5, 6] as Face[]) if (f !== state.currentBid.face) disabledFaces.add(f);
  }

  // -------------------------------------------------------------------------
  // Cup shake -> reveal (rulebook UX request #3): every time a new round's
  // dice are rolled (roundNumber changes, including the very first mount),
  // hide the real pip values behind a shaking-cup animation + rattle SFX for
  // a beat, then "flip the cup" (thud SFX) to reveal them. Purely a local
  // cosmetic delay — the real values already sit in `state`, synced via the
  // same lockstep broadcast as everything else; nothing about the network
  // waits on this timer.
  // -------------------------------------------------------------------------
  const [revealing, setRevealing] = useState(true);
  // Render-time state adjustment (same "adjust state when a prop changes"
  // pattern as NoThanksBoard's `trackedState`) rather than an effect that
  // calls setState synchronously as its first act — `revealedRound` just
  // remembers which round we've already kicked the shake off for, so this
  // block fires exactly once per `roundNumber` change (including mount).
  const [revealedRound, setRevealedRound] = useState<number | null>(null);
  if (revealedRound !== state.roundNumber) {
    setRevealedRound(state.roundNumber);
    setRevealing(true);
  }
  useEffect(() => {
    if (!revealing) return;
    const engine = getSoundEngine();
    engine.unlock(); // best-effort — a user gesture already happened earlier in the room lobby
    engine.playDiceRattle(750);
    const timeout = setTimeout(() => {
      setRevealing(false);
      engine.playCupThud();
    }, 800);
    return () => clearTimeout(timeout);
  }, [revealing]);

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

  // -------------------------------------------------------------------------
  // Game over
  // -------------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    return (
      <div className={`${TABLE_PANEL} flex flex-col items-center gap-4 p-4 text-center sm:p-8`}>
        <TableTexture />
        <TotalDiceBanner state={state} />
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

        {state.lastResolution && <RevealPanel state={state} names={names} viewerSeat={viewerSeat} />}

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
    const success = res.kind === "dudo" ? res.affectedSeat !== res.actorSeat : res.diceDelta === 1;
    return (
      <div className={`${TABLE_PANEL} flex flex-col gap-3 p-3 sm:p-4`}>
        <TableTexture />
        <TotalDiceBanner state={state} />
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
            {res.wasPalafico && <span className="ml-1 text-rose-300">(팔라피코 — 조커 없음)</span>}
          </p>
          <p className={`mt-2 text-sm font-bold ${success ? "text-emerald-300" : "text-rose-300"}`}>
            {res.kind === "dudo"
              ? res.affectedSeat === res.bid.seat
                ? `📉 선언이 틀렸습니다 — ${names[res.bid.seat]}님이 주사위 1개를 잃었습니다.`
                : `📈 선언이 맞았습니다 — ${names[res.actorSeat]}님이 주사위 1개를 잃었습니다.`
              : res.diceDelta === 1
                ? `🎉 정확히 맞췄습니다! ${names[res.actorSeat]}님이 주사위 1개를 되찾았습니다.`
                : `❌ 틀렸습니다 — ${names[res.actorSeat]}님이 주사위 1개를 잃었습니다.`}
          </p>
        </div>

        <RevealPanel state={state} names={names} viewerSeat={viewerSeat} />

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
          {palafico && (
            <span
              title="선(先) 플레이어가 주사위 1개만 남아 팔라피코 라운드입니다: 조커 없음, 선언한 숫자 고정, 맞아! 불가"
              className="rounded-full border border-rose-300/40 px-1.5 py-0.5 text-[10px] text-rose-200"
            >
              ⚠️ 팔라피코
            </span>
          )}
        </span>
        <div className="flex gap-1.5">
          {muteButton}
          {rulebookButton}
        </div>
      </div>

      <p className={`relative z-10 text-center text-xs font-medium ${isMyTurn ? "text-amber-200" : "text-white/50"}`}>
        {isMyTurn ? "🫵 당신 차례입니다!" : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
      </p>

      <div className="relative z-10 flex flex-col items-center gap-1.5">
        <p className="text-[11px] text-white/50">선언할 눈금 선택 (아래 트랙에서 개수를 눌러 선언)</p>
        <FacePicker selected={effectiveFace} onSelect={pickFace} disabledFaces={disabledFaces} />
      </div>

      <div className="relative z-10">
        <BidTrack
          state={state}
          isMyTurn={isMyTurn}
          selectedFace={effectiveFace}
          palafico={palafico}
          onPick={(quantity) => onAction({ type: "raise", seat: viewerSeat, quantity, face: effectiveFace })}
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
                disabled={palafico || !state.currentBid}
                onClick={() => onAction({ type: "calza", seat: viewerSeat })}
                title="차례와 상관없이 외칠 수 있어요"
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-[11px] font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/30 sm:px-4 sm:py-2 sm:text-xs"
              >
                🎯 맞아!
              </button>
            </div>
          )}
          {palafico && <p className="text-center text-[10px] font-semibold text-rose-800">팔라피코 라운드: &quot;맞아!&quot; 불가</p>}
        </BidTrack>
      </div>

      {/* Stats dashboard — right below the 페루도!/맞아! action buttons above. */}
      <MyDiceStatsPanel state={state} myDice={me.dice} />

      {/* My dice — hidden behind a shaking cup for a beat after each reroll, then revealed. */}
      <div className="relative z-10 flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-black/20 p-3">
        <p className="text-[11px] text-white/50">내 주사위 ({me.diceCount}개)</p>
        {revealing ? (
          <ShakingCup />
        ) : (
          <div className="flex flex-wrap justify-center gap-1.5 [animation:dice-reveal-pop_0.35s_ease-out]">
            {me.dice.map((d, i) => {
              const matchesBid = state.currentBid ? d === state.currentBid.face : false;
              const isWild = !palafico && state.currentBid && state.currentBid.face !== 1 && d === 1;
              return <DieFace key={i} value={d} size="lg" ring={matchesBid ? "match" : isWild ? "wild" : undefined} />;
            })}
            {!iAmAlive && <p className="text-xs text-rose-300/70">탈락했습니다 — 관전 중</p>}
          </div>
        )}
      </div>

      {/* Player strip — a responsive grid (not a single flex column) so it
          stays readable up to the full 8-player table instead of forcing a
          tall single-file scroll; wraps to 2 columns once there's room. */}
      <div className="relative z-10 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {seatOrder.map((seat) => {
          const player = state.players.find((p) => p.seat === seat)!;
          const isSelf = seat === viewerSeat;
          const isActive = state.activeSeat === seat && state.phase === "playing";
          const eliminated = player.diceCount <= 0;
          return (
            <div
              key={seat}
              className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 transition ${
                isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/20"
              } ${eliminated ? "opacity-40" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-white/90">
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
                  Array.from({ length: player.diceCount }, (_, i) => <DieBack key={i} />)
                )}
              </div>
            </div>
          );
        })}
      </div>

      {rulebookOpen && <RulebookModal onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}

/** Full-table dice reveal shown during "reveal"/"gameOver", highlighting whichever dice counted toward the resolved bid. */
function RevealPanel({ state, names, viewerSeat }: { state: PerudoState; names: Record<SeatIndex, string>; viewerSeat: SeatIndex }) {
  const res = state.lastResolution;
  if (!res) return null;
  const wild = !res.wasPalafico;
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
                  const isWild = wild && res.bid.face !== 1 && d === 1;
                  return <DieFace key={i} value={d} size="sm" ring={matches ? "match" : isWild ? "wild" : undefined} />;
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
