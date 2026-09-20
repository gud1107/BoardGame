"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ASSET_DEFS, MARKETS, SECTORS } from "./constants";
import { computeRankings } from "./engine";
import ActionPanel from "./ActionPanel";
import PlayerArea from "./PlayerArea";
import BettingArena from "./BettingArena";
import RulebookModal from "./RulebookModal";
import { detectCoinEvents, FlyingCoins, type CoinAnimEvent } from "./AuctionCoinEffects";
import { getSoundEngine } from "@/lib/audio/soundEngine";
import type { EngineAction, GreatLegacyState, SeatIndex } from "./types";

const MARKET_EMOJI: Record<string, string> = { 미장: "🇺🇸", 국장: "🇰🇷", 코인: "🪙" };
const SECTOR_EMOJI: Record<string, string> = { "빅테크&AI": "🤖", 블루칩: "🏆", "밈&테마주": "🎢" };

/**
 * Always-visible sidebar: the full 3(시장)×3(섹터) asset score reference
 * table (confirmed layout choice, carried over from 위대한유산) plus the
 * viewer's own portfolio progress — which cells they already own, and which
 * market/sector completions they're one card away from.
 */
function AssetReferenceSidebar({ ownedAssetIds }: { ownedAssetIds: Set<string> }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white/90 light:shadow-sm p-3">
      <h3 className="text-xs font-semibold text-white/60 light:text-slate-600">📈 자산 점수표</h3>
      <div className="flex flex-col gap-2">
        {MARKETS.map((market) => (
          <div key={market} className="rounded-lg border border-white/5 bg-black/20 light:border-slate-200 light:bg-slate-50 p-2">
            <p className="mb-1 text-xs font-semibold text-white/60 light:text-slate-600">
              {MARKET_EMOJI[market]} {market}
            </p>
            <div className="flex flex-col gap-0.5">
              {SECTORS.flatMap((sector) => ASSET_DEFS.filter((a) => a.market === market && a.sector === sector)).map((a) => {
                const owned = ownedAssetIds.has(a.id);
                return (
                  <div key={a.id} className={`flex items-center gap-1 text-[11px] ${owned ? "text-emerald-300 light:text-emerald-700" : "text-white/50 light:text-slate-500"}`}>
                    <span className="shrink-0">{owned ? "✅" : "▫️"}</span>
                    <span className="shrink-0">{SECTOR_EMOJI[a.sector]}</span>
                    <span className="min-w-0 flex-1 truncate" title={a.name}>
                      {a.name}
                    </span>
                    <span className="shrink-0 text-white/30 light:text-slate-400">{a.baseScore}점</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-white/40 light:text-slate-400">
        영끌 올인: 같은 시장의 빅테크&AI·블루칩·밈&테마주 각 1장 → +3점 · 테마 분산투자: 같은 섹터로 3개 시장 모두 → +3점 (한 장이 두 컬렉션에 동시에 카운트될 수 있어요)
      </p>
    </div>
  );
}

export interface GreatLegacyBoardProps {
  state: GreatLegacyState;
  viewerSeat: SeatIndex;
  names: Record<SeatIndex, string>;
  connectedSeats: Set<SeatIndex>;
  onAction: (action: EngineAction) => void;
  onGameEnd: () => void;
}

export default function GreatLegacyBoard({ state, viewerSeat, names, connectedSeats, onAction, onGameEnd }: GreatLegacyBoardProps) {
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const ownedAssetIds = useMemo(() => new Set(me.assets.filter((a) => !a.discarded).map((a) => a.assetId)), [me.assets]);
  const auction = state.auction;

  const rankings = state.phase === "gameOver" ? computeRankings(state) : null;

  // Coin-flight/sound effects (see AuctionCoinEffects.tsx) — diffed from
  // consecutive state snapshots so every connected client, not just the
  // player who acted, plays the same animation + SFX.
  const [trackedState, setTrackedState] = useState(state);
  const [coinEffects, setCoinEffects] = useState<CoinAnimEvent[]>([]);
  if (trackedState !== state) {
    const detected = detectCoinEvents(trackedState, state);
    setTrackedState(state);
    if (detected.length > 0) {
      const sound = getSoundEngine();
      let nextId = (coinEffects.at(-1)?.id ?? 0) + 1;
      const withIds = detected.map((e) => ({ ...e, id: nextId++ }));
      setCoinEffects((prev) => [...prev, ...withIds]);
      for (const e of detected) {
        if (e.kind === "bid") sound.playCoinDropSound();
        else if (e.kind === "refund-sweep") sound.playCoinSweepSound();
        else sound.playVaultAbsorbSound();
      }
    }
  }
  const handleCoinEffectDone = useCallback((id: number) => {
    setCoinEffects((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const seatRefs = useRef(new Map<SeatIndex, HTMLDivElement>());
  const betSpotRefs = useRef(new Map<SeatIndex, HTMLDivElement>());
  const vaultRef = useRef<HTMLDivElement | null>(null);
  function setSeatRef(seat: SeatIndex) {
    return (el: HTMLDivElement | null) => {
      if (el) seatRefs.current.set(seat, el);
      else seatRefs.current.delete(seat);
    };
  }
  function setBetSpotRef(seat: SeatIndex) {
    return (el: HTMLDivElement | null) => {
      if (el) betSpotRefs.current.set(seat, el);
      else betSpotRefs.current.delete(seat);
    };
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="order-2 lg:order-1 lg:w-64 lg:shrink-0">
        <AssetReferenceSidebar ownedAssetIds={ownedAssetIds} />
      </aside>

      <div className="order-1 flex flex-1 flex-col gap-4 lg:order-2">
        <div
          className="rounded-3xl border border-black/50 bg-gradient-to-b from-[#1a1023] via-[#120a17] to-[#0a0610] p-4 shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)] light:border-slate-200 light:shadow-md"
          // Hardcoded dark inline gradient (via Tailwind arbitrary colors) — intentionally left as-is per theme-system guidance.
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white/80 light:text-slate-800">📈 위대한 투자 — {state.mode === "4p" ? "4인" : "8인"} 경매</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40 light:text-slate-400">남은 매물 {state.deck.length + (auction ? 1 : 0)}장</span>
              <button
                type="button"
                onClick={() => setRulebookOpen(true)}
                className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-white/30 hover:text-white light:border-slate-300 light:text-slate-600 light:hover:border-slate-400 light:hover:text-slate-900"
              >
                📖 룰북
              </button>
            </div>
          </div>

          {auction && (
            <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.04] light:border-slate-200 light:bg-white/80 p-3">
              <div className="flex items-center justify-between">
                <span className="text-base font-bold text-white light:text-slate-900">
                  {auction.card.kind === "asset" ? (
                    <>
                      {auction.card.asset.name}{" "}
                      <span className="text-xs font-normal text-white/40 light:text-slate-400">
                        ({auction.card.asset.market} · {auction.card.asset.sector} · {auction.card.asset.baseScore}점)
                      </span>
                    </>
                  ) : (
                    <>
                      {auction.card.special === "초대형호재" && "🚀 초대형 호재"}
                      {auction.card.special === "악재어닝쇼크" && "📉 악재/어닝쇼크"}
                      {auction.card.special === "상장폐지" && "🗑️ 상장폐지"}
                      {auction.card.special === "강제반대매매" && "⚠️ 강제 반대매매"}
                    </>
                  )}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    auction.kind === "reverse"
                      ? "bg-rose-400/20 text-rose-200 light:bg-rose-100 light:text-rose-700"
                      : "bg-emerald-400/20 text-emerald-200 light:bg-emerald-100 light:text-emerald-700"
                  }`}
                >
                  {auction.kind === "reverse" ? "역경매 — 먼저 포기하면 낙찰" : "일반 경매"}
                </span>
              </div>
              <div className="text-xs text-white/50 light:text-slate-500">
                현재 최고 입찰 <b className="text-amber-200 light:text-amber-700">{auction.highestBid}코인</b>
                {auction.highestBidder !== null && ` (${names[auction.highestBidder] ?? "상대"})`} · 차례:{" "}
                <b className="text-white/80 light:text-slate-700">{names[auction.activeSeat] ?? "상대"}</b>
              </div>
            </div>
          )}

          {auction && (
            <div className="mb-4">
              <BettingArena
                players={state.players}
                auction={auction}
                names={names}
                registerBetSpotRef={setBetSpotRef}
                registerVaultRef={(el) => {
                  vaultRef.current = el;
                }}
              />
            </div>
          )}

          {state.phase === "playing" && auction && <ActionPanel state={state} viewerSeat={viewerSeat} onAction={onAction} />}

          {state.phase === "gameOver" && rankings && (
            <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 light:border-amber-300 light:bg-amber-50 p-4 text-center">
              <p className="text-lg font-bold text-white light:text-slate-900">🏆 게임 종료!</p>
              <div className="flex flex-col gap-1 text-sm text-white/80 light:text-slate-700">
                {rankings.map((r) => (
                  <div key={r.seat} className="flex items-center justify-between rounded-lg bg-black/20 light:bg-white/70 px-3 py-1.5">
                    <span>
                      {r.rank}위 {names[r.seat] ?? "상대"}
                    </span>
                    <span className="text-white/60 light:text-slate-500">
                      {r.score.total}점 (자산 {r.score.assetScore} + 컬렉션 {r.score.collectionBonus}) · 잔여 {r.score.remainingCoinValue}코인
                    </span>
                  </div>
                ))}
              </div>
              <button onClick={onGameEnd} className="mx-auto rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
                결과 확인
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {state.players.map((p) => (
            <div key={p.seat} ref={setSeatRef(p.seat)}>
              <PlayerArea
                player={p}
                name={names[p.seat] ?? "상대"}
                viewerSeat={viewerSeat}
                coinVisibility={state.coinVisibility}
                isActive={auction?.activeSeat === p.seat}
                hasPassed={auction?.passed.includes(p.seat) ?? false}
                isConnected={connectedSeats.has(p.seat)}
              />
            </div>
          ))}
        </div>
      </div>

      {coinEffects.map((effect) => (
        <FlyingCoins
          key={effect.id}
          event={effect}
          getSourceEl={() => (effect.kind === "bid" ? (seatRefs.current.get(effect.seat) ?? null) : (betSpotRefs.current.get(effect.seat) ?? null))}
          getTargetEl={() =>
            effect.kind === "bid"
              ? (betSpotRefs.current.get(effect.seat) ?? null)
              : effect.kind === "refund-sweep"
                ? (seatRefs.current.get(effect.seat) ?? null)
                : vaultRef.current
          }
          onDone={handleCoinEffectDone}
        />
      ))}

      {rulebookOpen && <RulebookModal mode={state.mode} onClose={() => setRulebookOpen(false)} />}
    </div>
  );
}
