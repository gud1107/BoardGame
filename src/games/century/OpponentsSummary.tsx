import { CartInventory } from "./boardChrome";
import { HAND_LIMIT, type PlayerState, type SeatIndex } from "./engine";

function PlayerSummaryRow({
  player,
  name,
  isActive,
  connected,
  setRef,
}: {
  player: PlayerState;
  name: string;
  isActive: boolean;
  connected: boolean;
  setRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={setRef}
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2 text-xs ${
        isActive ? "border-amber-300/60 bg-amber-400/10" : "border-white/10 bg-black/20"
      }`}
    >
      <span className="flex items-center gap-1.5 font-semibold text-white/90">
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-white/20"}`} />
        {isActive && <span title="차례">👉</span>}
        {name}
      </span>
      <div className="flex flex-wrap items-center gap-2 text-white/70">
        <CartInventory resources={player.resources} limit={HAND_LIMIT} compact />
        <span>🪙{player.gold}</span>
        <span>🥈{player.silver}</span>
        <span>🏆{player.pointCards.length}</span>
        <span title="손패">✋{player.hand.length}</span>
        <span title="사용한 카드">🗂️{player.playedCards.length}</span>
      </div>
    </div>
  );
}

/** Desktop's full stacked opponent rows — one `PlayerSummaryRow` per seat. */
export function OpponentsSummary({
  players,
  names,
  activeSeat,
  connectedSeats,
  setRef,
}: {
  players: PlayerState[];
  names: Record<SeatIndex, string>;
  activeSeat: SeatIndex;
  connectedSeats: Set<SeatIndex>;
  setRef: (seat: SeatIndex) => (el: HTMLDivElement | null) => void;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      {players.map((p) => (
        <PlayerSummaryRow
          key={p.seat}
          player={p}
          name={names[p.seat]}
          isActive={activeSeat === p.seat}
          connected={connectedSeats.has(p.seat)}
          setRef={setRef(p.seat)}
        />
      ))}
    </section>
  );
}

/**
 * Mobile compact dashboard's opponent strip — one small badge per opponent
 * (avatar-less initial + turn/point/hand indicators) in a single
 * horizontally-wrapping row, sitting above the hand strip per the brief's
 * "하단 25%: ... 상대방 보유 자원 미니 인디케이터" cell. Still wires the same
 * per-seat DOM ref MerchantEffects.tsx's flying-resource animation needs.
 */
export function OpponentsSummaryCompact({
  players,
  names,
  activeSeat,
  connectedSeats,
  setRef,
}: {
  players: PlayerState[];
  names: Record<SeatIndex, string>;
  activeSeat: SeatIndex;
  connectedSeats: Set<SeatIndex>;
  setRef: (seat: SeatIndex) => (el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {players.map((p) => {
        const isActive = activeSeat === p.seat;
        return (
          <div
            key={p.seat}
            ref={setRef(p.seat)}
            className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold whitespace-nowrap ${
              isActive ? "border-amber-300/60 bg-amber-400/10 text-amber-100" : "border-white/10 bg-black/20 text-white/60"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${connectedSeats.has(p.seat) ? "bg-emerald-400" : "bg-white/20"}`} />
            {isActive && "👉"}
            <span className="max-w-[64px] truncate break-keep">{names[p.seat]}</span>
            <span className="text-white/40">🏆{p.pointCards.length}</span>
          </div>
        );
      })}
    </div>
  );
}
