"use client";

import { useMemo } from "react";
import { COUNTRIES, FORMATS, RELIC_DEFS } from "./constants";
import { computeRankings } from "./engine";
import ActionPanel from "./ActionPanel";
import PlayerArea from "./PlayerArea";
import type { EngineAction, GreatLegacyState, SeatIndex } from "./types";

const COUNTRY_EMOJI: Record<string, string> = { 한국: "🇰🇷", 이집트: "🇪🇬", 프랑스: "🇫🇷" };
const FORMAT_EMOJI: Record<string, string> = { 그림: "🖼️", 조각공예: "🗿", 건축물: "🏛️" };

/**
 * Always-visible sidebar: the full 3(국가)×3(형식) relic score reference
 * table (confirmed layout choice) plus the viewer's own collection progress
 * — which cells they already own, and which country/format completions
 * they're one card away from.
 */
function RelicReferenceSidebar({ ownedRelicIds }: { ownedRelicIds: Set<string> }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] light:border-slate-200 light:bg-white/90 light:shadow-sm p-3">
      <h3 className="text-xs font-semibold text-white/60 light:text-slate-600">🏺 유물 점수표</h3>
      <div className="flex flex-col gap-2">
        {COUNTRIES.map((country) => (
          <div key={country} className="rounded-lg border border-white/5 bg-black/20 light:border-slate-200 light:bg-slate-50 p-2">
            <p className="mb-1 text-xs font-semibold text-white/60 light:text-slate-600">
              {COUNTRY_EMOJI[country]} {country}
            </p>
            <div className="flex flex-col gap-0.5">
              {FORMATS.flatMap((format) => RELIC_DEFS.filter((r) => r.country === country && r.format === format)).map((r) => {
                const owned = ownedRelicIds.has(r.id);
                return (
                  <div key={r.id} className={`flex items-center gap-1 text-[11px] ${owned ? "text-emerald-300 light:text-emerald-700" : "text-white/50 light:text-slate-500"}`}>
                    <span className="shrink-0">{owned ? "✅" : "▫️"}</span>
                    <span className="shrink-0">{FORMAT_EMOJI[r.format]}</span>
                    <span className="min-w-0 flex-1 truncate" title={r.name}>
                      {r.name}
                    </span>
                    <span className="shrink-0 text-white/30 light:text-slate-400">{r.baseScore}점</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-white/40 light:text-slate-400">
        국가 컬렉션: 같은 국가 그림·조각공예·건축물 각 1장 → +3점 · 작품 컬렉션: 같은 형식으로 3개국 모두 → +3점 (한 장이 두 컬렉션에 동시에 카운트될 수 있어요)
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
  const me = state.players.find((p) => p.seat === viewerSeat)!;
  const ownedRelicIds = useMemo(() => new Set(me.relics.filter((r) => !r.discarded).map((r) => r.relicId)), [me.relics]);
  const auction = state.auction;

  const rankings = state.phase === "gameOver" ? computeRankings(state) : null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="order-2 lg:order-1 lg:w-64 lg:shrink-0">
        <RelicReferenceSidebar ownedRelicIds={ownedRelicIds} />
      </aside>

      <div className="order-1 flex flex-1 flex-col gap-4 lg:order-2">
        <div
          className="rounded-3xl border border-black/50 bg-gradient-to-b from-[#1a1023] via-[#120a17] to-[#0a0610] p-4 shadow-[0_0_60px_-20px_rgba(0,0,0,0.9)] light:border-slate-200 light:shadow-md"
          // Hardcoded dark inline gradient (via Tailwind arbitrary colors) — intentionally left as-is per theme-system guidance.
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white/80 light:text-slate-800">🏛️ 위대한 유산 — {state.mode === "4p" ? "4인" : "8인"} 경매</h2>
            <span className="text-xs text-white/40 light:text-slate-400">남은 매물 {state.deck.length + (auction ? 1 : 0)}장</span>
          </div>

          {auction && (
            <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.04] light:border-slate-200 light:bg-white/80 p-3">
              <div className="flex items-center justify-between">
                <span className="text-base font-bold text-white light:text-slate-900">
                  {auction.card.kind === "relic" ? (
                    <>
                      {auction.card.relic.name}{" "}
                      <span className="text-xs font-normal text-white/40 light:text-slate-400">
                        ({auction.card.relic.country} · {auction.card.relic.format} · {auction.card.relic.baseScore}점)
                      </span>
                    </>
                  ) : (
                    <>
                      {auction.card.special === "재평가" && "📈 재평가"}
                      {auction.card.special === "평가절하" && "📉 평가절하"}
                      {auction.card.special === "가품판정" && "🗑️ 가품 판정"}
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
                      {r.score.total}점 (유물 {r.score.relicScore} + 컬렉션 {r.score.collectionBonus}) · 잔여 {r.score.remainingCoinValue}코인
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
            <PlayerArea
              key={p.seat}
              player={p}
              name={names[p.seat] ?? "상대"}
              viewerSeat={viewerSeat}
              coinVisibility={state.coinVisibility}
              isActive={auction?.activeSeat === p.seat}
              hasPassed={auction?.passed.includes(p.seat) ?? false}
              isConnected={connectedSeats.has(p.seat)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
