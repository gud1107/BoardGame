"use client";

import Overlay from "@/components/Overlay";
import { CardFace, HeartPips } from "./CardArt";
import { buildFormulaTerms, FormulaBar } from "./CoyoteEffects";
import { STARTING_HEARTS, type RoundResult, type SeatIndex } from "./engine";

/**
 * "📜 이전 결과" — 이번 게임에서 지나간 판정을 최신순으로 다시 본다. 엔진의
 * `resolutionHistory`(공개 시점에 이미 모두에게 보였던 정보뿐)만 읽으므로
 * 진행 중인 라운드의 내 이마 카드는 절대 새지 않는다.
 */
export default function CoyoteHistoryModal({
  history,
  names,
  viewerSeat,
  gameOver,
  onClose,
}: {
  history: RoundResult[];
  names: Record<SeatIndex, string>;
  viewerSeat: SeatIndex;
  /** 게임이 끝났으면 맨 마지막 기록에 "🏁 마지막 승부" 표시. */
  gameOver: boolean;
  onClose: () => void;
}) {
  const rows = history.map((r, i) => ({ r, last: i === history.length - 1 })).reverse();
  return (
    <Overlay title={`📜 이전 결과 (${history.length}판)`} onClose={onClose} wide>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/50 light:text-slate-500">아직 끝난 판정이 없어요.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map(({ r, last }) => (
            <HistoryRow key={r.roundNumber} result={r} names={names} viewerSeat={viewerSeat} finale={gameOver && last} />
          ))}
        </ol>
      )}
    </Overlay>
  );
}

function HistoryRow({ result, names, viewerSeat, finale }: { result: RoundResult; names: Record<SeatIndex, string>; viewerSeat: SeatIndex; finale: boolean }) {
  const { resolution: res, roundNumber, heartsAfter } = result;
  const terms = buildFormulaTerms(res);
  const loserHearts = heartsAfter[res.loserSeat] ?? 0;
  const who = (seat: SeatIndex) => `${names[seat]}${seat === viewerSeat ? " (나)" : ""}`;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/30 p-3 text-xs light:border-slate-200 light:bg-white">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded-full bg-white/10 px-2 py-0.5 font-bold text-white/80 light:bg-slate-100 light:text-slate-700">{roundNumber}라운드</span>
        {finale && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-bold text-amber-200 light:bg-amber-100 light:text-amber-800">🏁 마지막 승부</span>}
        <span className="break-keep text-white/80 light:text-slate-700">
          <span className="font-bold text-rose-200 light:text-rose-700">🐺 {who(res.callerSeat)}</span>
          <span className="mx-1 text-white/40 light:text-slate-400">→</span>
          <span className="font-bold text-amber-200 light:text-amber-700">📢 {who(res.bid.seat)}</span> 선언 {res.bid.number}
        </span>
      </div>

      <FormulaBar terms={terms} doubled={res.doubled} finalTotal={res.finalTotal} revealedTotal={res.finalTotal} bidNumber={res.bid.number} callerWon={res.loserWasBidder} />

      <div className="flex flex-wrap justify-center gap-2">
        {terms.map((t) => (
          <div key={t.key} className="flex w-14 flex-col items-center gap-0.5">
            <CardFace card={t.card} size="xs" highlight={t.seat === viewerSeat} className={t.zeroed ? "opacity-60 grayscale" : ""} />
            <span className={`max-w-full truncate text-[10px] ${t.seat === viewerSeat ? "font-bold text-amber-200 light:text-amber-700" : "text-white/60 light:text-slate-500"}`}>
              {t.seat === viewerSeat ? "나" : t.seat !== null ? names[t.seat] : "덱"}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 break-keep">
        <span className="font-semibold text-white light:text-slate-900">
          💔 {who(res.loserSeat)} 하트 −1{loserHearts <= 0 && <span className="ml-1 text-rose-300 light:text-rose-600">· 💀 탈락</span>}
        </span>
        {loserHearts > 0 && <HeartPips hearts={loserHearts} max={STARTING_HEARTS} />}
      </div>
    </li>
  );
}
