"use client";

import { useState } from "react";
import RulebookModal from "./RulebookModal";
import {
  computeRankings,
  isPalafico,
  minValidQuantityForFace,
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

// A deep crimson "leather dice table" panel — distinct from the other
// games' navy / wood / purple / felt-green boards.
const TABLE_PANEL =
  "relative overflow-hidden rounded-3xl border border-black/50 bg-gradient-to-b from-[#3a0f14] via-[#240a0d] to-[#130506] shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)]";

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
  return face === 1 ? "💀 파코" : `${face}`;
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

/** One face-up die — a skull for 파코(1), otherwise a standard pip layout. */
function DieFace({ value, size = "md", ring }: { value: number; size?: keyof typeof SIZE_CLASS; ring?: "match" | "wild" }) {
  const ringClass =
    ring === "match"
      ? "ring-2 ring-amber-300"
      : ring === "wild"
        ? "ring-2 ring-violet-300"
        : "ring-1 ring-black/30";
  return (
    <div
      className={`flex items-center justify-center rounded-md border border-white/40 bg-gradient-to-b from-white to-neutral-200 font-black text-neutral-900 shadow ${SIZE_CLASS[size]} ${ringClass}`}
      title={value === 1 ? "파코 (조커)" : `${value}`}
    >
      {value === 1 ? (
        <span aria-hidden>💀</span>
      ) : (
        <div className="grid h-full w-full grid-cols-3 grid-rows-3 gap-[1px] p-1">
          {Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              className={`m-auto h-[22%] w-[22%] rounded-full ${PIP_LAYOUT[value]?.includes(i) ? "bg-neutral-900" : "bg-transparent"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A hidden opponent die — no pips, just a themed back. */
function DieBack({ size = "sm" }: { size?: keyof typeof SIZE_CLASS }) {
  return (
    <div
      className={`flex items-center justify-center rounded-md border border-black/40 bg-gradient-to-br from-rose-900 to-rose-950 text-rose-300/50 ${SIZE_CLASS[size]}`}
    >
      🎲
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
            className={`flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-bold transition ${
              selected === face
                ? "border-amber-300 bg-amber-400/20 text-amber-100"
                : "border-white/15 text-white/60 hover:border-white/30"
            } ${disabled ? "cursor-not-allowed opacity-30" : ""}`}
            title={face === 1 ? "파코 (조커)" : `숫자 ${face}`}
          >
            {face === 1 ? "💀" : face}
          </button>
        );
      })}
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
  const minQuantity = minValidQuantityForFace(state.currentBid, effectiveFace, palafico) ?? 1;
  const [quantityOverride, setQuantityOverride] = useState<number | null>(null);
  const quantity = Math.max(minQuantity, quantityOverride ?? minQuantity);

  function pickFace(face: Face) {
    setSelectedFace(face);
    setQuantityOverride(null);
  }

  const disabledFaces = new Set<Face>();
  if (palafico && state.currentBid) {
    for (const f of [1, 2, 3, 4, 5, 6] as Face[]) if (f !== state.currentBid.face) disabledFaces.add(f);
  }

  const rulebookButton = (
    <button
      onClick={() => setRulebookOpen(true)}
      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white"
    >
      📖 페루도 룰북
    </button>
  );

  // ---------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------
  if (state.phase === "gameOver") {
    const rankings = computeRankings(state);
    return (
      <div className={`${TABLE_PANEL} flex flex-col items-center gap-5 p-4 text-center sm:p-8`}>
        <TableTexture />
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

        {state.lastResolution && (
          <RevealPanel state={state} names={names} viewerSeat={viewerSeat} />
        )}

        <button
          onClick={onGameEnd}
          className="relative z-10 rounded-full bg-amber-500 px-8 py-3 font-medium text-black transition hover:bg-amber-400"
        >
          결과 확정하고 계속하기
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Reveal (between rounds)
  // ---------------------------------------------------------------------
  if (state.phase === "reveal" && state.lastResolution) {
    const res = state.lastResolution;
    const success =
      res.kind === "dudo" ? res.affectedSeat !== res.actorSeat : res.diceDelta === 1;
    return (
      <div className={`${TABLE_PANEL} flex flex-col gap-4 p-3 sm:p-4`}>
        <TableTexture />
        <div className="relative z-10 flex items-center justify-between text-xs text-rose-100/60">
          <span>{state.playerCount}인 · {state.roundNumber}라운드 결과</span>
          {rulebookButton}
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

  // ---------------------------------------------------------------------
  // Playing
  // ---------------------------------------------------------------------
  const wild = !palafico;
  const seatOrder = Array.from({ length: state.playerCount }, (_, i) => i);

  return (
    <div className={`${TABLE_PANEL} flex flex-col gap-3 p-3 sm:p-4`}>
      <TableTexture />
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-1.5 text-xs text-rose-100/60">
        <span className="flex items-center gap-1.5">
          {state.playerCount}인 · {state.roundNumber}라운드 · 총 주사위 {totalDiceInPlay(state)}개
          {palafico && (
            <span
              title="선(先) 플레이어가 주사위 1개만 남아 팔라피코 라운드입니다: 조커 없음, 선언한 숫자 고정, 맞아! 불가"
              className="rounded-full border border-rose-300/40 px-1.5 py-0.5 text-[10px] text-rose-200"
            >
              ⚠️ 팔라피코
            </span>
          )}
        </span>
        {rulebookButton}
      </div>

      {/* Current bid */}
      <div className="relative z-10 flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-black/30 p-4 sm:p-5">
        <p className={`text-xs font-medium ${isMyTurn ? "text-amber-200" : "text-white/50"}`}>
          {isMyTurn ? "🫵 당신 차례입니다!" : `${names[state.activeSeat]}님 차례를 기다리는 중...`}
        </p>
        {state.currentBid ? (
          <div className="flex items-center gap-3 text-center">
            <span className="text-xs text-white/50">{names[state.currentBid.seat]}님의 선언</span>
            <span className="text-3xl font-black text-amber-100">
              {faceLabel(state.currentBid.face)} × {state.currentBid.quantity}개↑
            </span>
          </div>
        ) : (
          <p className="text-sm text-white/50">{names[state.activeSeat]}님이 이번 라운드를 엽니다 — 첫 선언 대기 중</p>
        )}
      </div>

      {/* My dice */}
      <div className="relative z-10 flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-black/20 p-3">
        <p className="text-[11px] text-white/50">내 주사위 ({me.diceCount}개)</p>
        <div className="flex flex-wrap justify-center gap-1.5">
          {me.dice.map((d, i) => {
            const matchesBid = state.currentBid ? d === state.currentBid.face : false;
            const isWild = wild && state.currentBid && state.currentBid.face !== 1 && d === 1;
            return <DieFace key={i} value={d} size="lg" ring={matchesBid ? "match" : isWild ? "wild" : undefined} />;
          })}
          {!iAmAlive && <p className="text-xs text-rose-300/70">탈락했습니다 — 관전 중</p>}
        </div>
      </div>

      {/* Actions */}
      {iAmAlive && (
        <div className="relative z-10 flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
          {isMyTurn && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] text-white/50">선언 올리기</p>
              <FacePicker selected={effectiveFace} onSelect={pickFace} disabledFaces={disabledFaces} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantityOverride(Math.max(minQuantity, quantity - 1))}
                  className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
                >
                  −
                </button>
                <span className="w-10 text-center text-lg font-semibold text-white">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantityOverride(quantity + 1)}
                  className="h-8 w-8 rounded-full border border-white/15 text-white/80 hover:border-white/30"
                >
                  +
                </button>
                <span className="text-[11px] text-white/40">(최소 {minQuantity}개)</span>
              </div>
              <button
                onClick={() => onAction({ type: "raise", seat: viewerSeat, quantity, face: effectiveFace })}
                className="rounded-xl bg-amber-600 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-500"
              >
                📢 {faceLabel(effectiveFace)} {quantity}개 이상! 선언하기
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <button
              disabled={!isMyTurn || !state.currentBid}
              onClick={() => onAction({ type: "dudo", seat: viewerSeat })}
              className="flex-1 rounded-xl bg-rose-700 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
            >
              🚨 페루도! (의심)
            </button>
            <button
              disabled={palafico || !state.currentBid}
              onClick={() => onAction({ type: "calza", seat: viewerSeat })}
              title="차례와 상관없이 외칠 수 있어요"
              className="flex-1 rounded-xl bg-emerald-700 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
            >
              🎯 맞아! (정확히 일치)
            </button>
          </div>
          {palafico && <p className="text-center text-[11px] text-rose-300/80">팔라피코 라운드에서는 &quot;맞아!&quot;를 외칠 수 없어요.</p>}
        </div>
      )}

      {/* Player strip */}
      <div className="relative z-10 flex flex-col gap-2">
        {seatOrder.map((seat) => {
          const player = state.players.find((p) => p.seat === seat)!;
          const isSelf = seat === viewerSeat;
          const isActive = state.activeSeat === seat && state.phase === "playing";
          const eliminated = player.diceCount <= 0;
          return (
            <div
              key={seat}
              className={`flex items-center justify-between rounded-xl border p-2.5 transition ${
                isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/20"
              } ${eliminated ? "opacity-40" : ""}`}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold text-white/90">
                <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(seat) ? "bg-emerald-400" : "bg-white/20"}`} />
                {isActive && <span title="차례">👉</span>}
                {eliminated && <span title="탈락">💀</span>}
                {names[seat]}
                {isSelf && <span className="text-amber-200">(나)</span>}
              </span>
              <div className="flex items-center gap-1">
                {eliminated ? (
                  <span className="text-[11px] text-white/30">탈락</span>
                ) : (
                  <>
                    {Array.from({ length: player.diceCount }, (_, i) => (
                      <DieBack key={i} />
                    ))}
                  </>
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
