"use client";

import Overlay from "@/components/Overlay";
import { CardFace } from "./CardFace";
import { visiblePastPrediction, type DestinyWar39State, type SeatIndex } from "./engine";

export interface LastRoundHistoryModalProps {
  state: DestinyWar39State;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  onClose: () => void;
}

/**
 * "직전 라운드 카드 조합" — turn-by-turn card reveal history for the most
 * recently *completed* round, sourced from `state.lastCompletedRound` (see
 * engine.ts). Available from the moment round 1 finishes through the rest
 * of the game, independent of the current phase, so a player can revisit
 * what was played even after the round has moved on. Predictions still
 * respect the same hidden-token redaction as everywhere else in the UI —
 * card plays themselves are never secret (they were revealed live).
 */
export default function LastRoundHistoryModal({ state, viewerSeat, names, onClose }: LastRoundHistoryModalProps) {
  const round = state.lastCompletedRound;
  const seatLabel = (seat: SeatIndex) => (seat === viewerSeat ? `${names[seat]} (나)` : names[seat]);

  return (
    <Overlay title="🕓 직전 라운드 카드 조합" onClose={onClose} wide>
      {!round ? (
        <p className="text-sm text-white/50">아직 완료된 라운드가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-5 text-sm text-white/80">
          <p className="text-xs text-white/50">ROUND {round.roundNumber} — 턴별 공개 카드와 승자</p>

          <div className="flex flex-col gap-3">
            {round.turnRecords.map((t) => (
              <div key={t.turnNumber} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center justify-between text-xs text-white/50">
                  <span>턴 {t.turnNumber}</span>
                  {t.reverseActive && (
                    <span className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-2 py-0.5 text-fuchsia-200">🔄 리버스 발동</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2.5">
                  {Array.from({ length: state.playerCount }, (_, seat) => {
                    const p = t.plays.find((x) => x.seat === seat);
                    if (!p) return null;
                    const isWinner = seat === t.winnerSeat;
                    return (
                      <div key={seat} className="flex flex-col items-center gap-1">
                        <span className={`text-[10px] ${isWinner ? "font-bold text-amber-200" : "text-white/50"}`}>
                          {seatLabel(seat)}
                          {isWinner ? " 🏆" : ""}
                        </span>
                        <CardFace card={p.card} playerCount={state.playerCount} size="sm" className={isWinner ? "ring-2 ring-amber-300/70" : ""} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[380px] border-collapse text-xs">
              <thead>
                <tr className="bg-white/5 text-white/50">
                  <th className="px-2 py-1.5 text-left">플레이어</th>
                  <th className="px-2 py-1.5 text-center">예측</th>
                  <th className="px-2 py-1.5 text-center">실제</th>
                  <th className="px-2 py-1.5 text-right">점수</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: state.playerCount }, (_, seat) => {
                  const idx = round.roundNumber - 1;
                  const player = state.players.find((p) => p.seat === seat)!;
                  const visible = visiblePastPrediction(state, viewerSeat, seat, round.roundNumber);
                  const isHiddenFromMe = visible === "hidden";
                  return (
                    <tr key={seat} className="border-t border-white/10">
                      <td className="px-2 py-1.5 font-medium text-white/90">{seatLabel(seat)}</td>
                      <td className="px-2 py-1.5 text-center text-white/70">{isHiddenFromMe ? "🙈" : player.predictions[idx]}</td>
                      <td className="px-2 py-1.5 text-center text-white/70">{player.actualWins[idx]}</td>
                      <td className="px-2 py-1.5 text-right text-white/80">
                        {isHiddenFromMe ? "?" : `${(player.scores[idx] ?? 0) >= 0 ? "+" : ""}${player.scores[idx]}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Overlay>
  );
}
