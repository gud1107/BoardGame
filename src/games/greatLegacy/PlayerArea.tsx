"use client";

import Avatar from "@/components/common/Avatar";
import { purseValue } from "./constants";
import { computeCollectionBonus, computePlayerScore } from "./engine";
import type { CoinVisibility, PlayerState, SeatIndex } from "./types";

const MARKET_EMOJI: Record<string, string> = { 미장: "🇺🇸", 국장: "🇰🇷", 코인: "🪙" };
const SECTOR_EMOJI: Record<string, string> = { "빅테크&AI": "🤖", 블루칩: "🏆", "밈&테마주": "🎢" };

/**
 * One seat's summary card — name, purse (respecting `coinVisibility`), asset
 * count + collection badges, and the seat's current auction status (active
 * bidder / passed / not yet acted). Read-only, no interaction — bidding
 * itself lives in ActionPanel.
 */
export default function PlayerArea({
  player,
  name,
  viewerSeat,
  coinVisibility,
  isActive,
  hasPassed,
  isConnected,
}: {
  player: PlayerState;
  name: string;
  viewerSeat: SeatIndex;
  coinVisibility: CoinVisibility;
  isActive: boolean;
  hasPassed: boolean;
  isConnected: boolean;
}) {
  const isMe = player.seat === viewerSeat;
  const canSeeCoins = isMe || coinVisibility === "public";
  const score = computePlayerScore(player);
  const { markets, sectors } = computeCollectionBonus(player.assets);
  const ownedAssets = player.assets.filter((a) => !a.discarded);

  return (
    <div
      className={`flex flex-col gap-2 rounded-2xl border p-3 transition ${
        isActive
          ? "border-amber-400/60 bg-amber-400/10 shadow-[0_0_20px_-6px_rgba(251,191,36,0.5)] light:border-amber-400 light:bg-amber-50"
          : hasPassed
            ? "border-white/5 bg-white/[0.02] opacity-60 light:border-slate-200 light:bg-slate-100"
            : "border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white/80"
      }`}
    >
      <div className="flex items-center gap-2">
        <Avatar size={22} />
        <span className={`truncate text-sm font-semibold ${isMe ? "text-emerald-300 light:text-emerald-700" : "text-white light:text-slate-900"}`}>
          {name}
          {isMe && " (나)"}
        </span>
        {!isConnected && <span className="text-xs text-white/30 light:text-slate-400">⏳</span>}
        {isActive && <span className="ml-auto rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200 light:bg-amber-100 light:text-amber-700">차례</span>}
        {hasPassed && <span className="ml-auto text-[10px] text-white/40 light:text-slate-400">포기함</span>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70 light:text-slate-600">
        <span>💰 {canSeeCoins ? `${purseValue(player.purse)}코인` : "??코인"}</span>
        <span>📊 보유자산 {ownedAssets.length}장</span>
        <span className="font-semibold text-white light:text-slate-900">점수 {score.total}</span>
      </div>

      {(markets.length > 0 || sectors.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {markets.map((m) => (
            <span key={m} className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] text-emerald-200 light:bg-emerald-100 light:text-emerald-700">
              {MARKET_EMOJI[m] ?? "💹"} {m} 영끌 올인 +3
            </span>
          ))}
          {sectors.map((s) => (
            <span key={s} className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] text-sky-200 light:bg-sky-100 light:text-sky-700">
              {SECTOR_EMOJI[s] ?? "🎴"} {s} 분산투자 +3
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
