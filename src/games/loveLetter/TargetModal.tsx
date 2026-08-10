"use client";

import { useState } from "react";
import Overlay from "@/components/Overlay";
import { CARD_NAMES, type CardNumber, type SeatIndex } from "./engine";
import { CARD_IMAGES } from "./CardArt";

/**
 * "대상 지정 및 카드 이름/번호 선택 모달" (task brief §2) — the only
 * decision-driving popup in this game: which seat to name (경비병/사제/남작/
 * 왕자/왕), and for 경비병 specifically, which character number (2~8) to
 * guess. Purely an input surface — it never touches `EngineAction` itself,
 * just hands the chosen `(targetSeat, guessNumber?)` back to
 * `LoveLetterBoard.tsx` via `onConfirm`, which is the one that calls
 * `onAction`. Kept in its own file (not `LoveLetterEffects.tsx`, which is
 * cosmetic-only per this project's 3-layer split, ARCHITECTURE.md §2) since
 * this is a meaningfully sized piece of interactive, game-driving UI.
 */

const GUESSABLE_NUMBERS: CardNumber[] = [2, 3, 4, 5, 6, 7, 8];

export interface TargetModalProps {
  cardNumber: CardNumber;
  targets: SeatIndex[];
  names: Record<SeatIndex, string>;
  viewerSeat: SeatIndex;
  onConfirm: (targetSeat: SeatIndex, guessNumber?: CardNumber) => void;
  onCancel: () => void;
}

export default function TargetModal({ cardNumber, targets, names, viewerSeat, onConfirm, onCancel }: TargetModalProps) {
  const [targetSeat, setTargetSeat] = useState<SeatIndex | null>(targets.length === 1 ? targets[0] : null);
  const [guessNumber, setGuessNumber] = useState<CardNumber | null>(null);

  const needsGuess = cardNumber === 1;
  const canConfirm = targetSeat !== null && (!needsGuess || guessNumber !== null);

  return (
    <Overlay title={`${cardNumber}. ${CARD_NAMES[cardNumber]} — 대상 지정`} onClose={onCancel} wide={needsGuess}>
      <div className="flex flex-col gap-4 text-sm text-white/80">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">누구를 지목할까요?</h3>
          <div className="flex flex-wrap gap-2">
            {targets.map((seat) => (
              <button
                key={seat}
                onClick={() => setTargetSeat(seat)}
                className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                  targetSeat === seat ? "border-rose-300 bg-rose-500/20 text-rose-100" : "border-white/15 text-white/70 hover:border-white/30"
                }`}
              >
                {seat === viewerSeat ? "나 자신" : names[seat]}
              </button>
            ))}
          </div>
        </section>

        {needsGuess && (
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">어떤 카드일지 추리하세요 (1번 제외)</h3>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {GUESSABLE_NUMBERS.map((n) => (
                <button
                  key={n}
                  onClick={() => setGuessNumber(n)}
                  title={`${n}. ${CARD_NAMES[n]}`}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-1.5 transition ${
                    guessNumber === n ? "border-amber-300 bg-amber-400/15" : "border-white/10 hover:border-white/25"
                  }`}
                >
                  <span className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md border border-white/15">
                    {/* eslint-disable-next-line @next/next/no-img-element -- tiny fixed thumbnail inside a modal grid, next/image's layout overhead isn't worth it here */}
                    <img src={CARD_IMAGES[n]} alt="" className="h-full w-full object-cover" />
                  </span>
                  <span className="text-[10px] leading-none font-semibold text-white/80">{n}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-white/70 hover:border-white/30">
            취소
          </button>
          <button
            disabled={!canConfirm}
            onClick={() => onConfirm(targetSeat!, needsGuess ? guessNumber! : undefined)}
            className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-30"
          >
            확정
          </button>
        </div>
      </div>
    </Overlay>
  );
}
