"use client";

import CoinStack from "./CoinStack";
import type { AuctionState, PlayerState, SeatIndex } from "./types";

/**
 * "베팅 아레나" — the one part of the board that gets the dark-luxury casino
 * treatment (confirmed scope: everything else keeps the board's existing
 * purple/black theme). Shows every seat's live `auction.committed` purse as
 * a coin stack around a shared center "vault" icon, which doubles as the
 * flight target for the vault-absorb animation (see AuctionCoinEffects.tsx).
 *
 * Height-capped on mobile only (`max-h-[...] lg:max-h-none`) per the
 * confirmed scope — only this panel is protected from pushing the page past
 * one viewport, not the whole board.
 */
export default function BettingArena({
  players,
  auction,
  names,
  registerBetSpotRef,
  registerVaultRef,
}: {
  players: PlayerState[];
  auction: AuctionState;
  names: Record<SeatIndex, string>;
  registerBetSpotRef: (seat: SeatIndex) => (el: HTMLDivElement | null) => void;
  registerVaultRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      className="relative max-h-[min(85vw,36dvh)] overflow-y-auto rounded-2xl border-2 border-amber-500/40 bg-gradient-to-b from-emerald-950/80 via-emerald-950/60 to-black/60 p-3 shadow-[inset_0_0_30px_rgba(0,0,0,0.6)] light:max-h-none light:border-slate-200 light:bg-white/90 light:shadow-sm lg:max-h-none"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at center, rgba(16,185,129,0.08) 0%, rgba(0,0,0,0) 70%)",
      }}
    >
      <div className="mb-2 flex items-center justify-center gap-1.5">
        <div
          ref={registerVaultRef}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-amber-400/60 bg-black/60 text-base shadow-[0_0_12px_rgba(251,191,36,0.35)] light:border-amber-300 light:bg-amber-50"
          title="금고"
        >
          🏦
        </div>
        <span className="text-[10px] font-semibold tracking-wide text-amber-200/70 light:text-amber-700">베팅 아레나</span>
      </div>

      <div className="flex flex-wrap items-start justify-center gap-3">
        {players.map((p) => {
          const committed = auction.committed[p.seat];
          const hasBet = !!committed && (committed[20] + committed[10] + committed[5] + committed[1]) > 0;
          return (
            <div key={p.seat} ref={registerBetSpotRef(p.seat)} className="flex flex-col items-center gap-1">
              {hasBet ? (
                <CoinStack purse={committed!} />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-amber-400/25 light:border-slate-300">
                  <span className="text-[9px] text-white/30 light:text-slate-400">대기</span>
                </div>
              )}
              <span className="max-w-[72px] truncate rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold text-white/80 light:bg-slate-100 light:text-slate-700">
                {names[p.seat] ?? "상대"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
